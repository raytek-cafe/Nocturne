/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Port of PrefWindow (Preference Window Framework) 6 from XBL */

/*
 * = Preferences Window Framework
 *
 *   The syntax for use looks something like:
 *
 *   <prefwindow>
 *     <prefpane id="prefPaneA">
 *       <preferences>
 *         <preference id="preference1" name="app.preference1" type="bool" onchange="foo();"/>
 *         <preference id="preference2" name="app.preference2" type="bool" useDefault="true"/>
 *       </preferences>
 *       <checkbox label="Preference" preference="preference1"/>
 *     </prefpane>
 *   </prefwindow>
 *
 *   This is PrefWindow 6. The Code Could Well Be Ready, Are You?
 *
 *   Historical References:
 *   PrefWindow V   (February 1, 2003)
 *   PrefWindow IV  (April 24, 2000)
 *   PrefWindow III (January 6, 2000)
 *   PrefWindow II  (???)
 *   PrefWindow I   (June 4, 1999)
 */

"use strict"; {
  const XUL_NS =
    "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";

  class MozPreferences extends MozXULElement {
    QueryInterface(iid) {
      if (iid.equals(Ci.nsIObserver) || iid.equals(Ci.nsISupports))
        return this;
      throw Components.Exception("", Cr.NS_ERROR_NO_INTERFACE);
    }

    _constructAfterChildren() {
      // This method will be called after each one of the child <preference>
      // elements is constructed. Its purpose is to propagate the values to
      // the associated form elements once all children are ready.
      var elements = this.getElementsByTagName("preference");
      for (let element of elements) {
        if (!element._constructed) {
          return;
        }
      }
      for (let element of elements) {
        element.updateElements();
      }
    }

    observe(aSubject, aTopic, aData) {
      for (var i = 0; i < this.childNodes.length; ++i) {
        var preference = this.childNodes[i];
        if (preference.name == aData) {
          preference.value = preference.valueFromPreferences;
        }
      }
    }

    fireChangedEvent(aPreference) {
      // Value changed, synthesize an event
      try {
        var event = document.createEvent("Events");
        event.initEvent("change", true, true);
        aPreference.dispatchEvent(event);
      } catch (e) {
        Cu.reportError(e);
      }
    }

    get instantApply() {
      var doc = document.documentElement;
      return this.type == "child" ? doc.instantApply
                                  : doc.instantApply ||
                                    Services.prefs.getBoolPref("browser.preferences.instantApply", false);
    }

    get type() {
      return document.documentElement.type || "";
    }
  }

  customElements.define("preferences", MozPreferences);

  class MozPreference extends MozXULElement {
    connectedCallback() {
      this._constructed = false;
      this._value = null;

      if (!this.name)
        return;

      var prefs = this.closest("preferences");
      if (!prefs)
        return;

      // addObserver requires a proper XPConnect-visible nsIObserver. A plain
      // DOM element cannot be passed directly in Firefox 140 chrome context;
      // wrap the prefs element's observe method in a generateQI-backed object
      // and store it so disconnectedCallback can remove the same reference.
      if (!this._prefsObserver) {
        this._prefsObserver = {
          observe: (aSubject, aTopic, aData) => prefs.observe(aSubject, aTopic, aData),
          QueryInterface: ChromeUtils.generateQI(["nsIObserver"]),
        };
      }
      try {
        Services.prefs.addObserver(this.name, this._prefsObserver);
      } catch (e) {
        Cu.reportError("addObserver failed: " + e);
        return;
      }

      // In non-instant apply mode, we must try and use the last saved state
      // from any previous opens of a child dialog instead of the value from
      // preferences, to pick up any edits a user may have made.
      var secMan = Cc["@mozilla.org/scriptsecuritymanager;1"]
                     .getService(Ci.nsIScriptSecurityManager);
      if (prefs.type == "child" &&
          !this.instantApply && window.opener &&
          secMan.isSystemPrincipal(window.opener.document.nodePrincipal)) {
        var pdoc = window.opener.document;

        // Try to find a preference element for the same preference.
        var preference = null;
        var parentPreferences = pdoc.getElementsByTagName("preferences");
        for (var k = 0; (k < parentPreferences.length && !preference); ++k) {
          var parentPrefs = parentPreferences[k]
                              .getElementsByAttribute("name", this.name);
          for (var l = 0; (l < parentPrefs.length && !preference); ++l) {
            if (parentPrefs[l].localName == "preference")
              preference = parentPrefs[l];
          }
        }

        // Don't use the value setter here, we don't want updateElements to be
        // prematurely fired.
        this._value = preference ? preference.value : this.valueFromPreferences;
      } else {
        this._value = this.valueFromPreferences;
      }

      this._constructed = true;
      prefs._constructAfterChildren();
    }

    disconnectedCallback() {
      if (this._prefsObserver && this.name) {
        Services.prefs.removeObserver(this.name, this._prefsObserver);
      }
    }

    get instantApply() {
      return this.getAttribute("instantApply") == "true" ||
             this.closest("preferences").instantApply;
    }

    get preferences() { return this.parentNode; }

    get name() { return this.getAttribute("name"); }
    set name(val) {
      if (val == this.name)
        return val;

      if (this._prefsObserver && this.name)
        Services.prefs.removeObserver(this.name, this._prefsObserver);
      this.setAttribute("name", val);
      if (this._prefsObserver && val)
        Services.prefs.addObserver(val, this._prefsObserver);

      return val;
    }

    get type()     { return this.getAttribute("type"); }
    set type(val)  { this.setAttribute("type", val); return val; }

    get inverted() { return this.getAttribute("inverted") == "true"; }
    set inverted(val) { this.setAttribute("inverted", val); return val; }

    get readonly() { return this.getAttribute("readonly") == "true"; }
    set readonly(val) { this.setAttribute("readonly", val); return val; }

    get disabled() { return this.getAttribute("disabled") == "true"; }
    set disabled(val) {
      if (val)
        this.setAttribute("disabled", "true");
      else
        this.removeAttribute("disabled");

      if (!this.id)
        return val;

      var elements = document.getElementsByAttribute("preference", this.id);
      for (var i = 0; i < elements.length; ++i) {
        elements[i].disabled = val;

        var labels = document.getElementsByAttribute("control", elements[i].id);
        for (var j = 0; j < labels.length; ++j)
          labels[j].disabled = val;
      }

      return val;
    }

    get tabIndex() { return parseInt(this.getAttribute("tabindex")); }
    set tabIndex(val) {
      if (val)
        this.setAttribute("tabindex", val);
      else
        this.removeAttribute("tabindex");

      if (!this.id)
        return val;

      var elements = document.getElementsByAttribute("preference", this.id);
      for (var i = 0; i < elements.length; ++i) {
        elements[i].tabIndex = val;

        var labels = document.getElementsByAttribute("control", elements[i].id);
        for (var j = 0; j < labels.length; ++j)
          labels[j].tabIndex = val;
      }

      return val;
    }

    get value() { return this._value; }
    set value(val) { return this._setValue(val); }

    _setValue(aValue) {
      if (this.value !== aValue) {
        this._value = aValue;
        if (this.instantApply)
          this.valueFromPreferences = aValue;
        var prefs = this.closest("preferences");
        if (prefs)
          prefs.fireChangedEvent(this);
      }
      return aValue;
    }

    get locked() {
      return Services.prefs.prefIsLocked(this.name);
    }

    get hasUserValue() {
      return Services.prefs.prefHasUserValue(this.name) &&
             this.value !== undefined;
    }

    reset() {
      // defer reset until preference update
      this.value = undefined;
    }

    get defaultValue() {
      this._useDefault = true;
      var val = this.valueFromPreferences;
      this._useDefault = false;
      return val;
    }

    get _branch() {
      return this._useDefault
        ? Services.prefs.getDefaultBranch("")
        : Services.prefs;
    }

    get valueFromPreferences() {
      try {
        // Force a resync of value with preferences.
        switch (this.type) {
          case "int":
            return this._branch.getIntPref(this.name);
          case "bool": {
            var val = this._branch.getBoolPref(this.name);
            return this.inverted ? !val : val;
          }
          case "wstring":
            return this._branch
                       .getComplexValue(this.name, Ci.nsIPrefLocalizedString)
                       .data;
          case "string":
          case "unichar":
            return this._branch.getStringPref(this.name);
          case "fontname": {
            var family = this._branch.getStringPref(this.name);
            var fontEnumerator = Cc["@mozilla.org/gfx/fontenumerator;1"]
                                   .createInstance(Ci.nsIFontEnumerator);
            return fontEnumerator.getStandardFamilyName(family);
          }
          case "file":
            return this._branch.getComplexValue(this.name, Ci.nsIFile);
          default:
            this._reportUnknownType();
        }
      } catch (e) {}
      return null;
    }

    set valueFromPreferences(val) {
      // Exit early if nothing to do.
      if (this.readonly)
        return val;

      // The special value undefined means 'reset preference to default'.
      if (val === undefined) {
        Services.prefs.clearUserPref(this.name);
        return val;
      }

      // Force a resync of preferences with value.
      switch (this.type) {
        case "int":
          Services.prefs.setIntPref(this.name, val);
          break;
        case "bool":
          Services.prefs.setBoolPref(this.name, this.inverted ? !val : val);
          break;
        case "wstring": {
          var pls = Cc["@mozilla.org/pref-localizedstring;1"]
                      .createInstance(Ci.nsIPrefLocalizedString);
          pls.data = val;
          Services.prefs.setComplexValue(
            this.name, Ci.nsIPrefLocalizedString, pls);
          break;
        }
        case "string":
        case "unichar":
        case "fontname": {
          var iss = Cc["@mozilla.org/supports-string;1"]
                      .createInstance(Ci.nsISupportsString);
          iss.data = val;
          Services.prefs.setComplexValue(
            this.name, Ci.nsISupportsString, iss);
          break;
        }
        case "file": {
          var lf;
          if (typeof val == "string") {
            lf = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
            lf.persistentDescriptor = val;
            if (!lf.exists())
              lf.initWithPath(val);
          } else {
            lf = val.QueryInterface(Ci.nsIFile);
          }
          Services.prefs.setComplexValue(this.name, Ci.nsIFile, lf);
          break;
        }
        default:
          this._reportUnknownType();
      }

      if (!this.batching)
        Services.prefs.savePrefFile(null);
      return val;
    }

    _reportUnknownType() {
      var consoleService = Cc["@mozilla.org/consoleservice;1"]
                             .getService(Ci.nsIConsoleService);
      var msg = "<preference> with id='" + this.id + "' and name='" +
                this.name + "' has unknown type '" + this.type + "'.";
      consoleService.logStringMessage(msg);
    }

    setElementValue(aElement) {
      if (this.locked)
        aElement.disabled = true;

      if (!this.isElementEditable(aElement))
        return;

      var rv = undefined;
      if (aElement.hasAttribute("onsyncfrompreference")) {
        // Value changed, synthesize an event
        try {
          var event = document.createEvent("Events");
          event.initEvent("syncfrompreference", true, true);
          // XUL compiles on* attributes into same-named properties; use the
          // property directly to avoid new Function() which is CSP-blocked in
          // the parent process.
          rv = aElement.onsyncfrompreference?.(event);
        } catch (e) {
          Cu.reportError(e);
        }
      }

      var val = rv !== undefined
        ? rv
        : (this.instantApply ? this.valueFromPreferences : this.value);
      // if the preference is marked for reset, show default value in UI
      if (val === undefined)
        val = this.defaultValue;

      /**
       * Initialize a UI element property with a value. Handles the case
       * where an element has not yet had a XBL binding attached for it and
       * the property setter does not yet exist by setting the same attribute
       * on the XUL element using DOM apis and assuming the element's
       * constructor or property getters appropriately handle this state.
       */
      function setValue(element, attribute, value) {
        if (attribute in element)
          element[attribute] = value;
        else
          element.setAttribute(attribute, value);
      }

      if (aElement.localName == "checkbox" ||
          aElement.localName == "listitem")
        setValue(aElement, "checked", val);
      else if (aElement.localName == "colorpicker")
        setValue(aElement, "color", val);
      else if (aElement.localName == "textbox") {
        // XXXmano Bug 303998: Avoid a caret placement issue if either the
        // preference observer or its setter calls updateElements as a result
        // of the input event handler.
        if (aElement.value !== val)
          setValue(aElement, "value", val);
      } else
        setValue(aElement, "value", val);
    }

    getElementValue(aElement) {
      if (aElement.hasAttribute("onsynctopreference")) {
        // Value changed, synthesize an event
        try {
          var event = document.createEvent("Events");
          event.initEvent("synctopreference", true, true);
          // Use the compiled property rather than new Function() (CSP-blocked).
          var rv = aElement.onsynctopreference?.(event);
          if (rv !== undefined)
            return rv;
        } catch (e) {
          Cu.reportError(e);
        }
      }

      /**
       * Read the value of an attribute from an element, assuming the
       * attribute is a property on the element's node API. If the property
       * is not present in the API, then assume its value is contained in
       * an attribute, as is the case before a binding has been attached.
       */
      function getValue(element, attribute) {
        if (attribute in element)
          return element[attribute];
        return element.getAttribute(attribute);
      }

      var value;
      if (aElement.localName == "checkbox" ||
          aElement.localName == "listitem")
        value = getValue(aElement, "checked");
      else if (aElement.localName == "colorpicker")
        value = getValue(aElement, "color");
      else
        value = getValue(aElement, "value");

      switch (this.type) {
        case "int":  return parseInt(value, 10) || 0;
        case "bool": return typeof value == "boolean" ? value : value == "true";
      }
      return value;
    }

    isElementEditable(aElement) {
      switch (aElement.localName) {
        case "checkbox":
        case "colorpicker":
        case "radiogroup":
        case "textbox":
        case "listitem":
        case "listbox":
        case "menulist":
          return true;
      }
      return aElement.getAttribute("preference-editable") == "true";
    }

    updateElements() {
      if (!this.id)
        return;

      // This "change" event handler tracks changes made to preferences by
      // sources other than the user in this window.
      var elements = document.getElementsByAttribute("preference", this.id);
      for (var i = 0; i < elements.length; ++i)
        this.setElementValue(elements[i]);
    }
  }

  customElements.define("preference", MozPreference);

  class MozPrefPane extends MozXULElement {
    connectedCallback() {
      if (!this.querySelector(".content-box")) {
        let box = document.createElementNS(XUL_NS, "vbox");
        box.className = "content-box";
        if (this.hasAttribute("flex"))
          box.setAttribute("flex", this.getAttribute("flex"));
        while (this.firstChild)
          box.appendChild(this.firstChild);
        this.appendChild(box);
      }
      this._content = this.querySelector(".content-box");
    }

    get src()      { return this.getAttribute("src"); }
    set src(val)   { this.setAttribute("src", val); return val; }
    get selected() { return this.getAttribute("selected") == "true"; }
    set selected(val) { this.setAttribute("selected", val); return val; }
    get image()    { return this.getAttribute("image"); }
    set image(val) { this.setAttribute("image", val); return val; }
    get label()    { return this.getAttribute("label"); }
    set label(val) { this.setAttribute("label", val); return val; }

    get loaded()    { return !this.src ? true : this._loaded; }
    set loaded(val) { this._loaded = val; return val; }
    get _loaded()   { return this.__loaded || false; }
    set _loaded(val){ this.__loaded = val; }

    get preferenceElements() { return this.getElementsByAttribute("preference", "*"); }
    get preferences()        { return this.getElementsByTagName("preference"); }

    get helpTopic() {
      // if there are tabs, and the selected tab provides a helpTopic, return that
      var box = this.getElementsByTagName("tabbox");
      if (box[0]) {
        var tab = box[0].selectedTab;
        if (tab && tab.hasAttribute("helpTopic"))
          return tab.getAttribute("helpTopic");
      }

      // otherwise, return the helpTopic of the current panel
      return this.getAttribute("helpTopic");
    }

    writePreferences(aFlushToDisk) {
      // Write all values to preferences.
      var preferences = this.preferences;
      for (var i = 0; i < preferences.length; ++i) {
        var preference = preferences[i];
        preference.batching = true;
        preference.valueFromPreferences = preference.value;
        preference.batching = false;
      }
      if (aFlushToDisk) {
        Services.prefs.savePrefFile(null);
      }
    }

    preferenceForElement(aElement) {
      return document.getElementById(aElement.getAttribute("preference"));
    }

    getPreferenceElement(aStartElement) {
      var temp = aStartElement;
      while (temp && temp.nodeType == Node.ELEMENT_NODE &&
             !temp.hasAttribute("preference"))
        temp = temp.parentNode;
      return (temp && temp.nodeType == Node.ELEMENT_NODE)
        ? temp
        : aStartElement;
    }

    userChangedValue(aElement) {
      let element = this.getPreferenceElement(aElement);
      if (element.hasAttribute("preference")) {
        if (element.getAttribute("delayprefsave") != "true") {
          var preference = document.getElementById(
            element.getAttribute("preference"));
          var prefVal = preference.getElementValue(element);
          preference.value = prefVal;
        }
      }
    }

    get contentHeight() {
      var style = window.getComputedStyle(this._content);
      var targetHeight = parseInt(style.height);
      targetHeight += parseInt(style.marginTop);
      targetHeight += parseInt(style.marginBottom);
      return targetHeight;
    }
  }

  customElements.define("prefpane", MozPrefPane);

  // This "command" event handler tracks changes made to preferences by
  // the user in this window.
  document.addEventListener("command", e => {
    // Pane-switching: radio buttons in the selector strip carry a "pane"
    // attribute. This mirrors the prefwindow command handler in the XBL.
    if (e.originalTarget && e.originalTarget.hasAttribute &&
        e.originalTarget.hasAttribute("pane")) {
      var prefwindow = document.documentElement;
      var pane = document.getElementById(e.originalTarget.getAttribute("pane"));
      prefwindow.showPane(pane);
      return;
    }
    let pane = e.target.closest("prefpane");
    if (pane)
      pane.userChangedValue((e.sourceEvent || e).target);
  });
  document.addEventListener("select", e => {
    // This "select" event handler tracks changes made to colorpicker
    // preferences by the user in this window.
    if (e.target.localName == "colorpicker") {
      let pane = e.target.closest("prefpane");
      if (pane) pane.userChangedValue(e.target);
    }
  });
  document.addEventListener("change", e => {
    // This "change" event handler tracks changes made to preferences by
    // the user in this window.
    let pane = e.target.closest("prefpane");
    if (pane) pane.userChangedValue(e.target);
  });
  document.addEventListener("input", e => {
    // This "input" event handler tracks changes made to preferences by
    // the user in this window.
    let pane = e.target.closest("prefpane");
    if (pane) pane.userChangedValue(e.target);
  });
  document.addEventListener("paneload", e => {
    // Initialize all values from preferences.
    var pane = e.target;
    if (pane.localName != "prefpane") return;
    var elements = pane.preferenceElements;
    for (var i = 0; i < elements.length; ++i) {
      try {
        var preference = pane.preferenceForElement(elements[i]);
        preference.setElementValue(elements[i]);
      } catch (ex) {
        dump("*** No preference found for " +
          elements[i].getAttribute("preference") + "\n");
      }
    }
  });

  class MozPrefWindow extends MozXULElement {
    constructor() {
      super();
      this._currentPane = null;
      this._initialized = false;
      // Derived bindings can set this to true to cause us to skip reading the
      // browser.preferences.instantApply pref in the constructor. Then they
      // can set instantApply to their wished value.
      this._instantApplyInitialized = false;
      // Controls whether changed pref values take effect immediately.
      this.instantApply = false;
      this._animateTimer = null;
      this._fadeTimer = null;
      this._animateDelay = 15;
      this._animateIncrement = 40;
      this._fadeDelay = 5;
      this._fadeIncrement = 0.40;
      this._animateRemainder = 0;
      this._currentHeight = 0;
      this._multiplier = 0;
    }

    connectedCallback() {
      if (this.type != "child") {
        if (!this._instantApplyInitialized) {
          this.instantApply = Services.prefs.getBoolPref(
            "browser.preferences.instantApply", false);
        }
        if (this.instantApply) {
          var docElt = document.documentElement;
          var acceptButton = this.getButton("accept");
          if (acceptButton) acceptButton.hidden = true;
          var cancelButton = this.getButton("cancel");
          if (cancelButton) {
            // morph the Cancel button into the Close button
            cancelButton.setAttribute("icon", "close");
            cancelButton.label = docElt.getAttribute("closebuttonlabel");
            cancelButton.accessKey = docElt.getAttribute("closebuttonaccesskey");
          }
        }
      }

      this.setAttribute("animated",
        this._shouldAnimate ? "true" : "false");
      this.setAttribute("orient", "vertical");

      this._buildChrome();

      document.addEventListener("keypress", event => {
        if (event.keyCode == KeyEvent.DOM_VK_RETURN) {
          this._hitEnter(event);
        } else if (event.keyCode == KeyEvent.DOM_VK_ESCAPE &&
                   !event.defaultPrevented) {
          window.close();
        }
      }, { mozSystemGroup: true });

      if (document.readyState == "complete") {
        this._init();
      } else {
        window.addEventListener("load", () => this._init(), { once: true });
      }
    }

    disconnectedCallback() {
      // Release timers to avoid reference cycles.
      if (this._animateTimer) {
        this._animateTimer.cancel();
        this._animateTimer = null;
      }
      if (this._fadeTimer) {
        this._fadeTimer.cancel();
        this._fadeTimer = null;
      }
    }

    _buildChrome() {
      // Selector strip — exposed to accessibility APIs as a listbox.
      this._selector = document.createElementNS(XUL_NS, "radiogroup");
      this._selector.setAttribute("anonid", "selector");
      this._selector.setAttribute("orient", "horizontal");
      this._selector.classList.add("paneSelector", "chromeclass-toolbar");
      this._selector.setAttribute("role", "listbox");

      var dragBox = document.createElementNS(XUL_NS, "windowdragbox");
      dragBox.setAttribute("orient", "vertical");
      dragBox.appendChild(this._selector);

      this._paneDeck = document.createElementNS(XUL_NS, "deck");
      this._paneDeck.setAttribute("anonid", "paneDeck");
      this._paneDeck.setAttribute("flex", "1");

      this._paneDeckContainer = document.createElementNS(XUL_NS, "hbox");
      this._paneDeckContainer.setAttribute("flex", "1");
      this._paneDeckContainer.classList.add("paneDeckContainer");
      this._paneDeckContainer.appendChild(this._paneDeck);

      this._dlgButtons = this._buildButtonBar();

      this.insertBefore(dragBox, this.firstChild);
      this.insertBefore(this._paneDeckContainer, dragBox.nextSibling);
      this.appendChild(this._dlgButtons);
    }

    _buildButtonBar() {
      var hbox = document.createElementNS(XUL_NS, "hbox");
      hbox.setAttribute("anonid", "dlg-buttons");
      hbox.classList.add("prefWindow-dlgbuttons");
      hbox.setAttribute("pack", "end");

      const makeBtn = (dlgtype, label, icon, hidden) => {
        var btn = document.createElementNS(XUL_NS, "button");
        btn.setAttribute("dlgtype", dlgtype);
        if (label) btn.setAttribute("label", label);
        if (icon)  btn.setAttribute("icon", icon);
        btn.classList.add("dialog-button");
        if (hidden) btn.setAttribute("hidden", "true");
        return btn;
      };

      var disclosureBtn = makeBtn("disclosure", "", "disclosure", true);
      var helpBtn       = makeBtn("help",       "", "help",       true);
      var extra2Btn     = makeBtn("extra2",     "", "",           true);
      var extra1Btn     = makeBtn("extra1",     "", "",           true);
      var spacer        = document.createElementNS(XUL_NS, "spacer");
      spacer.setAttribute("anonid", "spacer");
      spacer.setAttribute("flex", "1");
      var okBtn     = makeBtn("accept", "OK",     "accept", false);
      var cancelBtn = makeBtn("cancel", "Cancel", "cancel", false);

      okBtn.setAttribute("default", "true");
      okBtn.addEventListener("command", () => this._doAccept());
      cancelBtn.addEventListener("command", () => window.close());
      helpBtn.addEventListener("command", () => {
        this._fireEvent("dialoghelp", this);
      });

      this._buttons = {
        disclosure: disclosureBtn,
        help:       helpBtn,
        extra2:     extra2Btn,
        extra1:     extra1Btn,
        accept:     okBtn,
        cancel:     cancelBtn,
      };

      // Non-unix platform order mirrors dialog.xml:
      // extra2 | spacer | accept | extra1 | cancel | help | disclosure
      hbox.append(extra2Btn, spacer, okBtn, extra1Btn,
                  cancelBtn, helpBtn, disclosureBtn);

      return hbox;
    }

    getButton(aDlgType) {
      return this._buttons?.[aDlgType] || null;
    }

    _init() {
      var panes = Array.from(this.getElementsByTagName("prefpane"));
      for (let pane of panes) {
        if (pane.parentNode != this._paneDeck)
          this._paneDeck.appendChild(pane);
      }

      panes = Array.from(this.preferencePanes);
      if (!panes.length) return;

      var lastPane = null;
      if (this.lastSelected) {
        lastPane = document.getElementById(this.lastSelected);
        if (!lastPane) {
          this.lastSelected = "";
        }
      }

      var paneToLoad;
      if ("arguments" in window && window.arguments[0] &&
          document.getElementById(window.arguments[0]) &&
          document.getElementById(window.arguments[0]).localName == "prefpane") {
        paneToLoad = document.getElementById(window.arguments[0]);
        this.lastSelected = paneToLoad.id;
      } else if (lastPane) {
        paneToLoad = lastPane;
      } else {
        paneToLoad = panes[0];
      }

      for (var i = 0; i < panes.length; ++i) {
        this._makePaneButton(panes[i]);
        if (panes[i].loaded) {
          // Inline pane content, fire load event to force initialization.
          this._fireEvent("paneload", panes[i]);
        }
      }
      this.showPane(paneToLoad);

      if (panes.length == 1)
        this._selector.setAttribute("collapsed", "true");
    }

    get preferencePanes() {
      return this._paneDeck
        ? this._paneDeck.getElementsByTagName("prefpane")
        : this.getElementsByTagName("prefpane");
    }

    get type() { return this.getAttribute("type"); }

    get lastSelected() { return this.getAttribute("lastSelected"); }
    set lastSelected(val) {
      this.setAttribute("lastSelected", val);
      Services.xulStore.setValue(
        document.documentURI, this.id, "lastSelected", val);
    }

    get currentPane() {
      if (!this._currentPane)
        this._currentPane = this.preferencePanes[0];
      return this._currentPane;
    }
    set currentPane(val) { return this._currentPane = val; }

    _makePaneButton(aPaneElement) {
      var radio = document.createElementNS(XUL_NS, "radio");
      radio.setAttribute("pane", aPaneElement.id);
      radio.setAttribute("label", aPaneElement.label);
      // Expose preference group choice to accessibility APIs as an unchecked
      // list item. The parent group is exposed to accessibility APIs as a list.
      if (aPaneElement.image)
        radio.setAttribute("src", aPaneElement.image);
      radio.style.listStyleImage = aPaneElement.style.listStyleImage;
      this._selector.appendChild(radio);
      return radio;
    }

    showPane(aPaneElement) {
      if (!aPaneElement)
        return;

      this._selector.selectedItem =
        this._selector.querySelector(`[pane="${aPaneElement.id}"]`);

      if (!aPaneElement.loaded) {
        let self = this;
        fetch(aPaneElement.src)
          .then(r => r.text())
          .then(text => {
            // Strip preprocessor directives before parsing.
            text = text.replace(/^#.*$/gm, "");
            let parser = new DOMParser();
            parser.forceEnableXULXBL();
            let doc = parser.parseFromString(text, "application/xml");
            if (doc.documentElement.localName === "parsererror") {
              Cu.reportError("PANE PARSE ERROR in " + aPaneElement.src +
                ": " + doc.documentElement.textContent);
              return;
            }
            // Append into the content-box vbox so that contentHeight and
            // the content-box wrapping remain consistent.
            let target = aPaneElement._content || aPaneElement;
            for (let child of Array.from(doc.documentElement.childNodes)) {
              target.appendChild(document.importNode(child, true));
            }
            aPaneElement.loaded = true;
            self._fireEvent("paneload", aPaneElement);
            self._selectPane(aPaneElement);
          })
          .catch(e => Cu.reportError(
            "PANE FETCH ERROR " + aPaneElement.src + ": " + e));
      } else {
        this._selectPane(aPaneElement);
      }
    }

    _fireEvent(aEventName, aTarget) {
      // Panel loaded, synthesize a load event.
      try {
        var event = document.createEvent("Events");
        event.initEvent(aEventName, true, true);
        var cancel = !aTarget.dispatchEvent(event);
        if (aTarget.hasAttribute("on" + aEventName)) {
          // Use the XUL-compiled property rather than new Function() which is
          // blocked by the parent-process CSP.
          var handler = aTarget["on" + aEventName];
          if (typeof handler == "function") {
            var rv = handler.call(aTarget, event);
            if (rv == false)
              cancel = true;
          }
        }
        return !cancel;
      } catch (e) {
        Cu.reportError(e);
      }
      return false;
    }

    _selectPane(aPaneElement) {
      var helpButton = this.getButton("help");
      if (helpButton) {
        if (aPaneElement.helpTopic)
          helpButton.hidden = false;
        else
          helpButton.hidden = true;
      }

      // Find this pane's index in the deck and set the deck's
      // selectedIndex to that value to switch to it.
      var prefpanes = this.preferencePanes;
      for (var i = 0; i < prefpanes.length; ++i) {
        if (prefpanes[i] == aPaneElement) {
          this._paneDeck.selectedIndex = i;

          if (this.type != "child") {
            if (aPaneElement.hasAttribute("flex") &&
                this._shouldAnimate &&
                prefpanes.length > 1)
              aPaneElement.removeAttribute("flex");

            // Calling sizeToContent after the first prefpane is loaded will
            // size the window's contents so style information is available
            // to calculate correct sizing.
            if (!this._initialized && prefpanes.length > 1) {
              if (this._shouldAnimate)
                this.style.minHeight = 0;
              window.sizeToContent();
            }

            var oldPane = this.lastSelected
              ? document.getElementById(this.lastSelected)
              : this.preferencePanes[0];
            oldPane.selected = !(aPaneElement.selected = true);
            this.lastSelected = aPaneElement.id;
            this.currentPane = aPaneElement;
            this._initialized = true;

            // Only animate if we've switched between prefpanes
            if (this._shouldAnimate && oldPane.id != aPaneElement.id) {
              aPaneElement.style.opacity = 0.0;
              this.animate(oldPane, aPaneElement);
            } else if (!this._shouldAnimate && prefpanes.length > 1) {
              var targetHeight = parseInt(
                window.getComputedStyle(this._paneDeckContainer).height);
              var verticalPadding =
                parseInt(window.getComputedStyle(aPaneElement).paddingTop);
              verticalPadding +=
                parseInt(window.getComputedStyle(aPaneElement).paddingBottom);
              if (aPaneElement.contentHeight > targetHeight - verticalPadding) {
                // To workaround the bottom border of a groupbox from being
                // cutoff an hbox with a class of bottomBox may enclose it.
                // This needs to include its padding to resize properly.
                // See bug 394433.
                var bottomPadding = 0;
                var bottomBox =
                  aPaneElement.getElementsByAttribute("class", "bottomBox")[0];
                if (bottomBox)
                  bottomPadding =
                    parseInt(window.getComputedStyle(bottomBox).paddingBottom);
                window.innerHeight +=
                  bottomPadding + verticalPadding +
                  aPaneElement.contentHeight - targetHeight;
              }

              // XXX rstrong - extend the contents of the prefpane to
              // prevent elements from being cutoff (see bug 349098).
              if (aPaneElement._content &&
                  aPaneElement.contentHeight + verticalPadding < targetHeight)
                aPaneElement._content.style.height =
                  (targetHeight - verticalPadding) + "px";
            }
          }
          break;
        }
      }
    }

    _hitEnter(event) {
      if (event.defaultPrevented) return;
      var btn = this._buttons?.accept;
      if (btn && !btn.hidden && !btn.disabled) {
        btn.doCommand();
        event.preventDefault();
      }
    }

    _doAccept() {
      if (!this._fireEvent("beforeaccept", this))
        return;

      var secMan = Cc["@mozilla.org/scriptsecuritymanager;1"]
                     .getService(Ci.nsIScriptSecurityManager);

      if (this.type == "child" && window.opener &&
          secMan.isSystemPrincipal(window.opener.document.nodePrincipal)) {
        var pdoc = window.opener.document;
        var pdocEl = pdoc.documentElement;

        if (pdocEl.instantApply) {
          var panes = this.preferencePanes;
          for (var i = 0; i < panes.length; ++i)
            panes[i].writePreferences(true);
        } else {
          // Clone all the preferences elements from the child document and
          // insert them into the pane collection of the parent.
          if (pdocEl.localName == "prefwindow") {
            var currentPane = pdocEl.currentPane;
            var id = window.location.href + "#childprefs";
            var childPrefs = pdoc.getElementById(id);
            if (!childPrefs) {
              childPrefs = pdoc.createElement("preferences");
              currentPane.appendChild(childPrefs);
              childPrefs.id = id;
            }
            var panes = this.preferencePanes;
            for (var i = 0; i < panes.length; ++i) {
              var preferences = panes[i].preferences;
              for (var j = 0; j < preferences.length; ++j) {
                // Try to find a preference element for the same preference.
                var preference = null;
                var parentPreferences = pdoc.getElementsByTagName("preferences");
                for (var k = 0;
                     (k < parentPreferences.length && !preference); ++k) {
                  var parentPrefs = parentPreferences[k]
                                      .getElementsByAttribute(
                                        "name", preferences[j].name);
                  for (var l = 0;
                       (l < parentPrefs.length && !preference); ++l) {
                    if (parentPrefs[l].localName == "preference")
                      preference = parentPrefs[l];
                  }
                }
                if (!preference) {
                  // No matching preference in the parent window.
                  preference = pdoc.createElement("preference");
                  childPrefs.appendChild(preference);
                  preference.name     = preferences[j].name;
                  preference.type     = preferences[j].type;
                  preference.inverted = preferences[j].inverted;
                  preference.readonly = preferences[j].readonly;
                  preference.disabled = preferences[j].disabled;
                }
                preference.value = preferences[j].value;
              }
            }
          }
        }
      } else {
        var panes = this.preferencePanes;
        for (var i = 0; i < panes.length; ++i)
          panes[i].writePreferences(false);

        Services.prefs.savePrefFile(null);
      }

      window.close();
    }

    get _shouldAnimate() {
      var animate = false;
      try {
        animate = Services.prefs.getBoolPref("browser.preferences.animateFadeIn");
      } catch (e) {}
      return animate;
    }

    animate(aOldPane, aNewPane) {
      // if we are already resizing, use currentHeight
      var oldHeight = this._currentHeight
        ? this._currentHeight
        : aOldPane.contentHeight;

      this._multiplier = aNewPane.contentHeight > oldHeight ? 1 : -1;
      var sizeDelta = Math.abs(oldHeight - aNewPane.contentHeight);
      this._animateRemainder = sizeDelta % this._animateIncrement;

      this._setUpAnimationTimer(oldHeight);
    }

    _setUpAnimationTimer(aStartHeight) {
      if (!this._animateTimer)
        this._animateTimer = Cc["@mozilla.org/timer;1"]
                               .createInstance(Ci.nsITimer);
      else
        this._animateTimer.cancel();
      this._currentHeight = aStartHeight;

      this._animateTimer.initWithCallback(
        this, this._animateDelay, Ci.nsITimer.TYPE_REPEATING_SLACK);
    }

    _setUpFadeTimer() {
      if (!this._fadeTimer)
        this._fadeTimer = Cc["@mozilla.org/timer;1"]
                            .createInstance(Ci.nsITimer);
      else
        this._fadeTimer.cancel();

      this._fadeTimer.initWithCallback(
        this, this._fadeDelay, Ci.nsITimer.TYPE_REPEATING_SLACK);
    }

    notify(aTimer) {
      if (!document)
        aTimer.cancel();

      if (aTimer == this._animateTimer) {
        var increment = this._sizeIncrement;
        if (increment != 0) {
          window.innerHeight += increment;
          this._currentHeight += increment;
        } else {
          aTimer.cancel();
          this._setUpFadeTimer();
        }
      } else if (aTimer == this._fadeTimer) {
        var elt = document.getElementById(this.lastSelected);
        var newOpacity =
          parseFloat(window.getComputedStyle(elt).opacity) +
          this._fadeIncrement;
        if (newOpacity < 1.0)
          elt.style.opacity = newOpacity;
        else {
          aTimer.cancel();
          elt.style.opacity = 1.0;
        }
      }
    }

    get _sizeIncrement() {
      var lastSelectedPane = document.getElementById(this.lastSelected);
      var increment = this._animateIncrement * this._multiplier;
      var newHeight = this._currentHeight + increment;
      if ((this._multiplier > 0 &&
           this._currentHeight >= lastSelectedPane.contentHeight) ||
          (this._multiplier < 0 &&
           this._currentHeight <= lastSelectedPane.contentHeight))
        return 0;

      if ((this._multiplier > 0 &&
           newHeight > lastSelectedPane.contentHeight) ||
          (this._multiplier < 0 &&
           newHeight < lastSelectedPane.contentHeight))
        increment = this._animateRemainder * this._multiplier;
      return increment;
    }

    addPane(aPaneElement) {
      this.appendChild(aPaneElement);

      // Set up pane button
      this._makePaneButton(aPaneElement);
    }

    openSubDialog(aURL, aFeatures, aParams) {
      return openDialog(aURL, "",
        "modal,centerscreen,resizable=no" +
        (aFeatures != "" ? ("," + aFeatures) : ""), aParams);
    }

    openWindow(aWindowType, aURL, aFeatures, aParams) {
      var wm = Cc["@mozilla.org/appshell/window-mediator;1"]
                 .getService(Ci.nsIWindowMediator);
      var win = aWindowType ? wm.getMostRecentWindow(aWindowType) : null;
      if (win) {
        if ("initWithParams" in win)
          win.initWithParams(aParams);
        win.focus();
      } else {
        var features = "resizable,dialog=no,centerscreen" +
          (aFeatures != "" ? ("," + aFeatures) : "");
        var parentWindow =
          (this.instantApply || !window.opener || window.opener.closed)
            ? window
            : window.opener;
        win = parentWindow.openDialog(aURL, "_blank", features, aParams);
      }
      return win;
    }
  }

  customElements.define("prefwindow", MozPrefWindow);
}