/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

// This is loaded into XUL windows that use the legacy listbox widget. Wrap in
// a block to prevent leaking to window scope.
{
  MozElements.ListBox = class ListBox extends MozElements.RichListBox {
    get itemTagName() {
      return "listitem";
    }

    _refreshSelection() {
      super._refreshSelection(false);
    }

    set selectedItem(item) {
      if (item) {
        super.selectedItem = item;
      } else {
        this.clearSelection();
        this.currentItem = null;
      }
    }

    get selectedItem() {
      return super.selectedItem;
    }

    appendItem(label, value) {
      return this.insertItemAt(this.itemCount, label, value);
    }

    insertItemAt(index, label, value) {
      const item = this.ownerDocument.createXULElement(this.itemTagName);
      item.setAttribute("label", label);
      item.setAttribute("value", value);
      this.insertBefore(item, this.getItemAtIndex(index));
      return item;
    }

    removeItemAt(index) {
      const item = this.getItemAtIndex(index);
      if (!item) {
        return null;
      }

      if (item.selected) {
        this.removeItemFromSelection(item);
      }
      if (this.currentItem == item) {
        this.currentItem = null;
      }
      item.remove();
      return item;
    }
  };

  MozXULElement.implementCustomInterface(MozElements.ListBox, [
    Ci.nsIDOMXULSelectControlElement,
    Ci.nsIDOMXULMultiSelectControlElement,
  ]);

  customElements.define("listbox", MozElements.ListBox);

  MozElements.ListItem = class ListItem extends MozElements.MozRichlistitem {
    static get observedAttributes() {
      return ["label"];
    }

    connectedCallback() {
      this._ensureLabelElement();
      super.connectedCallback();
    }

    attributeChangedCallback(name, oldValue, newValue) {
      if (name == "label" && oldValue != newValue && this.isConnected) {
        this._ensureLabelElement().value = newValue || "";
      }
    }

    set label(value) {
      this.setAttribute("label", value);
    }

    get label() {
      return this.getAttribute("label") || "";
    }

    _ensureLabelElement() {
      let label = this.querySelector(":scope > label[data-listitem-label]");
      if (!label) {
        label = this.ownerDocument.createXULElement("label");
        label.setAttribute("data-listitem-label", "true");
        label.setAttribute("flex", "1");
        label.setAttribute("crop", "end");
        this.prepend(label);
      }
      label.value = this.label;
      return label;
    }
  };

  MozXULElement.implementCustomInterface(MozElements.ListItem, [
    Ci.nsIDOMXULSelectControlItemElement,
  ]);

  customElements.define("listitem", MozElements.ListItem);
}
