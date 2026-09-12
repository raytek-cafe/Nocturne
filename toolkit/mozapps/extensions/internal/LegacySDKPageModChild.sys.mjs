/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

export class LegacySDKPageModChild extends JSWindowActorChild {
  #sandboxes = new Map();
  #readySent = false;

  handleEvent(event) {
    if (event.type == "DOMContentLoaded" && event.target == this.document) {
      this.#documentReady();
    }
  }

  receiveMessage({ name, data }) {
    switch (name) {
      case "LegacySDKPageMod:Refresh":
        if (this.document.readyState != "loading") {
          this.sendAsyncMessage("LegacySDKPageMod:DocumentReady");
        }
        break;
      case "LegacySDKPageMod:Inject":
        this.#inject(data);
        break;
      case "LegacySDKPageMod:Remove":
        this.#remove(data.id);
        break;
      case "LegacySDKPageMod:DestroyAll":
        this.#destroySandboxes();
        break;
    }
  }

  didDestroy() {
    this.#destroySandboxes();
  }

  #documentReady() {
    if (this.#readySent) {
      return;
    }
    this.#readySent = true;
    this.sendAsyncMessage("LegacySDKPageMod:DocumentReady");
  }

  #inject({ id, addonId, files }) {
    if (this.#sandboxes.has(id)) {
      return;
    }

    const window = this.contentWindow;
    const sandbox = Cu.Sandbox(window, {
      sandboxName: `Legacy SDK content script for ${addonId}`,
      sandboxPrototype: window,
      sameZoneAs: window,
      wantComponents: false,
      wantExportHelpers: false,
      wantXrays: true,
    });
    this.#sandboxes.set(id, sandbox);

    try {
      for (const file of files) {
        Services.scriptloader.loadSubScriptWithOptions(file, {
          target: sandbox,
          charset: "UTF-8",
          allowUnsafeURL: true,
        });
      }
    } catch (error) {
      this.#remove(id);
      console.error(`Unable to load legacy SDK content scripts for ${addonId}`, error);
    }
  }

  #remove(id) {
    const sandbox = this.#sandboxes.get(id);
    if (!sandbox) {
      return;
    }
    this.#sandboxes.delete(id);
    Cu.nukeSandbox(sandbox);
  }

  #destroySandboxes() {
    for (const sandbox of this.#sandboxes.values()) {
      Cu.nukeSandbox(sandbox);
    }
    this.#sandboxes.clear();
  }
}
