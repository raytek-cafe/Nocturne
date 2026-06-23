/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// This is loaded into chrome windows with the subscript loader. Wrap in
// a block to prevent accidentally leaking globals onto `window`.
{
  const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
  const HTML_NS = "http://www.w3.org/1999/xhtml";

  class MozTextbox extends MozXULElement {
    static get inheritedAttributes() {
      return {
        ".textbox-input-box": "context,spellcheck",
        ".textbox-input": "value,type,maxlength,disabled,size,readonly,placeholder,tabindex,accesskey,noinitialfocus,mozactionhint,spellcheck",
      };
    }

    static get markup() {
      return `
        <hbox class="textbox-input-box" flex="1">
          <html:input class="textbox-input" anonid="input"/>
        </hbox>
      `;
    }

    constructor() {
      super();
      this._mInputField = null;
      this._mIgnoreClick = false;
      this._mIgnoreFocus = false;
      this._mEditor = null;
    }

    connectedCallback() {
      if (this.delayConnectedCallback()) {
        return;
      }
      if (!this._initialized) {
        this.textContent = "";
        this.appendChild(this.constructor.fragment);
        this.initializeAttributeInheritance();
        this._initialized = true;

        this.addEventListener("focus", this._onFocus.bind(this), true);
        this.addEventListener("blur", this._onBlur.bind(this), true);
        this.addEventListener("mousedown", this._onMouseDown.bind(this));
        this.addEventListener("click", this._onClick.bind(this));

        this._setNewlineHandling();
        if (this.hasAttribute("emptytext"))
          this.placeholder = this.getAttribute("emptytext");
      }
    }

    get inputField() {
      if (!this._mInputField)
        this._mInputField = this.querySelector(".textbox-input");
      return this._mInputField;
    }

    get value() { return this.inputField.value; }
    set value(val) { this.inputField.value = val; }

    get defaultValue() { return this.inputField.defaultValue; }
    set defaultValue(val) { this.inputField.defaultValue = val; }

    get label() {
      return this.getAttribute("label") ||
             (this.labelElement ? this.labelElement.value : this.placeholder);
    }
    set label(val) { this.setAttribute("label", val); }

    get placeholder() { return this.inputField.placeholder; }
    set placeholder(val) { this.inputField.placeholder = val; }

    get emptyText() { return this.placeholder; }
    set emptyText(val) { this.placeholder = val; }

    get type() { return this.getAttribute("type"); }
    set type(val) {
      if (val) this.setAttribute("type", val);
      else this.removeAttribute("type");
    }

    get maxLength() { return this.inputField.maxLength; }
    set maxLength(val) { this.inputField.maxLength = val; }

    get disabled() { return this.inputField.disabled; }
    set disabled(val) {
      this.inputField.disabled = val;
      if (val) this.setAttribute("disabled", "true");
      else this.removeAttribute("disabled");
    }

    get tabIndex() { return parseInt(this.getAttribute("tabindex")); }
    set tabIndex(val) {
      this.inputField.tabIndex = val;
      if (val) this.setAttribute("tabindex", val);
      else this.removeAttribute("tabindex");
    }

    get size() { return this.inputField.size; }
    set size(val) { this.inputField.size = val; }

    get readOnly() { return this.inputField.readOnly; }
    set readOnly(val) {
      this.inputField.readOnly = val;
      if (val) this.setAttribute("readonly", "true");
      else this.removeAttribute("readonly");
    }

    get clickSelectsAll() { return this.getAttribute("clickSelectsAll") == "true"; }
    set clickSelectsAll(val) {
      if (val) this.setAttribute("clickSelectsAll", "true");
      else this.removeAttribute("clickSelectsAll");
    }

    get editor() {
      if (!this._mEditor)
        this._mEditor = this.inputField.editor;
      return this._mEditor;
    }

    get controllers() { return this.inputField.controllers; }
    get textLength() { return this.inputField.textLength; }

    get selectionStart() { return this.inputField.selectionStart; }
    set selectionStart(val) { this.inputField.selectionStart = val; }

    get selectionEnd() { return this.inputField.selectionEnd; }
    set selectionEnd(val) { this.inputField.selectionEnd = val; }

    setSelectionRange(start, end) {
      this.inputField.setSelectionRange(start, end);
    }

    select() { this.inputField.select(); }

    focus() { this.inputField.focus(); }

    reset() {
      this.value = this.defaultValue;
      try {
        this.editor.transactionManager.clear();
        return true;
      } catch(e) {}
      return false;
    }

    _setNewlineHandling() {
      let str = this.getAttribute("newlines");
      if (str && this.editor) {
        for (let x in Ci.nsIPlaintextEditor) {
          if (/^eNewlines/.test(x)) {
            if (str == RegExp.rightContext.toLowerCase()) {
              this.editor.QueryInterface(Ci.nsIPlaintextEditor).newlineHandling =
                Ci.nsIPlaintextEditor[x];
              break;
            }
          }
        }
      }
    }

    _maybeSelectAll() {
      if (!this._mIgnoreClick && this.clickSelectsAll &&
          document.activeElement == this.inputField &&
          this.inputField.selectionStart == this.inputField.selectionEnd)
        this.editor.selectAll();
    }

    _onFocus(event) {
      if (this.hasAttribute("focused"))
        return;

      switch (event.originalTarget) {
        case this:
          this.inputField.focus();
          break;
        case this.inputField:
          if (this._mIgnoreFocus) {
            this._mIgnoreFocus = false;
          } else if (this.clickSelectsAll) {
            try {
              let imeEditor = this.editor.QueryInterface(Ci.nsIEditorIMESupport);
              if (!imeEditor || !imeEditor.composing)
                this.editor.selectAll();
            } catch(e) {}
          }
          break;
        default:
          return;
      }
      this.setAttribute("focused", "true");
    }

    _onBlur(event) {
      this.removeAttribute("focused");
      if (window == window.top &&
          window.constructor == ChromeWindow &&
          document.activeElement == this.inputField)
        this._mIgnoreFocus = true;
    }

    _onMouseDown(event) {
      this._mIgnoreClick = this.hasAttribute("focused");
      if (!this._mIgnoreClick) {
        this._mIgnoreFocus = true;
        this.inputField.setSelectionRange(0, 0);
        if (event.originalTarget == this ||
            event.originalTarget == this.inputField.parentNode)
          this.inputField.focus();
      }
    }

    _onClick(event) { this._maybeSelectAll(); }
  }

  MozXULElement.implementCustomInterface(MozTextbox, [
    Ci.nsIDOMXULTextBoxElement,
  ]);
  customElements.define("textbox", MozTextbox);

  // timed-textbox
  // extends textbox
  class MozTimedTextbox extends MozTextbox {
    constructor() {
      super();
      this._timer = null;
    }

    connectedCallback() {
      super.connectedCallback();
      if (!this._timedInitialized) {
        this._timedInitialized = true;
        console.warn("Timed textboxes are deprecated. Consider using type=\"search\" instead.");
        this.addEventListener("input", this._onTimedInput.bind(this));
        this.addEventListener("keypress", this._onTimedKeypress.bind(this));
      }
    }

    get timeout() { return parseInt(this.getAttribute("timeout")) || 0; }
    set timeout(val) { this.setAttribute("timeout", val); }

    get value() { return this.inputField.value; }
    set value(val) {
      this.inputField.value = val;
      if (this._timer)
        clearTimeout(this._timer);
    }

    _fireCommand(me) {
      me._timer = null;
      me.doCommand();
    }

    _onTimedInput(event) {
      if (this._timer)
        clearTimeout(this._timer);
      this._timer = this.timeout && setTimeout(this._fireCommand, this.timeout, this);
    }

    _onTimedKeypress(event) {
      if (event.keyCode == KeyEvent.DOM_VK_RETURN) {
        if (this._timer)
          clearTimeout(this._timer);
        this._fireCommand(this);
        event.preventDefault();
      }
    }
  }

  customElements.define("timed-textbox", MozTimedTextbox);

  // textarea
  // extends textbox with <textarea> instead of <input>
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
        ".textbox-textarea": "value,disabled,tabindex,rows,cols,readonly,wrap,placeholder,mozactionhint,spellcheck",
      };
    }
  }

  customElements.define("textarea", MozTextarea);
}