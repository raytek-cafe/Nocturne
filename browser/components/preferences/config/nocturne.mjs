/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Preferences } from "chrome://global/content/preferences/Preferences.mjs";
import { SettingGroupManager } from "chrome://browser/content/preferences/config/SettingGroupManager.mjs";

const { NOCTURNE_COLOR_FIELDS, NOCTURNE_COLOR_GROUPS, nocturneColorPref } =
  ChromeUtils.importESModule("resource:///modules/NocturneColors.sys.mjs");

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

const CUSTOM_COLORS_PREF = "nocturne.colors";
const SHARED_CUSTOM_COLORS_PREF = "nocturne.colors.custom.shared";

addPreference(SHARED_CUSTOM_COLORS_PREF, "bool");
Preferences.addSetting({
  id: SHARED_CUSTOM_COLORS_PREF,
  pref: SHARED_CUSTOM_COLORS_PREF,
  deps: [CUSTOM_COLORS_PREF],
  visible: ({ [CUSTOM_COLORS_PREF]: colors }, setting) =>
    colors.value == "6" && !setting.locked,
});
Preferences.addSetting({
  id: "nocturneCustomPalette",
  deps: [CUSTOM_COLORS_PREF],
  visible: ({ [CUSTOM_COLORS_PREF]: colors }) => colors.value == "6",
});

const customColorGroups = new Map(
  NOCTURNE_COLOR_GROUPS.map(group => [
    group,
    { colorSettingIds: [], items: [] },
  ])
);
for (const { id, group, opacity, backgrounds } of NOCTURNE_COLOR_FIELDS) {
  const colorGroup = customColorGroups.get(group);
  for (const scheme of ["light", "dark"]) {
    const pref = nocturneColorPref(id, scheme);
    const visibilityDeps = [
      CUSTOM_COLORS_PREF,
      ...(scheme == "dark" ? [SHARED_CUSTOM_COLORS_PREF] : []),
      ...(backgrounds ? ["nocturne.backgrounds.enabled"] : []),
    ];
    addPreference(pref, "string");
    Preferences.addSetting({
      id: pref,
      pref,
      deps: visibilityDeps,
      visible: (deps, setting) =>
        deps[CUSTOM_COLORS_PREF].value == "6" &&
        !setting.locked &&
        (!backgrounds || deps["nocturne.backgrounds.enabled"].value) &&
        (scheme == "light" || !deps[SHARED_CUSTOM_COLORS_PREF].value),
    });
    colorGroup.colorSettingIds.push(pref);
    colorGroup.items.push({
      id: pref,
      l10nId: "nocturne-custom-color-control",
      l10nArgs: { field: id, scheme },
      control: "moz-input-color",
      controlAttrs: { class: "indent", optional: true },
    });

    if (opacity !== undefined) {
      const opacityPref = `${pref}.opacity`;
      addPreference(opacityPref, "int");
      Preferences.addSetting({
        id: opacityPref,
        pref: opacityPref,
        deps: [...visibilityDeps, pref],
        visible: (deps, setting) =>
          deps[CUSTOM_COLORS_PREF].value == "6" &&
          !setting.locked &&
          !deps[pref].locked &&
          (!backgrounds || deps["nocturne.backgrounds.enabled"].value) &&
          /^#[0-9a-f]{6}$/i.test(deps[pref].value) &&
          (scheme == "light" || !deps[SHARED_CUSTOM_COLORS_PREF].value),
        get: value => String(value ?? 100),
        set: value => Number.parseInt(value, 10) || 0,
      });
      colorGroup.items.push({
        id: opacityPref,
        l10nId: "nocturne-custom-opacity-control",
        l10nArgs: { field: id, scheme },
        control: "moz-input-number",
        controlAttrs: {
          class: "indent",
          inputlayout: "inline-end",
          min: "0",
          max: "100",
        },
      });
    }
  }
}

const customColorGroupItems = NOCTURNE_COLOR_GROUPS.map(group => {
  const { colorSettingIds, items } = customColorGroups.get(group);
  const id = `nocturneCustomPalette-${group}`;
  Preferences.addSetting({
    id,
    deps: colorSettingIds,
    visible: deps => colorSettingIds.some(settingId => deps[settingId].visible),
  });
  return {
    id,
    l10nId: `nocturne-custom-group-${group}`,
    control: "moz-card",
    controlAttrs: { type: "accordion" },
    lazyItems: true,
    items,
  };
});

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
  let options = values.map(([value, optionL10nId]) => ({
    key: `${id}-${value}`,
    value: String(value),
    l10nId: optionL10nId,
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
  "browser.ui.menu.squaredcorners",
  "browser.urlbar.oneOffsInstant",
  "browser.menu.viewImage",
  "browser.e10s.disabled",
  "content.cors.disable",
  "content.cors.bypass_preflight_request",
  "browser.urlbar.secondaryActions.switchToTab",
  "screenshots.browser.component.enabled",
  "browser.ui.oldaboutconfig",
  "prompts.headerAppIcon.enabled",
  "prompts.tab_modal.enabled",
  "prompts.tab_modal.sound.enabled",
  "browser.tabs.hoverPreview.enabled",
  "browser.tabs.groups.enabled",
  "browser.translations.enable",
  "nocturne.ui.ff68downloadicons",
  "nocturne.legacyiconbehavior.enabled",
  "nocturne.platformspecificicons.enabled",
  "nocturne.smalliconbehavior.enabled",
  "nocturne.ui.oldurlbar",
  "nocturne.ui.oldautofill",
]) {
  addSetting(id);
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
  "cookiebanners.service.mode",
  "cookiebanners.service.mode.privateBrowsing",
  "security.sandbox.content.level",
  "widget.native-controls.override-aero-caption-buttons-mask-width",
  "widget.native-controls.override-aero-caption-buttons-mask-height",
]) {
  addIntegerSetting(id);
}
for (let id of [
  "widget.non-native-theme.enabled",
  "browser.menu.navigationIcons",
  "security.same_origin_policy.enabled",
  "browser.tabs.dropToPin.enabled",
  "browser.taskbarTabs.enabled",
  "browser.urlbar.formatting.enabled",
  "geo.enabled",
  "dom.webaudio.enabled",
  "security.csp.enable",
  "network.stricttransportsecurity.enabled",
  "security.port.blocking.enabled",
  "gfx.dwrite.enabled",
]) {
  addSetting(id, true);
}

SettingGroupManager.registerGroups({
  nocturneTheme: {
    l10nId: "nocturne-theme-header",
    headingLevel: 2,
    items: [
      {
        id: "nocturneCustomPalette",
        control: "div",
        items: [
          checkbox(
            SHARED_CUSTOM_COLORS_PREF,
            "nocturne-colors-shared",
            "nocturne-colors-shared-description"
          ),
          ...customColorGroupItems,
        ],
      },
    ],
  },
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
          [0, "nocturne-option-native-menulists-always"],
          [1, "nocturne-option-custom-menulists-always"],
          [2, "nocturne-option-native-menulists-unless-win10"],
        ]
      ),
      select(
        "widget.native-controls.scrollbar-style",
        "nocturne-native-scroll",
        [
          [0, "nocturne-option-native-scrollbars-always"],
          [1, "nocturne-option-custom-scrollbars-always"],
          [2, "nocturne-option-native-scrollbars-unless-dark"],
        ]
      ),
      select(
        "widget.non-native-theme.scrollbar.style",
        "nocturne-fake-scroll-type",
        [
          [0, "nocturne-option-scrollbar-platform"],
          [1, "nocturne-option-scrollbar-macos"],
          [2, "nocturne-option-scrollbar-gtk"],
          [3, "nocturne-option-scrollbar-android"],
          [4, "nocturne-option-scrollbar-win10"],
          [5, "nocturne-option-scrollbar-win11"],
        ]
      ),
      select(
        "widget.native-controls.override-win-version",
        "nocturne-win-theme-type",
        [
          [0, "nocturne-option-win-current"],
          [5, "nocturne-option-win-xp"],
          [6, "nocturne-option-win-vista"],
          [7, "nocturne-option-win-7"],
          [8, "nocturne-option-win-8"],
          [10, "nocturne-option-win10-modern"],
        ]
      ),
      select(CUSTOM_COLORS_PREF, "nocturne-colors", [
        [0, "nocturne-option-color-disabled"],
        [1, "nocturne-option-color-red"],
        [2, "nocturne-option-color-orange"],
        [3, "nocturne-option-color-pink"],
        [4, "nocturne-option-color-dark-purple"],
        [5, "nocturne-option-color-system"],
        [6, "nocturne-option-color-custom"],
      ]),
      checkbox("nocturne.drag-space.enabled", "nocturne-drag"),
      checkbox("nocturne.backgrounds.enabled", "nocturne-backgrounds"),
      checkbox("nocturne.transparent.menubar", "nocturne-menubar"),
      checkbox("nocturne.translucent.navbar", "nocturne-navbar"),
      checkbox("browser.ui.menu.squaredcorners", "nocturne-squared-corners"),
      checkbox(
        "nocturne.ui.oldautofill",
        "nocturne-old-autofill",
        "nocturne-old-autofill-desc"
      ),
      select("nocturne.aero.fog", "nocturne-fog-type", [
        [0, "nocturne-option-fog-disabled"],
        [1, "nocturne-option-fog-nocturne"],
        [2, "nocturne-option-fog-stock"],
      ]),
      select("nocturne.caption.text.color", "nocturne-caption-text", [
        [0, "nocturne-option-caption-default"],
        [1, "nocturne-option-caption-white"],
        [2, "nocturne-option-caption-black"],
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
      checkbox(
        "browser.urlbar.formatting.enabled",
        "nocturne-urlbar-formatting"
      ),
      checkbox("browser.tabs.groups.enabled", "nocturne-tab-groups"),
      checkbox("browser.translations.enable", "nocturne-translations-enable"),
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
        "nocturne.ui.ff68downloadicons",
        "nocturne-ff68-download-icons",
        "nocturne-ff68-download-icons-desc"
      ),
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
      checkbox(
        "nocturne.legacyiconbehavior.enabled",
        "nocturne-legacy-icon",
        "nocturne-legacy-icon-desc"
      ),
      checkbox(
        "nocturne.platformspecificicons.enabled",
        "nocturne-platform-specific-icons",
        "nocturne-platform-specific-icons-desc"
      ),
      checkbox(
        "nocturne.smalliconbehavior.enabled",
        "nocturne-small-icon",
        "nocturne-small-icon-desc"
      ),
      checkbox(
        "nocturne.ui.oldurlbar",
        "nocturne-old-urlbar",
        "nocturne-old-urlbar-desc"
      ),
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
          [1, "nocturne-option-accessibility-always-disabled"],
          [0, "nocturne-option-accessibility-default"],
          [-1, "nocturne-option-accessibility-always-enabled"],
        ],
        "nocturne-accessibility-desc"
      ),
      select(
        "cookiebanners.service.mode",
        "nocturne-cookiebanners",
        [
          [1, "nocturne-option-cookiebanners-reject"],
          [0, "nocturne-option-cookiebanners-disabled"],
        ],
        "nocturne-cookiebanners-desc"
      ),
      select(
        "cookiebanners.service.mode.privateBrowsing",
        "nocturne-cookiebanners-private",
        [
          [1, "nocturne-option-cookiebanners-reject"],
          [0, "nocturne-option-cookiebanners-disabled"],
        ],
        "nocturne-cookiebanners-desc"
      ),
      select("security.sandbox.content.level", "nocturne-sandbox-level", [
        [20, "nocturne-option-sandbox-increased"],
        [9, "nocturne-option-sandbox-default"],
        [7, "nocturne-option-sandbox-lower"],
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
