/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Preferences } from "chrome://global/content/preferences/Preferences.mjs";
import { SettingGroupManager } from "chrome://browser/content/preferences/config/SettingGroupManager.mjs";

function addPreference(id, type, inverted = false) {
  if (!Preferences.get(id)) {
    Preferences.add({ id, type, inverted });
  }
}

function addSetting(id, inverted = false) {
  addPreference(id, "bool", inverted);
  Preferences.addSetting({ id, pref: id });
}

function addIntegerSetting(id) {
  addPreference(id, "int");
  Preferences.addSetting({
    id,
    pref: id,
    get: value => String(value ?? ""),
    set: value => Number.parseInt(value, 10) || 0,
  });
}

function descriptionOption(l10nId) {
  return {
    key: `description-${l10nId}`,
    control: "span",
    l10nId,
    slot: "description",
  };
}

function checkbox(id, l10nId, description) {
  return {
    id,
    l10nId,
    ...(description && { options: [descriptionOption(description)] }),
  };
}

function select(id, l10nId, values, description) {
  let options = values.map(([value, label]) => ({
    key: `${id}-${value}`,
    value: String(value),
    controlAttrs: { label },
  }));
  if (description) {
    options.push(descriptionOption(description));
  }
  return {
    id,
    l10nId,
    control: "moz-select",
    controlAttrs: { inputlayout: "inline-end" },
    options,
  };
}

function numberInput(id, l10nId, description) {
  return {
    id,
    l10nId,
    control: "moz-input-number",
    controlAttrs: { inputlayout: "inline-end" },
    ...(description && { options: [descriptionOption(description)] }),
  };
}

for (let id of [
  "nocturne.drag-space.enabled",
  "nocturne.backgrounds.enabled",
  "nocturne.transparent.menubar",
  "nocturne.translucent.navbar",
  "browser.urlbar.oneOffsInstant",
  "browser.menu.viewImage",
  "browser.e10s.disabled",
  "content.cors.disable",
  "content.cors.bypass_preflight_request",
  "browser.urlbar.secondaryActions.switchToTab",
  "screenshots.browser.component.enabled",
  "browser.ui.oldaboutconfig",
  "prompts.headerAppIcon.enabled",
  "prompts.tab_modal.sound.enabled",
  "browser.tabs.hoverPreview.enabled",
  "browser.tabs.groups.enabled",
]) {
  addSetting(id);
}

for (let id of [
  "widget.non-native-theme.enabled",
  "browser.menu.navigationIcons",
  "security.same_origin_policy.enabled",
  "browser.tabs.dropToPin.enabled",
  "browser.taskbarTabs.enabled",
  "browser.urlbar.formatting.enabled",
  "geo.enabled",
  "prompts.tab_modal.enabled",
  "dom.webaudio.enabled",
  "security.csp.enable",
  "network.stricttransportsecurity.enabled",
  "security.port.blocking.enabled",
  "gfx.dwrite.enabled",
]) {
  addSetting(id, true);
}

for (let id of [
  "nocturne.colors",
  "browser.display.windows.non_native_menus",
  "widget.native-controls.scrollbar-style",
  "widget.non-native-theme.scrollbar.style",
  "widget.native-controls.override-win-version",
  "nocturne.aero.fog",
  "nocturne.caption.text.color",
  "accessibility.force_disabled",
  "security.sandbox.content.level",
  "widget.native-controls.override-aero-caption-buttons-mask-width",
  "widget.native-controls.override-aero-caption-buttons-mask-height",
]) {
  addIntegerSetting(id);
}

SettingGroupManager.registerGroups({
  nocturneVisual: {
    l10nId: "nocturne-visual-header",
    headingLevel: 2,
    items: [
      checkbox(
        "widget.non-native-theme.enabled",
        "nocturne-native-checkbox",
        "nocturne-native-checkbox-desc"
      ),
      select(
        "browser.display.windows.non_native_menus",
        "nocturne-native-menulist",
        [
          [0, "Native menulists always"],
          [1, "Custom menulists always"],
          [
            2,
            "Native menulists unless Windows 10 (Modern) theme is used (Default)",
          ],
        ]
      ),
      select("widget.native-controls.scrollbar-style", "nocturne-native-scroll", [
        [0, "Native scrollbars always"],
        [1, "Custom scrollbars always"],
        [
          2,
          "Native scrollbars unless the website has a dark color scheme (Default)",
        ],
      ]),
      select(
        "widget.non-native-theme.scrollbar.style",
        "nocturne-fake-scroll-type",
        [
          [0, "Default platform scrollbar style (Default)"],
          [1, "macOS scrollbar (small)"],
          [2, "GTK scrollbar (smaller)"],
          [3, "Android scrollbar (smallest)"],
          [4, "Windows 10 scrollbar (normal)"],
          [5, "Windows 11 scrollbar (smaller)"],
        ]
      ),
      select(
        "widget.native-controls.override-win-version",
        "nocturne-win-theme-type",
        [
          [0, "Current OS version (Default)"],
          [5, "Windows XP"],
          [6, "Windows Vista"],
          [7, "Windows 7"],
          [8, "Windows 8"],
          [10, "Windows 10 (Modern)"],
        ]
      ),
      select("nocturne.colors", "nocturne-colors", [
        [0, "Disabled (Stock Firefox Blue)"],
        [1, "Red"],
        [2, "Orange"],
        [3, "Pink"],
        [4, "Dark Theme Purple"],
      ]),
      checkbox("nocturne.drag-space.enabled", "nocturne-drag"),
      checkbox("nocturne.backgrounds.enabled", "nocturne-backgrounds"),
      checkbox("nocturne.transparent.menubar", "nocturne-menubar"),
      checkbox("nocturne.translucent.navbar", "nocturne-navbar"),
      select("nocturne.aero.fog", "nocturne-fog-type", [
        [0, "Disabled (Default with backgrounds enabled)"],
        [1, "nocturne style (covers menubar)"],
        [2, "Stock Firefox style"],
      ]),
      select("nocturne.caption.text.color", "nocturne-caption-text", [
        [0, "Default platform style (Default)"],
        [1, "White"],
        [2, "Black"],
      ]),
    ],
  },
  nocturneFunctional: {
    l10nId: "nocturne-functional-header",
    headingLevel: 2,
    items: [
      checkbox("browser.urlbar.oneOffsInstant", "nocturne-one-offs"),
      checkbox("browser.menu.viewImage", "nocturne-view-image"),
      checkbox("browser.menu.navigationIcons", "nocturne-nav-text"),
      checkbox("browser.urlbar.formatting.enabled", "nocturne-urlbar-formatting"),
      checkbox("browser.tabs.groups.enabled", "nocturne-tab-groups"),
      checkbox(
        "screenshots.browser.component.enabled",
        "nocturne-screenshot-component"
      ),
      checkbox("browser.tabs.hoverPreview.enabled", "nocturne-hover-preview"),
      checkbox("browser.tabs.dropToPin.enabled", "nocturne-drop-to-pin"),
      checkbox("browser.taskbarTabs.enabled", "nocturne-taskbar-tabs"),
      checkbox("browser.ui.oldaboutconfig", "nocturne-old-aboutconfig"),
      checkbox("geo.enabled", "nocturne-geo"),
      checkbox(
        "browser.urlbar.secondaryActions.switchToTab",
        "nocturne-switch-to-tab",
        "nocturne-switch-to-tab-desc"
      ),
      checkbox(
        "prompts.tab_modal.enabled",
        "nocturne-prompt-tab-modal",
        "nocturne-prompt-tab-modal-desc"
      ),
      checkbox("prompts.headerAppIcon.enabled", "nocturne-prompt-header-icon"),
      checkbox("prompts.tab_modal.sound.enabled", "nocturne-prompt-sound"),
    ],
  },
  nocturneAdvanced: {
    l10nId: "nocturne-advanced-header",
    headingLevel: 2,
    items: [
      select(
        "accessibility.force_disabled",
        "nocturne-accessibility",
        [
          [1, "Always disabled (1)"],
          [0, "Default (0)"],
          [-1, "Always enabled (-1)"],
        ],
        "nocturne-accessibility-desc"
      ),
      select("security.sandbox.content.level", "nocturne-sandbox-level", [
        [20, "Increased (20)"],
        [9, "Default (9)"],
        [7, "Lower (7)"],
      ]),
      numberInput(
        "widget.native-controls.override-aero-caption-buttons-mask-width",
        "nocturne-caption-width",
        "nocturne-caption-desc"
      ),
      numberInput(
        "widget.native-controls.override-aero-caption-buttons-mask-height",
        "nocturne-caption-height",
        "nocturne-caption-desc"
      ),
      checkbox(
        "dom.webaudio.enabled",
        "nocturne-webaudio",
        "nocturne-webaudio-desc"
      ),
      checkbox("security.csp.enable", "nocturne-csp", "nocturne-csp-desc"),
      checkbox(
        "content.cors.disable",
        "nocturne-cors-base",
        "nocturne-cors-base-desc"
      ),
      checkbox(
        "content.cors.bypass_preflight_request",
        "nocturne-cors-preflight",
        "nocturne-cors-preflight-desc"
      ),
      checkbox(
        "network.stricttransportsecurity.enabled",
        "nocturne-hsts",
        "nocturne-hsts-desc"
      ),
      checkbox(
        "security.same_origin_policy.enabled",
        "nocturne-same-origin",
        "nocturne-same-origin-desc"
      ),
      checkbox(
        "security.port.blocking.enabled",
        "nocturne-port-blocking",
        "nocturne-port-blocking-desc"
      ),
      checkbox("browser.e10s.disabled", "nocturne-e10s", "nocturne-e10s-desc"),
      checkbox("gfx.dwrite.enabled", "nocturne-dwrite", "nocturne-dwrite-desc"),
    ],
  },
});
