/* -*- indent-tabs-mode: nil; js-indent-level: 2 -*-
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* eslint-env mozilla/browser-window */

// JS files which are needed by browser.xhtml but no other top level windows to
// support MacOS specific features should be loaded directly from browser-main.js
// rather than this file.
//
// If you update this list, you may need to add a mapping within the following
// file so that ESLint works correctly:
// tools/lint/eslint/eslint-plugin-mozilla/lib/environments/browser-window.js

// prettier-ignore
// eslint-disable-next-line no-lone-blocks
{
  Services.scriptloader.loadSubScript("chrome://browser/content/browser.js", this);
  Services.scriptloader.loadSubScript("chrome://browser/content/places/browserPlacesViews.js", this);
  Services.scriptloader.loadSubScript("chrome://browser/content/browser-places.js", this);
  Services.scriptloader.loadSubScript("chrome://global/content/globalOverlay.js", this);
  Services.scriptloader.loadSubScript("chrome://global/content/editMenuOverlay.js", this);
  Services.scriptloader.loadSubScript("chrome://browser/content/utilityOverlay.js", this);
  Services.scriptloader.loadSubScript("chrome://browser/content/browser-sets.js", this);
  if (AppConstants.platform == "macosx") {
    Services.scriptloader.loadSubScript("chrome://global/content/macWindowMenu.js", this);
  }
}

const LEGACY_XUL_CREATE_ELEMENT_TAGS = new Set([
  "menu",
  "menubar",
  "menuitem",
  "menupopup",
  "menuseparator",
  "toolbar",
  "toolbarbutton",
  "toolbaritem",
  "toolbarpalette",
  "toolbarseparator",
  "toolbarspacer",
  "toolbarspring",
]);

if (document.contentType == "application/xhtml+xml" && document.createXULElement) {
  let createElement = document.createElement;
  document.createElement = function (localName, options) {
    if (
      typeof localName == "string" &&
      LEGACY_XUL_CREATE_ELEMENT_TAGS.has(localName.toLowerCase())
    ) {
      return document.createXULElement(localName);
    }
    return createElement.call(this, localName, options);
  };
}

function getLegacyToolbarTarget(toolbar) {
  return (
    document.getElementById(toolbar.getAttribute("customizationtarget")) ??
    toolbar
  );
}

function getLegacyToolbarCurrentSet(toolbar) {
  return Array.from(getLegacyToolbarTarget(toolbar).children, child => child.id)
    .filter(Boolean)
    .join(",");
}

function setLegacyToolbarCurrentSet(toolbar, value) {
  toolbar.setAttribute("currentset", value ?? "");
}

function installLegacyToolbarCurrentSet(toolbar) {
  let proto = Object.getPrototypeOf(toolbar);
  if (!Object.getOwnPropertyDescriptor(proto, "currentSet")) {
    Object.defineProperty(proto, "currentSet", {
      configurable: true,
      get() {
        if (this.localName != "toolbar") {
          return "";
        }
        return getLegacyToolbarCurrentSet(this);
      },
      set(value) {
        if (this.localName == "toolbar") {
          setLegacyToolbarCurrentSet(this, value);
        }
      },
    });
  }
}

function legacyToolbarInsertItem(itemID, beforeElt = null) {
  let toolbar = this;
  let toolbox = document.getElementById("navigator-toolbox");
  let palette = toolbox?.palette;
  let item =
    document.getElementById(itemID) ??
    palette?.querySelector?.(`#${CSS.escape(itemID)}`);
  if (!item) {
    return null;
  }

  if (typeof beforeElt == "string") {
    beforeElt = document.getElementById(beforeElt);
  }

  let target =
    document.getElementById(toolbar.getAttribute("customizationtarget")) ??
    toolbar;
  if (beforeElt?.parentNode != target) {
    beforeElt = null;
  }

  target.insertBefore(item, beforeElt);
  updateLegacyToolbarCurrentSet(toolbar, target);
  return item;
}

function installLegacyToolbarInsertItem(toolbar) {
  if (typeof toolbar.insertItem == "function") {
    return;
  }

  Object.defineProperty(toolbar, "insertItem", {
    configurable: true,
    value: legacyToolbarInsertItem,
  });
}

if (document.contentType == "application/xhtml+xml") {
  if (
    typeof XULElement != "undefined" &&
    typeof XULElement.prototype.insertItem != "function"
  ) {
    Object.defineProperty(XULElement.prototype, "insertItem", {
      configurable: true,
      value(itemID, beforeElt = null) {
        if (this.localName != "toolbar") {
          return null;
        }
        return legacyToolbarInsertItem.call(this, itemID, beforeElt);
      },
    });
  }

  for (let toolbar of document.querySelectorAll("toolbar")) {
    installLegacyToolbarCurrentSet(toolbar);
    installLegacyToolbarInsertItem(toolbar);
  }
}
