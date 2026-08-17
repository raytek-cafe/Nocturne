/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * BrightworkProvider exposes installed Brightwork UI packages (custom omni.ja
 * archives) in the Add-ons Manager, as a native "brightwork" addon category.
 * It mirrors GMPProvider, but with a few tweaks to immitate webextension behavior.
 *
 * Because omni.ja is only consulted at startup, every operation requires a
 * restart. The enable/disable stuff just rewrites the pref and surfaces a pending state.
 * The changes take effect (and the startup cache is invalidated because of duhh reasons) on the next
 * launch.
 */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  AddonManager: "resource://gre/modules/AddonManager.sys.mjs",
  AddonManagerPrivate: "resource://gre/modules/AddonManager.sys.mjs",
  AppConstants: "resource://gre/modules/AppConstants.sys.mjs",
  NetUtil: "resource://gre/modules/NetUtil.sys.mjs",
});

ChromeUtils.defineLazyGetter(lazy, "l10n", function () {
  return new Localization(
    ["toolkit/about/aboutAddons.ftl", "branding/brand.ftl"],
    true
  );
});

const PACKAGES_DIRNAME = "packages";
const METADATA_FILE = "brightwork.json";
const ACTIVE_PREF = "browser.brightwork.active";
// Sent by BrightworkContentHandler when a bwpkg is downloaded from the net.
const MSG_INSTALL_FROM_WEB = "Brightwork:InstallFromWeb";

function brightworkDir() {
  return PathUtils.join(PathUtils.profileDir, "brightwork");
}
function packagesDir() {
  return PathUtils.join(brightworkDir(), PACKAGES_DIRNAME);
}

// A package id must be a single safe path segment. The native loader rejects
// anything else, so let's keep it consistent here as well!!
function slugify(name) {
  return (
    String(name || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "package"
  );
}

function promptRestartToApply() {
  try {
    let prompts = Services.prompt;
    let win =
      Services.wm.getMostRecentWindow("navigator:browser") ||
      Services.wm.getMostRecentWindow(null);
    let flags =
      prompts.BUTTON_POS_0 * prompts.BUTTON_TITLE_IS_STRING +
      prompts.BUTTON_POS_1 * prompts.BUTTON_TITLE_IS_STRING +
      prompts.BUTTON_POS_0_DEFAULT;
    let [title, message, restartLabel, laterLabel] = lazy.l10n.formatValuesSync([
      "brightwork-restart-prompt-title",
      "brightwork-restart-prompt-message",
      "brightwork-restart-prompt-restart-button",
      "brightwork-restart-prompt-later-button",
    ]);
    let choice = prompts.confirmEx(
      win,
      title,
      message,
      flags,
      restartLabel,
      laterLabel,
      null,
      null,
      {}
    );
    if (choice !== 0) {
      return;
    }
    // Alert about anything that may halt the quit (we're not monsters, right?)
    let cancel = Cc["@mozilla.org/supports-PRBool;1"].createInstance(
      Ci.nsISupportsPRBool
    );
    Services.obs.notifyObservers(cancel, "quit-application-requested", "restart");
    if (!cancel.data) {
      Services.startup.quit(
        Ci.nsIAppStartup.eAttemptQuit | Ci.nsIAppStartup.eRestart
      );
    }
  } catch (e) {
    console.error("Brightwork: restart prompt failed", e);
  }
}

/**
 * The addon-like object the Add-ons Manager UI renders. `meta` is the parsed
 * brightwork.json; `id` is the package directory name.
 */
class BrightworkWrapper {
  constructor(provider, id, meta) {
    this._provider = provider;
    this._id = id;
    this._meta = meta || {};
  }

  get id() {
    return this._id;
  }
  get type() {
    return "brightwork";
  }
  get isBrightwork() {
    return true;
  }
  get name() {
    return this._meta.name || this._id;
  }
  get version() {
    return this._meta.version || "0";
  }
  get description() {
    return this._meta.description || "";
  }
  get creator() {
    return this._meta.author
      ? new lazy.AddonManagerPrivate.AddonAuthor(this._meta.author)
      : null;
  }
  get homepageURL() {
    return this._meta.homepage || null;
  }
  get iconURL() {
    // The icon ships beside brightwork.json in the package dir; brightwork.json
    // stores just its basename. Let's resolve it to a file:// URL so the about:addons
    // card can load because of csp rules (we can disable those anyway).
    let icon = this._meta.icon;
    if (!icon || typeof icon !== "string") {
      return null;
    }
    let segments = icon
      .split(/[\\/]/)
      .filter(s => s && s !== "." && s !== "..");
    if (!segments.length) {
      return null;
    }
    return PathUtils.toFileURI(
      PathUtils.join(packagesDir(), this._id, ...segments)
    );
  }
  get scope() {
    return lazy.AddonManager.SCOPE_PROFILE;
  }
  get size() {
    return 0;
  }
  get blocklistState() {
    return Ci.nsIBlocklistService.STATE_NOT_BLOCKED;
  }
  get updateDate() {
    return null;
  }
  get isGMPlugin() {
    return false;
  }
  get isInstalled() {
    return true;
  }
  get install() {
    return null;
  }
  get installDate() {
    return null;
  }
  get isWebExtension() {
    return false;
  }
  // Additional surface the Add-ons Manager UI/update machinery reads, mirroring
  // GMPWrapper so the generic cards render without missing-property errors.
  get foreignInstall() {
    return false;
  }
  get isSystem() {
    return false;
  }
  get isBuiltin() {
    return false;
  }
  get hidden() {
    return false;
  }
  get seen() {
    return true;
  }
  get installTelemetryInfo() {
    return null;
  }
  get providesUpdatesSecurely() {
    return true;
  }
  get applyBackgroundUpdates() {
    return lazy.AddonManager.AUTOUPDATE_DISABLE;
  }
  get fullDescription() {
    return this._meta.description || "";
  }
  get optionsURL() {
    return null;
  }
  get sourceURI() {
    return null;
  }
  get userPermissions() {
    return null;
  }
  get installPermissions() {
    return null;
  }
  isCompatibleWith() {
    return true;
  }
  findUpdates(listener) {
    lazy.AddonManagerPrivate.callNoUpdateListeners(this, listener);
  }

  // Compatibility is the ABI, so the package's declared
  // brightworkAbi must match the running build's abi.
  get isCompatible() {
    return (
      Number(this._meta.brightworkAbi) === lazy.AppConstants.MOZ_BRIGHTWORK_ABI
    );
  }

  get isPlatformCompatible() {
    let platforms = this._meta.platforms;
    if (!Array.isArray(platforms) || !platforms.length) {
      return true;
    }
    return platforms.includes(lazy.AppConstants.platform);
  }
  get appDisabled() {
    return !this.isCompatible || !this.isPlatformCompatible;
  }

  // userDisabled reflects the active pref, but the toggle flips
  // immediately when the user acts, but we also reflect isActive for what is actually
  // loaded this session.
  get userDisabled() {
    return this._provider.desiredActiveId !== this._id;
  }
  set userDisabled(val) {
    if (val) {
      this._provider.setDesiredActive(null);
    } else {
      this._provider.setDesiredActive(this._id);
    }
  }
  get isActive() {
    return !this.appDisabled && this._provider.desiredActiveId === this._id;
  }

  async enable() {
    if (this.appDisabled) {
      return;
    }
    await this._provider.setDesiredActive(this._id);
  }
  async disable() {
    await this._provider.setDesiredActive(null);
  }
  async uninstall() {
    await this._provider.uninstall(this._id);
  }

  get pendingOperations() {
    if (this._provider.isUninstalling(this._id)) {
      return lazy.AddonManager.PENDING_UNINSTALL;
    }
    let desired = this._provider.desiredActiveId === this._id;
    let session = this._provider.sessionActiveId === this._id;
    if (desired && !session) {
      return lazy.AddonManager.PENDING_ENABLE;
    }
    if (!desired && session) {
      return lazy.AddonManager.PENDING_DISABLE;
    }
    return lazy.AddonManager.PENDING_NONE;
  }

  // Everything takes effect only on restart
  get operationsRequiringRestart() {
    return (
      lazy.AddonManager.OP_NEEDS_RESTART_ENABLE |
      lazy.AddonManager.OP_NEEDS_RESTART_DISABLE |
      lazy.AddonManager.OP_NEEDS_RESTART_UNINSTALL
    );
  }

  get permissions() {
    let perms = lazy.AddonManager.PERM_CAN_UNINSTALL;
    if (!this.appDisabled) {
      perms |= this.userDisabled
        ? lazy.AddonManager.PERM_CAN_ENABLE
        : lazy.AddonManager.PERM_CAN_DISABLE;
    }
    return perms;
  }

  get optionsType() {
    return null;
  }

  getFullDescription(doc) {
    let frag = doc.createDocumentFragment();
    let p = doc.createElementNS("http://www.w3.org/1999/xhtml", "p");
    let bits = [];
    if (!this.isCompatible) {
      bits.push(lazy.l10n.formatValueSync("brightwork-incompatible-description"));
    }
    if (!this.isPlatformCompatible) {
      bits.push(
        lazy.l10n.formatValueSync("brightwork-platform-incompatible-description")
      );
    }
    p.textContent = [this.description, ...bits].filter(Boolean).join("  ");
    frag.appendChild(p);
    return frag;
  }
}

export const BrightworkProvider = {
  _wrappers: new Map(),
  sessionActiveId: null,
  desiredActiveId: null,
  _uninstalling: new Set(),
  _startPromise: null,

  // Idempotent as AddonManager calls startup func during provider registration
  startup() {
    if (!this._startPromise) {
      this._startPromise = (async () => {
        try {
          if (!this._webInstallRegistered) {
            Services.ppmm.addMessageListener(MSG_INSTALL_FROM_WEB, this);
            this._webInstallRegistered = true;
          }

          this.sessionActiveId = this._readActive();
          this.desiredActiveId = this.sessionActiveId;
          await this._reload();
        } catch (e) {
          // Never let a profile-state hiccup reject the Add-ons Manager view.
          console.error("BrightworkProvider startup failed", e);
        }
      })();
    }
    return this._startPromise;
  },

  shutdown() {
    if (this._webInstallRegistered) {
      try {
        Services.ppmm.removeMessageListener(MSG_INSTALL_FROM_WEB, this);
      } catch (e) {}
      this._webInstallRegistered = false;
    }
    this._wrappers.clear();
    this._uninstalling.clear();
    this._startPromise = null;
  },

  // Parent-process handoff from the content handler.
  receiveMessage(msg) {
    if (msg.name === MSG_INSTALL_FROM_WEB) {
      this.installFromWeb(msg.data).catch(e =>
        console.error("Brightwork: web install failed", e)
      );
    }
  },

  async getAddonByID(id) {
    try {
      await this.startup();
      return this._wrappers.get(id) || null;
    } catch (e) {
      console.error("BrightworkProvider.getAddonByID failed", e);
      return null;
    }
  },

  async getAddonsByTypes(types) {
    if (types && !types.includes("brightwork")) {
      return [];
    }
    try {
      await this.startup();
      return Array.from(this._wrappers.values());
    } catch (e) {
      console.error("BrightworkProvider.getAddonsByTypes failed", e);
      return [];
    }
  },

  isUninstalling(id) {
    return this._uninstalling.has(id);
  },

  // internal state

  _readActive() {
    let id = Services.prefs.getStringPref(ACTIVE_PREF, "").trim();
    return id || null;
  },

  async _reload() {
    this._wrappers.clear();
    let dir = packagesDir();
    if (!(await IOUtils.exists(dir))) {
      return;
    }
    for (let child of await IOUtils.getChildren(dir)) {
      let info = await IOUtils.stat(child).catch(() => null);
      if (!info || info.type !== "directory") {
        continue;
      }
      let id = PathUtils.filename(child);
      let meta = await IOUtils.readJSON(PathUtils.join(child, METADATA_FILE)).catch(
        () => null
      );
      if (!meta) {
        continue;
      }
      this._wrappers.set(id, new BrightworkWrapper(this, id, meta));
    }
  },

  async setDesiredActive(id, { prompt = true } = {}) {
    let previous = this.desiredActiveId;
    if (previous === id) {
      return;
    }
    // Only one package can be active, so writing the single-valued pref implicitly disables whatever was active before.
    // This means we should flush prefs.js synchronously so the native loader sees the change on the next startup.
    Services.prefs.setStringPref(ACTIVE_PREF, id || "");
    try {
      Services.prefs.savePrefFile(null);
    } catch (e) {
      console.error("Brightwork: failed to flush prefs", e);
    }
    this.desiredActiveId = id;

    // Notify the UI for both the newly-toggled and previously-active packages.
    let toNotify = new Set([id, previous].filter(Boolean));
    for (let pid of toNotify) {
      let w = this._wrappers.get(pid);
      if (!w) {
        continue;
      }
      let enabling = w.userDisabled === false;
      lazy.AddonManagerPrivate.callAddonListeners(
        enabling ? "onEnabling" : "onDisabling",
        w,
        false
      );
      lazy.AddonManagerPrivate.callAddonListeners(
        enabling ? "onEnabled" : "onDisabled",
        w
      );
      lazy.AddonManagerPrivate.callAddonListeners("onPropertyChanged", w, [
        "userDisabled",
        "pendingOperations",
      ]);
    }

    // Offer to restart so the change applies now. Suppressed for callers (e.g.
    // uninstall) that drive their own flow and surface their own prompt.
    if (prompt) {
      promptRestartToApply();
    }
  },

  async uninstall(id) {
    let w = this._wrappers.get(id);
    if (!w) {
      return;
    }
    // Only a package that is actually loaded this session needs a restart to
    // get unloaded.
    let wasLoaded = this.sessionActiveId === id;
    lazy.AddonManagerPrivate.callAddonListeners("onUninstalling", w, false);
    if (this.desiredActiveId === id) {
      await this.setDesiredActive(null, { prompt: false });
    }
    await IOUtils.remove(PathUtils.join(packagesDir(), id), {
      recursive: true,
      ignoreAbsent: true,
    });
    this._wrappers.delete(id);
    lazy.AddonManagerPrivate.callAddonListeners("onUninstalled", w);

    if (wasLoaded) {
      promptRestartToApply();
    }
  },

  // --- install ------------------------------------------------------------

  /**
   * Install a package downloaded from the web (the content handler's hand-off).
   * Mirrors WebExtensions as in, warn about safety first, then download and install into the
   * profile. They're not automatically activated.
   */
  async installFromWeb({ uri, sourceHost, browsingContext }) {
    let host = sourceHost;
    if (!host) {
      try {
        host = Services.io.newURI(uri).host;
      } catch (e) {
        host = uri;
      }
    }

    let browser = browsingContext?.top?.embedderElement;
    let win =
      browser?.ownerGlobal ||
      Services.wm.getMostRecentWindow("navigator:browser") ||
      Services.wm.getMostRecentWindow(null);

    if (!(await this._confirmWebInstall(win, browser, host))) {
      return;
    }

    let tmp = PathUtils.join(
      PathUtils.tempDir,
      "brightwork-" + Date.now().toString(36) + ".zip"
    );
    try {
      let resp = await fetch(uri);
      if (!resp.ok) {
        throw new Error("HTTP " + resp.status);
      }
      await IOUtils.write(tmp, new Uint8Array(await resp.arrayBuffer()));
      await this.installFromPath(tmp);
    } catch (e) {
      let failTitle = lazy.l10n.formatValueSync("brightwork-install-failed-title");
      Services.prompt.alert(win, failTitle, e.message || String(e));
      return;
    } finally {
      await IOUtils.remove(tmp, { ignoreAbsent: true }).catch(() => {});
    }

    let [doneTitle, doneMessage] = lazy.l10n.formatValuesSync([
      "brightwork-web-installed-title",
      "brightwork-web-installed-message",
    ]);
    Services.prompt.alert(win, doneTitle, doneMessage);
  },

  /**
   * Resolve the install trust prompt to a boolean. anchored at the extensions button. 
   * This only falls back to a modal when there is no browser window.
   * Perhaps a way to exploit the browser? Not like everyone will use this anyway.
   */
  _confirmWebInstall(win, browser, host) {
    if (browser && win && browser.ownerGlobal === win && win.PopupNotifications) {
      return new Promise(resolve => {
        let [message, install, cancel] = lazy.l10n.formatMessagesSync([
          "brightwork-web-install-message",
          "brightwork-web-install-button",
          "brightwork-web-install-cancel-button",
        ]);
        let key = (m, name) => m.attributes?.find(a => a.name === name)?.value;

        let settled = false;
        let settle = v => {
          if (!settled) {
            settled = true;
            resolve(v);
          }
        };

        let anchor;
        try {
          anchor = win.gUnifiedExtensions?.getPopupAnchorID(browser, win);
        } catch (e) {}

        if (win.gUnifiedExtensions?.isEnabled) {
          win.gUnifiedExtensions.ensureButtonShownBeforeAttachingPanel?.(
            win.PopupNotifications.panel
          );
        }

        win.PopupNotifications.show(
          browser,
          "brightwork-web-install",
          message.value,
          anchor || null,
          {
            label: install.value,
            accessKey: key(install, "accesskey"),
            callback: () => settle(true),
          },
          [
            {
              label: cancel.value,
              accessKey: key(cancel, "accesskey"),
              callback: () => settle(false),
            },
          ],
          {
            // "<>" in the message is replaced with this, shown bold.
            name: host,
            popupIconURL: "chrome://global/skin/icons/warning.svg",
            persistent: true,
            removeOnDismissal: true,
            // Any action (dismissal, window close) that isn't an explicit
            // button counts as a installation cancel.
            eventCallback: topic => {
              if (topic === "removed") {
                settle(false);
              }
            },
          }
        );
      });
    }

    // Modal fallback
    let prompts = Services.prompt;
    let [title, message, installLabel, cancelLabel] = lazy.l10n.formatValuesSync(
      [
        "brightwork-web-install-title",
        "brightwork-web-install-message",
        "brightwork-web-install-button",
        "brightwork-web-install-cancel-button",
      ]
    );
    let flags =
      prompts.BUTTON_POS_0 * prompts.BUTTON_TITLE_IS_STRING +
      prompts.BUTTON_POS_1 * prompts.BUTTON_TITLE_IS_STRING +
      prompts.BUTTON_POS_1_DEFAULT;
    let choice = prompts.confirmEx(
      win || Services.wm.getMostRecentWindow(null),
      title,
      message.replace("<>", host),
      flags,
      installLabel,
      cancelLabel,
      null,
      null,
      {}
    );
    return Promise.resolve(choice === 0);
  },

  /**
   * Install a package from a folder of one.
   * Validates that brightwork.json + omni.ja are present. Returns the installed wrapper.
   */
  async installFromPath(path) {
    let lower = path.toLowerCase();
    let isZip = lower.endsWith(".zip") || lower.endsWith(".bwpkg");
    let staging = PathUtils.join(
      brightworkDir(),
      ".staging-" + Date.now().toString(36)
    );
    await IOUtils.makeDirectory(staging, {
      ignoreExisting: true,
      createAncestors: true,
    });
    try {
      if (isZip) {
        await this._extractZip(path, staging);
      } else {
        await IOUtils.copy(path, staging, { recursive: true });
        // copy of a folder creates staging/foldername and flatten if needed.
        staging = await this._flattenSingleChild(staging);
      }

      let meta = await IOUtils.readJSON(
        PathUtils.join(staging, METADATA_FILE)
      ).catch(() => null);

      if (meta) {
        await this._applyPlatformLayout(staging, meta);
      }

      let hasOmni = await IOUtils.exists(PathUtils.join(staging, "omni.ja"));
      if (!meta) {
        if (hasOmni) {
          throw new Error(
            lazy.l10n.formatValueSync(
              "brightwork-install-error-has-omni-no-metadata",
              { file: METADATA_FILE }
            )
          );
        }
        throw new Error(
          lazy.l10n.formatValueSync("brightwork-install-error-no-metadata", {
            file: METADATA_FILE,
          })
        );
      }
      if (!hasOmni) {
        throw new Error(
          lazy.l10n.formatValueSync("brightwork-install-error-no-omni", {
            file: METADATA_FILE,
          })
        );
      }

      let id = slugify(meta.name);
      let dest = PathUtils.join(packagesDir(), id);
      await IOUtils.makeDirectory(packagesDir(), {
        ignoreExisting: true,
        createAncestors: true,
      });
      await IOUtils.remove(dest, { recursive: true, ignoreAbsent: true });
      await IOUtils.move(staging, dest);
      staging = null;

      await this._reload();
      let wrapper = this._wrappers.get(id);
      if (wrapper) {
        lazy.AddonManagerPrivate.callInstallListeners(
          "onExternalInstall",
          null,
          wrapper,
          null,
          false
        );
        lazy.AddonManagerPrivate.callAddonListeners("onInstalling", wrapper, false);
        lazy.AddonManagerPrivate.callAddonListeners("onInstalled", wrapper);
      }
      return wrapper;
    } finally {
      if (staging) {
        await IOUtils.remove(staging, {
          recursive: true,
          ignoreAbsent: true,
        }).catch(() => {});
      }
    }
  },

  /**
   * Apply the multi-target layout for the running platform.
   */
  async _applyPlatformLayout(staging, meta) {
    let platform = lazy.AppConstants.platform; // "win" | "linux" | ...
    let platforms = Array.isArray(meta.platforms) ? meta.platforms : [];
    if (platforms.length && !platforms.includes(platform)) {
      throw new Error(
        lazy.l10n.formatValueSync("brightwork-install-error-platform", {
          platform,
          supported: platforms.join(", "),
        })
      );
    }

    let sub = PathUtils.join(staging, platform);
    if (!(await IOUtils.exists(PathUtils.join(sub, "omni.ja")))) {
      return; // already flat, or nothing to promote
    }
    await IOUtils.move(
      PathUtils.join(sub, "omni.ja"),
      PathUtils.join(staging, "omni.ja")
    );
    let subBrowser = PathUtils.join(sub, "browser");
    if (await IOUtils.exists(subBrowser)) {
      await IOUtils.move(subBrowser, PathUtils.join(staging, "browser"));
    }
    // Drop every per-platform subdir (incl. our now-emptied one); the installed
    // package only needs this machine's jars.
    for (let p of ["win", "linux", "macosx"]) {
      await IOUtils.remove(PathUtils.join(staging, p), {
        recursive: true,
        ignoreAbsent: true,
      });
    }
  },

  // If dir contains exactly one child directory (the common case for copying
  // a dist folder), return that child, otherwise, return dir unchanged.
  async _flattenSingleChild(dir) {
    let children = await IOUtils.getChildren(dir);
    if (children.length === 1) {
      let info = await IOUtils.stat(children[0]).catch(() => null);
      if (
        info &&
        info.type === "directory" &&
        (await IOUtils.exists(PathUtils.join(children[0], METADATA_FILE)))
      ) {
        return children[0];
      }
    }
    return dir;
  },

  async _extractZip(zipPath, destDir) {
    let ZipReader = Components.Constructor(
      "@mozilla.org/libjar/zip-reader;1",
      "nsIZipReader",
      "open"
    );
    let zipFile = await IOUtils.getFile(zipPath);
    let reader = new ZipReader(zipFile);
    try {
      let entries = [];
      let en = reader.findEntries("*");
      while (en.hasMore()) {
        entries.push(en.getNext());
      }
      // Strip a single shared top-level directory, so we end up with
      // omni.ja/brightwork.json at destDir root regardless of zip layout.
      let prefix = this._commonZipPrefix(entries);
      for (let entry of entries) {
        let rel = prefix ? entry.slice(prefix.length) : entry;
        if (!rel || rel.endsWith("/")) {
          continue;
        }
        let outPath = PathUtils.join(destDir, ...rel.split("/"));
        await IOUtils.makeDirectory(PathUtils.parent(outPath), {
          ignoreExisting: true,
          createAncestors: true,
        });
        let stream = reader.getInputStream(entry);
        let bytes = lazy.NetUtil.readInputStream(stream, stream.available());
        await IOUtils.write(outPath, new Uint8Array(bytes));
        stream.close();
      }
    } finally {
      reader.close();
    }
  },

  _commonZipPrefix(entries) {
    // Return a single leading dir/ shared by every entry, else "".
    let fileEntries = entries.filter(e => !e.endsWith("/"));
    if (!fileEntries.length) {
      return "";
    }
    let first = fileEntries[0];
    let slash = first.indexOf("/");
    if (slash < 0) {
      return "";
    }
    let prefix = first.slice(0, slash + 1);
    return fileEntries.every(e => e.startsWith(prefix)) ? prefix : "";
  },
};

lazy.AddonManagerPrivate.registerProvider(BrightworkProvider, ["brightwork"]);
