/* -*- indent-tabs-mode: nil; js-indent-level: 2 -*-
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Nocturne: Convert URLBar from new popover implementation to old hbox implementation
 * This provides support for reverting Bug 1921811 (https://github.com/mozilla/gecko-dev/commit/22d599d1607cf798100f87e1b25e3e4f7e247f87( when nocturne.ui.oldurlbar is enabled
 */
var NocturneURLBarConverter = {
  /**
   * Convert the URLBar from the new popover implementation to the old hbox implementation
   * @param {Window} window - The browser window
   */
  convertToOldURLBar(window) {
    const document = window.document;
    const urlbar = document.getElementById("urlbar");

    if (!urlbar || urlbar.localName !== "div") {
      return;
    }

    // Get the parent toolbaritem
    const urlbarContainer = document.getElementById("urlbar-container");
    if (!urlbarContainer) {
      return;
    }

    // Create a new hbox element to replace the div
    const newUrlbar = document.createXULElement("hbox");
    newUrlbar.id = "urlbar";
    newUrlbar.setAttribute("flex", "1");
    newUrlbar.setAttribute("context", "");
    newUrlbar.setAttribute("focused", "true");
    newUrlbar.setAttribute("pageproxystate", "invalid");

    // Copy all attributes from the old urlbar to the new one
    for (const attr of urlbar.attributes) {
      if (attr.name !== "popover" && attr.name !== "id" && !newUrlbar.hasAttribute(attr.name)) {
        newUrlbar.setAttribute(attr.name, attr.value);
      }
    }

    // Move all children from the old urlbar to the new one
    while (urlbar.firstChild) {
      newUrlbar.appendChild(urlbar.firstChild);
    }

    // Replace the old urlbar with the new one
    urlbarContainer.replaceChild(newUrlbar, urlbar);

    // Add attribute to indicate old URLBar is being used (for CSS targeting)
    newUrlbar.setAttribute("data-nocturne-old-urlbar", "true");
    document.documentElement.setAttribute("data-nocturne-old-urlbar", "true");
  },
};