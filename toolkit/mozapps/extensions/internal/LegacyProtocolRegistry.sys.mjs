/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { LegacyExtensionPackage } from "resource://gre/modules/addons/LegacyChromeManifest.sys.mjs";

const PROTOCOL_CONTRACT = "@mozilla.org/network/protocol;1?name=";
const HANDLER_PROPERTY = "legacy-extension-protocol-handler";
const URI_PROPERTY = "legacy-extension-protocol-uri";
const registrar = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);
const protocolQI = ChromeUtils.generateQI(["nsIProtocolHandler"]);
const SECURITY_FLAGS =
  Ci.nsIProtocolHandler.URI_LOADABLE_BY_ANYONE |
  Ci.nsIProtocolHandler.URI_DANGEROUS_TO_LOAD |
  Ci.nsIProtocolHandler.URI_IS_UI_RESOURCE |
  Ci.nsIProtocolHandler.URI_IS_LOCAL_FILE |
  Ci.nsIProtocolHandler.URI_LOADABLE_BY_SUBSUMERS |
  Ci.nsIProtocolHandler.URI_IS_WEBEXTENSION_RESOURCE;
const INSECURE_PREF = "extensions.legacy.insecure.enabled";

function isSystemRequest(loadInfo) {
  return (
    loadInfo?.triggeringPrincipal?.isSystemPrincipal &&
    (!loadInfo.loadingPrincipal ||
      loadInfo.loadingPrincipal.isSystemPrincipal) &&
    !loadInfo.sandboxFlags
  );
}

function hasSystemOwner(channel) {
  try {
    return channel.owner?.QueryInterface(Ci.nsIPrincipal).isSystemPrincipal;
  } catch {
    return false;
  }
}

export class LegacyProtocolRegistry {
  constructor(addonId, rootURI) {
    this.addonId = addonId;
    this.package = new LegacyExtensionPackage(rootURI);
    this.moduleLoader = null;
    this.protocols = new Map();
    this.factories = new Map();
    this.channels = new WeakMap();
    this.documents = new WeakSet();
    this.observing = false;
    this.destroyed = false;
  }

  setModuleLoader(loader) {
    this.moduleLoader = loader;
  }

  registerFactory(
    cid,
    description,
    contractID,
    originalFactory,
    wrappedFactory
  ) {
    if (this.destroyed) {
      throw new Error("Legacy protocol registry has been destroyed");
    }
    const key = cid.toString();
    const existing = this.factories.get(key);
    const factory = wrappedFactory ?? existing?.wrappedFactory;
    let protocol;
    if (contractID?.startsWith(PROTOCOL_CONTRACT)) {
      if (!factory) {
        throw new Error("Legacy protocol must use an add-on-owned factory");
      }
      protocol = this.registerProtocol(contractID, factory);
    }
    try {
      registrar.registerFactory(cid, description, contractID, wrappedFactory);
    } catch (error) {
      if (protocol) {
        this.unregisterProtocol(protocol);
      }
      throw error;
    }
    const record = existing ?? {
      cid,
      originalFactory,
      wrappedFactory,
      protocols: new Set(),
    };
    if (protocol) {
      record.protocols.add(protocol);
    }
    this.factories.set(key, record);
  }

  unregisterFactory(cid, originalFactory, wrappedFactory) {
    registrar.unregisterFactory(cid, wrappedFactory);
    const key = cid.toString();
    const record = this.factories.get(key);
    if (record?.originalFactory === originalFactory) {
      for (const protocol of record.protocols) {
        this.unregisterProtocol(protocol);
      }
      this.factories.delete(key);
    }
  }

  registerProtocol(contractID, factory) {
    if (this.destroyed) {
      throw new Error("Legacy protocol registry has been destroyed");
    }
    if (!contractID.startsWith(PROTOCOL_CONTRACT)) {
      return null;
    }
    if (typeof factory?.createInstance !== "function") {
      throw new Error("Legacy protocol must use an add-on-owned factory");
    }
    const scheme = contractID.slice(PROTOCOL_CONTRACT.length).toLowerCase();
    if (!/^[a-z][a-z0-9+.-]*$/.test(scheme)) {
      throw new Error(`Invalid legacy protocol scheme: ${scheme}`);
    }
    const handler = factory.createInstance(Ci.nsIProtocolHandler);
    const flags = handler.protocolFlags;
    const defaultPort = handler.defaultPort;
    const securityFlags = flags & SECURITY_FLAGS;
    if (
      typeof handler.scheme !== "string" ||
      handler.scheme.toLowerCase() !== scheme ||
      !Number.isInteger(flags) ||
      flags < 0 ||
      flags > 0xffffffff ||
      flags & Ci.nsIProtocolHandler.ORIGIN_IS_FULL_SPEC ||
      !securityFlags ||
      securityFlags & (securityFlags - 1) ||
      !Number.isInteger(defaultPort) ||
      defaultPort < -1 ||
      defaultPort > 65535 ||
      (typeof handler.newChannel2 !== "function" &&
        typeof handler.newChannel !== "function")
    ) {
      throw new Error(`Invalid legacy protocol handler: ${scheme}`);
    }

    const registry = this;
    const record = { scheme, handler, flags, active: true, adapter: null };
    const adapter = {
      scheme,
      QueryInterface: protocolQI,
      get wrappedJSObject() {
        return this;
      },
      allowPort(port, requestedScheme) {
        return handler.allowPort(port, requestedScheme);
      },
      newChannel(uri, loadInfo) {
        return registry.newChannel(record, uri, loadInfo);
      },
    };
    record.adapter = adapter;
    Services.io.registerProtocolHandler(scheme, adapter, flags, defaultPort);
    this.protocols.set(scheme, record);
    if (!this.observing) {
      Services.obs.addObserver(this, "document-element-inserted");
      this.observing = true;
    }
    return record;
  }

  isCurrent(record) {
    return (
      record.active &&
      Services.io.getProtocolHandler(record.scheme).wrappedJSObject ===
        record.adapter
    );
  }

  unregisterProtocol(record) {
    if (record.active) {
      try {
        Services.io.unregisterProtocolHandler(record.scheme, record.adapter);
      } catch (error) {
        if (error.result !== Cr.NS_ERROR_FACTORY_NOT_REGISTERED) {
          throw error;
        }
      }
    }
    record.active = false;
    if (this.protocols.get(record.scheme) === record) {
      this.protocols.delete(record.scheme);
    }
    if (!this.protocols.size && this.observing) {
      Services.obs.removeObserver(this, "document-element-inserted");
      this.observing = false;
    }
  }

  newURI(spec, charset = null, baseURI = null) {
    let scheme;
    try {
      scheme = Services.io.extractScheme(spec);
    } catch {
      scheme = baseURI?.scheme;
    }
    const record = this.protocols.get(scheme);
    if (
      record &&
      this.isCurrent(record) &&
      typeof record.handler.newURI === "function"
    ) {
      return this.moduleLoader.unwrapURI(
        record.handler.newURI(spec, charset, baseURI)
      );
    }
    return Services.io.newURI(spec, charset, baseURI);
  }

  recordChannel(uri, channel) {
    if (!uri.schemeIs("chrome") || !hasSystemOwner(channel)) {
      return;
    }
    const backing = this.package.resolveRegisteredURI(uri.spec);
    if (backing && backing.equalsExceptRef(channel.URI)) {
      this.channels.set(channel, {
        backing: channel.URI,
        loadInfo: channel.loadInfo,
      });
    }
  }

  newChannel(record, uri, loadInfo) {
    if (!this.isCurrent(record)) {
      throw Components.Exception(
        "Legacy protocol was unregistered",
        Cr.NS_ERROR_UNKNOWN_PROTOCOL
      );
    }
    const insecure =
      Services.prefs.getBoolPref(INSECURE_PREF, false) &&
      !Services.appinfo.browserTabsRemoteAutostart;
    if (
      !insecure &&
      record.flags &
        (Ci.nsIProtocolHandler.URI_IS_LOCAL_RESOURCE |
          Ci.nsIProtocolHandler.URI_OPENING_EXECUTES_SCRIPT) &&
      !isSystemRequest(loadInfo)
    ) {
      throw Components.Exception(
        "Legacy local content requires a trusted caller",
        Cr.NS_ERROR_DOM_BAD_URI
      );
    }
    const method = record.handler.newChannel2 ?? record.handler.newChannel;
    const channel = method.call(record.handler, uri, loadInfo);
    if (!channel || channel.loadInfo !== loadInfo) {
      throw Components.Exception(
        "Legacy protocol changed the caller's loadInfo",
        Cr.NS_ERROR_UNEXPECTED
      );
    }
    if (hasSystemOwner(channel)) {
      const contentPolicyType = loadInfo.externalContentPolicyType;
      if (
        insecure &&
        (contentPolicyType === Ci.nsIContentPolicy.TYPE_DOCUMENT ||
          contentPolicyType === Ci.nsIContentPolicy.TYPE_SUBDOCUMENT)
      ) {
        const verified = {
          backing: channel.URI,
          loadInfo: channel.loadInfo,
        };
        this.channels.set(channel, verified);
        const properties = channel.QueryInterface(Ci.nsIWritablePropertyBag2);
        properties.setPropertyAsInterface(HANDLER_PROPERTY, record.adapter);
        properties.setPropertyAsInterface(URI_PROPERTY, verified.backing);
      } else if (!insecure) {
        const verified = this.channels.get(channel);
        if (
          !isSystemRequest(loadInfo) ||
          contentPolicyType === Ci.nsIContentPolicy.TYPE_SUBDOCUMENT ||
          !verified ||
          verified.loadInfo !== loadInfo ||
          !verified.backing.equals(channel.URI) ||
          !this.package.isLocalURI(channel.URI)
        ) {
          throw Components.Exception(
            "Legacy protocol returned unverified privileged content",
            Cr.NS_ERROR_DOM_BAD_URI
          );
        }
        if (contentPolicyType === Ci.nsIContentPolicy.TYPE_DOCUMENT) {
          const properties = channel.QueryInterface(Ci.nsIWritablePropertyBag2);
          properties.setPropertyAsInterface(HANDLER_PROPERTY, record.adapter);
          properties.setPropertyAsInterface(URI_PROPERTY, verified.backing);
        }
      }
    }
    return channel;
  }

  observe(document) {
    if (
      !document.nodePrincipal.isSystemPrincipal ||
      this.documents.has(document)
    ) {
      return;
    }
    const record = this.protocols.get(document.documentURIObject.scheme);
    if (!record || !this.isCurrent(record)) {
      return;
    }
    const window = document.defaultView;
    const channel = window?.docShell.currentDocumentChannel;
    if (!channel || !this.channels.has(channel)) {
      return;
    }
    const properties = channel.QueryInterface(Ci.nsIPropertyBag2);
    const handler = properties.getPropertyAsInterface(
      HANDLER_PROPERTY,
      Ci.nsIProtocolHandler
    );
    if (handler.wrappedJSObject !== record.adapter) {
      return;
    }
    const global = Cu.waiveXrays(window);
    for (const [name, value] of Object.entries(
      this.moduleLoader.createGlobals(global)
    )) {
      Object.defineProperty(global, name, {
        value,
        writable: true,
        configurable: true,
      });
    }
    this.documents.add(document);
  }

  destroy() {
    this.destroyed = true;
    for (const record of [...this.protocols.values()]) {
      this.unregisterProtocol(record);
    }
    this.factories.clear();
    this.channels = new WeakMap();
  }
}
