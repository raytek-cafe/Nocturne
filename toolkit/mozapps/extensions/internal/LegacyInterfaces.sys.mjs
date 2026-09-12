/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";
import { createLegacyNamespace } from "resource://gre/modules/addons/LegacyModuleLoader.sys.mjs";

const lazy = {};
XPCOMUtils.defineLazyGlobalGetters(lazy, [
  "DOMParser",
  "Document",
  "Element",
  "InspectorUtils",
  "Node",
  "NodeFilter",
  "XMLHttpRequest",
]);

const messageListener = Object.freeze({
  name: "nsIMessageListener",
  equals(iid) {
    return iid === this;
  },
  [Symbol.hasInstance](value) {
    return typeof value === "function" || typeof value?.receiveMessage === "function";
  },
});

const badCertListener = Components.ID("{2c3d268c-ad82-49f3-99aa-e9ffddd7a0dc}");
Object.defineProperties(badCertListener, {
  name: { value: "nsIBadCertListener2" },
  [Symbol.hasInstance]: {
    value(value) {
      try {
        value.QueryInterface(badCertListener);
        return true;
      } catch {
        return typeof value?.notifyCertProblem === "function";
      }
    },
  },
});

const treeBoxObject = Components.ID("{f3da0c5e-51f5-45f0-b2cd-6be3ab6847ae}");
Object.defineProperties(treeBoxObject, {
  name: { value: "nsITreeBoxObject" },
  [Symbol.hasInstance]: {
    value(value) {
      try {
        value.QueryInterface(treeBoxObject);
        return true;
      } catch {
        return false;
      }
    },
  },
});

const interfaces = {
  nsIMessageListener: messageListener,
  nsIBadCertListener2: badCertListener,
  nsITreeBoxObject: treeBoxObject,
  nsIPrefBranch2: Ci.nsIPrefBranch,
  nsICache: Object.freeze({
    ACCESS_NONE: 0,
    ACCESS_READ: 1,
    ACCESS_WRITE: 2,
    ACCESS_READ_WRITE: 3,
    STORE_ANYWHERE: 0,
    STORE_IN_MEMORY: 1,
    STORE_ON_DISK: 2,
    STORE_OFFLINE: 4,
    NOT_STREAM_BASED: 0,
    STREAM_BASED: 1,
    NON_BLOCKING: 0,
    BLOCKING: 1,
    NO_EXPIRATION_TIME: 0xffffffff,
  }),
  get nsIDOMDocument() { return lazy.Document; },
  get nsIDOMElement() { return lazy.Element; },
  get nsIDOMNode() { return lazy.Node; },
  get nsIDOMNodeFilter() { return lazy.NodeFilter; },
  get nsIXMLHttpRequest() { return lazy.XMLHttpRequest; },
  get inIDOMUtils() { return lazy.InspectorUtils; },
  nsIDOMXULElement: Object.freeze({
    [Symbol.hasInstance](value) {
      return value instanceof lazy.Element &&
        /^XUL\w*Element$/.test(ChromeUtils.getClassName(value, true));
    },
  }),
  nsIDOMChromeWindow: Object.freeze({
    [Symbol.hasInstance](value) {
      return value !== null && typeof value === "object" &&
        ChromeUtils.getClassName(value, true) === "Window" &&
        value.isChromeWindow;
    },
  }),
};
ChromeUtils.defineLazyGetter(interfaces, "nsIDOMXPathResult", () => {
  const document = new lazy.DOMParser().parseFromString("<root/>", "text/xml");
  return document.evaluate("/", document, null, 0, null).constructor;
});

const legacyInterfaces = createLegacyNamespace(Ci, interfaces);
const interfacesByGlobal = new WeakMap();

export function getLegacyInterface(name) {
  return Object.hasOwn(interfaces, name) ? interfaces[name] : undefined;
}

export function createLegacyInterfaces(scope) {
  const global = scope && Cu.getGlobalForObject(scope);
  if (!global || ChromeUtils.getClassName(global, true) !== "Sandbox") {
    return legacyInterfaces;
  }
  let facade = interfacesByGlobal.get(global);
  if (!facade) {
    const reflected = new Map();
    // Interface promotion must expose methods in the caller's compartment.
    const hasInstance = Cu.evalInSandbox(
      `(function(value) {
        try {
          value.QueryInterface(this);
          return true;
        } catch {
          return false;
        }
      })`,
      global
    );
    facade = new Proxy(legacyInterfaces, {
      get(target, name) {
        const native = target[name];
        if (typeof native?.number !== "string" || Object.hasOwn(native, Symbol.hasInstance)) {
          return native;
        }
        if (!reflected.has(name)) {
          const iid = Components.ID(native.number);
          Object.setPrototypeOf(iid, native);
          Object.defineProperties(iid, {
            name: { value: native.name },
            [Symbol.hasInstance]: { value: hasInstance },
          });
          reflected.set(name, iid);
        }
        return reflected.get(name);
      },
    });
    interfacesByGlobal.set(global, facade);
  }
  return facade;
}

export function generateLegacyQI(iids) {
  const supportsMessages = iids.includes(messageListener);
  if (!supportsMessages) {
    return ChromeUtils.generateQI(iids);
  }
  const nativeQI = ChromeUtils.generateQI(iids.filter(iid => iid !== messageListener));
  return function QueryInterface(iid) {
    if (supportsMessages && iid === messageListener) {
      if (!(this instanceof messageListener)) {
        throw Components.Exception("", Cr.NS_NOINTERFACE);
      }
      return this;
    }
    return nativeQI.call(this, iid);
  };
}

function requireInterface(iid, supported) {
  if (iid && iid !== supported && !iid.equals?.(Ci.nsISupports)) {
    throw Components.Exception("", Cr.NS_NOINTERFACE);
  }
}

ChromeUtils.defineLazyGetter(lazy, "dns", () => {
  const listeners = new WeakMap();
  const wrapRecord = record =>
    record ? createLegacyNamespace(record.QueryInterface(Ci.nsIDNSAddrRecord), {}) : null;
  const wrapListener = listener => {
    let wrapped = listeners.get(listener);
    if (!wrapped) {
      wrapped = {
        QueryInterface: ChromeUtils.generateQI(["nsIDNSListener"]),
        onLookupComplete(request, record, status) {
          listener.onLookupComplete(request, wrapRecord(record), status);
        },
      };
      listeners.set(listener, wrapped);
    }
    return wrapped;
  };
  return createLegacyNamespace(Services.dns, {
    asyncResolve(host, flags, listener, target, originAttributes = {}) {
      return Services.dns.asyncResolve(
        host, Ci.nsIDNSService.RESOLVE_TYPE_DEFAULT, flags, null,
        wrapListener(listener), target, originAttributes
      );
    },
    cancelAsyncResolve(host, flags, listener, reason, originAttributes = {}) {
      Services.dns.cancelAsyncResolve(
        host, Ci.nsIDNSService.RESOLVE_TYPE_DEFAULT, flags, null,
        wrapListener(listener), reason, originAttributes
      );
    },
    resolve(host, flags, originAttributes = {}) {
      return wrapRecord(Services.dns.resolve(host, flags, originAttributes));
    },
    QueryInterface(iid) {
      Services.dns.QueryInterface(iid);
      return lazy.dns;
    },
  });
});

const classes = {
  "@mozilla.org/xmlextras/xmlhttprequest;1": {
    createInstance(iid) {
      requireInterface(iid, lazy.XMLHttpRequest);
      return new lazy.XMLHttpRequest();
    },
  },
  "@mozilla.org/xul/xul-document;1": {
    createInstance(iid) {
      requireInterface(iid, lazy.Document);
      return new lazy.Document();
    },
  },
  "@mozilla.org/inspector/dom-utils;1": {
    getService(iid) {
      requireInterface(iid, lazy.InspectorUtils);
      return lazy.InspectorUtils;
    },
  },
};

export function createLegacyClasses(uriFixup) {
  return createLegacyNamespace(Cc, {
    ...classes,
    "@mozilla.org/network/dns-service;1": createLegacyNamespace(
      Cc["@mozilla.org/network/dns-service;1"],
      {
        getService(iid = Ci.nsIDNSService) {
          lazy.dns.QueryInterface(iid);
          return lazy.dns;
        },
      }
    ),
    "@mozilla.org/docshell/urifixup;1": createLegacyNamespace(
      Cc["@mozilla.org/docshell/urifixup;1"],
      {
        getService(iid = Ci.nsIURIFixup) {
          uriFixup.QueryInterface(iid);
          return uriFixup;
        },
      }
    ),
  });
}
