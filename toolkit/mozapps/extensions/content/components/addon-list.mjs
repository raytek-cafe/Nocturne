/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  AddonManagerListenerHandler,
  isPending,
  isPendingRestartInstall,
  shouldSkipAnimations,
} from "../aboutaddons-utils.mjs";

const { AddonManager } = ChromeUtils.importESModule(
  "resource://gre/modules/AddonManager.sys.mjs"
);

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  // eslint-disable-next-line mozilla/no-browser-refs-in-toolkit
  BuiltInThemes: "resource:///modules/BuiltInThemes.sys.mjs",
  recordListViewTelemetry: "chrome://global/content/ml/Utils.sys.mjs",
});

/**
 * A list view for add-ons of a certain type. It should be initialized with the
 * type of add-on to render and have section data set before being connected to
 * the document.
 *
 *    let list = document.createElement("addon-list");
 *    list.type = "plugin";
 *    list.setSections([{
 *      headingId: "plugin-section-heading",
 *      filterFn: addon => !addon.isSystem,
 *    }]);
 *    document.body.appendChild(list);
 */
export class AddonList extends HTMLElement {
  constructor() {
    super();
    this.sections = [];
    this.pendingUninstallAddons = new Set();
    this._addonsToUpdate = new Set();
    this._userFocusListenersAdded = false;
    this._listeningForInstallUpdates = false;
  }

  async connectedCallback() {
    // Register the listener and get the add-ons, these operations should
    // happpen as close to each other as possible.
    this.registerListener();
    // Don't render again if we were rendered prior to being inserted.
    if (!this.children.length) {
      // Render the initial view.
      this.render();
    }
  }

  disconnectedCallback() {
    // Remove content and stop listening until this is connected again.
    this.textContent = "";
    this.removeListener();

    // Process any pending uninstall related to this list.
    for (const addon of this.pendingUninstallAddons) {
      if (
        isPending(addon, "uninstall") &&
        !(
          addon.operationsRequiringRestart &
          AddonManager.OP_NEEDS_RESTART_UNINSTALL
        )
      ) {
        Promise.resolve(addon.uninstall()).catch(Cu.reportError);
      }
    }
    this.pendingUninstallAddons.clear();
  }

  /**
   * Configure the sections in the list.
   *
   * Warning: if filterFn uses criteria that are not tied to add-on events,
   * make sure to add an implementation that calls updateAddon(addon) as
   * needed. Not doing so can result in missing or out-of-date add-on cards!
   *
   * @param {object[]} sections
   *        The options for the section. Each entry in the array should have:
   *          headingId: The fluent id for the section's heading.
   *          filterFn: A function that determines if an add-on belongs in
   *                    the section.
   */
  setSections(sections) {
    this.sections = sections.map(section => Object.assign({}, section));
  }

  /**
   * Set the add-on type for this list. This will be used to filter the add-ons
   * that are displayed.
   *
   * @param {string} val The type to filter on.
   */
  set type(val) {
    this.setAttribute("type", val);
  }

  get type() {
    return this.getAttribute("type");
  }

  getSection(index) {
    return this.sections[index].node;
  }

  getCards(section) {
    return section.querySelectorAll("addon-card");
  }

  getCard(addon) {
    return this.querySelector(`addon-card[addon-id="${addon.id}"]`);
  }

  getPendingUninstallBar(addon) {
    return this.querySelector(`moz-message-bar[addon-id="${addon.id}"]`);
  }

  sortByFn(aAddon, bAddon) {
    return aAddon.name.localeCompare(bAddon.name);
  }
  isAddonForList(addon) {
    if (this.type === "all") {
      return true;
    }
    if (this.type === "xul-theme") {
      return addon.type === "extension" && addon.isXULTheme;
    }
    if (this.type === "extension") {
      return addon.type === "extension" && !addon.isXULTheme;
    }
    return addon.type === this.type;
  }

  async getAddons() {
    if (!this.type) {
      throw new Error(`type must be set to find add-ons`);
    }

    // XUL themes use the extension provider but have their own UI list type.
    let providerType = this.type === "xul-theme" ? "extension" : this.type;
    let type = providerType == "all" ? null : [providerType];
    let [addons, installs] = await Promise.all([
      AddonManager.getAddonsByTypes(type),
      this.type === "xul-theme"
        ? AddonManager.getAllInstalls()
        : AddonManager.getInstallsByTypes(type),
    ]);
    const addonIds = new Set(addons.map(addon => addon.id));
    for (const install of installs) {
      if (
        install.state === AddonManager.STATE_INSTALLED &&
        install.addon &&
        !addonIds.has(install.addon.id)
      ) {
        addons.push(install.addon);
        addonIds.add(install.addon.id);
      }
    }
    addons = addons.filter(addon => this.isAddonForList(addon));

    if (type == "theme") {
      await lazy.BuiltInThemes.ensureBuiltInThemes();
    }

    if (type == "mlmodel") {
      lazy.recordListViewTelemetry(addons.length);
    }

    // Put the add-ons into the sections, an add-on goes in the first section
    // that it matches the filterFn for. It might not go in any section.
    let sectionedAddons = this.sections.map(() => []);
    for (let addon of addons) {
      let index = this.sections.findIndex(({ filterFn }) => filterFn(addon));
      if (index != -1) {
        sectionedAddons[index].push(addon);
      } else if (isPending(addon, "uninstall")) {
        // A second tab may be opened on "about:addons" (or Firefox may
        // have crashed) while there are still "pending uninstall" add-ons.
        // Ensure to list them in the pendingUninstall message-bar-stack
        // when the AddonList is initially rendered.
        this.pendingUninstallAddons.add(addon);
      }
    }

    // Sort the add-ons in each section.
    for (let [index, section] of sectionedAddons.entries()) {
      let sortByFn = this.sections[index].sortByFn || this.sortByFn;
      section.sort(sortByFn);
    }

    return sectionedAddons;
  }

  createPendingUninstallStack() {
    const stack = document.createElement("message-bar-stack");
    stack.setAttribute("class", "pending-uninstall");
    stack.setAttribute("reverse", "");
    return stack;
  }

  addPendingUninstallBar(addon) {
    const stack = this.pendingUninstallStack;
    const mb = document.createElement("moz-message-bar");
    mb.setAttribute("addon-id", addon.id);
    mb.setAttribute("type", "info");

    const undo = document.createElement("button");
    undo.setAttribute("action", "undo");
    undo.addEventListener("click", () => {
      Promise.resolve(addon.cancelUninstall()).catch(Cu.reportError);
    });
    undo.setAttribute("slot", "actions");

    const messageId =
      addon.operationsRequiringRestart & AddonManager.OP_NEEDS_RESTART_UNINSTALL
        ? "pending-uninstall-restart-description"
        : "pending-uninstall-description2";
    document.l10n.setAttributes(mb, messageId, {
      addon: addon.name,
    });
    mb.setAttribute("data-l10n-attrs", "message");
    document.l10n.setAttributes(undo, "pending-uninstall-undo-button");

    mb.appendChild(undo);
    stack.append(mb);
  }

  removePendingUninstallBar(addon) {
    const messagebar = this.getPendingUninstallBar(addon);
    if (messagebar) {
      messagebar.remove();
    }
  }
  createRestartBar() {
    const message = document.createElement("moz-message-bar");
    message.className = "xul-theme-restart";
    message.setAttribute("type", "warning");
    message.hidden = true;
    document.l10n.setAttributes(message, "xul-theme-restart-required-message");

    const restart = document.createElement("button");
    restart.setAttribute("slot", "actions");
    restart.setAttribute("action", "restart");
    document.l10n.setAttributes(restart, "addon-page-restart");
    restart.addEventListener("click", () => {
      const cancel = Cc["@mozilla.org/supports-PRBool;1"].createInstance(
        Ci.nsISupportsPRBool
      );
      Services.obs.notifyObservers(
        cancel,
        "quit-application-requested",
        "restart"
      );
      if (!cancel.data) {
        Services.startup.quit(
          Ci.nsIAppStartup.eAttemptQuit | Ci.nsIAppStartup.eRestart
        );
      }
    });
    message.append(restart);
    return message;
  }

  async updateRestartBar() {
    if (!this.restartBar) {
      return;
    }
    const [addons, installs] = await Promise.all([
      AddonManager.getAddonsByTypes(["extension"]),
      AddonManager.getAllInstalls(),
    ]);
    const needsRestart = addon =>
      addon.isXULTheme &&
      !!(
        (addon.pendingOperations & AddonManager.PENDING_UNINSTALL &&
          addon.operationsRequiringRestart &
            AddonManager.OP_NEEDS_RESTART_UNINSTALL) ||
        (addon.pendingOperations & AddonManager.PENDING_ENABLE &&
          addon.operationsRequiringRestart &
            AddonManager.OP_NEEDS_RESTART_ENABLE) ||
        (addon.pendingOperations & AddonManager.PENDING_DISABLE &&
          addon.operationsRequiringRestart &
            AddonManager.OP_NEEDS_RESTART_DISABLE)
      );
    this.restartBar.hidden = !(
      addons.some(needsRestart) ||
      installs.some(
        install =>
          install.state === AddonManager.STATE_INSTALLED &&
          install.addon?.isXULTheme
      )
    );
  }

  createSectionHeading(headingIndex) {
    let { headingId, subheadingId } = this.sections[headingIndex];
    let frag = document.createDocumentFragment();
    let heading = document.createElement("h2");
    heading.classList.add("list-section-heading");
    document.l10n.setAttributes(heading, headingId);
    frag.append(heading);

    if (subheadingId) {
      heading.className = "header-name";
      let subheading = document.createElement("h3");
      subheading.classList.add("list-section-subheading");
      document.l10n.setAttributes(subheading, subheadingId);
      frag.append(subheading);
    }

    return frag;
  }

  createEmptyListMessage() {
    let emptyMessage = "list-empty-get-extensions-message";
    let linkPref = "extensions.getAddons.link.url";

    if (this.sections && this.sections.length) {
      if (this.sections[0].headingId == "locale-enabled-heading") {
        emptyMessage = "list-empty-get-language-packs-message";
        linkPref = "browser.dictionaries.download.url";
      } else if (this.sections[0].headingId == "dictionary-enabled-heading") {
        emptyMessage = "list-empty-get-dictionaries-message";
        linkPref = "browser.dictionaries.download.url";
      }
    }

    if (this.type === "xul-theme") {
      let messageContainer = document.createElement("p");
      messageContainer.id = "empty-addons-message";
      document.l10n.setAttributes(messageContainer, "xul-theme-empty-message");
      return messageContainer;
    }

    let messageContainer = document.createElement("p");
    messageContainer.id = "empty-addons-message";
    let a = document.createElement("a");
    a.href = Services.urlFormatter.formatURLPref(linkPref);
    a.setAttribute("target", "_blank");
    a.setAttribute("data-l10n-name", "get-extensions");
    document.l10n.setAttributes(messageContainer, emptyMessage, {
      domain: a.hostname,
    });
    messageContainer.appendChild(a);
    return messageContainer;
  }

  updateSectionIfEmpty(section) {
    // Clear the entire list if there are no `addon-card` childrens.
    if (!section.querySelectorAll("addon-card").length) {
      section.textContent = "";
    }
  }

  insertCardInto(card, sectionIndex) {
    let section = this.getSection(sectionIndex);
    let sectionCards = this.getCards(section);

    // If this is the first card in the section, create the heading.
    if (!sectionCards.length) {
      section.appendChild(this.createSectionHeading(sectionIndex));
    }

    // Find where to insert the card.
    let insertBefore = Array.from(sectionCards).find(
      otherCard => this.sortByFn(card.addon, otherCard.addon) < 0
    );
    // This will append if insertBefore is null.
    section.insertBefore(card, insertBefore || null);
  }

  addAddon(addon) {
    // Only insert add-ons belonging to this UI list.
    if (!this.isAddonForList(addon)) {
      this.sendEvent("skip-add", "type-mismatch");
      return;
    }

    let insertSection = this._addonSectionIndex(addon);

    // Don't add the add-on if it doesn't go in a section.
    if (insertSection == -1) {
      return;
    }

    // Create and insert the card.
    let card = document.createElement("addon-card");
    card.setAddon(addon);
    this.insertCardInto(card, insertSection);
    this.sendEvent("add", { id: addon.id });
  }

  sendEvent(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }

  removeAddon(addon) {
    let card = this.getCard(addon);
    if (card) {
      let section = card.parentNode;
      card.remove();
      this.updateSectionIfEmpty(section);
      this.sendEvent("remove", { id: addon.id });
    }
  }

  updateAddon(addon) {
    if (!this.getCard(addon)) {
      // Try to add the add-on right away.
      this.addAddon(addon);
    } else if (this._addonSectionIndex(addon) == -1) {
      // Try to remove the add-on right away.
      this._updateAddon(addon);
    } else if (this.isUserFocused && this.type !== "xul-theme") {
      // Queue up a change for when the focus is cleared.
      this.updateLater(addon);
    } else {
      // Not currently focused, make the change now.
      this.withCardAnimation(() => this._updateAddon(addon));
    }
  }

  updateLater(addon) {
    this._addonsToUpdate.add(addon);
    this._addUserFocusListeners();
  }

  _addUserFocusListeners() {
    if (this._userFocusListenersAdded) {
      return;
    }

    this._userFocusListenersAdded = true;
    this.addEventListener("mouseleave", this);
    this.addEventListener("hidden", this, true);
    this.addEventListener("focusout", this);
  }

  _removeUserFocusListeners() {
    if (!this._userFocusListenersAdded) {
      return;
    }

    this.removeEventListener("mouseleave", this);
    this.removeEventListener("hidden", this, true);
    this.removeEventListener("focusout", this);
    this._userFocusListenersAdded = false;
  }

  get hasMenuOpen() {
    return !!this.querySelector("panel-list[open]");
  }

  get isUserFocused() {
    return this.matches(":hover, :focus-within") || this.hasMenuOpen;
  }

  update() {
    if (this._addonsToUpdate.size) {
      this.withCardAnimation(() => {
        for (let addon of this._addonsToUpdate) {
          this._updateAddon(addon);
        }
        this._addonsToUpdate = new Set();
      });
    }
  }

  _getChildCoords() {
    let results = new Map();
    for (let child of this.querySelectorAll("addon-card")) {
      results.set(child, child.getBoundingClientRect());
    }
    return results;
  }

  withCardAnimation(changeFn) {
    if (shouldSkipAnimations()) {
      changeFn();
      return;
    }

    let origChildCoords = this._getChildCoords();

    changeFn();

    let newChildCoords = this._getChildCoords();
    let cards = this.querySelectorAll("addon-card");
    let transitionCards = [];
    for (let card of cards) {
      let orig = origChildCoords.get(card);
      let moved = newChildCoords.get(card);
      let changeY = moved.y - (orig || moved).y;
      let cardEl = card.firstElementChild;

      if (changeY != 0) {
        cardEl.style.transform = `translateY(${changeY * -1}px)`;
        transitionCards.push(card);
      }
    }
    requestAnimationFrame(() => {
      for (let card of transitionCards) {
        card.firstElementChild.style.transition = "transform 125ms";
      }

      requestAnimationFrame(() => {
        for (let card of transitionCards) {
          let cardEl = card.firstElementChild;
          cardEl.style.transform = "";
          cardEl.addEventListener("transitionend", function handler(e) {
            if (e.target == cardEl && e.propertyName == "transform") {
              cardEl.style.transition = "";
              cardEl.removeEventListener("transitionend", handler);
            }
          });
        }
      });
    });
  }

  _addonSectionIndex(addon) {
    return this.sections.findIndex(s => s.filterFn(addon));
  }

  _updateAddon(addon) {
    if (this._listeningForInstallUpdates) {
      // For stability of the UI, do not remove the card from the updates view
      // when it is already there, even when an update is installed.
      return;
    }
    let card = this.getCard(addon);
    if (card) {
      let sectionIndex = this._addonSectionIndex(addon);
      if (sectionIndex != -1) {
        // Move the card, if needed. This will allow an animation between
        // page sections and provides clearer events for testing.
        if (card.parentNode.getAttribute("section") != sectionIndex) {
          let { activeElement } = document;
          let refocus = card.contains(activeElement);
          let oldSection = card.parentNode;
          this.insertCardInto(card, sectionIndex);
          this.updateSectionIfEmpty(oldSection);
          if (refocus) {
            activeElement.focus();
          }
          this.sendEvent("move", { id: addon.id });
        }
      } else {
        this.removeAddon(addon);
      }
    }
  }

  renderSection(addons, index) {
    const { sectionClass } = this.sections[index];

    let section = document.createElement("section");
    section.setAttribute("section", index);
    if (sectionClass) {
      section.setAttribute("class", sectionClass);
    }

    // Render the heading and add-ons if there are any, except for mlmodel list
    // view which only shows installed models.
    if (this.type != "mlmodel" && addons.length) {
      section.appendChild(this.createSectionHeading(index));
    }

    for (let addon of addons) {
      let card = document.createElement("addon-card");
      card.setAddon(addon);
      card.render();
      section.appendChild(card);
    }

    return section;
  }

  async render() {
    this.textContent = "";

    let sectionedAddons = await this.getAddons();

    let frag = document.createDocumentFragment();

    // Render the pending uninstall message-bar-stack.
    this.pendingUninstallStack = this.createPendingUninstallStack();
    for (let addon of this.pendingUninstallAddons) {
      this.addPendingUninstallBar(addon);
    }
    if (this.type === "xul-theme") {
      this.restartBar = this.createRestartBar();
      frag.appendChild(this.restartBar);
      this.updateRestartBar().catch(Cu.reportError);
    }

    frag.appendChild(this.pendingUninstallStack);

    if (this.type == "mlmodel") {
      frag.appendChild(document.createElement("mlmodel-list-intro"));
    }

    // Render the sections.
    for (let i = 0; i < sectionedAddons.length; i++) {
      this.sections[i].node = this.renderSection(sectionedAddons[i], i);
      frag.appendChild(this.sections[i].node);
    }

    // Add the "empty list message" elements (but omit it in the list view
    // related to the "mlmodel" type).
    if (this.type != "mlmodel") {
      // Render the placeholder that is shown when all sections are empty.
      // This call is after rendering the sections, because its visibility
      // is controlled through the general sibling combinator relative to
      // the sections (section ~).
      let message = this.createEmptyListMessage();
      frag.appendChild(message);
    }

    // Make sure fluent has set all the strings before we render. This will
    // avoid the height changing as strings go from 0 height to having text.
    await document.l10n.translateFragment(frag);
    this.appendChild(frag);
  }

  registerListener() {
    AddonManagerListenerHandler.addListener(this);
  }

  removeListener() {
    AddonManagerListenerHandler.removeListener(this);
  }

  handleEvent(e) {
    if (!this.isUserFocused || (e.type == "mouseleave" && !this.hasMenuOpen)) {
      this._removeUserFocusListeners();
      this.update();
    }
  }

  /**
   * AddonManager listener events.
   */

  onOperationCancelled(addon) {
    if (
      this.pendingUninstallAddons.has(addon) &&
      !isPending(addon, "uninstall")
    ) {
      this.pendingUninstallAddons.delete(addon);
      this.removePendingUninstallBar(addon);
    }
    this.updateAddon(addon);
    this.updateRestartBar().catch(Cu.reportError);
  }

  onPropertyChanged(addon, properties) {
    if (
      this.type === "xul-theme" &&
      properties.some(property =>
        ["userDisabled", "appDisabled"].includes(property)
      )
    ) {
      this.updateAddon(addon);
      this.updateRestartBar().catch(Cu.reportError);
    }
  }

  onEnabling(addon) {
    this.updateAddon(addon);
    this.updateRestartBar().catch(Cu.reportError);
  }

  onDisabling(addon) {
    this.updateAddon(addon);
    this.updateRestartBar().catch(Cu.reportError);
  }

  onEnabled(addon) {
    this.updateAddon(addon);
    this.updateRestartBar().catch(Cu.reportError);
  }

  onDisabled(addon) {
    this.updateAddon(addon);
    this.updateRestartBar().catch(Cu.reportError);
  }

  onUninstalling(addon) {
    if (isPending(addon, "uninstall") && this.isAddonForList(addon)) {
      this.pendingUninstallAddons.add(addon);
      this.addPendingUninstallBar(addon);
      this.updateAddon(addon);
    }
    this.updateRestartBar().catch(Cu.reportError);
  }

  onInstalled(addon) {
    this.updateAddon(addon);
    this.updateRestartBar().catch(Cu.reportError);
  }

  onInstallEnded(install) {
    if (isPendingRestartInstall(install)) {
      this.updateAddon(install.addon);
    }
    this.updateRestartBar().catch(Cu.reportError);
  }

  onInstallCancelled(install) {
    if (!install.existingAddon && install.addon) {
      const card = this.getCard(install.addon);
      if (card?.addon === install.addon) {
        this.removeAddon(install.addon);
      }
    }
    this.updateRestartBar().catch(Cu.reportError);
  }

  onUninstalled(addon) {
    this.pendingUninstallAddons.delete(addon);
    this.removePendingUninstallBar(addon);
    this.removeAddon(addon);
    this.updateRestartBar().catch(Cu.reportError);
  }

  onNewInstall(install) {
    if (this._listeningForInstallUpdates) {
      this._updateOnNewInstall(install);
    }
    this.updateRestartBar().catch(Cu.reportError);
  }

  onInstallPostponed(install) {
    if (this._listeningForInstallUpdates) {
      this._updateOnNewInstall(install);
    }
    this.updateRestartBar().catch(Cu.reportError);
  }

  listenForUpdates() {
    this._listeningForInstallUpdates = true;
  }

  async _updateOnNewInstall(install) {
    if (!install.existingAddon) {
      // Not from an update check.
      return;
    }
    // install.existingAddon can differ from the actual add-on (bug 2007749).
    // To make sure that we use the real, live add-on state, look it up again.
    const addon = await AddonManager.getAddonByID(install.existingAddon.id);
    if (addon) {
      this.updateAddon(addon);
    }
  }
}
customElements.define("addon-list", AddonList);
