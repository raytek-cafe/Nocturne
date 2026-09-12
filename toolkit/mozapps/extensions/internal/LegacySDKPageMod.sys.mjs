/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const ACTOR_NAME = "LegacySDKPageMod";
const CHILD_URI =
  "resource://gre/modules/addons/LegacySDKPageModChild.sys.mjs";
const PARENT_URI = "resource://gre/modules/addons/LegacySDKPageMod.sys.mjs";

const pageMods = new Map();
const actors = new Set();
let nextPageModId = 0;
let actorRegistered = false;

function registerActor() {
  if (actorRegistered) {
    return;
  }

  ChromeUtils.registerWindowActor(ACTOR_NAME, {
    matches: ["http://*/*", "https://*/*"],
    parent: { esModuleURI: PARENT_URI },
    child: {
      esModuleURI: CHILD_URI,
      events: { DOMContentLoaded: {} },
    },
  });
  actorRegistered = true;
}

function refreshCurrentDocuments() {
  for (const window of Services.wm.getEnumerator("navigator:browser")) {
    for (const browser of window.gBrowser?.browsers ?? []) {
      const windowGlobal = browser.browsingContext?.currentWindowGlobal;
      if (
        !windowGlobal ||
        (!windowGlobal.documentURI.schemeIs("http") &&
          !windowGlobal.documentURI.schemeIs("https"))
      ) {
        continue;
      }
      try {
        windowGlobal
          .getActor(ACTOR_NAME)
          .sendAsyncMessage("LegacySDKPageMod:Refresh");
      } catch (error) {
        console.error("Unable to refresh a legacy SDK page-mod actor", error);
      }
    }
  }
}

function normalizeIncludes(include) {
  const includes = Array.isArray(include) ? include : [include];
  if (!includes.length || includes.some(pattern => typeof pattern != "string")) {
    throw new TypeError("PageMod include must be a string or a non-empty array");
  }
  return includes;
}

function matchesInclude(urlString, patterns) {
  let url;
  try {
    url = new URL(urlString);
  } catch (_) {
    return false;
  }

  for (const pattern of patterns) {
    if (pattern == "*") {
      return true;
    }

    // Add-on SDK host patterns without a scheme match HTTP and HTTPS. A
    // leading "*." includes both the named host and its subdomains.
    if (!pattern.includes("://")) {
      const host = pattern.startsWith("*.") ? pattern.slice(2) : pattern;
      if (
        (url.protocol == "http:" || url.protocol == "https:") &&
        (url.hostname == host ||
          (pattern.startsWith("*.") && url.hostname.endsWith(`.${host}`)))
      ) {
        return true;
      }
      continue;
    }

    const expression = pattern
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replaceAll("*", ".*");
    if (new RegExp(`^${expression}$`).test(urlString)) {
      return true;
    }
  }
  return false;
}

function resolveContentScripts(rootURI, contentScriptFile) {
  const root =
    typeof rootURI == "string" ? Services.io.newURI(rootURI) : rootURI;
  if (!root?.spec) {
    throw new TypeError("PageMod rootURI must be an nsIURI or URI string");
  }

  const files = Array.isArray(contentScriptFile)
    ? contentScriptFile
    : [contentScriptFile];
  if (!files.length || files.some(file => typeof file != "string")) {
    throw new TypeError("PageMod contentScriptFile must name at least one file");
  }

  return files.map(file => {
    const uri = Services.io.newURI(file, null, root);
    if (!uri.spec.startsWith(root.spec)) {
      throw new Error(`PageMod content script is outside the add-on: ${uri.spec}`);
    }
    return uri.spec;
  });
}

export class LegacySDKPageModParent extends JSWindowActorParent {
  actorCreated() {
    actors.add(this);
  }

  didDestroy() {
    actors.delete(this);
  }

  receiveMessage({ name }) {
    if (name != "LegacySDKPageMod:DocumentReady") {
      return;
    }

    const { browsingContext } = this;
    if (browsingContext.parent) {
      return;
    }

    const url = browsingContext.currentWindowGlobal?.documentURI?.spec;
    if (!url) {
      return;
    }

    const isPrivate = browsingContext.usePrivateBrowsing;
    for (const pageMod of pageMods.values()) {
      if (
        (!isPrivate || pageMod.privateBrowsingAllowed) &&
        matchesInclude(url, pageMod.include)
      ) {
        this.sendAsyncMessage("LegacySDKPageMod:Inject", {
          id: pageMod.id,
          addonId: pageMod.addonId,
          files: pageMod.files,
        });
      }
    }
  }
}

export class LegacySDKPageMod {
  constructor(addonId, rootURI, options, privateBrowsingAllowed = false) {
    if (options?.attachTo != "top" || options?.contentScriptWhen != "ready") {
      throw new Error(
        "Legacy SDK PageMod only supports attachTo 'top' and contentScriptWhen 'ready'"
      );
    }

    this.id = `${addonId}:${++nextPageModId}`;
    this.destroyed = false;
    pageMods.set(this.id, {
      id: this.id,
      addonId,
      include: normalizeIncludes(options.include),
      files: resolveContentScripts(rootURI, options.contentScriptFile),
      privateBrowsingAllowed: !!privateBrowsingAllowed,
    });

    try {
      registerActor();
      refreshCurrentDocuments();
    } catch (error) {
      pageMods.delete(this.id);
      throw error;
    }
  }

  destroy() {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    pageMods.delete(this.id);

    for (const actor of actors) {
      actor.sendAsyncMessage("LegacySDKPageMod:Remove", { id: this.id });
    }

    if (!pageMods.size && actorRegistered) {
      for (const actor of actors) {
        actor.sendAsyncMessage("LegacySDKPageMod:DestroyAll");
      }
      ChromeUtils.unregisterWindowActor(ACTOR_NAME);
      actorRegistered = false;
      actors.clear();
    }
  }
}
