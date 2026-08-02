/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// This is loaded into chrome windows with the subscript loader. Wrap in
// a block to prevent accidentally leaking globals onto `window`.
{
  class MozTextbox extends MozXULElement {
    static get inheritedAttributes() {
      return {
        ".textbox-input-box": "context,spellcheck",
        ".textbox-input":
          "value,type,maxlength,disabled,size,readonly,placeholder,tabindex,accesskey,noinitialfocus,mozactionhint,spellcheck",
      };
    }

    static get markup() {
      return `
        <hbox class="textbox-input-box" flex="1">
          <html:input class="textbox-input" anonid="input" />
        </hbox>
      `;
    }

    constructor() {
      super();
      this._inputField = null;
      this._ignoreClick = false;
      this._ignoreFocus = false;
      this._editor = null;
    }

    connectedCallback() {
      if (this.delayConnectedCallback() || this._initialized) {
        return;
      }

      this.textContent = "";
      this.appendChild(this.constructor.fragment);
      this.initializeAttributeInheritance();
      this._initialized = true;

      this.addEventListener("focus", this._onFocus, true);
      this.addEventListener("blur", this._onBlur, true);
      this.addEventListener("mousedown", this._onMouseDown);
      this.addEventListener("click", this._onClick);

      this._setNewlineHandling();
      if (this.hasAttribute("emptytext")) {
        this.placeholder = this.getAttribute("emptytext");
      }
    }

    get inputField() {
      if (!this._inputField) {
        this._inputField = this.querySelector(
          ".textbox-input, .textbox-textarea"
        );
      }
      return this._inputField;
    }

    get value() {
      return this.inputField.value;
    }

    set value(value) {
      this.inputField.value = value;
    }

    get defaultValue() {
      return this.inputField.defaultValue;
    }

    set defaultValue(value) {
      this.inputField.defaultValue = value;
    }

    get label() {
      return this.getAttribute("label") || this.placeholder;
    }

    set label(value) {
      this.setAttribute("label", value);
    }

    get placeholder() {
      return this.inputField.placeholder;
    }

    set placeholder(value) {
      this.inputField.placeholder = value;
    }

    get emptyText() {
      return this.placeholder;
    }

    set emptyText(value) {
      this.placeholder = value;
    }

    get type() {
      return this.getAttribute("type") || "text";
    }

    set type(value) {
      if (value) {
        this.setAttribute("type", value);
      } else {
        this.removeAttribute("type");
      }
    }

    get maxLength() {
      return this.inputField.maxLength;
    }

    set maxLength(value) {
      this.inputField.maxLength = value;
    }

    get disabled() {
      return this.inputField.disabled;
    }

    set disabled(value) {
      this.inputField.disabled = !!value;
      this.toggleAttribute("disabled", !!value);
    }

    get tabIndex() {
      return this.inputField.tabIndex;
    }

    set tabIndex(value) {
      this.inputField.tabIndex = value;
      if (value == null) {
        this.removeAttribute("tabindex");
      } else {
        this.setAttribute("tabindex", value);
      }
    }

    get size() {
      return this.inputField.size;
    }

    set size(value) {
      this.inputField.size = value;
    }

    get readOnly() {
      return this.inputField.readOnly;
    }

    set readOnly(value) {
      this.inputField.readOnly = !!value;
      this.toggleAttribute("readonly", !!value);
    }

    get clickSelectsAll() {
      return this.getAttribute("clickSelectsAll") == "true";
    }

    set clickSelectsAll(value) {
      this.toggleAttribute("clickSelectsAll", !!value);
    }

    get editor() {
      if (!this._editor) {
        this._editor = this.inputField.editor;
      }
      return this._editor;
    }

    get controllers() {
      return this.inputField.controllers;
    }

    get textLength() {
      return this.inputField.textLength;
    }

    get selectionStart() {
      return this.inputField.selectionStart;
    }

    set selectionStart(value) {
      this.inputField.selectionStart = value;
    }

    get selectionEnd() {
      return this.inputField.selectionEnd;
    }

    set selectionEnd(value) {
      this.inputField.selectionEnd = value;
    }

    setSelectionRange(start, end) {
      this.inputField.setSelectionRange(start, end);
    }

    select() {
      this.inputField.select();
    }

    focus() {
      this.inputField.focus();
    }

    reset() {
      this.value = this.defaultValue;
      try {
        this.editor.transactionManager.clear();
        return true;
      } catch (e) {
        return false;
      }
    }

    doCommand(command = this.getAttribute("command")) {
      if (!command) {
        return;
      }
      const controller =
        this.ownerDocument.commandDispatcher.getControllerForCommand(command);
      controller?.doCommand(command);
    }

    _setNewlineHandling() {
      const newlineName = this.getAttribute("newlines");
      if (!newlineName || !this.editor) {
        return;
      }

      for (const name in Ci.nsIPlaintextEditor) {
        const match = /^eNewlines(.*)$/i.exec(name);
        if (match && match[1].toLowerCase() == newlineName.toLowerCase()) {
          this.editor.QueryInterface(Ci.nsIPlaintextEditor).newlineHandling =
            Ci.nsIPlaintextEditor[name];
          break;
        }
      }
    }

    _maybeSelectAll() {
      if (
        !this._ignoreClick &&
        this.clickSelectsAll &&
        this.ownerDocument.activeElement == this.inputField &&
        this.inputField.selectionStart == this.inputField.selectionEnd
      ) {
        this.editor.selectAll();
      }
    }

    _onFocus = event => {
      if (this.hasAttribute("focused")) {
        return;
      }

      const target = event.originalTarget || event.target;
      if (target == this) {
        this.inputField.focus();
      } else if (target == this.inputField) {
        if (this._ignoreFocus) {
          this._ignoreFocus = false;
        } else if (this.clickSelectsAll) {
          try {
            const imeEditor = this.editor.QueryInterface(
              Ci.nsIEditorIMESupport
            );
            if (!imeEditor || !imeEditor.composing) {
              this.editor.selectAll();
            }
          } catch (e) {}
        }
      } else {
        return;
      }

      this.setAttribute("focused", "true");
    };

    _onBlur = () => {
      this.removeAttribute("focused");
    };

    _onMouseDown = event => {
      this._ignoreClick = this.hasAttribute("focused");
      if (!this._ignoreClick) {
        this._ignoreFocus = true;
        this.inputField.setSelectionRange(0, 0);
        const target = event.originalTarget || event.target;
        if (target == this || target == this.inputField.parentNode) {
          this.inputField.focus();
        }
      }
    };

    _onClick = () => this._maybeSelectAll();
  }

  customElements.define("textbox", MozTextbox);

  class MozTimedTextbox extends MozTextbox {
    constructor() {
      super();
      this._timer = null;
    }

    connectedCallback() {
      super.connectedCallback();
      if (this._timedInitialized) {
        return;
      }
      this._timedInitialized = true;
      this.addEventListener("input", this._onTimedInput);
      this.addEventListener("keypress", this._onTimedKeypress);
    }

    get timeout() {
      return parseInt(this.getAttribute("timeout"), 10) || 0;
    }

    set timeout(value) {
      this.setAttribute("timeout", value);
    }

    set value(value) {
      this.inputField.value = value;
      if (this._timer) {
        clearTimeout(this._timer);
        this._timer = null;
      }
    }

    _fireCommand = () => {
      this._timer = null;
      this.doCommand();
    };

    _onTimedInput = () => {
      clearTimeout(this._timer);
      this._timer = this.timeout
        ? setTimeout(this._fireCommand, this.timeout)
        : null;
    };

    _onTimedKeypress = event => {
      if (event.keyCode == KeyEvent.DOM_VK_RETURN) {
        clearTimeout(this._timer);
        this._fireCommand();
        event.preventDefault();
      }
    };
  }

  customElements.define("timed-textbox", MozTimedTextbox);

  class MozTextarea extends MozTextbox {
    static get markup() {
      return `
        <hbox class="textbox-input-box" flex="1">
          <html:textarea class="textbox-textarea" anonid="input"></html:textarea>
        </hbox>
      `;
    }

    static get inheritedAttributes() {
      return {
        ".textbox-input-box": "context,spellcheck",
        ".textbox-textarea":
          "value,disabled,tabindex,rows,cols,readonly,wrap,placeholder,mozactionhint,spellcheck",
      };
    }
  }

  customElements.define("textarea", MozTextarea);
}
