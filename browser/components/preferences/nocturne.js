/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/* import-globals-from preferences.js */
const { NOCTURNE_COLOR_FIELDS, NOCTURNE_COLOR_GROUPS, nocturneColorPref } =
  ChromeUtils.importESModule("resource:///modules/NocturneColors.sys.mjs");

var gNocturnePane = {
  init() {
    const container = document.getElementById("nocturneThemeGroup");
    const palette = document.getElementById("nocturneCustomPalette");
    const paletteRows = [];
    const paletteGroups = new Map();
    for (const groupId of NOCTURNE_COLOR_GROUPS) {
      const paletteGroup = document.createElement("moz-card");
      paletteGroup.id = `nocturneCustomPalette-${groupId}`;
      paletteGroup.type = "accordion";
      document.l10n.setAttributes(
        paletteGroup,
        `nocturne-custom-group-${groupId}`
      );
      palette.append(paletteGroup);
      paletteGroups.set(groupId, {
        card: paletteGroup,
        fields: [],
      });
    }
    for (const {
      id,
      opacity,
      backgrounds,
      group: groupId,
    } of NOCTURNE_COLOR_FIELDS) {
      const field = { id, rows: [] };
      paletteGroups.get(groupId).fields.push(field);
      for (const scheme of ["light", "dark"]) {
        const pref = nocturneColorPref(id, scheme);
        const row = {
          field,
          preference: Preferences.get(pref),
          pref,
          isDark: scheme === "dark",
          backgrounds,
          scheme,
          opacityPreference:
            opacity === undefined ? null : Preferences.get(`${pref}.opacity`),
          element: null,
          groupElement: null,
        };
        field.rows.push(row);
        paletteRows.push(row);
      }
    }
    const colors = Preferences.get("nocturne.colors");
    const sharedColors = Preferences.get("nocturne.colors.custom.shared");
    const sharedRow = document.getElementById("nocturneColorsSharedRow");
    const sharedDescription = document.getElementById(
      "nocturneColorsSharedDescription"
    );
    const updateCustomColorVisibility = () => {
      container.toggleAttribute(
        "data-hidden-by-setting-group",
        colors.value != 6
      );
    };
    const backgroundsEnabled = Preferences.get("nocturne.backgrounds.enabled");
    const isRowVisible = row =>
      !row.preference.locked &&
      (!row.isDark || !sharedColors.value) &&
      (!row.backgrounds || backgroundsEnabled.value);
    const updatePaletteControlVisibility = () => {
      sharedRow.hidden = sharedColors.locked;
      sharedDescription.hidden = sharedColors.locked;
      for (const row of paletteRows) {
        if (row.element) {
          row.element.hidden = !isRowVisible(row);
        }
        if (row.groupElement) {
          row.groupElement.hidden = row.field.rows.every(
            fieldRow => !isRowVisible(fieldRow)
          );
        }
      }
      for (const { card, fields } of paletteGroups.values()) {
        card.hidden = fields.every(field =>
          field.rows.every(row => !isRowVisible(row))
        );
      }
    };
    for (const { card, fields } of paletteGroups.values()) {
      let renderPromise;
      card.ensureChildrenRendered = () => {
        renderPromise ??= Promise.resolve().then(async () => {
          const colorInputs = [];
          for (const field of fields) {
            const roleId = `nocturneCustomColorRole-${field.id}`;
            const roleGroup = document.createXULElement("vbox");
            roleGroup.setAttribute("role", "group");
            roleGroup.setAttribute("aria-labelledby", roleId);
            roleGroup.classList.add("indent");
            const roleLabel = document.createXULElement("label");
            roleLabel.id = roleId;
            document.l10n.setAttributes(
              roleLabel,
              "nocturne-custom-color-role",
              { field: field.id }
            );
            roleGroup.append(roleLabel);
            for (const row of field.rows) {
              const colorId = `nocturneCustomColor-${field.id}-${row.scheme}`;
              const rowElement = document.createXULElement("hbox");
              rowElement.setAttribute("align", "center");
              row.element = rowElement;
              row.groupElement = roleGroup;
              const colorInput = document.createElement("moz-input-color");
              colorInput.id = colorId;
              colorInput.optional = true;
              colorInput.setAttribute("flex", "1");
              colorInput.setAttribute("preference", row.pref);
              document.l10n.setAttributes(
                colorInput,
                "nocturne-custom-color-control",
                { field: field.id, scheme: row.scheme }
              );
              rowElement.append(colorInput);
              colorInputs.push(colorInput);
              if (row.opacityPreference) {
                const opacityPref = `${row.pref}.opacity`;
                const opacityId = `${colorId}-opacity`;
                const opacityLabel = document.createXULElement("label");
                opacityLabel.setAttribute("control", opacityId);
                document.l10n.setAttributes(
                  opacityLabel,
                  `nocturne-legacy-custom-opacity-${row.scheme}`
                );
                const opacityInput = document.createElementNS(
                  "http://www.w3.org/1999/xhtml",
                  "input"
                );
                opacityInput.id = opacityId;
                opacityInput.type = "number";
                opacityInput.min = "0";
                opacityInput.max = "100";
                opacityInput.setAttribute("preference", opacityPref);
                const updateOpacityVisibility = () => {
                  const hidden =
                    !/^#[0-9a-f]{6}$/i.test(row.preference.value) ||
                    row.opacityPreference.locked;
                  opacityInput.hidden = hidden;
                  opacityLabel.hidden = hidden;
                };
                row.preference.on("change", updateOpacityVisibility);
                row.opacityPreference.on("change", updateOpacityVisibility);
                updateOpacityVisibility();
                rowElement.append(opacityLabel, opacityInput);
              }
              roleGroup.append(rowElement);
            }
            card.append(roleGroup);
          }
          for (const input of card.querySelectorAll("[preference]")) {
            Preferences.get(input.getAttribute("preference")).setElementValue(
              input
            );
          }
          updatePaletteControlVisibility();
          await Promise.all(colorInputs.map(input => input.updateComplete));
          await document.l10n.translateFragment(card);
          await Promise.all(colorInputs.map(input => input.updateComplete));
        });
        return renderPromise;
      };
      card.addEventListener("toggle", event => {
        if (event.newState == "open") {
          card.ensureChildrenRendered().catch(console.error);
        }
      });
    }
    colors.on("change", updateCustomColorVisibility);
    sharedColors.on("change", updatePaletteControlVisibility);
    backgroundsEnabled.on("change", updatePaletteControlVisibility);
    for (const { preference } of paletteRows) {
      preference.on("change", updatePaletteControlVisibility);
    }
    updateCustomColorVisibility();
    updatePaletteControlVisibility();
  },
};

for (let preference of [
  { id: "widget.non-native-theme.enabled", type: "bool", inverted: true },
  { id: "widget.native-controls.scrollbar-style", type: "int" },
  { id: "widget.non-native-theme.scrollbar.style", type: "int" },
  { id: "widget.native-controls.override-win-version", type: "int" },
  { id: "security.sandbox.content.level", type: "int" },
  { id: "nocturne.colors", type: "int" },
  { id: "nocturne.colors.custom.shared", type: "bool" },
  ...NOCTURNE_COLOR_FIELDS.flatMap(({ id, opacity }) =>
    ["light", "dark"].flatMap(scheme => {
      const pref = nocturneColorPref(id, scheme);
      return [
        { id: pref, type: "string" },
        ...(opacity === undefined
          ? []
          : [{ id: `${pref}.opacity`, type: "int" }]),
      ];
    })
  ),
  { id: "nocturne.drag-space.enabled", type: "bool" },
  { id: "nocturne.backgrounds.enabled", type: "bool" },
  { id: "nocturne.transparent.menubar", type: "bool" },
  { id: "nocturne.translucent.navbar", type: "bool" },
  { id: "nocturne.aero.fog", type: "int" },
  { id: "nocturne.caption.text.color", type: "int" },
  { id: "browser.urlbar.oneOffsInstant", type: "bool" },
  { id: "browser.menu.viewImage", type: "bool" },
  { id: "browser.menu.navigationIcons", type: "bool", inverted: true },
  { id: "browser.tabs.groups.enabled", type: "bool" },
  { id: "browser.tabs.hoverPreview.enabled", type: "bool" },
  { id: "screenshots.browser.component.enabled", type: "bool" },
  { id: "browser.tabs.dropToPin.enabled", type: "bool", inverted: true },
  { id: "browser.taskbarTabs.enabled", type: "bool", inverted: true },
  { id: "browser.e10s.disabled", type: "bool" },
  { id: "security.csp.enable", type: "bool", inverted: true },
  { id: "security.port.blocking.enabled", type: "bool", inverted: true },
  {
    id: "network.stricttransportsecurity.enabled",
    type: "bool",
    inverted: true,
  },
  { id: "accessibility.force_disabled", type: "int" },
  { id: "content.cors.disable", type: "bool" },
  { id: "content.cors.bypass_preflight_request", type: "bool" },
  { id: "security.same_origin_policy.enabled", type: "bool", inverted: true },
  { id: "browser.urlbar.secondaryActions.switchToTab", type: "bool" },
  { id: "gfx.dwrite.enabled", type: "bool", inverted: true },
  { id: "browser.display.windows.non_native_menus", type: "int" },
  { id: "dom.webaudio.enabled", type: "bool", inverted: true },
  // { id: "browser.urlbar.scotchBonnet.enableOverride", type: "bool", inverted: true },
  { id: "browser.urlbar.formatting.enabled", type: "bool", inverted: true },
  { id: "geo.enabled", type: "bool", inverted: true },
  { id: "browser.ui.oldaboutconfig", type: "bool" },
  { id: "browser.ui.menu.squaredcorners", type: "bool" },
  { id: "prompts.tab_modal.enabled", type: "bool" },
  { id: "prompts.headerAppIcon.enabled", type: "bool" },
  { id: "prompts.tab_modal.sound.enabled", type: "bool" },
  { id: "cookiebanners.service.mode", type: "int" },
  { id: "cookiebanners.service.mode.privateBrowsing", type: "int" },
  { id: "nocturne.legacyiconbehavior.enabled", type: "bool" },
  { id: "nocturne.platformspecificicons.enabled", type: "bool" },
  { id: "nocturne.smalliconbehavior.enabled", type: "bool" },
  { id: "nocturne.ui.ff68downloadicons", type: "bool" },
  { id: "nocturne.ui.oldurlbar", type: "bool" },
  { id: "nocturne.ui.oldautofill", type: "bool" },
  { id: "browser.translations.enable", type: "bool" },
]) {
  if (!Preferences.get(preference.id)) {
    Preferences.add(preference);
  }
}
