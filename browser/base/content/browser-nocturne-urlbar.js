/* -*- indent-tabs-mode: nil; js-indent-level: 2 -*-
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Nocturne: Apply the old URLBar styling without replacing the custom element.
 */
var NocturneURLBar = {
  applyOldURLBarStyles(window) {
    window.document.documentElement.setAttribute(
      "data-nocturne-old-urlbar",
      "true"
    );
  },
};
