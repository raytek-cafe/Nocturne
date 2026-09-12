/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  createLegacyNamespace,
  createLegacyXPCOMUtils,
  legacyFunctionToSource,
} from "resource://gre/modules/addons/LegacyModuleLoader.sys.mjs";
import { getOpenDocuments } from "resource://gre/modules/addons/LegacyXULOverlay.sys.mjs";
import { Overlays } from "resource://gre/modules/addons/Overlays.sys.mjs";
import { getLegacyInterface } from "resource://gre/modules/addons/LegacyInterfaces.sys.mjs";

const manifests = new Set();
const windows = new Map();
const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
const HTML_NS = "http://www.w3.org/1999/xhtml";
const WINDOW_EVENTS = new Set(["onload", "onunload", "onbeforeunload", "onresize"]);
function findManifest(source) {
  if (!source) {
    return null;
  }
  for (const manifest of manifests) {
    if (manifest.package.resolveRegisteredURI(String(source).replace(/[?#].*$/, ""))) {
      return manifest;
    }
  }
  return null;
}

export function bindLegacyChromeEventHandler(element, attribute, source) {
  windows.get(element.ownerDocument.defaultView)?.bindEventHandler(element, attribute, source);
}

export function prepareLegacyChromeWindow(window) {
  const state = windows.get(window);
  if (state) {
    state.refresh();
    return;
  }
  if (!manifests.size || !window.document.nodePrincipal.isSystemPrincipal) {
    return;
  }
  const document = window.document;
  const restorers = [];
  function replaceProperty(object, name, replacement) {
    const descriptor = Object.getOwnPropertyDescriptor(object, name);
    Object.defineProperty(object, name, { configurable: true, ...replacement });
    restorers.push(() => {
      const current = Object.getOwnPropertyDescriptor(object, name);
      if (!current || current.value !== replacement.value ||
          current.get !== replacement.get || current.set !== replacement.set) {
        return;
      }
      if (descriptor) {
        Object.defineProperty(object, name, descriptor);
      } else {
        delete object[name];
      }
    });
  }
  function replace(object, name, value) {
    replaceProperty(object, name, { writable: true, value });
  }
  const refresh = () => {
    if (typeof window.XPCOMUtils?.generateQI !== "function") {
      replace(window, "XPCOMUtils", createLegacyXPCOMUtils());
    }
    if ("gBrowser" in window && typeof window.getBrowser !== "function") {
      replace(window, "getBrowser", () => window.gBrowser);
    }
  };
  refresh();

  const NativeXHR = window.XMLHttpRequest;
  replace(window, "XMLHttpRequest", class extends NativeXHR {
    #legacy = false;
    #preparedDocument = null;

    open(...args) {
      const result = super.open(...args);
      this.#legacy = false;
      this.#preparedDocument = null;
      if (this.channel && findManifest(this.channel.URI.spec)) {
        this.#legacy = true;
        this.channel.owner = Services.scriptSecurityManager.getSystemPrincipal();
      }
      return result;
    }

    get responseXML() {
      const result = super.responseXML;
      if (this.#legacy && result !== this.#preparedDocument &&
          result?.documentElement?.namespaceURI === XUL_NS) {
        const walker = result.createTreeWalker(
          result,
          window.NodeFilter.SHOW_TEXT | window.NodeFilter.SHOW_COMMENT
        );
        for (let node = walker.nextNode(); node;) {
          const next = walker.nextNode();
          if (node.nodeType === window.Node.COMMENT_NODE) {
            node.remove();
          } else if (node.parentElement?.namespaceURI === XUL_NS &&
                     !["label", "description"].includes(node.parentElement.localName)) {
            const text = node.data.replace(/^[ \t\n\r]+|[ \t\n\r]+$/g, "");
            if (text) {
              node.data = text;
            } else {
              node.remove();
            }
          }
          node = next;
        }
        this.#preparedDocument = result;
      }
      return result;
    }
  });

  const createElement = document.createElement;
  replace(document, "createElement", function (name, options) {
    if (
      (this.documentURI === "chrome://browser/content/browser.xhtml" ||
        this.documentElement?.namespaceURI === XUL_NS) &&
      findManifest(Components.stack.caller?.filename)
    ) {
      return this.createElementNS(XUL_NS, name, options);
    }
    return createElement.call(this, name, options);
  });

  const boxObjects = new WeakMap();
  replaceProperty(window.Element.prototype, "boxObject", {
    get() {
      if (boxObjects.has(this)) {
        return boxObjects.get(this);
      }
      const element = this;
      const getChild = (first) => {
        const root = element.openOrClosedShadowRoot || element;
        let child = first ? root.firstElementChild : root.lastElementChild;
        while (child && window.getComputedStyle(child).display === "none") {
          child = first ? child.nextElementSibling : child.previousElementSibling;
        }
        return child;
      };
      const box = createLegacyNamespace(element, {
        element,
        QueryInterface(iid) {
          if (iid?.equals?.(Ci.nsISupports) ||
              (element.localName === "tree" &&
               iid?.equals?.(getLegacyInterface("nsITreeBoxObject")))) {
            return box;
          }
          throw Components.Exception("", Cr.NS_NOINTERFACE);
        },
        get width() { return Math.round(element.getBoundingClientRect().width); },
        get height() { return Math.round(element.getBoundingClientRect().height); },
        get screenX() {
          const rect = element.getClientRects()[0];
          return rect ? Math.round(rect.left + window.mozInnerScreenX) : 0;
        },
        get screenY() {
          const rect = element.getClientRects()[0];
          return rect ? Math.round(rect.top + window.mozInnerScreenY) : 0;
        },
        get parentBox() { return element.parentElement || element.getRootNode().host || null; },
        get firstChild() { return getChild(true); },
        get lastChild() { return getChild(false); },
        get nextSibling() { return element.nextElementSibling; },
        get previousSibling() { return element.previousElementSibling; },
      });
      boxObjects.set(element, box);
      return box;
    },
  });

  replace(document, "getAnonymousNodes", function (element) {
    const root = element.openOrClosedShadowRoot || element;
    return root.childNodes.length ? Array.from(root.childNodes) : null;
  });
  replace(document, "getAnonymousElementByAttribute", function (element, name, value) {
    if (element.localName === "menupopup" &&
        name === "class" && value === "popup-internal-box") {
      return element.openOrClosedShadowRoot?.querySelector("arrowscrollbox") ?? null;
    }
    const visit = root => {
      const walker = document.createTreeWalker(root, window.NodeFilter.SHOW_ELEMENT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (value === "*" ? node.hasAttribute(name) : node.getAttribute(name) === value) {
          return node;
        }
        if (node.openOrClosedShadowRoot) {
          const found = visit(node.openOrClosedShadowRoot);
          if (found) {
            return found;
          }
        }
      }
      return null;
    };
    return visit(element.openOrClosedShadowRoot || element);
  });

  const importNode = document.importNode;
  const eventScopes = new WeakMap();
  const booleanAttributes = new Set(["checked", "disabled", "hidden", "collapsed", "selected", "readonly", "multiple"]);
  const bindEventHandler = (element, attribute, source) => {
    if (element.namespaceURI === XUL_NS &&
        booleanAttributes.has(attribute.name) && attribute.value === "false") {
      if (findManifest(source)) {
        element.removeAttribute(attribute.name);
      }
      return;
    }
    if (!attribute.name.startsWith("on")) {
      return;
    }
    const manifest = findManifest(source);
    if (!manifest) {
      return;
    }
    const target = element === document.documentElement &&
      element.namespaceURI === XUL_NS && WINDOW_EVENTS.has(attribute.name) &&
      findManifest(document.documentURI) ? window : element;
    if (!(attribute.name in target)) {
      return;
    }
    let scope = eventScopes.get(manifest);
    if (!scope) {
      scope = Cu.Sandbox(Services.scriptSecurityManager.getSystemPrincipal(), {
        sandboxPrototype: window,
        sandboxName: `Legacy chrome handlers: ${source}`,
        wantComponents: true,
        wantXrays: false,
        freezeBuiltins: false,
      });
      eventScopes.set(manifest, scope);
    }
    target[attribute.name] = Cu.evalInSandbox(
      `(function(event) {\n${attribute.value}\n})`,
      scope,
      "latest",
      source
    );
  };
  const bindHandlers = (root, source) => {
    if (!findManifest(source)) {
      return;
    }
    const walker = document.createTreeWalker(root, window.NodeFilter.SHOW_ELEMENT);
    let element = root.nodeType === window.Node.ELEMENT_NODE ? root : walker.nextNode();
    for (; element; element = walker.nextNode()) {
      for (const attribute of Array.from(element.attributes)) {
        bindEventHandler(element, attribute, source);
      }
    }
  };
  const setAttribute = window.Element.prototype.setAttribute;
  replace(window.Element.prototype, "setAttribute", function (name, value) {
    const result = setAttribute.call(this, name, value);
    if (typeof name === "string" &&
        (name.toLowerCase().startsWith("on") || booleanAttributes.has(name))) {
      bindEventHandler(this, this.getAttributeNode(name), Components.stack.caller?.filename);
    }
    return result;
  });
  const setAttributeNS = window.Element.prototype.setAttributeNS;
  replace(window.Element.prototype, "setAttributeNS", function (namespace, name, value) {
    const result = setAttributeNS.call(this, namespace, name, value);
    if ((namespace == null || namespace === "") &&
        typeof name === "string" &&
        (name.toLowerCase().startsWith("on") || booleanAttributes.has(name))) {
      bindEventHandler(this, this.getAttributeNode(name), Components.stack.caller?.filename);
    }
    return result;
  });
  replace(document, "importNode", function (node, deep = false) {
    const imported = importNode.call(this, node, deep);
    const source = findManifest(node.ownerDocument.documentURI)
      ? node.ownerDocument.documentURI
      : Components.stack.caller?.filename;
    bindHandlers(imported, source);
    return imported;
  });
  const cloneNode = window.Node.prototype.cloneNode;
  replace(window.Node.prototype, "cloneNode", function (deep = false) {
    const cloned = cloneNode.call(this, deep);
    const documentURI = this.ownerDocument?.documentURI ?? this.documentURI;
    const source = findManifest(documentURI)
      ? documentURI
      : Components.stack.caller?.filename;
    bindHandlers(cloned, source);
    return cloned;
  });

  replace(document, "loadOverlay", function (url, observer) {
    const manifest = findManifest(url);
    if (!manifest) {
      throw new Error(`No active legacy add-on owns overlay ${url}`);
    }
    new Overlays(manifest, window).load(url).then(() => {
      observer?.observe(Services.io.newURI(url), "xul-overlay-merged", null);
    }).catch(Cu.reportError);
  });

  for (const name of ["slice", "forEach"]) {
    if (!(name in window.Array)) {
      replace(window.Array, name, Function.prototype.call.bind(window.Array.prototype[name]));
    }
  }
  if (!("toSource" in window.Function.prototype)) {
    replace(window.Function.prototype, "toSource", legacyFunctionToSource);
  }

  const restore = () => {
    window.removeEventListener("unload", restore);
    for (const reset of restorers.reverse()) {
      reset();
    }
    windows.delete(window);
  };
  window.addEventListener("unload", restore, { once: true });
  windows.set(window, { restore, refresh, bindEventHandler, bindHandlers });
}

function initializeDocument(document) {
  const window = document.defaultView;
  if (!window || !document.nodePrincipal.isSystemPrincipal) {
    return;
  }
  prepareLegacyChromeWindow(window);
  if (!findManifest(document.documentURI)) {
    return;
  }
  windows.get(window)?.bindHandlers(document, document.documentURI);
  if (document.documentElement.localName === "prefwindow") {
    document.createXULElement("dialog");
    const Dialog = window.customElements.get("dialog");
    if (!window.customElements.get("prefwindow")) {
      window.customElements.define("prefwindow", class extends Dialog {});
    }
  }
  if (document.querySelector("preferences, colorpicker")) {
    const script = document.createElementNS(HTML_NS, "script");
    script.type = "module";
    script.src = "chrome://mozapps/content/extensions/legacyXULPreferences.mjs";
    document.documentElement.appendChild(script);
  }
}

const observer = {
  observe(subject, topic) {
    if (topic === "chrome-document-global-created") {
      prepareLegacyChromeWindow(subject);
    } else {
      initializeDocument(subject);
    }
  },
};

export function registerLegacyChromeWindows(manifest) {
  manifests.add(manifest);
  if (manifests.size === 1) {
    Services.obs.addObserver(observer, "chrome-document-global-created");
    Services.obs.addObserver(observer, "chrome-document-interactive");
  }
  for (const document of getOpenDocuments()) {
    if (["interactive", "complete"].includes(document.readyState)) {
      initializeDocument(document);
    }
  }
  return () => {
    manifests.delete(manifest);
    if (!manifests.size) {
      Services.obs.removeObserver(observer, "chrome-document-global-created");
      Services.obs.removeObserver(observer, "chrome-document-interactive");
      for (const { restore } of [...windows.values()]) {
        restore();
      }
    }
  };
}
