/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { NetUtil } from "resource://gre/modules/NetUtil.sys.mjs";
import { PrivateBrowsingUtils } from "resource://gre/modules/PrivateBrowsingUtils.sys.mjs";
import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";
import { LegacySDKPageMod } from "resource://gre/modules/addons/LegacySDKPageMod.sys.mjs";
import {
  cloneLegacyError,
  createLegacyNamespace,
} from "resource://gre/modules/addons/LegacyModuleLoader.sys.mjs";
import { parseXMLData } from "moz-src:///toolkit/components/search/OpenSearchLoader.sys.mjs";

const lazy = {};
XPCOMUtils.defineLazyGlobalGetters(lazy, ["XMLHttpRequest", "btoa", "atob"]);
ChromeUtils.defineESModuleGetters(lazy, {
  SearchService: "moz-src:///toolkit/components/search/SearchService.sys.mjs",
});

const PREF_COMMAND_TOPIC = "legacy-sdk-preference-command";
const SEARCH_CONTRACT = "@mozilla.org/browser/search-service;1";
const STORAGE_PREF = "sdk.simple-storage";
const SEARCH_TOPIC = "browser-search-engine-modified";
const SEARCH_ENGINE_INTERFACE = Object.freeze({ DATA_XML: 1 });

const REASONS = new Map([
  [1, "startup"],
  [2, "shutdown"],
  [3, "enable"],
  [4, "disable"],
  [5, "install"],
  [6, "uninstall"],
  [7, "upgrade"],
  [8, "downgrade"],
]);

function readURI(uri) {
  const channel = NetUtil.newChannel({ uri, loadUsingSystemPrincipal: true });
  const stream = channel.open();
  try {
    return NetUtil.readInputStreamToString(stream, stream.available(), {
      charset: "UTF-8",
    });
  } finally {
    stream.close();
  }
}

function reasonName(reason) {
  return REASONS.get(reason) ?? String(reason).toLowerCase();
}

function openTab(url) {
  const win = Services.wm.getMostRecentWindow("navigator:browser");
  if (!win?.gBrowser) {
    throw new Error(`Cannot open ${url}: no browser window is available`);
  }
  const tab = win.gBrowser.addTab(url, {
    triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
  });
  win.gBrowser.selectedTab = tab;
  return tab;
}

function wrapTab(win, tab) {
  return {
    get id() {
      return tab.linkedPanel;
    },
    get url() {
      return tab.linkedBrowser.currentURI.spec;
    },
    set url(value) {
      tab.linkedBrowser.loadURI(Services.io.newURI(String(value)), {
        triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
      });
    },
    activate() {
      win.gBrowser.selectedTab = tab;
      win.focus();
    },
  };
}

export class LegacySDKLoader {
  #rootURI;
  #moduleLoader;
  #addonId;
  #metadata;
  #modules = new Map();
  #pageMods = new Set();
  #prefListeners = new Map();
  #requests = new Set();
  #prefBranch;
  #prefObserver;
  #commandObserver;
  #storage;
  #main;
  #services;
  #startupObserver = null;
  #searchObservers = new Map();
  #searchOperations = Promise.resolve();
  #destroyed = false;

  constructor(rootURI, moduleLoader) {
    this.#rootURI = String(rootURI).endsWith("/") ? String(rootURI) : `${rootURI}/`;
    this.#moduleLoader = moduleLoader;
    this.#metadata = JSON.parse(readURI(this.#uri("package.json")));
    this.#addonId = this.#metadata.id;
    this.#prefBranch = Services.prefs.getBranch(`extensions.${this.#addonId}.`);
    this.#storage = this.#makeStorage();

    this.#prefObserver = (_subject, _topic, name) => this.#emitPreference(name);
    this.#prefBranch.addObserver("", this.#prefObserver);
    this.#commandObserver = (_subject, _topic, data) => {
      let command;
      try {
        command = JSON.parse(data);
      } catch {
        return;
      }
      if (command.id === this.#addonId && typeof command.name === "string") {
        this.#emitPreference(command.name);
      }
    };
    Services.obs.addObserver(this.#commandObserver, PREF_COMMAND_TOPIC);

    this.bootstrap = Object.freeze({
      install: this.install.bind(this),
      startup: this.startup.bind(this),
      shutdown: this.shutdown.bind(this),
      uninstall: this.uninstall.bind(this),
    });
  }

  createServices(services) {
    if (this.#services) {
      return this.#services;
    }
    const observers = services.obs;
    this.#services = createLegacyNamespace(services, {
      obs: createLegacyNamespace(observers, {
        addObserver: (observer, topic, weak = false) => {
          if (topic !== SEARCH_TOPIC) {
            return observers.addObserver(observer, topic, weak);
          }
          const adapted = {
            observe(subject, notification, data) {
              const engine = subject?.wrappedJSObject ?? subject;
              const legacySubject = subject && {
                wrappedJSObject: engine,
                QueryInterface(iid) {
                  if (
                    iid === SEARCH_ENGINE_INTERFACE ||
                    iid.equals?.(Ci.nsISupports)
                  ) {
                    return engine;
                  }
                  throw Components.Exception("", Cr.NS_ERROR_NO_INTERFACE);
                },
              };
              observer.observe(legacySubject, notification, data);
            },
          };
          this.#searchObservers.set(observer, adapted);
          observers.addObserver(adapted, topic, false);
        },
        removeObserver: (observer, topic) => {
          if (topic !== SEARCH_TOPIC) {
            return observers.removeObserver(observer, topic);
          }
          const adapted = this.#searchObservers.get(observer);
          this.#searchObservers.delete(observer);
          return observers.removeObserver(adapted ?? observer, topic);
        },
      }),
    });
    return this.#services;
  }

  #queueSearch(operation) {
    const result = this.#searchOperations.then(operation);
    this.#searchOperations = result.catch(error =>
      console.error(`Legacy SDK search operation failed for ${this.#addonId}`, error)
    );
    return result;
  }

  async #addSearchEngine(url, iconURL) {
    const uri = Services.io.newURI(String(url));
    if (!uri.spec.startsWith(this.#rootURI)) {
      return lazy.SearchService.addOpenSearchEngine(uri.spec, iconURL);
    }
    const channel = NetUtil.newChannel({ uri, loadUsingSystemPrincipal: true });
    const stream = channel.open();
    const input = Cc["@mozilla.org/binaryinputstream;1"].createInstance(Ci.nsIBinaryInputStream);
    let bytes;
    try {
      input.setInputStream(stream);
      bytes = input.readByteArray(stream.available());
    } finally {
      stream.close();
    }
    const engineData = await parseXMLData(bytes);
    engineData.installURL = uri;
    await lazy.SearchService.init();
    return lazy.SearchService.addOpenSearchEngineFromData(engineData, iconURL);
  }

  #uri(path) {
    return Services.io.newURI(path, null, Services.io.newURI(this.#rootURI));
  }

  #makeStorage() {
    let stored = {};
    try {
      if (this.#prefBranch.prefHasUserValue(STORAGE_PREF)) {
        stored = JSON.parse(this.#prefBranch.getStringPref(STORAGE_PREF));
      }
    } catch (error) {
      console.error(`Invalid simple-storage data for ${this.#addonId}`, error);
    }
    const save = () =>
      this.#prefBranch.setStringPref(STORAGE_PREF, JSON.stringify(stored));
    return new Proxy(stored, {
      set(target, name, value) {
        target[name] = value;
        save();
        return true;
      },
      deleteProperty(target, name) {
        const changed = delete target[name];
        save();
        return changed;
      },
    });
  }

  #preferenceDefinition(name) {
    return this.#metadata.preferences?.find(pref => pref.name === name);
  }

  #readPreference(name) {
    const definition = this.#preferenceDefinition(name);
    if (!definition) {
      return undefined;
    }
    if (!this.#prefBranch.prefHasUserValue(name)) {
      return definition.value;
    }
    switch (definition.type) {
      case "bool":
        return this.#prefBranch.getBoolPref(name);
      case "integer":
        return this.#prefBranch.getIntPref(name);
      default:
        return this.#prefBranch.getStringPref(name);
    }
  }

  #writePreference(name, value) {
    const definition = this.#preferenceDefinition(name);
    if (!definition || definition.type === "control") {
      throw new Error(`Unknown writable SDK preference: ${name}`);
    }
    switch (definition.type) {
      case "bool":
        this.#prefBranch.setBoolPref(name, Boolean(value));
        break;
      case "integer":
        this.#prefBranch.setIntPref(name, Number(value));
        break;
      default:
        this.#prefBranch.setStringPref(name, String(value));
        break;
    }
  }

  #emitPreference(name) {
    for (const listener of this.#prefListeners.get(name) ?? []) {
      try {
        listener(name);
      } catch (error) {
        console.error(`SDK preference listener failed for ${name}`, error);
      }
    }
  }

  #simplePrefs() {
    return {
      prefs: new Proxy(Object.create(null), {
        get: (_target, name) => this.#readPreference(name),
        set: (_target, name, value) => {
          this.#writePreference(name, value);
          return true;
        },
      }),
      on: (name, listener) => {
        let listeners = this.#prefListeners.get(name);
        if (!listeners) {
          listeners = new Set();
          this.#prefListeners.set(name, listeners);
        }
        listeners.add(listener);
      },
      removeListener: (name, listener) =>
        this.#prefListeners.get(name)?.delete(listener),
    };
  }

  #tabs() {
    const snapshots = () => {
      const tabs = [];
      for (const win of Services.wm.getEnumerator("navigator:browser")) {
        for (const tab of win.gBrowser?.tabs ?? []) {
          tabs.push(wrapTab(win, tab));
        }
      }
      return tabs;
    };
    const api = {
      open: url =>
        wrapTab(
          Services.wm.getMostRecentWindow("navigator:browser"),
          openTab(url)
        ),
      get activeTab() {
        const win = Services.wm.getMostRecentWindow("navigator:browser");
        return win?.gBrowser ? wrapTab(win, win.gBrowser.selectedTab) : null;
      },
      [Symbol.iterator]: () => snapshots()[Symbol.iterator](),
    };
    return new Proxy(api, {
      get(target, name, receiver) {
        if (name === "length") {
          return snapshots().length;
        }
        if (typeof name === "string" && /^\d+$/.test(name)) {
          return snapshots()[Number(name)];
        }
        return Reflect.get(target, name, receiver);
      },
      has(_target, name) {
        if (typeof name === "string" && /^\d+$/.test(name)) {
          return Number(name) < snapshots().length;
        }
        return name in api;
      },
    });
  }

  #searchService() {
    const search = lazy.SearchService;
    const loader = this;
    const report = error => console.error(`Legacy SDK search operation failed for ${this.#addonId}`, error);
    return new Proxy(search, {
      get(target, name) {
        switch (name) {
          case "init":
            return callback => target.init().then(() => callback?.(Cr.NS_OK), error => {
              callback?.(error.result ?? Cr.NS_ERROR_FAILURE);
              report(error);
            });
          case "addEngine":
            return (url, _dataType, iconURL) =>
              loader.#queueSearch(() => loader.#addSearchEngine(url, iconURL));
          case "currentEngine":
            return target.defaultEngine;
          case "moveEngine":
            return (engine, index) => loader.#queueSearch(() => target.moveEngine(engine, index));
          case "removeEngine":
            return engine => loader.#queueSearch(() => target.removeEngine(engine, target.CHANGE_REASON.ADDON_UNINSTALL));
          default: {
            const value = Reflect.get(target, name, target);
            return typeof value === "function" ? value.bind(target) : value;
          }
        }
      },
      set(target, name, value) {
        if (name !== "currentEngine") {
          return Reflect.set(target, name, value, target);
        }
        loader.#queueSearch(() => target.setDefault(value, target.CHANGE_REASON.ADDON_INSTALL));
        return true;
      },
    });
  }

  #chrome() {
    const globals = this.#moduleLoader.createGlobals(null);
    const classes = new Proxy(globals.Cc, {
      get: (target, contract) => {
        if (contract === SEARCH_CONTRACT) {
          return { getService: () => this.#searchService() };
        }
        return target[contract];
      },
    });
    const interfaces = new Proxy(globals.Ci, {
      get(target, name) {
        if (name === "nsISearchEngine") {
          return SEARCH_ENGINE_INTERFACE;
        }
        if (name === "nsIBrowserSearchService") {
          return Ci.nsISupports;
        }
        return target[name];
      },
    });
    return { ...globals, Cc: classes, Ci: interfaces };
  }

  #requestModule() {
    const loader = this;
    return {
      Request(options) {
        return {
          get() {
            const xhr = new lazy.XMLHttpRequest();
            loader.#requests.add(xhr);
            xhr.open("GET", String(options.url), true);
            xhr.onloadend = () => {
              loader.#requests.delete(xhr);
              options.onComplete?.({ status: xhr.status, text: xhr.responseText });
            };
            xhr.send();
            return this;
          },
        };
      },
    };
  }

  #sdkModule(id) {
    switch (id) {
      case "chrome":
        return this.#chrome();
      case "sdk/self":
        return {
          id: this.#addonId,
          name: this.#metadata.name,
          version: this.#metadata.version,
          data: { url: path => this.#uri(`data/${path}`).spec },
        };
      case "sdk/simple-storage":
        return { storage: this.#storage };
      case "sdk/tabs":
        return this.#tabs();
      case "sdk/preferences/service":
        return {
          get: (name, fallback) => {
            switch (Services.prefs.getPrefType(name)) {
              case Services.prefs.PREF_BOOL:
                return Services.prefs.getBoolPref(name);
              case Services.prefs.PREF_INT:
                return Services.prefs.getIntPref(name);
              case Services.prefs.PREF_STRING:
                return Services.prefs.getStringPref(name);
              default:
                return fallback;
            }
          },
          set: (name, value) => {
            if (typeof value === "boolean") Services.prefs.setBoolPref(name, value);
            else if (Number.isInteger(value)) Services.prefs.setIntPref(name, value);
            else Services.prefs.setStringPref(name, String(value));
          },
          reset: name => Services.prefs.clearUserPref(name),
        };
      case "sdk/simple-prefs":
        return this.#simplePrefs();
      case "sdk/base64":
        return { encode: value => lazy.btoa(unescape(encodeURIComponent(String(value)))), decode: value => decodeURIComponent(escape(lazy.atob(String(value)))) };
      case "sdk/private-browsing":
        return { isPrivate: win => Boolean(win && PrivateBrowsingUtils.isWindowPrivate(win)) };
      case "sdk/request":
        return this.#requestModule();
      case "sdk/windows":
        return { browserWindows: { get activeWindow() { return Services.wm.getMostRecentWindow("navigator:browser"); } } };
      case "sdk/page-mod":
        return { PageMod: options => {
          const pageMod = new LegacySDKPageMod(this.#addonId, this.#rootURI, options, Boolean(this.#metadata.permissions?.["private-browsing"]));
          this.#pageMods.add(pageMod);
          return pageMod;
        } };
      default:
        throw new Error(`Unsupported Add-on SDK dependency: ${id}`);
    }
  }

  #resolve(id, parentURI) {
    if (!id.startsWith(".")) {
      return { sdk: id };
    }
    const base = Services.io.newURI(parentURI);
    const uri = Services.io.newURI(id, null, base).spec;
    if (!uri.startsWith(this.#rootURI)) {
      throw new Error(`CommonJS module escapes add-on package: ${id}`);
    }
    const candidates = /\.(?:js|json)$/.test(uri) ? [uri] : [`${uri}.js`, `${uri}/index.js`];
    for (const candidate of candidates) {
      if (this.#modules.has(candidate)) {
        return { uri: candidate };
      }
      try {
        const source = readURI(Services.io.newURI(candidate));
        return { uri: candidate, source };
      } catch {}
    }
    throw new Error(`Cannot resolve CommonJS module ${id} from ${parentURI}`);
  }

  #require(id, parentURI = this.#rootURI) {
    const resolved = this.#resolve(id, parentURI);
    if (resolved.sdk) {
      if (!this.#modules.has(resolved.sdk)) {
        this.#modules.set(resolved.sdk, this.#sdkModule(resolved.sdk));
      }
      return this.#modules.get(resolved.sdk);
    }
    if (this.#modules.has(resolved.uri)) {
      return this.#modules.get(resolved.uri).exports;
    }
    const module = { exports: {} };
    this.#modules.set(resolved.uri, module);
    try {
      if (resolved.uri.endsWith(".json")) {
        module.exports = JSON.parse(resolved.source);
        return module.exports;
      }
      const scope = new Cu.Sandbox(Services.scriptSecurityManager.getSystemPrincipal(), {
        sandboxName: `${this.#addonId}: ${resolved.uri}`,
        freshCompartment: true,
        freezeBuiltins: false,
        wantComponents: false,
        metadata: { addonID: this.#addonId, URI: resolved.uri },
      });
      Object.assign(scope, this.#moduleLoader.createGlobals(scope), {
        module,
        exports: module.exports,
        require: id => this.#require(String(id), resolved.uri),
        console,
      });
      module.scope = scope;
      Cu.evalInSandbox(resolved.source, scope, undefined, resolved.uri, 1);
      return module.exports;
    } catch (error) {
      const retained = cloneLegacyError(error);
      if (module.scope) {
        Cu.nukeSandbox(module.scope);
      }
      this.#modules.delete(resolved.uri);
      throw retained;
    }
  }

  install() {}

  startup(_data, reason) {
    if (this.#destroyed) throw new Error("Legacy SDK loader has been destroyed");
    this.#main ??= this.#require(this.#metadata.main ? `./${this.#metadata.main}` : "./index");
    if (
      reasonName(reason) === "startup" &&
      !Services.wm.getMostRecentWindow("navigator:browser")?.gBrowser
    ) {
      this.#startupObserver = async () => {
        Services.obs.removeObserver(this.#startupObserver, "browser-delayed-startup-finished");
        this.#startupObserver = null;
        try {
          await this.#main.main?.({ loadReason: reasonName(reason) });
        } catch (error) {
          console.error(`Legacy SDK startup failed for ${this.#addonId}`, error);
        }
      };
      Services.obs.addObserver(this.#startupObserver, "browser-delayed-startup-finished");
      return undefined;
    }
    return this.#main.main?.({ loadReason: reasonName(reason) });
  }

  async shutdown(_data, reason) {
    try {
      await this.#main?.onUnload?.(reasonName(reason));
      await this.#searchOperations;
    } finally {
      this.destroy();
    }
  }

  uninstall(_data, reason) {
    if (reasonName(reason) === "uninstall") {
      this.#prefBranch.clearUserPref(STORAGE_PREF);
    }
  }

  destroy() {
    if (this.#destroyed) return;
    this.#destroyed = true;
    if (this.#startupObserver) {
      Services.obs.removeObserver(this.#startupObserver, "browser-delayed-startup-finished");
      this.#startupObserver = null;
    }
    this.#prefBranch.removeObserver("", this.#prefObserver);
    Services.obs.removeObserver(this.#commandObserver, PREF_COMMAND_TOPIC);
    for (const observer of this.#searchObservers.values()) {
      Services.obs.removeObserver(observer, SEARCH_TOPIC);
    }
    this.#searchObservers.clear();
    for (const pageMod of this.#pageMods) pageMod.destroy();
    for (const request of this.#requests) request.abort();
    this.#pageMods.clear();
    this.#requests.clear();
    this.#prefListeners.clear();
    for (const module of this.#modules.values()) {
      if (module?.scope) Cu.nukeSandbox(module.scope);
    }
    this.#modules.clear();
  }
}
