/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Preferences } from "chrome://global/content/preferences/Preferences.mjs";
import { getLegacyPreference } from "resource://gre/modules/addons/LegacyModuleLoader.sys.mjs";

const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
const HTML_NS = "http://www.w3.org/1999/xhtml";
const PREFERENCE_SELECTOR = "preference[name]";
const CONTROL_SELECTOR = "[preference]";
const SUPPORTED_TYPES = new Set([
  "bool",
  "int",
  "string",
  "unichar",
  "wstring",
  "fontname",
  "file",
]);

class LegacyXULPreferencesAdapter {
  #declarations = new Map();
  #synchronizedControls = new Set();
  #observer = null;
  #destroyed = false;
  #domReadyListener = null;
  #readyResolve;

  constructor() {
    this.ready = new Promise(resolve => {
      this.#readyResolve = resolve;
    });
    this.#start();
  }

  async #start() {
    if (document.readyState == "loading") {
      await new Promise(resolve => {
        this.#domReadyListener = () => {
          this.#domReadyListener = null;
          resolve();
        };
        window.addEventListener(
          "DOMContentLoaded",
          this.#domReadyListener,
          { capture: true, once: true }
        );
      });
    }
    if (this.#destroyed) {
      this.#readyResolve();
      return;
    }

    this.#installStyleSheet();
    this.#initializeTree(document);
    Preferences.queueUpdateOfAllElements();

    this.#observer = new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType == Node.ELEMENT_NODE) {
            this.#initializeTree(node);
          }
        }
      }
    });
    this.#observer.observe(document, { childList: true, subtree: true });
    this.#readyResolve();
  }

  #installStyleSheet() {
    if (document.querySelector("link[data-legacy-xul-preferences]")) {
      return;
    }
    const link = document.createElementNS(HTML_NS, "link");
    link.rel = "stylesheet";
    link.href =
      "chrome://mozapps/content/extensions/legacyXULPreferences.css";
    link.dataset.legacyXulPreferences = "true";
    document.documentElement.prepend(link);
  }

  #initializeTree(root) {
    const declarations = [];
    if (root.matches?.(PREFERENCE_SELECTOR)) {
      declarations.push(root);
    }
    declarations.push(...root.querySelectorAll?.(PREFERENCE_SELECTOR) ?? []);
    for (const declaration of declarations) {
      this.#initializeDeclaration(declaration);
    }

    const controls = [];
    if (root.matches?.(CONTROL_SELECTOR)) {
      controls.push(root);
    }
    controls.push(...root.querySelectorAll?.(CONTROL_SELECTOR) ?? []);
    for (let control of controls) {
      if (control.localName == "preference") {
        continue;
      }
      control = this.#upgradeControl(control);
      this.#bindControl(control);
    }

    for (const colorpicker of root.matches?.("colorpicker")
      ? [root]
      : root.querySelectorAll?.("colorpicker") ?? []) {
      const control = this.#upgradeControl(colorpicker);
      this.#bindControl(control);
    }
  }

  #initializeDeclaration(element) {
    if (element.dataset.legacyPreferenceInitialized) {
      return;
    }

    const legacyId = element.id;
    const name = element.getAttribute("name");
    const type = element.getAttribute("type") || "string";
    const inverted = element.getAttribute("inverted") == "true";
    if (!legacyId || !name || !SUPPORTED_TYPES.has(type)) {
      console.error(
        `Invalid legacy preference declaration id=${legacyId}, name=${name}, type=${type}`
      );
      return;
    }

    let entry = this.#declarations.get(legacyId);
    if (entry) {
      if (entry.name != name || entry.type != type || entry.inverted != inverted) {
        console.error(`Conflicting duplicate legacy preference '${legacyId}'`);
        return;
      }
    } else {
      const alias = getLegacyPreference(name);
      const preferenceName = alias?.name ?? name;
      const preferenceType = alias?.type ?? type;
      let preference = Preferences.get(preferenceName);
      if (!preference) {
        preference = Preferences.add({ id: preferenceName, type: preferenceType, inverted: false });
      } else if (preference.type != preferenceType) {
        console.error(`Conflicting preference declaration for '${name}'`);
        return;
      }
      entry = { name, type, inverted, preference, alias };
      this.#declarations.set(legacyId, entry);
    }

    if (element.getAttribute("instantApply") == "true") {
      Preferences.forceEnableInstantApply();
    }
    this.#exposeDeclaration(element, entry);
    element.dataset.legacyPreferenceInitialized = "true";
    for (const control of document.querySelectorAll(CONTROL_SELECTOR)) {
      if (control.getAttribute("preference") == legacyId) {
        this.#bindControl(this.#upgradeControl(control));
      }
    }
  }

  #exposeDeclaration(element, entry) {
    const descriptors = {
      name: {
        get: () => entry.name,
      },
      type: {
        get: () => entry.type,
      },
      inverted: {
        get: () => entry.inverted,
      },
      value: {
        get: () => {
          const value = entry.alias
            ? entry.alias.toLegacy(entry.preference.value) : entry.preference.value;
          return entry.inverted && typeof value == "boolean" ? !value : value;
        },
        set: value => {
          if (entry.inverted && typeof value == "boolean") {
            value = !value;
          }
          entry.preference.value = entry.alias ? entry.alias.fromLegacy(value) : value;
        },
      },
      defaultValue: {
        get: () => {
          const value = entry.alias
            ? entry.alias.toLegacy(entry.preference.defaultValue) : entry.preference.defaultValue;
          return entry.inverted && typeof value == "boolean" ? !value : value;
        },
      },
      locked: {
        get: () => entry.preference.locked,
      },
      hasUserValue: {
        get: () => entry.preference.hasUserValue,
      },
      reset: {
        value: () => entry.preference.reset(),
      },
    };
    for (const descriptor of Object.values(descriptors)) {
      descriptor.configurable = true;
      descriptor.enumerable = true;
    }
    Object.defineProperties(element, descriptors);
  }

  #upgradeControl(control) {
    if (control.localName != "colorpicker") {
      return control;
    }

    const input = document.createElementNS(HTML_NS, "input");
    for (const attribute of control.attributes) {
      if (attribute.name != "type") {
        input.setAttribute(attribute.name, attribute.value);
      }
    }
    input.type = "color";
    input.classList.add("legacy-xul-colorpicker");
    input.disabled = control.hasAttribute("disabled");
    input.title = control.getAttribute("tooltiptext") || "";
    control.replaceWith(input);
    return input;
  }

  #bindControl(control) {
    if (control.dataset.legacyPreferenceControlInitialized) {
      return;
    }
    const legacyId = control.getAttribute("preference");
    const entry = this.#declarations.get(legacyId);
    if (!entry) {
      return;
    }

    if (entry.inverted || entry.alias) {
      Preferences.addSyncFromPrefListener(control, () => {
        let value = Preferences.instantApply
          ? entry.preference.valueFromPreferences
          : entry.preference.value;
        if (entry.alias) {
          value = entry.alias.toLegacy(value);
        }
        return entry.inverted && typeof value == "boolean" ? !value : value;
      });
      Preferences.addSyncToPrefListener(control, element => {
        const value = entry.inverted ? !element.checked : element.checked;
        return entry.alias ? entry.alias.fromLegacy(value) : value;
      });
      this.#synchronizedControls.add(control);
    }
    control.setAttribute("preference", entry.preference.id);
    control.dataset.legacyPreferenceControlInitialized = "true";
    entry.preference.setElementValue(control);
  }

  destroy() {
    if (this.#destroyed) {
      return;
    }
    for (const control of this.#synchronizedControls) {
      Preferences.removeSyncFromPrefListener(control);
      Preferences.removeSyncToPrefListener(control);
    }
    this.#synchronizedControls.clear();
    this.#destroyed = true;
    if (this.#domReadyListener) {
      window.removeEventListener(
        "DOMContentLoaded",
        this.#domReadyListener,
        { capture: true }
      );
      const listener = this.#domReadyListener;
      this.#domReadyListener = null;
      listener();
    }
    this.#observer?.disconnect();
    this.#observer = null;

    window.removeEventListener("toggle", Preferences);
    window.removeEventListener("change", Preferences);
    window.removeEventListener("command", Preferences);
    window.removeEventListener("dialogaccept", Preferences);
    window.removeEventListener("input", Preferences);
    window.removeEventListener("select", Preferences);
    window.removeEventListener("unload", Preferences);
    Preferences.onUnload();
  }
}

window.LegacyXULPreferences = new LegacyXULPreferencesAdapter();
