/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  NOCTURNE_COLOR_FIELDS,
  nocturneColorPref,
} from "resource:///modules/NocturneColors.sys.mjs";

const fieldsByPref = new Map();
for (let field of NOCTURNE_COLOR_FIELDS) {
  for (let scheme of ["light", "dark"]) {
    fieldsByPref.set(nocturneColorPref(field.id, scheme), field);
  }
}

export class NocturneColorsChild extends JSWindowActorChild {
  _root = null;
  _colors = new Map();
  _pending = null;
  _prefObserver = (subject, topic, pref) => this.observe(subject, topic, pref);

  handleEvent(event) {
    if (event.type == "change") {
      this._queueUpdate();
    } else {
      this._init();
    }
  }

  observe(subject, topic, pref) {
    if (topic == "chrome-document-global-created") {
      this._document = subject.document;
      if (this._document.documentElement) {
        this._init();
      } else {
        this._document.addEventListener("DOMDocElementInserted", this, {
          once: true,
        });
      }
    } else if (
      pref == "nocturne.colors" ||
      pref == "nocturne.colors.custom.shared"
    ) {
      this._queueUpdate();
    } else {
      let field = fieldsByPref.get(pref.replace(/\.opacity$/, ""));
      if (field) {
        this._queueUpdate(field);
      }
    }
  }

  _init() {
    let root = this.document.documentElement;
    if (this._root || !root?.style) {
      return;
    }
    this._root = root;
    this._scheme = this.contentWindow.matchMedia(
      "(prefers-color-scheme: dark)"
    );
    this._scheme.addEventListener("change", this);
    Services.prefs.addObserver("nocturne.colors", this._prefObserver);
    this._update(NOCTURNE_COLOR_FIELDS);
  }

  didDestroy() {
    this._document?.removeEventListener("DOMDocElementInserted", this);
    if (this._root) {
      Services.prefs.removeObserver("nocturne.colors", this._prefObserver);
      this._scheme.removeEventListener("change", this);
    }
    this._root = null;
    this._document = null;
  }

  _queueUpdate(changedField) {
    if (!this._pending) {
      this._pending = new Set();
      Promise.resolve().then(() => {
        let fields = this._pending;
        this._pending = null;
        if (this._root) {
          this._update(fields);
        }
      });
    }
    if (changedField) {
      this._pending.add(changedField);
    } else {
      for (let field of NOCTURNE_COLOR_FIELDS) {
        this._pending.add(field);
      }
    }
  }

  _update(fields) {
    let enabled = Services.prefs.getIntPref("nocturne.colors", 0) == 6;
    if (!enabled && !this._colors.size) {
      return;
    }
    let shared = Services.prefs.getBoolPref(
      "nocturne.colors.custom.shared",
      false
    );
    let scheme = !shared && this._scheme.matches ? "dark" : "light";
    let availabilityChanged = false;
    for (let field of fields) {
      let pref = nocturneColorPref(field.id, scheme);
      let color = enabled ? Services.prefs.getStringPref(pref, "") : "";
      let variable = `--nocturne-custom-${field.id}`;
      let previous = this._colors.get(field.id);
      if (!/^#[0-9a-f]{6}$/i.test(color)) {
        if (previous) {
          this._root.style.removeProperty(variable);
          if (previous.text !== undefined) {
            this._root.style.removeProperty(`${variable}-text`);
          }
          this._colors.delete(field.id);
          availabilityChanged = true;
        }
        continue;
      }

      let text;
      if (field.text || field.textProperties) {
        let channels = [1, 3, 5].map(offset => {
          let channel = parseInt(color.slice(offset, offset + 2), 16) / 255;
          return channel <= 0.04045
            ? channel / 12.92
            : ((channel + 0.055) / 1.055) ** 2.4;
        });
        let luminance =
          channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
        text = luminance > 0.179 ? "black" : "white";
      }
      if (field.opacity !== undefined) {
        let opacity = Math.max(
          0,
          Math.min(100, Services.prefs.getIntPref(`${pref}.opacity`, 100))
        );
        if (opacity < 100) {
          color = `color-mix(in srgb, ${color} ${opacity}%, transparent)`;
        }
      }
      if (previous?.color == color && previous?.text == text) {
        continue;
      }
      if (previous?.color != color) {
        this._root.style.setProperty(variable, color);
      }
      if (previous?.text != text) {
        this._root.style.setProperty(`${variable}-text`, text);
      }
      this._colors.set(field.id, { color, text });
      availabilityChanged ||= !previous;
    }
    if (availabilityChanged) {
      this._root.setAttribute(
        "nocturne-custom-colors",
        [...this._colors.keys()].join(" ")
      );
    }
  }
}
