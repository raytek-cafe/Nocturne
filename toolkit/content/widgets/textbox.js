/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
 
 /* Thin wrapper Custom Element around moz-input-box to keep old code ticking. */

"use strict";
{
    const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
    const HTML_NS = "http://www.w3.org/1999/xhtml";

    class MozTextbox extends MozXULElement {
        connectedCallback() {
            if (this._initialized)
                return;
            this._initialized = true;

            this._inputBox = document.createElementNS(XUL_NS, "moz-input-box");
            if (this.hasAttribute("spellcheck"))
                this._inputBox.setAttribute("spellcheck", "true");

            this._input = document.createElementNS(HTML_NS, "input");
            this._input.classList.add("textbox-input");

            for (let attr of ["id", "class", "placeholder", "readonly", "disabled",
                               "maxlength", "size", "tabindex", "preference",
                               "onsyncfrompreference", "onsynctopreference",
                               "preference-editable"]) {
                if (this.hasAttribute(attr))
                    this._input.setAttribute(attr, this.getAttribute(attr));
            }

            const type = this.getAttribute("type");
            if (type && type !== "autocomplete")
                this._input.setAttribute("type", type);
            else
                this._input.setAttribute("type", "text");

            if (this.getAttribute("flex"))
                this.style.flex = this.getAttribute("flex");

            this._inputBox.appendChild(this._input);
            this.appendChild(this._inputBox);
        }

        get value() {
            return this._input?.value ?? "";
        }
        set value(val) {
            if (this._input)
                this._input.value = val;
        }

        get editor() {
            return this._input?.editor;
        }

        focus() {
            this._input?.focus();
        }

        select() {
            this._input?.select();
        }
    }

    customElements.define("textbox", MozTextbox);
}