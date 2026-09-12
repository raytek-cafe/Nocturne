/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  createLegacyClasses,
  createLegacyInterfaces,
  generateLegacyQI,
} from "resource://gre/modules/addons/LegacyInterfaces.sys.mjs";
import { LegacyMessageManagers } from "resource://gre/modules/addons/LegacyMessageManager.sys.mjs";

const SIMPLE_URI_CONTRACT = "@mozilla.org/network/simple-uri;1";
const SIMPLE_URI_MUTATOR_CONTRACT = "@mozilla.org/network/simple-uri-mutator;1";
const modulePackages = new Map();

export function importLegacyModule(spec, target, callerGlobal) {
  if (
    target !== undefined && target !== null &&
    typeof target !== "object" && typeof target !== "function"
  ) {
    throw new TypeError("Legacy import target must be an object or null");
  }
  const sources = [
    Components.stack.caller?.filename,
    callerGlobal?.document?.documentURI,
    spec,
  ];
  for (const source of sources) {
    if (!source) {
      continue;
    }
    for (const [loader, owner] of modulePackages) {
      if (owner.resolveRegisteredURI(cleanModuleSpec(source))) {
        return loader.import(spec, target, callerGlobal);
      }
    }
  }
  throw new Error(`No active legacy add-on owns the import of ${spec}`);
}

export function createLegacyNamespace(native, overrides) {
  const methods = new Map();
  return new Proxy(overrides, {
    get(target, name, receiver) {
      if (Reflect.has(target, name)) {
        return Reflect.get(target, name, receiver);
      }
      if (native === Components && name === "stack") {
        return native.stack?.caller;
      }
      const value = native[name];
      if (typeof value !== "function") {
        return value;
      }
      if (!methods.has(name)) {
        methods.set(name, Function.prototype.bind.call(value, native));
      }
      return methods.get(name);
    },
    has(target, name) {
      return Reflect.has(target, name) || name in native;
    },
  });
}

const legacyPreferences = new Map([
  ["browser.tabs.drawInTitlebar", {
    name: "browser.tabs.inTitlebar",
    type: "int",
    toLegacy: value => value === 1 || (value === 2 && Services.appinfo.OS !== "Linux"),
    fromLegacy: value => value ? 1 : 0,
  }],
]);

export function getLegacyPreference(name) {
  return legacyPreferences.get(name);
}

function createLegacyPrefBranch(root = "", defaults = false) {
  const service = defaults ? Services.prefs.getDefaultBranch("") : Services.prefs;
  const native = defaults ? Services.prefs.getDefaultBranch(root)
    : root ? Services.prefs.getBranch(root) : Services.prefs;
  const overrides = {
    getBranch: prefix => createLegacyPrefBranch(root + (prefix ?? ""), defaults),
    getDefaultBranch: prefix => createLegacyPrefBranch(root + (prefix ?? ""), true),
    getBoolPref(name, ...fallback) {
      const alias = getLegacyPreference(root + name);
      return alias
        ? alias.toLegacy(service.getIntPref(alias.name, ...fallback.map(alias.fromLegacy)))
        : native.getBoolPref(name, ...fallback);
    },
    setBoolPref(name, value) {
      const alias = getLegacyPreference(root + name);
      return alias
        ? service.setIntPref(alias.name, alias.fromLegacy(value))
        : native.setBoolPref(name, value);
    },
    getPrefType(name) {
      const alias = getLegacyPreference(root + name);
      return alias && service.getPrefType(alias.name) === Ci.nsIPrefBranch.PREF_INT
        ? Ci.nsIPrefBranch.PREF_BOOL : native.getPrefType(name);
    },
  };
  for (const method of ["prefHasUserValue", "prefIsLocked", "clearUserPref", "lockPref", "unlockPref"]) {
    overrides[method] = name => {
      const alias = getLegacyPreference(root + name);
      return alias ? service[method](alias.name) : native[method](name);
    };
  }
  return createLegacyNamespace(native, overrides);
}

const legacyPrefService = createLegacyPrefBranch();

export function cloneLegacyError(error) {
  let retained;
  try {
    retained = Cu.cloneInto(error, {});
  } catch {
    retained = new Error(error?.message ?? String(error));
    retained.name = error?.name ?? "Error";
    if (error?.stack) {
      retained.stack = error.stack;
    }
  }
  if (typeof error?.result === "number") {
    retained.result = error.result;
  }
  return retained;
}

export function legacyFunctionToSource() {
  return `(${Function.prototype.toString.call(this)})`;
}

const URI_SETTERS = new Map([
  ["spec", "setSpec"],
  ["scheme", "setScheme"],
  ["userPass", "setUserPass"],
  ["username", "setUsername"],
  ["password", "setPassword"],
  ["hostPort", "setHostPort"],
  ["host", "setHost"],
  ["port", "setPort"],
  ["pathQueryRef", "setPathQueryRef"],
  ["ref", "setRef"],
  ["query", "setQuery"],
  ["filePath", "setFilePath"],
]);

function cleanModuleSpec(spec) {
  return String(spec).replace(/[?#].*$/, "");
}

function generateNSGetFactory(components) {
  const factories = new Map();
  for (const component of components) {
    const prototype = component.prototype;
    if (!(prototype?.classID instanceof Components.ID)) {
      throw new Error(
        `classID missing or incorrect for legacy component ${component}`
      );
    }
    const factory = prototype._xpcom_factory ?? {
      createInstance(iid) {
        return new component().QueryInterface(iid);
      },
      QueryInterface: ChromeUtils.generateQI(["nsIFactory"]),
    };
    factories.set(prototype.classID.toString(), factory);
  }
  return cid => {
    const factory = factories.get(cid.toString());
    if (!factory) {
      throw Components.Exception("", Cr.NS_ERROR_FACTORY_NOT_REGISTERED);
    }
    return factory;
  };
}

export function createLegacyXPCOMUtils() {
  const { XPCOMUtils } = ChromeUtils.importESModule(
    "resource://gre/modules/XPCOMUtils.sys.mjs"
  );
  return Object.assign(Object.create(XPCOMUtils), {
    generateQI: generateLegacyQI,
    generateNSGetFactory,
  });
}

export class LegacyModuleLoader {
  #addonId;
  #protocolRegistry;
  #modules = new Map();
  #retiredScopes = new Set();
  #policyWrappers = new WeakMap();
  #messageManagers = null;
  #uriFixup = null;
  #classes = null;
  #factoryWrappers = new WeakMap();
  #registrations = new Map();
  #uriFacades = new WeakMap();
  #sdkLoader = null;
  #destroyed = false;

  constructor(addonId, protocolRegistry = null) {
    this.#addonId = addonId;
    this.#protocolRegistry = protocolRegistry;
    this.#protocolRegistry?.setModuleLoader(this);
  }

  registerPackage(owner) {
    modulePackages.set(this, owner);
    return () => modulePackages.delete(this);
  }

  import(spec, target, scope) {
    return this.#loadModule(spec, target === undefined ? scope : target, scope);
  }

  unwrapURI(value) {
    const getNativeURI =
      (typeof value === "object" && value !== null) ||
      typeof value === "function"
        ? this.#uriFacades.get(value)
        : null;
    return getNativeURI ? getNativeURI() : value;
  }

  #makeMutableURI() {
    let nativeURI = null;
    const target = Object.create(null);
    const facade = new Proxy(target, {
      get(_target, name) {
        if (name === "QueryInterface") {
          return iid => nativeURI.QueryInterface(iid);
        }
        if (!nativeURI) {
          return undefined;
        }
        const value = nativeURI[name];
        return typeof value === "function"
          ? Function.prototype.bind.call(value, nativeURI)
          : value;
      },
      set(_target, name, value) {
        const setter = URI_SETTERS.get(name);
        if (!setter) {
          return Reflect.set(target, name, value);
        }
        const mutator = nativeURI
          ? nativeURI.mutate()
          : Cc[SIMPLE_URI_MUTATOR_CONTRACT].createInstance(Ci.nsIURIMutator);
        nativeURI = mutator[setter](value).finalize();
        return true;
      },
      has(_target, name) {
        return URI_SETTERS.has(name) || (nativeURI && name in nativeURI);
      },
    });
    this.#uriFacades.set(facade, () => {
      if (!nativeURI) {
        throw new Components.Exception(
          "Legacy URI has not been initialized",
          Cr.NS_ERROR_NOT_INITIALIZED
        );
      }
      return nativeURI;
    });
    return facade;
  }

  #wrapMessageManager(manager) {
    this.#messageManagers ??= new LegacyMessageManagers(this.#addonId, this);
    return this.#messageManagers.wrap(manager);
  }

  #wrapContentPolicy(component) {
    if (
      typeof component?.shouldLoad !== "function" ||
      typeof component?.shouldProcess !== "function"
    ) {
      return component;
    }
    let wrapper = this.#policyWrappers.get(component);
    if (!wrapper) {
      const invoke = (method, uri, loadInfo) => {
        const type = loadInfo.externalContentPolicyType;
        const context = loadInfo.loadingContext;
        if (
          type === Ci.nsIContentPolicy.TYPE_SUBDOCUMENT &&
          !context &&
          Services.appinfo.processType === Services.appinfo.PROCESS_TYPE_DEFAULT &&
          loadInfo.browsingContext?.currentWindowGlobal?.isInProcess === false
        ) {
          // The child runs this policy again with the frame's DOM context.
          return Ci.nsIContentPolicy.ACCEPT;
        }
        return component[method](
          type,
          uri,
          loadInfo.triggeringPrincipal.URI,
          context,
          "",
          null,
          loadInfo.triggeringPrincipal
        );
      };
      wrapper = createLegacyNamespace(component, {
        QueryInterface(iid) {
          const queried = component.QueryInterface(iid);
          return queried === component ? wrapper : queried;
        },
        shouldLoad: (uri, info) => invoke("shouldLoad", uri, info),
        shouldProcess: (uri, info) => invoke("shouldProcess", uri, info),
      });
      this.#policyWrappers.set(component, wrapper);
    }
    return wrapper;
  }

  #wrapFactory(factory) {
    if (!factory || typeof factory.createInstance !== "function") {
      return factory;
    }
    let wrapper = this.#factoryWrappers.get(factory);
    if (!wrapper) {
      const createInstance = factory.createInstance;
      const usesOuterArgument = createInstance.length > 1;
      wrapper = {
        createInstance: iid => {
          const component = usesOuterArgument
            ? createInstance.call(factory, null, iid)
            : createInstance.call(factory, iid);
          return this.#wrapContentPolicy(component);
        },
        lockFactory(lock) {
          return factory.lockFactory?.(lock);
        },
        QueryInterface: ChromeUtils.generateQI(["nsIFactory"]),
      };
      this.#factoryWrappers.set(factory, wrapper);
    }
    return wrapper;
  }

  #loadModule(spec, target, scope = target) {
    if (this.#destroyed) {
      throw new Error("Legacy module loader has been destroyed");
    }
    const cleanSpec = cleanModuleSpec(spec);
    let module;

    if (
      cleanSpec === "resource://gre/modules/commonjs/toolkit/require.js"
    ) {
      const loader = this;
      module = {
        require(id) {
          if (id !== "resource://gre/modules/commonjs/sdk/addon/bootstrap.js") {
            throw new Error(`Unsupported SDK bootstrap dependency: ${id}`);
          }
          return {
            Bootstrap: class {
              constructor(rootURI) {
                const { LegacySDKLoader } = ChromeUtils.importESModule(
                  "resource://gre/modules/addons/LegacySDKLoader.sys.mjs"
                );
                loader.#sdkLoader ??= new LegacySDKLoader(rootURI, loader);
                return loader.#sdkLoader.bootstrap;
              }
            },
          };
        },
      };
    } else if (cleanSpec === "resource://gre/modules/Services.jsm") {
      module = { Services: this.createGlobals(scope).Services };
    } else if (cleanSpec === "resource://gre/modules/AddonManager.jsm") {
      const native = ChromeUtils.importESModule(
        "resource://gre/modules/AddonManager.sys.mjs"
      );
      module = {
        ...native,
        AddonManager: createLegacyNamespace(native.AddonManager, {
          getAddonByID(id, callback) {
            const promise = native.AddonManager.getAddonByID(id);
            if (typeof callback === "function") {
              promise.then(callback).catch(Cu.reportError);
            }
            return promise;
          },
        }),
      };
    } else if (cleanSpec === "resource:///modules/CustomizableUI.jsm") {
      module = ChromeUtils.importESModule(
        "moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs"
      );
    } else if (
      cleanSpec === "resource://gre/modules/XPCOMUtils.jsm" ||
      cleanSpec === "resource://gre/modules/XPCOMUtils.sys.mjs"
    ) {
      module = { XPCOMUtils: createLegacyXPCOMUtils() };
    } else if (cleanSpec === "resource://gre/modules/NetUtil.jsm") {
      const { NetUtil } = ChromeUtils.importESModule(
        "resource://gre/modules/NetUtil.sys.mjs"
      );
      const globals = this.createGlobals(null);
      const netUtil = createLegacyNamespace(NetUtil, {
        newURI: (value, charset, baseURI) =>
          value instanceof Ci.nsIFile
            ? NetUtil.newURI(value)
            : globals.Services.io.newURI(value, charset, baseURI),
        newChannel: options => {
          const unwrapped = this.unwrapURI(options);
          if (
            unwrapped !== options ||
            typeof options === "string" ||
            options instanceof Ci.nsIURI ||
            options instanceof Ci.nsIFile
          ) {
            options = { uri: unwrapped, loadUsingSystemPrincipal: true };
          } else if (
            options &&
            typeof options === "object" &&
            "uri" in options
          ) {
            const uri = this.unwrapURI(options.uri);
            if (uri !== options.uri) {
              options = { ...options, uri };
            }
          }
          const channel = NetUtil.newChannel.call(netUtil, options);
          this.#protocolRegistry?.recordChannel(channel.originalURI, channel);
          return channel;
        },
        asyncFetch: (source, callback) =>
          NetUtil.asyncFetch.call(netUtil, source, callback),
      });
      module = { NetUtil: netUtil };
    } else if (cleanSpec === "resource://gre/modules/FileUtils.jsm") {
      const { FileUtils } = ChromeUtils.importESModule(
        "resource://gre/modules/FileUtils.sys.mjs"
      );
      module = {
        FileUtils: createLegacyNamespace(FileUtils, {
          getFile(key, pathArray) {
            const file = Services.dirsvc.get(key, Ci.nsIFile);
            for (const component of pathArray) {
              file.append(component);
            }
            return file;
          },
        }),
      };
    } else if (
      cleanSpec.startsWith("resource://gre/modules/") &&
      cleanSpec.endsWith(".jsm")
    ) {
      module = ChromeUtils.importESModule(
        cleanSpec.replace(/\.jsm$/, ".sys.mjs")
      );
    } else if (cleanSpec.endsWith(".jsm") || cleanSpec.endsWith(".js")) {
      let record = this.#modules.get(cleanSpec);
      if (record?.state === "loading") {
        throw new Error(
          `Cyclic legacy module import is unsupported: ${cleanSpec}`
        );
      }
      if (!record) {
        const uri = Services.io.newURI(cleanSpec);
        if (uri.schemeIs("http") || uri.schemeIs("https")) {
          throw new Error(
            `Refusing to import remote legacy module ${cleanSpec}`
          );
        }

        const scope = new Cu.Sandbox(
          Services.scriptSecurityManager.getSystemPrincipal(),
          {
            sandboxName: cleanSpec,
            freshCompartment: true,
            freezeBuiltins: false,
            wantComponents: false,
            metadata: { addonID: this.#addonId, URI: cleanSpec },
          }
        );
        record = { exports: {}, scope, state: "loading" };
        this.#modules.set(cleanSpec, record);
        Object.assign(scope, this.createGlobals(scope));
        try {
          Services.scriptloader.loadSubScriptWithOptions(cleanSpec, {
            target: scope,
            allowUnsafeURL: true,
          });
          const exportedSymbols = Cu.evalInSandbox(
            "typeof EXPORTED_SYMBOLS === 'undefined' ? undefined : EXPORTED_SYMBOLS",
            scope
          );
          if (!Array.isArray(exportedSymbols)) {
            throw new Error(
              `Legacy module ${cleanSpec} does not define EXPORTED_SYMBOLS`
            );
          }
          for (const symbol of exportedSymbols) {
            if (
              typeof symbol !== "string" ||
              !/^[A-Za-z_$][\w$]*$/.test(symbol)
            ) {
              throw new Error(
                `Legacy module ${cleanSpec} exports an invalid symbol: ${symbol}`
              );
            }
            record.exports[symbol] = Cu.evalInSandbox(
              `typeof ${symbol} === "undefined" ? undefined : ${symbol}`,
              scope
            );
          }
          record.state = "loaded";
        } catch (error) {
          const retained = cloneLegacyError(error);
          this.#modules.delete(cleanSpec);
          Cu.nukeSandbox(scope);
          throw retained;
        }
      }
      module = record.exports;
    } else {
      throw new Error(`Unsupported legacy module import: ${spec}`);
    }

    if (target) {
      Object.assign(target, module);
      return target;
    }
    return module;
  }

  #unloadModule(spec) {
    const cleanSpec = cleanModuleSpec(spec);
    const record = this.#modules.get(cleanSpec);
    if (!record) {
      return;
    }
    this.#modules.delete(cleanSpec);
    this.#retiredScopes.add(new WeakRef(record.scope));
  }

  createGlobals(defaultScope) {
    if (this.#destroyed) {
      throw new Error("Legacy module loader has been destroyed");
    }
    const array = defaultScope?.Array;
    if (array && Object.isExtensible(array)) {
      for (const name of ["slice", "forEach"]) {
        if (!(name in array)) {
          Object.defineProperty(array, name, {
            configurable: true,
            writable: true,
            value: Function.prototype.call.bind(array.prototype[name]),
          });
        }
      }
    }
    const functionPrototype = defaultScope?.Function?.prototype;
    if (functionPrototype && Object.isExtensible(functionPrototype) &&
        !("toSource" in functionPrototype)) {
      Object.defineProperty(functionPrototype, "toSource", {
        configurable: true,
        writable: true,
        value: legacyFunctionToSource,
      });
    }

    let componentsShim;
    let chromeUtilsShim;
    const loadModule = (spec, target) =>
      this.import(spec, target, defaultScope);
    const unloadModule = spec => this.#unloadModule(spec);
    const loader = this;

    const nativeIO = Services.io;
    const io = createLegacyNamespace(nativeIO, {
      newURI(spec, charset = null, baseURI = null) {
        baseURI = loader.unwrapURI(baseURI);
        return loader.#protocolRegistry
          ? loader.#protocolRegistry.newURI(spec, charset, baseURI)
          : nativeIO.newURI(spec, charset, baseURI);
      },
      newChannelFromURIWithLoadInfo(uri, loadInfo) {
        const inputURI = loader.unwrapURI(uri);
        const channel = nativeIO.newChannelFromURIWithLoadInfo(
          inputURI,
          loadInfo
        );
        loader.#protocolRegistry?.recordChannel(inputURI, channel);
        return channel;
      },
      newChannelFromURI(
        uri,
        loadingNode,
        loadingPrincipal,
        triggeringPrincipal,
        securityFlags,
        contentPolicyType
      ) {
        const legacy = arguments.length === 1;
        if (legacy) {
          loadingNode = null;
          loadingPrincipal = Services.scriptSecurityManager.getSystemPrincipal();
          triggeringPrincipal = null;
          securityFlags = Ci.nsILoadInfo.SEC_ALLOW_CROSS_ORIGIN_SEC_CONTEXT_IS_NULL;
          contentPolicyType = Ci.nsIContentPolicy.TYPE_OTHER;
        }
        const inputURI = loader.unwrapURI(uri);
        const channel = nativeIO.newChannelFromURI(
          inputURI,
          loadingNode,
          loadingPrincipal,
          triggeringPrincipal,
          securityFlags,
          contentPolicyType
        );
        if (legacy) {
          channel.loadInfo.allowDeprecatedSystemRequests = true;
        }
        loader.#protocolRegistry?.recordChannel(inputURI, channel);
        return channel;
      },
      newChannel(
        spec,
        charset,
        baseURI,
        loadingNode,
        loadingPrincipal,
        triggeringPrincipal,
        securityFlags,
        contentPolicyType
      ) {
        const inputURI = io.newURI(spec, charset, baseURI);
        return arguments.length <= 3
          ? io.newChannelFromURI(inputURI)
          : io.newChannelFromURI(
              inputURI,
              loadingNode,
              loadingPrincipal,
              triggeringPrincipal,
              securityFlags,
              contentPolicyType
            );
      },
    });
    this.#uriFixup ??= createLegacyNamespace(Services.uriFixup, {
      createExposableURI: uri =>
        nativeIO.createExposableURI(this.unwrapURI(uri)),
      QueryInterface: iid => {
        Services.uriFixup.QueryInterface(iid);
        return this.#uriFixup;
      },
    });
    this.#classes ??= createLegacyClasses(this.#uriFixup);
    const servicesShim = createLegacyNamespace(Services, {
      io,
      prefs: legacyPrefService,
      uriFixup: this.#uriFixup,
      get dns() {
        return loader.#classes["@mozilla.org/network/dns-service;1"].getService(
          Ci.nsIDNSService
        );
      },
      scriptloader: createLegacyNamespace(Services.scriptloader, {
        loadSubScript(url, target = defaultScope, charset = "UTF-8") {
          return this.loadSubScriptWithOptions(url, { target, charset });
        },
        loadSubScriptWithOptions(url, options) {
          const uri = nativeIO.newURI(url);
          if (uri.schemeIs("file") || uri.schemeIs("jar")) {
            options = { ...options, allowUnsafeURL: true };
          }
          return Services.scriptloader.loadSubScriptWithOptions(url, options);
        },
      }),
      get mm() {
        return loader.#wrapMessageManager(Services.mm);
      },
      get ppmm() {
        return loader.#wrapMessageManager(Services.ppmm);
      },
      get cpmm() {
        return loader.#wrapMessageManager(Services.cpmm);
      },
    });

    const registrar = Components.manager.QueryInterface(
      Ci.nsIComponentRegistrar
    );
    const queryRegistrar = ChromeUtils.generateQI(["nsIComponentRegistrar"]);
    const manager = createLegacyNamespace(Components.manager, {
      QueryInterface: iid => {
        try {
          return Reflect.apply(queryRegistrar, manager, [iid]);
        } catch (error) {
          if (error.result !== Cr.NS_NOINTERFACE) {
            throw error;
          }
          return Components.manager.QueryInterface(iid);
        }
      },
    });
    manager.registerFactory = (classID, description, contractID, factory) => {
      if (this.#destroyed) {
        throw new Error("Legacy module loader has been destroyed");
      }
      const cid = Components.ID(
        typeof classID === "string" ? classID : classID.toString()
      );
      const wrappedFactory = this.#wrapFactory(factory);
      const key = cid.toString();
      if (this.#protocolRegistry) {
        this.#protocolRegistry.registerFactory(
          cid,
          String(description),
          contractID == null ? null : String(contractID),
          factory,
          wrappedFactory
        );
      } else {
        registrar.registerFactory(
          cid,
          String(description),
          contractID == null ? null : String(contractID),
          wrappedFactory
        );
      }
      if (factory) {
        this.#registrations.set(key, { cid, factory, wrappedFactory });
      }
    };
    manager.unregisterFactory = (classID, factory) => {
      const cid = Components.ID(
        typeof classID === "string" ? classID : classID.toString()
      );
      const wrappedFactory = this.#wrapFactory(factory);
      if (this.#protocolRegistry) {
        this.#protocolRegistry.unregisterFactory(cid, factory, wrappedFactory);
      } else {
        registrar.unregisterFactory(cid, wrappedFactory);
      }
      this.#registrations.delete(cid.toString());
    };

    const nativeConstructor = Function.prototype.bind.call(
      Components.Constructor,
      Components
    );
    function LegacyConstructor(contractID, interfaceID, initializer) {
      if (String(contractID) !== SIMPLE_URI_CONTRACT) {
        return Reflect.apply(nativeConstructor, undefined, arguments);
      }
      if (!interfaceID?.equals?.(Ci.nsIURI) && String(interfaceID) !== "nsIURI") {
        throw new Error(
          "The scoped legacy simple URI constructor only supports nsIURI"
        );
      }
      if (initializer) {
        throw new Error(
          "The scoped legacy simple URI constructor has no initializer method"
        );
      }
      return function LegacyMutableURI() {
        return loader.#makeMutableURI();
      };
    }

    componentsShim = createLegacyNamespace(Components, {
      Constructor: LegacyConstructor,
      manager,
      classes: this.#classes,
      interfaces: createLegacyInterfaces(defaultScope),
      utils: createLegacyNamespace(Cu, {
        import: loadModule,
        unload: unloadModule,
        Sandbox: function (...args) {
          const sandbox = Cu.Sandbox(...args);
          Cu.evalInSandbox(
            `if (!("toSource" in Function.prototype) &&
                 Object.isExtensible(Function.prototype)) {
              Object.defineProperty(Function.prototype, "toSource", {
                configurable: true,
                writable: true,
                value: ${legacyFunctionToSource}
              });
            }`,
            sandbox
          );
          return sandbox;
        },
      }),
    });
    chromeUtilsShim = createLegacyNamespace(ChromeUtils, {
      generateQI: generateLegacyQI,
      import: loadModule,
      unload: unloadModule,
      importESModule(spec, options) {
        if (spec === "resource://gre/modules/XPCOMUtils.sys.mjs") {
          return loader.#loadModule(spec, null);
        }
        return ChromeUtils.importESModule(spec, options);
      },
    });

    return {
      Components: componentsShim,
      Cu: componentsShim.utils,
      ChromeUtils: chromeUtilsShim,
      Services: this.#sdkLoader?.createServices(servicesShim) ?? servicesShim,
      Cc: componentsShim.classes,
      Ci: componentsShim.interfaces,
      Cr: componentsShim.results,
    };
  }

  destroy({ nukeSandboxes = true } = {}) {
    if (this.#destroyed) {
      return;
    }
    this.#destroyed = true;
    modulePackages.delete(this);
    this.#messageManagers?.destroy();
    this.#messageManagers = null;
    this.#sdkLoader?.destroy();
    this.#sdkLoader = null;

    for (const {
      cid,
      factory,
      wrappedFactory,
    } of this.#registrations.values()) {
      try {
        if (this.#protocolRegistry) {
          this.#protocolRegistry.unregisterFactory(
            cid,
            factory,
            wrappedFactory
          );
        } else {
          Components.manager
            .QueryInterface(Ci.nsIComponentRegistrar)
            .unregisterFactory(cid, wrappedFactory);
        }
      } catch (error) {
        Cu.reportError(error);
      }
    }
    this.#registrations.clear();

    if (nukeSandboxes) {
      for (const { scope } of this.#modules.values()) {
        Cu.nukeSandbox(scope);
      }
      for (const reference of this.#retiredScopes) {
        const scope = reference.deref();
        if (scope && !Cu.isDeadWrapper(scope)) {
          Cu.nukeSandbox(scope);
        }
      }
    }
    this.#modules.clear();
    this.#retiredScopes.clear();
  }
}
