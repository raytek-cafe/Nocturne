/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

{
  const XUL_NS =
    "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";

  function ensureGroupboxStyles(doc) {
    if (doc.querySelector('link[href="chrome://global/skin/groupbox.css"]')) {
      return;
    }

    const link = doc.createElement("link");
    link.rel = "stylesheet";
    link.href = "chrome://global/skin/groupbox.css";
    doc.documentElement.appendChild(link);
  }

  class MozGroupbox extends MozXULElement {
    connectedCallback() {
      if (this.delayConnectedCallback() || this._initialized) {
        return;
      }
      this._initialized = true;

      const hasCaption = Array.from(this.childNodes).some(
        child => child.namespaceURI == XUL_NS && child.localName == "caption"
      );
      if (hasCaption) {
        ensureGroupboxStyles(this.ownerDocument);
      }

      let title = null;
      if (hasCaption) {
        title = this.ownerDocument.createXULElement("hbox");
        title.className = "groupbox-title";
        title.setAttribute("align", "center");
        title.setAttribute("pack", "start");
      }

      const body = this.ownerDocument.createXULElement("vbox");
      body.className = "groupbox-body";
      body.setAttribute("flex", "1");

      for (const attr of ["orient", "align", "pack"]) {
        if (this.hasAttribute(attr)) {
          body.setAttribute(attr, this.getAttribute(attr));
        }
      }

      for (const child of Array.from(this.childNodes)) {
        if (
          title &&
          child.namespaceURI == XUL_NS &&
          child.localName == "caption"
        ) {
          title.appendChild(child);
        } else {
          body.appendChild(child);
        }
      }

      if (title) {
        this.appendChild(title);
      }
      this.appendChild(body);
    }
  }

  customElements.define("groupbox", MozGroupbox);

  class MozCaption extends MozElements.BaseText {
    connectedCallback() {
      if (this.delayConnectedCallback() || this._initialized) {
        return;
      }
      this._initialized = true;

      const icon = this.ownerDocument.createXULElement("image");
      icon.className = "caption-icon";

      const label = this.ownerDocument.createXULElement("label");
      label.className = "caption-text";
      label.setAttribute("flex", "1");

      this.append(icon, label);
      this._updateCaption();
    }

    static get observedAttributes() {
      return ["label", "value", "image", "crop", "accesskey", "default"];
    }

    attributeChangedCallback(name, oldValue, newValue) {
      if (
        oldValue == newValue ||
        !this._initialized ||
        !this.isConnectedAndReady
      ) {
        return;
      }

      if (name == "label" || name == "value") {
        this._updateCaption();
        return;
      }

      const target = this.querySelector(
        name == "image" ? ".caption-icon" : ".caption-text"
      );
      if (!target) {
        return;
      }

      if (newValue == null) {
        target.removeAttribute(name == "image" ? "src" : name);
      } else {
        target.setAttribute(name == "image" ? "src" : name, newValue);
      }
    }

    _updateCaption() {
      const label = this.querySelector(".caption-text");
      if (!label) {
        return;
      }

      const value = this.hasAttribute("value")
        ? this.getAttribute("value")
        : this.getAttribute("label");
      label.setAttribute("value", value || "");

      const icon = this.querySelector(".caption-icon");
      if (icon) {
        const image = this.getAttribute("image");
        if (image == null) {
          icon.removeAttribute("src");
        } else {
          icon.setAttribute("src", image);
        }
      }

      for (const attr of ["crop", "accesskey", "default"]) {
        const attrValue = this.getAttribute(attr);
        if (attrValue == null) {
          label.removeAttribute(attr);
        } else {
          label.setAttribute(attr, attrValue);
        }
      }
    }
  }

  customElements.define("caption", MozCaption);
}
