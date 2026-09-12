/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

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

{
  const legacyXULTags = new Set([
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

  function toolbarTarget(toolbar) {
    return (
      toolbar.ownerDocument.getElementById(
        toolbar.getAttribute("customizationtarget")
      ) ?? toolbar
    );
  }

  function toolbarCurrentSet(toolbar) {
    return Array.from(toolbarTarget(toolbar).children, child => child.id)
      .filter(Boolean)
      .join(",");
  }

  if (document.contentType == "application/xhtml+xml") {
    const createElement = document.createElement;
    document.createElement = function (localName, options) {
      if (
        typeof localName == "string" &&
        legacyXULTags.has(localName.toLowerCase())
      ) {
        return this.createXULElement(localName, options);
      }
      return createElement.call(this, localName, options);
    };

    if (!Object.getOwnPropertyDescriptor(XULElement.prototype, "currentSet")) {
      Object.defineProperty(XULElement.prototype, "currentSet", {
        configurable: true,
        get() {
          return this.localName == "toolbar" ? toolbarCurrentSet(this) : "";
        },
        set(value) {
          if (this.localName == "toolbar") {
            this.setAttribute("currentset", value ?? "");
          }
        },
      });
    }

    if (typeof XULElement.prototype.insertItem != "function") {
      Object.defineProperty(XULElement.prototype, "insertItem", {
        configurable: true,
        value(itemID, beforeElt = null) {
          if (this.localName != "toolbar") {
            return null;
          }
          const doc = this.ownerDocument;
          const palette = doc.getElementById("navigator-toolbox")?.palette;
          const item =
            doc.getElementById(itemID) ??
            palette?.querySelector(`#${CSS.escape(itemID)}`);
          if (!item) {
            return null;
          }
          if (typeof beforeElt == "string") {
            beforeElt = doc.getElementById(beforeElt);
          }
          const target = toolbarTarget(this);
          target.insertBefore(
            item,
            beforeElt?.parentNode == target ? beforeElt : null
          );
          this.setAttribute("currentset", toolbarCurrentSet(this));
          return item;
        },
      });
    }
  }
}
