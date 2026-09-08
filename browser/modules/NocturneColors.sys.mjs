/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

export const NOCTURNE_COLOR_GROUPS = [
  "accents",
  "tabs",
  "toolbars",
  "address-bar",
  "menus-panels",
  "sidebar",
  "buttons-inputs",
  "settings",
  "newtab",
  "backgrounds",
];

export const NOCTURNE_COLOR_FIELDS = [
  {
    id: "color-accent-primary",
    group: "accents",
    properties: ["--color-accent-primary"],
  },
  {
    id: "newtab-primary-action-background",
    group: "newtab",
    properties: ["--newtab-primary-action-background"],
    textProperties: ["--newtab-primary-element-text-color"],
    opacity: 100,
  },
  { id: "link-color", group: "accents", properties: ["--link-color"] },
  {
    id: "link-color-visited",
    group: "accents",
    properties: ["--link-color-visited"],
  },
  {
    id: "button-primary-bgcolor",
    group: "buttons-inputs",
    properties: ["--button-background-color-primary"],
    textProperties: ["--button-text-color-primary"],
    opacity: 100,
  },
  {
    id: "download-progress-fill-color",
    group: "toolbars",
    properties: ["--download-progress-fill-color"],
  },
  {
    id: "tabpanel-background-color",
    group: "tabs",
    properties: ["--tabpanel-background-color"],
    document: "chrome://browser/content/blanktab.html",
    selector: "body",
    cssProperty: "background-color",
    opacity: 100,
  },
  {
    id: "lwt-sidebar-background-color",
    group: "sidebar",
    properties: ["--sidebar-background-color"],
    opacity: 100,
  },
  {
    id: "arrowpanel-background",
    group: "menus-panels",
    properties: ["--panel-background-color"],
    opacity: 100,
  },
  {
    id: "toolbar-field-focus-background-color",
    group: "address-bar",
    properties: ["--toolbar-field-background-color-focus"],
    opacity: 100,
  },
  {
    id: "in-content-page-background",
    group: "settings",
    properties: ["--background-color-canvas"],
    opacity: 100,
  },
  {
    id: "toolbar-bgcolor",
    group: "toolbars",
    properties: ["--toolbar-background-color"],
    opacity: 100,
    navbar: true,
  },
  {
    id: "toolbar-field-background-color",
    group: "address-bar",
    properties: ["--toolbar-field-background-color"],
    opacity: 100,
    navbar: true,
  },
  {
    id: "selection-background",
    group: "address-bar",
    selector: ".urlbar-input::selection, .searchbar-textbox::selection",
    cssProperty: "background",
    text: true,
    opacity: 100,
  },
  {
    id: "button-background",
    group: "buttons-inputs",
    properties: ["--button-background-color"],
    opacity: 100,
  },
  {
    id: "button-text",
    group: "buttons-inputs",
    properties: ["--button-text-color"],
  },
  {
    id: "primary-button-text",
    group: "buttons-inputs",
    properties: ["--button-text-color-primary"],
  },
  {
    id: "input-background",
    group: "buttons-inputs",
    properties: ["--input-text-background-color"],
    opacity: 100,
  },
  {
    id: "input-text",
    group: "buttons-inputs",
    properties: ["--input-text-color"],
  },
  {
    id: "tab-selected-background",
    group: "tabs",
    selector: ".tab-background:is([selected], [multiselected])",
    cssProperty: "background-color",
    opacity: 100,
  },
  {
    id: "tab-inactive-background",
    group: "tabs",
    selector:
      ".tabbrowser-tab:not([visuallyselected], [multiselected]) .tab-background",
    cssProperty: "background-color",
    opacity: 100,
  },
  {
    id: "tabstrip-background",
    group: "tabs",
    selector: "#TabsToolbar",
    cssProperty: "background-color",
    opacity: 100,
  },
  {
    id: "urlbar-result-selected-background",
    group: "address-bar",
    properties: ["--urlbarview-background-color-selected"],
    opacity: 100,
  },
  {
    id: "bookmarks-toolbar-background",
    group: "toolbars",
    selector: "#PersonalToolbar",
    cssProperty: "background-color",
    opacity: 100,
  },
  {
    id: "tab-selected-text-color",
    group: "tabs",
    selector: ".tabbrowser-tab:is([selected], [multiselected])",
    cssProperty: "color",
  },
  {
    id: "tab-inactive-text-color",
    group: "tabs",
    selector: ".tabbrowser-tab:not([selected], [multiselected])",
    cssProperty: "color",
  },
  {
    id: "toolbar-text-color",
    group: "toolbars",
    properties: ["--toolbar-text-color"],
  },
  {
    id: "toolbar-field-text-color",
    group: "address-bar",
    selector: ".urlbar:not([focused], [open]), #searchbar:not(:focus-within)",
    cssProperty: "color",
  },
  {
    id: "toolbar-field-focus-text-color",
    group: "address-bar",
    selector: ".urlbar:is([focused], [open]), #searchbar:focus-within",
    cssProperty: "color",
  },
  {
    id: "urlbar-results-text-color",
    group: "address-bar",
    selector: ".urlbarView",
    cssProperty: "color",
  },
  {
    id: "urlbar-result-selected-text-color",
    group: "address-bar",
    properties: ["--urlbarview-text-color-selected"],
  },
  {
    id: "bookmarks-toolbar-text-color",
    group: "toolbars",
    selector: "#PersonalToolbar",
    cssProperty: "color",
  },
  {
    id: "sidebar-text-color",
    group: "sidebar",
    properties: ["--sidebar-text-color"],
  },
  {
    id: "sidebar-selection-background",
    group: "sidebar",
    selector: ".sidebar-placesTreechildren::-moz-tree-row(selected, focus)",
    cssProperty: "background-color",
    opacity: 100,
  },
  {
    id: "sidebar-selection-text",
    group: "sidebar",
    selector:
      ".sidebar-placesTreechildren::-moz-tree-image(selected, focus), .sidebar-placesTreechildren::-moz-tree-twisty(selected, focus), .sidebar-placesTreechildren::-moz-tree-cell-text(selected, focus)",
    cssProperty: "color",
  },
  {
    id: "menu-background-color",
    group: "menus-panels",
    selector: "menupopup",
    cssProperty: "--panel-background-color",
    opacity: 100,
  },
  {
    id: "menu-text-color",
    group: "menus-panels",
    selector: "menupopup",
    cssProperty: "--panel-text-color",
  },
  {
    id: "menuitem-hover-background",
    group: "menus-panels",
    selector: "menupopup :is(menu, menuitem)[_moz-menuactive]:not([disabled])",
    cssProperty: "background-color",
    opacity: 100,
  },
  {
    id: "menuitem-hover-text",
    group: "menus-panels",
    selector: "menupopup :is(menu, menuitem)[_moz-menuactive]:not([disabled])",
    cssProperty: "color",
  },
  {
    id: "panel-text-color",
    group: "menus-panels",
    properties: ["--panel-text-color"],
    selector: "panel",
    cssProperty: "--panel-text-color",
  },
  {
    id: "newtab-background-color",
    group: "newtab",
    properties: ["--newtab-background-color"],
    opacity: 100,
  },
  {
    id: "newtab-card-background",
    group: "newtab",
    properties: ["--newtab-background-card"],
    opacity: 100,
  },
  {
    id: "newtab-secondary-background",
    group: "newtab",
    properties: ["--newtab-background-color-secondary"],
    opacity: 100,
  },
  {
    id: "newtab-text-primary",
    group: "newtab",
    properties: [
      "--newtab-text-primary-color",
      "--newtab-contextual-text-primary-color",
    ],
  },
  {
    id: "newtab-text-secondary",
    group: "newtab",
    properties: [
      "--newtab-text-secondary-color",
      "--newtab-contextual-text-secondary-color",
    ],
  },
  {
    id: "in-content-box-background",
    group: "settings",
    properties: ["--background-color-box", "--card-background-color"],
    selector: ".ai-controls-description",
    cssProperty: "--card-background-color",
    opacity: 100,
  },
  {
    id: "in-content-page-color",
    group: "settings",
    properties: ["--text-color"],
  },
  {
    id: "text-color-deemphasized",
    group: "settings",
    properties: ["--text-color-deemphasized"],
  },
  {
    id: "item-backdrop",
    group: "backgrounds",
    properties: ["--nocturne-toolbar-item-background"],
    opacity: 100,
    backgrounds: true,
  },
  {
    id: "menubar-backdrop",
    group: "backgrounds",
    properties: ["--nocturne-menubar-background"],
    opacity: 100,
    backgrounds: true,
  },
  {
    id: "taskbar-item-backdrop",
    group: "backgrounds",
    properties: ["--nocturne-taskbar-item-background"],
    opacity: 100,
    backgrounds: true,
  },
].map(field => ({ light: "", dark: "", ...field }));

export function nocturneColorPref(id, scheme) {
  return id == "color-accent-primary" && scheme == "light"
    ? "nocturne.colors.custom"
    : `nocturne.colors.custom.${id}.${scheme}`;
}

if (Services.appinfo.processType == Services.appinfo.PROCESS_TYPE_DEFAULT) {
  const defaults = Services.prefs.getDefaultBranch("");
  for (let field of NOCTURNE_COLOR_FIELDS) {
    for (let scheme of ["light", "dark"]) {
      let pref = nocturneColorPref(field.id, scheme);
      defaults.setStringPref(pref, field[scheme]);
      if (field.opacity !== undefined) {
        defaults.setIntPref(`${pref}.opacity`, field.opacity);
      }
    }
  }
}
