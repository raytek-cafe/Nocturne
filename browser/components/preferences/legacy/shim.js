/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const { UpdateUtils } = ChromeUtils.importESModule("resource://gre/modules/UpdateUtils.sys.mjs");

var Preferences = {
    get: function (id) {
        let el = document.getElementById(id);
        if (!el) {
            el = Preferences.add({
                id: id,
                type: "string"
            });
        }
        if (el && !el.on) {
            el.on = function (eventName, callback) {
                if (eventName === "change") {
                    Services.prefs.addObserver(el.getAttribute("name") || id, callback);
                }
            };
        }
        return el;
    },
    addAll: function (prefs) {},
    add: function (pref) {
        let existing = document.getElementById(pref.id);
        if (existing)
            return existing;
        let el = document.createElementNS(
                "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
                "preference");
        el.id = pref.id;
        el.setAttribute("name", pref.id);
        el.setAttribute("type", pref.type);
        let container = document.querySelector("preferences");
        if (container)
            container.appendChild(el);
        customElements.upgrade(el);
        return el;
    },
    addSetting: function () {},
    addSyncFromPrefListener: function () {},
    addSyncToPrefListener: function () {},
    getSetting: function () {},
    on: function () {},
};

if (!document.l10n) {
    document.l10n = {
        setAttributes: function (element, id, args) {
            if (id === "fonts-label-default" && args && args.name)
                element.setAttribute("label", args.name);
            else if (id === "fonts-label-default-unnamed")
                element.setAttribute("label", "Default");
            else
                element.setAttribute("data-l10n-id", id);
        },
        formatValue: async function (id) {
            return id;
        },
        formatValues: async function (ids) {
            return ids.map(i => i.id || i);
        },
    };
}
