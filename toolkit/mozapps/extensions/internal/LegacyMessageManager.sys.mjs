/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  cloneLegacyError,
  createLegacyNamespace,
  LegacyModuleLoader,
} from "resource://gre/modules/addons/LegacyModuleLoader.sys.mjs";

const MODULE_URI = "resource://gre/modules/addons/LegacyMessageManager.sys.mjs";
const CLEANUP_PREFIX = "Nocturne:LegacyMessageManager:Destroy:";
const contexts = new Map();

function destroyContext(id) {
  const context = contexts.get(id);
  if (!context) {
    return;
  }
  contexts.delete(id);
  if (context.listener) {
    Services.cpmm.removeMessageListener(CLEANUP_PREFIX + id, context.listener);
  }
  for (const cleanup of context.scripts) {
    cleanup();
  }
  if (context.owned) {
    context.loader.destroy();
  }
}

export class LegacyMessageManagers {
  #addonId;
  #id;
  #facades = new WeakMap();
  #listeners = new Set();
  #delayedScripts = new Set();
  #scriptManagers = new Set();
  #destroyed = false;
  #finalizer;

  constructor(addonId, moduleLoader) {
    this.#addonId = addonId;
    this.#id = Services.uuid.generateUUID().toString();
    contexts.set(this.#id, { loader: moduleLoader, scripts: new Set(), owned: false });
    this.#finalizer = new FinalizationRegistry(record => this.#removeListener(record));
  }

  #removeListener(record) {
    if (!this.#listeners.delete(record)) {
      return;
    }
    record.byName.delete(record.name);
    this.#finalizer.unregister(record);
    record.manager.removeMessageListener(record.name, record.callback);
  }

  wrap(manager) {
    if (!manager) {
      return manager;
    }
    if (this.#destroyed) {
      throw new Error("Legacy message managers have been destroyed");
    }
    let facade = this.#facades.get(manager);
    if (facade) {
      return facade;
    }

    const strongListeners = new WeakMap();
    const weakListeners = new WeakMap();
    const delayed = { frame: new Map(), process: new Map() };
    const owner = this;

    const addListener = (weak, name, listener, listenWhenClosed = false) => {
      if (this.#destroyed) {
        throw new Error("Legacy message managers have been destroyed");
      }
      if (typeof listener !== "function" && typeof listener?.receiveMessage !== "function") {
        throw new TypeError("A message callback or receiveMessage listener is required");
      }
      name = String(name);
      const listeners = weak ? weakListeners : strongListeners;
      let byName = listeners.get(listener);
      if (byName?.has(name)) {
        return;
      }
      if (!byName) {
        byName = new Map();
        listeners.set(listener, byName);
      }
      const record = { manager, name, byName, callback: listener };
      if (weak) {
        const reference = new WeakRef(listener);
        record.callback = function (message) {
          const live = reference.deref();
          if (!live) {
            owner.#removeListener(record);
            return undefined;
          }
          return typeof live === "function"
            ? live.call(this, message)
            : live.receiveMessage(message);
        };
      }
      manager.addMessageListener(name, record.callback, listenWhenClosed);
      byName.set(name, record);
      this.#listeners.add(record);
      if (weak) {
        this.#finalizer.register(listener, record, record);
      }
    };
    const removeListener = (weak, name, listener) => {
      const listeners = weak ? weakListeners : strongListeners;
      const record = listeners.get(listener)?.get(String(name));
      if (record) {
        this.#removeListener(record);
      }
    };
    const loadScript = (kind, uri, allowDelayedLoad = false, ...options) => {
      uri = String(uri);
      const source = `ChromeUtils.importESModule(${JSON.stringify(MODULE_URI)}).executeLegacyMessageManagerScript(this, ${JSON.stringify(this.#addonId)}, ${JSON.stringify(this.#id)}, ${JSON.stringify(uri)});`;
      const helper = `data:text/javascript;charset=UTF-8,${encodeURIComponent(source)}`;
      const load = kind === "frame" ? "loadFrameScript" : "loadProcessScript";
      manager[load](helper, allowDelayedLoad, ...options);
      this.#scriptManagers.add(manager);
      if (allowDelayedLoad) {
        const record = {
          manager,
          helper,
          remove: kind === "frame" ? "removeDelayedFrameScript" : "removeDelayedProcessScript",
        };
        let records = delayed[kind].get(uri);
        if (!records) {
          records = [];
          delayed[kind].set(uri, records);
        }
        records.push(record);
        this.#delayedScripts.add(record);
      }
    };
    const removeScript = (kind, uri) => {
      const records = delayed[kind].get(String(uri));
      if (!records?.length) {
        return;
      }
      const record = records.shift();
      if (!records.length) {
        delayed[kind].delete(String(uri));
      }
      this.#delayedScripts.delete(record);
      manager[record.remove](record.helper);
    };
    const overrides = {
      addMessageListener: (name, listener, closed) => addListener(false, name, listener, closed),
      removeMessageListener: (name, listener) => removeListener(false, name, listener),
      addWeakMessageListener: (name, listener, closed) => addListener(true, name, listener, closed),
      removeWeakMessageListener: (name, listener) => removeListener(true, name, listener),
      get processMessageManager() {
        return owner.wrap(manager.processMessageManager);
      },
    };
    if (typeof manager.loadFrameScript === "function") {
      overrides.loadFrameScript = (...args) => loadScript("frame", ...args);
      overrides.removeDelayedFrameScript = uri => removeScript("frame", uri);
    }
    if (typeof manager.loadProcessScript === "function") {
      overrides.loadProcessScript = (...args) => loadScript("process", ...args);
      overrides.removeDelayedProcessScript = uri => removeScript("process", uri);
    }
    if (typeof manager.getChildAt === "function") {
      overrides.getChildAt = index => this.wrap(manager.getChildAt(index));
    }
    facade = createLegacyNamespace(manager, overrides);
    this.#facades.set(manager, facade);
    return facade;
  }

  destroy() {
    if (this.#destroyed) {
      return;
    }
    this.#destroyed = true;
    for (const record of this.#delayedScripts) {
      record.manager[record.remove](record.helper);
    }
    this.#delayedScripts.clear();
    const message = CLEANUP_PREFIX + this.#id;
    for (const manager of this.#scriptManagers) {
      if (manager.broadcastAsyncMessage) {
        manager.broadcastAsyncMessage(message);
      } else {
        manager.sendAsyncMessage(message);
      }
    }
    if (this.#scriptManagers.size && Services.appinfo.processType === Ci.nsIXULRuntime.PROCESS_TYPE_DEFAULT) {
      Services.ppmm.broadcastAsyncMessage(message);
    }
    this.#scriptManagers.clear();
    for (const record of this.#listeners) {
      this.#removeListener(record);
    }
    destroyContext(this.#id);
    this.#facades = new WeakMap();
  }
}

export function executeLegacyMessageManagerScript(nativeGlobal, addonId, managerId, uri) {
  let context = contexts.get(managerId);
  if (!context) {
    context = {
      loader: new LegacyModuleLoader(addonId),
      scripts: new Set(),
      owned: true,
      listener: () => destroyContext(managerId),
    };
    contexts.set(managerId, context);
    Services.cpmm.addMessageListener(CLEANUP_PREFIX + managerId, context.listener);
  }
  const sandbox = Cu.Sandbox(Services.scriptSecurityManager.getSystemPrincipal(), {
    sandboxName: uri,
    sandboxPrototype: nativeGlobal,
    freshCompartment: true,
    freezeBuiltins: false,
    wantComponents: false,
    metadata: { addonID: addonId, URI: uri },
  });
  Object.assign(sandbox, context.loader.createGlobals(sandbox), {
    __SCRIPT_URI_SPEC__: uri,
  });
  const listeners = [];
  const events = [];
  let destroyed = false;
  for (const name of ["sendAsyncMessage", "sendSyncMessage", "sendRpcMessage", "broadcastAsyncMessage"]) {
    if (typeof nativeGlobal[name] === "function") {
      sandbox[name] = nativeGlobal[name].bind(nativeGlobal);
    }
  }
  for (const name of ["content", "docShell", "browsingContext", "initialProcessData", "sharedData"]) {
    if (name in nativeGlobal) {
      Object.defineProperty(sandbox, name, { get: () => nativeGlobal[name] });
    }
  }
  sandbox.addMessageListener = (name, listener, closed = false) => {
    nativeGlobal.addMessageListener(name, listener, closed);
    listeners.push({ name, listener });
  };
  sandbox.removeMessageListener = (name, listener) => {
    nativeGlobal.removeMessageListener(name, listener);
    const index = listeners.findIndex(record => record.name === name && record.listener === listener);
    if (index !== -1) {
      listeners.splice(index, 1);
    }
  };
  if (nativeGlobal.addEventListener) {
    sandbox.addEventListener = (type, listener, options) => {
      nativeGlobal.addEventListener(type, listener, options);
      events.push({ type, listener, options });
    };
    sandbox.removeEventListener = (type, listener, options) => {
      nativeGlobal.removeEventListener(type, listener, options);
      const capture = typeof options === "boolean" ? options : Boolean(options?.capture);
      const index = events.findIndex(record => record.type === type && record.listener === listener &&
        (typeof record.options === "boolean" ? record.options : Boolean(record.options?.capture)) === capture);
      if (index !== -1) {
        events.splice(index, 1);
      }
    };
    nativeGlobal.addEventListener("unload", onUnload, { once: true });
  }
  function onUnload() {
    Services.tm.dispatchToMainThread(cleanup);
  }
  function cleanup() {
    if (destroyed) {
      return;
    }
    destroyed = true;
    context.scripts.delete(cleanup);
    for (const { name, listener } of listeners) {
      nativeGlobal.removeMessageListener(name, listener);
    }
    for (const { type, listener, options } of events) {
      nativeGlobal.removeEventListener(type, listener, options);
    }
    nativeGlobal.removeEventListener?.("unload", onUnload);
    Cu.nukeSandbox(sandbox);
  }
  context.scripts.add(cleanup);
  try {
    Services.scriptloader.loadSubScriptWithOptions(uri, {
      target: sandbox,
      charset: "UTF-8",
      allowUnsafeURL: true,
    });
  } catch (error) {
    const retained = cloneLegacyError(error);
    cleanup();
    throw retained;
  }
}
