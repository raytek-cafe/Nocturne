/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict';

ChromeUtils.defineESModuleGetters(globalThis, {
  Blocklist: 'resource://gre/modules/Blocklist.sys.mjs',
  ConsoleAPI: 'resource://gre/modules/Console.sys.mjs',
  InstallRDF: 'resource://gre/modules/addons/RDFManifestConverter.sys.mjs',
  NetUtil: 'resource://gre/modules/NetUtil.sys.mjs',
});

function maybePatchLegacyAddonsUI(doc) {
  if (doc.location.protocol + doc.location.pathname !== 'about:addons' &&
      doc.location.protocol + doc.location.pathname !== 'chrome:/content/extensions/aboutaddons.html') {
    return;
  }

  const win = doc.defaultView;
  let handleEvent_orig = win.customElements.get('addon-card').prototype.handleEvent;
  win.customElements.get('addon-card').prototype.handleEvent = function (e) {
    if (e.type === 'click' &&
        e.target.getAttribute('action') === 'preferences' &&
        this.addon.__AddonInternal__.optionsType == 1/*AddonManager.OPTIONS_TYPE_DIALOG*/) {
      var windows = Services.wm.getEnumerator(null);
      while (windows.hasMoreElements()) {
        var win2 = windows.getNext();
        if (win2.closed) {
          continue;
        }
        if (win2.document.documentURI == this.addon.optionsURL) {
          win2.focus();
          return;
        }
      }
      var features = 'chrome,titlebar,toolbar,centerscreen';
      win.docShell.rootTreeItem.domWindow.openDialog(this.addon.optionsURL, this.addon.id, features);
    } else {
      handleEvent_orig.apply(this, arguments);
    }
  };
  let update_orig = win.customElements.get('addon-options').prototype.update;
  win.customElements.get('addon-options').prototype.update = function (card, addon) {
    update_orig.apply(this, arguments);
    if (addon.__AddonInternal__.optionsType == 1/*AddonManager.OPTIONS_TYPE_DIALOG*/) {
      this.querySelector('panel-item[data-l10n-id="preferences-addon-button"]').hidden = false;
    }
  };
}

function onLegacyChromeDocumentLoaded(doc) {
  maybePatchLegacyAddonsUI(doc);
  applyLegacyStyles(doc);
  applyLegacyOverlays(doc);
}

Services.obs.addObserver(onLegacyChromeDocumentLoaded, 'chrome-document-loaded');

const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
const { XPIDatabase, AddonInternal } = ChromeUtils.importESModule('resource://gre/modules/addons/XPIDatabase.sys.mjs');
const { XPIExports } = ChromeUtils.importESModule('resource://gre/modules/addons/XPIExports.sys.mjs');

var orig_verifyBundleSignedState = XPIExports.verifyBundleSignedState;
XPIExports.verifyBundleSignedState = async (aBundle, aAddon) => {
  if (!aAddon.isWebExtension && aAddon.type === "extension") {
    return { signedState: AddonManager.SIGNEDSTATE_NOT_REQUIRED, signedTypes: [] };
  }
  return orig_verifyBundleSignedState(aBundle, aAddon);
};

XPIDatabase.isDisabledLegacy = () => false;

ChromeUtils.defineLazyGetter(globalThis, 'BOOTSTRAP_REASONS', () => {
  const { XPIProvider } = ChromeUtils.importESModule('resource://gre/modules/addons/XPIProvider.sys.mjs');
  return XPIProvider.BOOTSTRAP_REASONS;
});

const { Log } = ChromeUtils.importESModule('resource://gre/modules/Log.sys.mjs');
var logger = Log.repository.getLogger('addons.bootstrap');

const aomStartup = Cc["@mozilla.org/addons/addon-manager-startup;1"]
  .getService(Ci.amIAddonManagerStartup);
const resourceProtocol = Services.io.getProtocolHandler("resource")
  .QueryInterface(Ci.nsIResProtocolHandler);
const RESTARTLESS_TYPES = new Set(["dictionary", "locale"]);
const gLegacyChromeRegistrations = new Map();
const gLegacyResourceHosts = new Set();
const gLegacyOverlayEntries = new Map();
const gLegacyStyleEntries = new Map();
const gLegacyAppliedOverlays = new WeakMap();
const gLegacyAppliedStyles = new WeakMap();

function createLegacyBootstrapModuleShim(defaultScope = null) {
  let moduleShim;

  function getChromeUtilsShim() {
    return {
      import: moduleShim.import,
      importESModule: ChromeUtils.importESModule.bind(ChromeUtils),
      unload: moduleShim.unload,
    };
  }

  function getLegacyModule(spec, scope = null) {
    let cleanSpec = spec.replace(/[?#].*$/, "");

    if (cleanSpec == "resource://gre/modules/Services.jsm") {
      return { Services };
    }

    if (cleanSpec == "resource://gre/modules/XPCOMUtils.jsm") {
      let { XPCOMUtils } = ChromeUtils.importESModule(
        "resource://gre/modules/XPCOMUtils.sys.mjs"
      );
      return {
        XPCOMUtils: {
          ...XPCOMUtils,
          generateQI: ChromeUtils.generateQI.bind(ChromeUtils),
        },
      };
    }

    if (cleanSpec.endsWith(".jsm")) {
      if (cleanSpec.startsWith("resource://gre/modules/")) {
        return ChromeUtils.importESModule(cleanSpec.replace(/\.jsm$/, ".sys.mjs"));
      }

      let legacyScope = Object.create(scope ?? defaultScope ?? null);
      Object.defineProperty(legacyScope, "Components", {
        value: createLegacyBootstrapComponentsShim(moduleShim),
        configurable: true,
        enumerable: true,
        writable: true,
      });
      Object.defineProperty(legacyScope, "Cu", {
        value: legacyScope.Components.utils,
        configurable: true,
        enumerable: true,
        writable: true,
      });
      Object.defineProperty(legacyScope, "Services", {
        value: Services,
        configurable: true,
        enumerable: true,
        writable: true,
      });
      Object.defineProperty(legacyScope, "ChromeUtils", {
        value: getChromeUtilsShim(),
        configurable: true,
        enumerable: true,
        writable: true,
      });

      Services.scriptloader.loadSubScript(cleanSpec, legacyScope);
      if (Array.isArray(legacyScope.EXPORTED_SYMBOLS)) {
        return Object.fromEntries(
          legacyScope.EXPORTED_SYMBOLS.map(symbol => [symbol, legacyScope[symbol]])
        );
      }
      return legacyScope;
    }

    throw new Error(`Unsupported legacy module import: ${spec}`);
  }

  moduleShim = {
    import(spec, scope = null) {
      let target = scope ?? defaultScope;
      let module = getLegacyModule(spec, target);
      if (target) {
        Object.assign(target, module);
        return target;
      }
      return module;
    },

    unload(_spec) {},
  };

  return moduleShim;
}

function createLegacyBootstrapComponentsShim(moduleShim) {
  let factoryWrappers = new WeakMap();

  function wrapFactory(factory) {
    if (!factory || typeof factory.createInstance != "function") {
      return factory;
    }

    let wrapped = factoryWrappers.get(factory);
    if (wrapped) {
      return wrapped;
    }

    wrapped = {
      createInstance(outer, iid) {
        return factory.createInstance(outer, iid);
      },
      lockFactory(lock) {
        if (typeof factory.lockFactory == "function") {
          return factory.lockFactory(lock);
        }
        return undefined;
      },
      QueryInterface(iid) {
        if (iid.equals(Ci.nsIFactory) || iid.equals(Ci.nsISupports)) {
          return this;
        }
        throw Cr.NS_NOINTERFACE;
      },
    };
    wrapped.contractID = factory.contractID;
    wrapped.classID = factory.classID;

    factoryWrappers.set(factory, wrapped);
    return wrapped;
  }

  function normalizeCID(classID) {
    if (typeof classID == "string") {
      return Components.ID(classID);
    }
    if (classID && typeof classID.toString == "function") {
      return Components.ID(classID.toString());
    }
    return classID;
  }





  let registrar = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);
  let manager = {
    QueryInterface(iid) {
      if (iid.equals(Ci.nsIComponentRegistrar) || iid.equals(Ci.nsISupports)) {
        return this;
      }
      return Components.manager.QueryInterface(iid);
    },
    registerFactory(classID, classDescription, contractID, factory) {
      let wrappedFactory = wrapFactory(factory);
      let normalizedCID = normalizeCID(classID);
      try {
        return registrar.registerFactory(
          normalizedCID,
          String(classDescription),
          String(contractID),
          wrappedFactory
        );
      } catch (error) {
        if (error.result == Cr.NS_ERROR_FACTORY_EXISTS) {
          registrar.unregisterFactory(normalizedCID, wrappedFactory);
          return registrar.registerFactory(
            normalizedCID,
            String(classDescription),
            String(contractID),
            wrappedFactory
          );
        }
        throw error;
      }
    },
    unregisterFactory(classID, factory) {
      let wrappedFactory = wrapFactory(factory);
      let normalizedCID = normalizeCID(classID);
      try {
        return registrar.unregisterFactory(normalizedCID, wrappedFactory);
      } catch (error) {
        if (error.result != Cr.NS_ERROR_FACTORY_NOT_REGISTERED) {
          throw error;
        }
      }
      return undefined;
    },
  };

  return {
    classes: Components.classes,
    interfaces: Components.interfaces,
    manager,
    results: Components.results,
    Constructor: (...args) => Components.Constructor(...args),
    ID: (...args) => Components.ID(...args),
    Exception: (...args) => Components.Exception(...args),
    isSuccessCode: (...args) => Components.isSuccessCode(...args),
    stack: Components.stack,
    utils: {
      Sandbox: (...args) => Cu.Sandbox(...args),
      cloneInto: (...args) => Cu.cloneInto(...args),
      createObjectIn: (...args) => Cu.createObjectIn(...args),
      evalInSandbox: (...args) => Cu.evalInSandbox(...args),
      exportFunction: (...args) => Cu.exportFunction(...args),
      getGlobalForObject: (...args) => Cu.getGlobalForObject(...args),
      import: moduleShim.import,
      importGlobalProperties: (...args) => Cu.importGlobalProperties(...args),
      isESModuleLoaded: (...args) => Cu.isESModuleLoaded?.(...args),
      nukeSandbox: (...args) => Cu.nukeSandbox?.(...args),
      reportError: (...args) => Cu.reportError(...args),
      unload: moduleShim.unload,
      waiveXrays: (...args) => Cu.waiveXrays(...args),
      unwaiveXrays: (...args) => Cu.unwaiveXrays(...args),
    },
  };
}

function createLegacySimpleURI(spec) {
  return Cc["@mozilla.org/network/simple-uri-mutator;1"]
    .createInstance(Ci.nsIURIMutator)
    .setSpec(spec)
    .finalize();
}

function readLegacyText(uri) {
  let channel = NetUtil.newChannel({
    uri,
    loadUsingSystemPrincipal: true,
  });
  let input = channel.open();
  try {
    return NetUtil.readInputStreamToString(input, input.available(), {
      charset: "utf-8",
    });
  } finally {
    input.close();
  }
}

function legacyHasResource(file, path) {
  if (file.isDirectory()) {
    let target = file.clone();
    target.appendRelativePath(path);
    return target.exists();
  }

  let zipReader = Cc["@mozilla.org/libjar/zip-reader;1"]
    .createInstance(Ci.nsIZipReader);
  zipReader.open(file);
  try {
    return zipReader.hasEntry(path);
  } finally {
    zipReader.close();
  }
}

function normalizeLegacyChromeURL(spec) {
  return spec.replace(/#.*/, "");
}

function parseLegacyChromeManifest(file) {
  let entries = [];

  function readManifest(uri) {
    let baseURI = Services.io.newURI(".", null, uri);
    let text = readLegacyText(uri);
    for (let rawLine of text.split(/\r?\n/)) {
      let line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }

      let tokens = line.split(/\s+/);
      let type = tokens.shift();
      if (type == "manifest") {
        if (!tokens.length) {
          continue;
        }
        readManifest(Services.io.newURI(tokens[0], null, uri));
        continue;
      }

      entries.push({ type, baseURI, args: tokens });
    }
  }

  try {
    readManifest(getURIForResourceInFile(file, "chrome.manifest"));
  } catch (error) {
    logger.warn(`Error reading chrome.manifest for ${file.path}`, error);
  }

  return entries;
}

function rebuildLegacyChromeRegistry() {
  for (let host of gLegacyResourceHosts) {
    resourceProtocol.setSubstitution(host, null);
  }
  gLegacyResourceHosts.clear();
  gLegacyOverlayEntries.clear();
  gLegacyStyleEntries.clear();

  for (let registration of gLegacyChromeRegistrations.values()) {
    for (let { host, uri } of registration.resources) {
      resourceProtocol.setSubstitution(host, uri);
      gLegacyResourceHosts.add(host);
    }

    for (let [target, overlays] of registration.overlays) {
      let existing = gLegacyOverlayEntries.get(target);
      if (!existing) {
        existing = [];
        gLegacyOverlayEntries.set(target, existing);
      }
      existing.push(...overlays);
    }

    for (let [target, styles] of registration.styles) {
      let existing = gLegacyStyleEntries.get(target);
      if (!existing) {
        existing = [];
        gLegacyStyleEntries.set(target, existing);
      }
      existing.push(...styles);
    }
  }
}

function registerLegacyChromeManifest(addon) {
  let file = addon.file || addon._sourceBundle;
  if (!legacyHasResource(file, "chrome.manifest")) {
    return null;
  }

  unregisterLegacyChromeManifest(addon.id);

  let chromeEntries = [];
  let resources = [];
  let overlays = new Map();
  let styles = new Map();

  for (let entry of parseLegacyChromeManifest(file)) {
    switch (entry.type) {
      case "content": {
        if (entry.args.length < 2) {
          break;
        }
        let args = ["content", entry.args[0], Services.io.newURI(entry.args[1], null, entry.baseURI).spec];
        if (entry.args[2] == "contentaccessible=yes") {
          args.push(entry.args[2]);
        }
        chromeEntries.push(args);
        break;
      }

      case "locale":
        if (entry.args.length >= 3) {
          chromeEntries.push([
            "locale",
            entry.args[0],
            entry.args[1],
            Services.io.newURI(entry.args[2], null, entry.baseURI).spec,
          ]);
        }
        break;

      case "override":
        if (entry.args.length >= 2) {
          chromeEntries.push([
            "override",
            entry.args[0],
            Services.io.newURI(entry.args[1], null, entry.baseURI).spec,
          ]);
        }
        break;

      case "resource":
        if (entry.args.length >= 2) {
          resources.push({
            host: entry.args[0],
            uri: Services.io.newURI(entry.args[1], null, entry.baseURI),
          });
        }
        break;

      case "overlay":
      case "style":
        if (entry.args.length >= 2) {
          let target = normalizeLegacyChromeURL(entry.args[0]);
          let spec = Services.io.newURI(entry.args[1], null, entry.baseURI).spec;
          let map = entry.type == "overlay" ? overlays : styles;
          let existing = map.get(target);
          if (!existing) {
            existing = [];
            map.set(target, existing);
          }
          existing.push(spec);
        }
        break;
    }
  }

  let manifestURI = getURIForResourceInFile(file, "chrome.manifest");
  let chromeHandle = chromeEntries.length
    ? aomStartup.registerChrome(manifestURI, chromeEntries)
    : null;

  let registration = {
    addonId: addon.id,
    chromeHandle,
    resources,
    overlays,
    styles,
  };
  gLegacyChromeRegistrations.set(addon.id, registration);
  rebuildLegacyChromeRegistry();
  applyLegacyChromeToOpenWindows();
  return registration;
}

function unregisterLegacyChromeManifest(addonId) {
  let registration = gLegacyChromeRegistrations.get(addonId);
  if (!registration) {
    return;
  }

  gLegacyChromeRegistrations.delete(addonId);
  registration.chromeHandle?.destruct();
  rebuildLegacyChromeRegistry();
}

function applyLegacyChromeToOpenWindows() {
  let windows = Services.wm.getEnumerator(null);
  while (windows.hasMoreElements()) {
    let win = windows.getNext();
    if (win.closed) {
      continue;
    }
    let doc = win.document;
    applyLegacyStyles(doc);
    applyLegacyOverlays(doc);
  }
}

function cloneLegacyOverlayNode(doc, node) {
  switch (node.nodeType) {
    case node.ELEMENT_NODE: {
      let clone = doc.createElementNS(node.namespaceURI, node.nodeName);
      for (let attr of node.attributes) {
        clone.setAttributeNS(attr.namespaceURI, attr.name, attr.value);
      }
      for (let child of node.childNodes) {
        clone.appendChild(cloneLegacyOverlayNode(doc, child));
      }
      return clone;
    }

    case node.TEXT_NODE:
      return doc.createTextNode(node.textContent);

    case node.CDATA_SECTION_NODE:
      return doc.createCDATASection(node.data);

    case node.COMMENT_NODE:
      return doc.createComment(node.data);

    default:
      return doc.createTextNode("");
  }
}

function insertLegacyOverlayNode(target, overlayNode) {
  let doc = target.ownerDocument;
  let clone = cloneLegacyOverlayNode(doc, overlayNode);
  if (overlayNode.nodeType != overlayNode.ELEMENT_NODE) {
    target.appendChild(clone);
    return;
  }

  let beforeId = overlayNode.getAttribute("insertbefore");
  if (beforeId) {
    let before = doc.getElementById(beforeId);
    if (before?.parentNode == target) {
      target.insertBefore(clone, before);
      return;
    }
  }

  let afterId = overlayNode.getAttribute("insertafter");
  if (afterId) {
    let after = doc.getElementById(afterId);
    if (after?.parentNode == target) {
      target.insertBefore(clone, after.nextSibling);
      return;
    }
  }

  target.appendChild(clone);
}

function mergeLegacyOverlayElement(target, overlayNode) {
  let doc = target.ownerDocument;
  for (let attr of overlayNode.attributes) {
    if (attr.name == "id" || attr.name == "insertbefore" || attr.name == "insertafter") {
      continue;
    }
    target.setAttributeNS(attr.namespaceURI, attr.name, attr.value);
  }

  for (let child of overlayNode.childNodes) {
    if (child.nodeType == child.ELEMENT_NODE && child.hasAttribute("id")) {
      let existing = doc.getElementById(child.getAttribute("id"));
      if (existing) {
        mergeLegacyOverlayElement(existing, child);
        continue;
      }
    }
    insertLegacyOverlayNode(target, child);
  }
}

function applyLegacyOverlayDocument(doc, overlaySpec) {
  let overlayText = readLegacyText(Services.io.newURI(overlaySpec));
  let overlayDoc = new doc.defaultView.DOMParser()
    .parseFromString(overlayText, "application/xml");
  let root = overlayDoc.documentElement;
  if (!root || root.localName == "parsererror") {
    logger.warn(`Failed to parse legacy overlay ${overlaySpec}`);
    return;
  }

  for (let child of root.childNodes) {
    if (child.nodeType != child.ELEMENT_NODE) {
      continue;
    }
    if (child.hasAttribute("id")) {
      let target = doc.getElementById(child.getAttribute("id"));
      if (target) {
        mergeLegacyOverlayElement(target, child);
        continue;
      }
    }
    insertLegacyOverlayNode(doc.documentElement, child);
  }
}

function applyLegacyStyles(doc) {
  let entries = gLegacyStyleEntries.get(normalizeLegacyChromeURL(doc.documentURI));
  if (!entries?.length) {
    return;
  }

  let applied = gLegacyAppliedStyles.get(doc);
  if (!applied) {
    applied = new Set();
    gLegacyAppliedStyles.set(doc, applied);
  }

  for (let spec of entries) {
    if (applied.has(spec)) {
      continue;
    }
    let pi = doc.createProcessingInstruction("xml-stylesheet", `href="${spec}" type="text/css"`);
    doc.insertBefore(pi, doc.documentElement);
    applied.add(spec);
  }
}

function applyLegacyOverlays(doc) {
  let entries = gLegacyOverlayEntries.get(normalizeLegacyChromeURL(doc.documentURI));
  if (!entries?.length) {
    return;
  }

  let applied = gLegacyAppliedOverlays.get(doc);
  if (!applied) {
    applied = new Set();
    gLegacyAppliedOverlays.set(doc, applied);
  }

  for (let spec of entries) {
    if (applied.has(spec)) {
      continue;
    }
    try {
      applyLegacyOverlayDocument(doc, spec);
      applied.add(spec);
    } catch (error) {
      logger.warn(`Failed to apply legacy overlay ${spec}`, error);
    }
  }
}

function createLegacyBootstrapScope(addon) {
  let file = addon.file || addon._sourceBundle;
  let uri = getURIForResourceInFile(file, 'bootstrap.js').spec;
  let principal = Services.scriptSecurityManager.getSystemPrincipal();

  let sandbox = new Cu.Sandbox(principal, {
    sandboxName: uri,
    addonId: addon.id,
    wantGlobalProperties: ['ChromeUtils', 'indexedDB'],
    metadata: { addonID: addon.id, URI: uri },
  });
  let legacyModuleShim = createLegacyBootstrapModuleShim(sandbox);
  let legacyComponents = createLegacyBootstrapComponentsShim(legacyModuleShim);
  let legacyChromeUtils = {
    import: legacyModuleShim.import,
    importESModule: ChromeUtils.importESModule.bind(ChromeUtils),
    unload: legacyModuleShim.unload,
  };
  sandbox.__legacyBootstrapComponents = legacyComponents;
  sandbox.__legacyBootstrapUtils = legacyComponents.utils;
  sandbox.__legacyBootstrapChromeUtils = legacyChromeUtils;
  sandbox.__legacyCreateSimpleURI = createLegacySimpleURI;
  sandbox.__legacyInsertToolbarItem = legacyInsertToolbarItem;
  if (typeof Worker != "undefined") {
    sandbox.Worker = Worker;
  }
  if (typeof ChromeWorker != "undefined") {
    sandbox.ChromeWorker = ChromeWorker;
  }

  try {
    Object.assign(sandbox, BOOTSTRAP_REASONS);

    ChromeUtils.defineLazyGetter(sandbox, 'console', () =>
      new ConsoleAPI({ consoleID: `addon/${addon.id}` }));

    loadLegacyBootstrapScript(
      uri,
      sandbox,
      "var Components = __legacyBootstrapComponents; var Cu = __legacyBootstrapUtils; var ChromeUtils = __legacyBootstrapChromeUtils;\n"
    );
  } catch (e) {
    logger.warn(`Error loading bootstrap.js for ${addon.id}`, e);
  } finally {
    delete sandbox.__legacyBootstrapComponents;
    delete sandbox.__legacyBootstrapUtils;
    delete sandbox.__legacyBootstrapChromeUtils;
  }

  function findMethod(name) {
    if (sandbox[name]) {
      return sandbox[name];
    }

    try {
      let method = Cu.evalInSandbox(name, sandbox);
      return method;
    } catch (err) { }

    return () => {
      logger.warn(`Add-on ${addon.id} is missing bootstrap method ${name}`);
    };
  }

  let install = findMethod('install');
  let uninstall = findMethod('uninstall');
  let startup = findMethod('startup');
  let shutdown = findMethod('shutdown');

  return {
    install(...args) {
      install(...args);
      Services.obs.notifyObservers(null, 'startupcache-invalidate');
    },

    uninstall(...args) {
      uninstall(...args);
      Services.obs.notifyObservers(null, 'startupcache-invalidate');
    },

    startup(...args) {
      if (addon.type == 'extension') {
        logger.debug(`Registering manifest for ${file.path}\n`);
        Components.manager.addBootstrappedManifestLocation(file);
      }
      return startup(...args);
    },

    shutdown(data, reason) {
      try {
        return shutdown(data, reason);
      } finally {
        if (reason != BOOTSTRAP_REASONS.APP_SHUTDOWN) {
          logger.debug(`Removing manifest for ${file.path}\n`);
          Components.manager.removeBootstrappedManifestLocation(file);
        }
      }
    },
  };
}

function createLegacyClassicScope(addon) {
  return {
    install() {},
    uninstall() {
      unregisterLegacyChromeManifest(addon.id);
      Services.obs.notifyObservers(null, 'startupcache-invalidate');
    },
    startup() {
      registerLegacyChromeManifest(addon);
      Services.obs.notifyObservers(null, 'startupcache-invalidate');
    },
    shutdown(_data, reason) {
      if (reason != BOOTSTRAP_REASONS.APP_SHUTDOWN) {
        unregisterLegacyChromeManifest(addon.id);
      }
    },
  };
}

function normalizeLegacyToolbarButtonIcon(item) {
  if (item.localName != "toolbarbutton" || item.hasAttribute("image")) {
    return;
  }

  let listStyleImage = item.style.listStyleImage;
  let match = /^url\(["']?(.*?)["']?\)$/.exec(listStyleImage);
  if (!match) {
    return;
  }

  item.setAttribute("image", match[1]);
  item.style.removeProperty("list-style-image");
}


function legacyInsertToolbarItem(toolbar, itemID, beforeElt = null) {
  let doc = toolbar.ownerDocument;
  let toolbox = doc.getElementById("navigator-toolbox");
  let palette = toolbox?.palette;
  let item =
    doc.getElementById(itemID) ??
    palette?.querySelector?.(`#${CSS.escape(itemID)}`);
  if (!item) {
    return null;
  }

  if (typeof beforeElt == "string") {
    beforeElt = doc.getElementById(beforeElt);
  }

  let target =
    doc.getElementById(toolbar.getAttribute("customizationtarget")) ?? toolbar;
  if (beforeElt?.parentNode != target) {
    beforeElt = null;
  }
  if (item.localName == "toolbarbutton") {
    normalizeLegacyToolbarButtonIcon(item);
    item.classList.add("badged-button");
    item.classList.add("webextension-browser-action");
    item.setAttribute("badged", "true");
    item.setAttribute("constrain-size", "true");
  }


  target.insertBefore(item, beforeElt);
  let currentSet = Array.from(target.children, child => child.id).filter(Boolean);
  toolbar.setAttribute("currentset", currentSet.join(","));
  return item;
}



function loadLegacyBootstrapScript(uri, sandbox, prelude = "") {
  let channel = NetUtil.newChannel({
    uri,
    loadUsingSystemPrincipal: true,
  });
  let input = channel.open();
  try {
    let source = NetUtil.readInputStreamToString(input, input.available(), {
      charset: "utf-8",
    });
    source = source
      .replace(/\butils\s*:\s*Cu\b/g, "utils: __legacyBootstrapUtils")
      .replace(
        /aSubject\.QueryInterface\(Ci\.nsIDOMWindow\)\.addEventListener\("load",\s*this,\s*false\)/g,
        "aSubject.addEventListener(\"load\", this, false)"
      )
      .replace(
        /aWindow\["ca-archive"\]\.done\(\);\s*delete aWindow\["ca-archive"\];/g,
        "if (aWindow[\"ca-archive\"]) { aWindow[\"ca-archive\"].done(); delete aWindow[\"ca-archive\"]; }"
      )
      .replace(
        /CC\(\s*["']@mozilla\.org\/network\/simple-uri;1["']\s*,\s*["']nsIURI["']\s*\)/g,
        "function LegacySimpleURI() {}"
      )
      .replace(
        /(?:let|var|const)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+nsIURI\(\);\s*\1\.spec\s*=\s*([^;]+);\s*return\s+\1;/g,
        "return __legacyCreateSimpleURI($2);"
      )
      .replace(/\btoolbar\.insertItem\(/g, "__legacyInsertToolbarItem(toolbar, ")
      .replace(/\bCu\.import\(/g, "ChromeUtils.import(")
      .replace(/\bComponents\.utils\.import\(/g, "ChromeUtils.import(")
      .replace(/\bCu\.unload\(/g, "ChromeUtils.unload(")
      .replace(/\bComponents\.utils\.unload\(/g, "ChromeUtils.unload(");
    Cu.evalInSandbox(prelude + source, sandbox, "latest", uri, 1);
  } finally {
    input.close();
  }
}

/**
 * Valid IDs fit this pattern.
 */
var gIDTest = /^(\{[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}|[a-z0-9-\._]*\@[a-z0-9-\._]+)$/i;

// Properties that exist in the install manifest
const PROP_METADATA = [
  'id',
  'version',
  'type',
  'internalName',
  'updateURL',
  'updateKey',
  'optionsURL',
  'optionsType',
  'aboutURL',
  'iconURL',
  'icon64URL',
];
const PROP_LOCALE_SINGLE = ['name', 'description', 'creator', 'homepageURL'];
const PROP_LOCALE_MULTI = ['developers', 'translators', 'contributors'];

// Map new string type identifiers to old style nsIUpdateItem types.
const TYPES = {
  extension: 2,
  theme: 4,
  locale: 8,
  dictionary: 64,
};

const COMPATIBLE_BY_DEFAULT_TYPES = {
  extension: true,
  dictionary: true,
};

const hasOwnProperty = Function.call.bind(Object.prototype.hasOwnProperty);

function isXPI(filename) {
  let ext = filename.slice(-4).toLowerCase();
  return ext === '.xpi' || ext === '.zip';
}

/**
 * Gets an nsIURI for a file within another file, either a directory or an XPI
 * file. If aFile is a directory then this will return a file: URI, if it is an
 * XPI file then it will return a jar: URI.
 *
 * @param {nsIFile} aFile
 *        The file containing the resources, must be either a directory or an
 *        XPI file
 * @param {string} aPath
 *        The path to find the resource at, '/' separated. If aPath is empty
 *        then the uri to the root of the contained files will be returned
 * @returns {nsIURI}
 *        An nsIURI pointing at the resource
 */
function getURIForResourceInFile(aFile, aPath) {
  if (!isXPI(aFile.leafName)) {
    let resource = aFile.clone();
    if (aPath)
      aPath.split('/').forEach(part => resource.append(part));

    return Services.io.newFileURI(resource);
  }

  return buildJarURI(aFile, aPath);
}

/**
 * Creates a jar: URI for a file inside a ZIP file.
 *
 * @param {nsIFile} aJarfile
 *        The ZIP file as an nsIFile
 * @param {string} aPath
 *        The path inside the ZIP file
 * @returns {nsIURI}
 *        An nsIURI for the file
 */
function buildJarURI(aJarfile, aPath) {
  let uri = Services.io.newFileURI(aJarfile);
  uri = 'jar:' + uri.spec + '!/' + aPath;
  return Services.io.newURI(uri);
}

export var BootstrapLoader = {
  name: 'bootstrap',
  manifestFile: 'install.rdf',
  async loadManifest(pkg) {
    /**
     * Reads locale properties from either the main install manifest root or
     * an em:localized section in the install manifest.
     *
     * @param {Object} aSource
     *        The resource to read the properties from.
     * @param {boolean} isDefault
     *        True if the locale is to be read from the main install manifest
     *        root
     * @param {string[]} aSeenLocales
     *        An array of locale names already seen for this install manifest.
     *        Any locale names seen as a part of this function will be added to
     *        this array
     * @returns {Object}
     *        an object containing the locale properties
     */
    function readLocale(aSource, isDefault, aSeenLocales) {
      let locale = {};
      if (!isDefault) {
        locale.locales = [];
        for (let localeName of aSource.locales || []) {
          if (!localeName) {
            logger.warn('Ignoring empty locale in localized properties');
            continue;
          }
          if (aSeenLocales.includes(localeName)) {
            logger.warn('Ignoring duplicate locale in localized properties');
            continue;
          }
          aSeenLocales.push(localeName);
          locale.locales.push(localeName);
        }

        if (locale.locales.length == 0) {
          logger.warn('Ignoring localized properties with no listed locales');
          return null;
        }
      }

      for (let prop of [...PROP_LOCALE_SINGLE, ...PROP_LOCALE_MULTI]) {
        if (hasOwnProperty(aSource, prop)) {
          locale[prop] = aSource[prop];
        }
      }

      return locale;
    }

    let manifestData = await pkg.readString('install.rdf');
    let manifest = InstallRDF.loadFromString(manifestData).decode();

    let addon = new AddonInternal();
    for (let prop of PROP_METADATA) {
      if (hasOwnProperty(manifest, prop)) {
        addon[prop] = manifest[prop];
      }
    }

    if (!addon.type) {
      addon.type = 'extension';
    } else {
      let type = addon.type;
      addon.type = null;
      for (let name in TYPES) {
        if (TYPES[name] == type) {
          addon.type = name;
          break;
        }
      }
    }

    if (!(addon.type in TYPES)) {
      throw new Error('Install manifest specifies unknown type: ' + addon.type);
    }

    if (!addon.id) {
      throw new Error('No ID in install manifest');
    }
    if (!gIDTest.test(addon.id)) {
      throw new Error('Illegal add-on ID ' + addon.id);
    }
    if (!addon.version) {
      throw new Error('No version in install manifest');
    }

    addon.unpack = manifest.unpack == 'true';
    addon.strictCompatibility = (!(addon.type in COMPATIBLE_BY_DEFAULT_TYPES) ||
                                 manifest.strictCompatibility == 'true');

    if (addon.type == 'extension') {
      addon.bootstrap = manifest.bootstrap == 'true';
      addon.multiprocessCompatible = manifest.multiprocessCompatible == 'true';

      if (addon.optionsType &&
          addon.optionsType != 1/*AddonManager.OPTIONS_TYPE_DIALOG*/ &&
          addon.optionsType != AddonManager.OPTIONS_TYPE_INLINE_BROWSER &&
          addon.optionsType != AddonManager.OPTIONS_TYPE_TAB) {
        throw new Error('Install manifest specifies unknown optionsType: ' + addon.optionsType);
      }

      if (addon.optionsType) {
        addon.optionsType = parseInt(addon.optionsType);
      }
    } else {
      addon.bootstrap = RESTARTLESS_TYPES.has(addon.type);
      addon.optionsURL = null;
      addon.optionsType = null;
      addon.aboutURL = null;

      if (addon.type == 'theme') {
        if (!addon.internalName) {
          throw new Error('Themes must include an internalName property');
        }
        addon.skinnable = manifest.skinnable == 'true';
      }
    }

    addon.defaultLocale = readLocale(manifest, true);

    let seenLocales = [];
    addon.locales = [];
    for (let localeData of manifest.localized || []) {
      let locale = readLocale(localeData, false, seenLocales);
      if (locale) {
        addon.locales.push(locale);
      }
    }

    let dependencies = new Set(manifest.dependencies);
    addon.dependencies = Object.freeze(Array.from(dependencies));

    let seenApplications = [];
    addon.targetApplications = [];
    for (let targetApp of manifest.targetApplications || []) {
      if (!targetApp.id || !targetApp.minVersion ||
          !targetApp.maxVersion) {
        logger.warn('Ignoring invalid targetApplication entry in install manifest');
        continue;
      }
      if (seenApplications.includes(targetApp.id)) {
        logger.warn('Ignoring duplicate targetApplication entry for ' + targetApp.id +
                    ' in install manifest');
        continue;
      }
      seenApplications.push(targetApp.id);
      addon.targetApplications.push(targetApp);
    }

    addon.targetPlatforms = [];
    for (let targetPlatform of manifest.targetPlatforms || []) {
      let platform = {
        os: null,
        abi: null,
      };

      let pos = targetPlatform.indexOf('_');
      if (pos != -1) {
        platform.os = targetPlatform.substring(0, pos);
        platform.abi = targetPlatform.substring(pos + 1);
      } else {
        platform.os = targetPlatform;
      }

      addon.targetPlatforms.push(platform);
    }

    addon.userDisabled = false;
    addon.softDisabled = addon.blocklistState == Blocklist.STATE_SOFTBLOCKED;
    addon.applyBackgroundUpdates = AddonManager.AUTOUPDATE_DEFAULT;

    addon.userPermissions = null;
    addon.icons = {};

    if (addon.icon64URL) {
      addon.icons[64] = addon.icon64URL;
    }
    if (await pkg.hasResource('icon.png')) {
      addon.icons[32] = 'icon.png';
      addon.icons[48] = 'icon.png';
    }
    if (await pkg.hasResource('icon64.png')) {
      addon.icons[64] = 'icon64.png';
    }

    Object.defineProperty(addon, 'appDisabled', {
      set: _ => {},
      get: _ => false
    });

    Object.defineProperty(addon, 'signedState', {
      set: _ => {},
      get: _ => AddonManager.SIGNEDSTATE_NOT_REQUIRED
    });

    return addon;
  },

  loadScope(addon) {
    let file = addon.file || addon._sourceBundle;
    if (addon.type == 'extension' && legacyHasResource(file, 'bootstrap.js')) {
      return createLegacyBootstrapScope(addon);
    }
    return createLegacyClassicScope(addon);
  },
};

if (AddonManager.isReady) {
  AddonManager.getAllAddons().then(addons => {
    addons.forEach(addon => {
      if (addon.type == 'extension' && !addon.isWebExtension && !addon.userDisabled) {
        addon.reload();
      };
    });
  });
}