/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";

class MozGroupbox extends MozXULElement {
    connectedCallback() {
        if (this._initialized)
            return;
        this._initialized = true;

        const hasCaption = Array.from(this.childNodes).some(
            child => child.localName === "caption"
        );
        if (
            hasCaption &&
            !document.querySelector('link[href="chrome://global/skin/groupbox.css"]')
        ) {
            const link = document.createElement("link");
            link.rel = "stylesheet";
            link.href = "chrome://global/skin/groupbox.css";
            document.documentElement.appendChild(link);
        }

        let title = null;
        if (hasCaption) {
            title = document.createElementNS(XUL_NS, "hbox");
            title.className = "groupbox-title";
            title.setAttribute("align", "center");
            title.setAttribute("pack", "start");
        }

        let body = document.createElementNS(XUL_NS, "vbox");
        body.className = "groupbox-body";
        body.setAttribute("flex", "1");

        for (let attr of["orient", "align", "pack"]) {
            if (this.hasAttribute(attr))
                body.setAttribute(attr, this.getAttribute(attr));
        }

        for (let child of Array.from(this.childNodes)) {
            if (child.localName === "caption" && title)
                title.appendChild(child);
            else
                body.appendChild(child);
        }

        if (title)
            this.appendChild(title);
        this.appendChild(body);
    }
}

customElements.define("groupbox", MozGroupbox);

class MozCaption extends MozXULElement {
    connectedCallback() {
        if (this._initialized)
            return;
        this._initialized = true;

        let icon = document.createElementNS(XUL_NS, "image");
        icon.className = "caption-icon";
        if (this.hasAttribute("image"))
            icon.setAttribute("src", this.getAttribute("image"));

        let label = document.createElementNS(XUL_NS, "label");
        label.className = "caption-text";
        label.setAttribute("flex", "1");
        if (this.hasAttribute("label"))
            label.setAttribute("value", this.getAttribute("label"));
        if (this.hasAttribute("value"))
            label.setAttribute("value", this.getAttribute("value"));
        if (this.hasAttribute("crop"))
            label.setAttribute("crop", this.getAttribute("crop"));
        if (this.hasAttribute("accesskey"))
            label.setAttribute("accesskey", this.getAttribute("accesskey"));
        if (this.hasAttribute("default"))
            label.setAttribute("default", this.getAttribute("default"));

        this.appendChild(icon);
        this.appendChild(label);
    }

    static get observedAttributes() {
        return ["label", "value", "image", "crop", "accesskey", "default"];
    }

    attributeChangedCallback(name, oldVal, newVal) {
    if (!this._initialized) {
        // Fluent fired before connectedCallback, will be picked up on connect
        return;
    }
    let label = this.querySelector(".caption-text");
    if (!label) return;
    if (name === "label" || name === "value")
        label.setAttribute("value", newVal);
    else if (name === "image")
        this.querySelector(".caption-icon")?.setAttribute("src", newVal);
    else if (name === "crop" || name === "accesskey" || name === "default")
        label.setAttribute(name, newVal);
}
}

customElements.define("caption", MozCaption);
