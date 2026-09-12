/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { AddonManagerPrivate } from "resource://gre/modules/AddonManager.sys.mjs";
import { LocalConduitConnection } from "resource://gre/modules/ConduitsParent.sys.mjs";
import { Extension } from "resource://gre/modules/Extension.sys.mjs";
import { ExtensionActivityLog } from "resource://gre/modules/ExtensionActivityLog.sys.mjs";
import { Messenger } from "resource://gre/modules/ExtensionChild.sys.mjs";
import { BaseContext } from "resource://gre/modules/ExtensionCommon.sys.mjs";

const reasonNames = new Map(
  Object.entries(AddonManagerPrivate.BOOTSTRAP_REASONS).map(([name, value]) => [
    value,
    name,
  ])
);

class LegacyExtensionContext extends BaseContext {
  constructor(extension) {
    super("legacy_extension", extension);
    this.viewType = "legacy";
    this.sandbox = Cu.Sandbox(this.principal, {
      sandboxName: `Legacy WebExtension messaging for ${extension.id}`,
      metadata: { addonID: extension.id },
    });
    this.connection = new LocalConduitConnection(extension.id, extension.baseURL);
    this.nextConduitId = 0;
    this.callOnClose(this.connection);
    this.messenger = new Messenger(this, this.contextId);
    this.api = {
      browser: {
        runtime: {
          onConnect: this.messenger.onConnect.api(),
          onMessage: this.messenger.onMessage.api(),
        },
      },
    };
  }

  get principal() {
    return Services.scriptSecurityManager.getSystemPrincipal();
  }

  get cloneScope() {
    return this.sandbox;
  }

  openConduit(subject, address) {
    return this.connection.openConduit(subject, {
      ...address,
      id: `${this.extension.id}.legacy.${this.contextId}.${++this.nextConduitId}`,
    });
  }

  logActivity(type, name, data) {
    ExtensionActivityLog.log(this.extension.id, this.viewType, type, name, data);
  }

  unload() {
    if (this.unloaded) {
      return;
    }
    super.unload();
    this.active = false;
    Cu.nukeSandbox(this.sandbox);
    this.sandbox = null;
    if (this.jsonSandbox) {
      Cu.nukeSandbox(this.jsonSandbox);
      this.jsonSandbox = null;
    }
  }
}

export class LegacyEmbeddedExtension {
  constructor() {
    this.extension = null;
    this.context = null;
    this.startupComplete = null;
  }

  startup(data, reason) {
    if (this.extension) {
      return Promise.reject(new Error("The embedded WebExtension has already started"));
    }
    const extension = new Extension(
      {
        ...data,
        resourceURI: Services.io.newURI("webextension/", null, data.resourceURI),
      },
      reasonNames.get(reason)
    );
    this.extension = extension;
    const ready = Promise.withResolvers();
    const onStartup = () => {
      extension.off("startup", onStartup);
      try {
        const context = new LegacyExtensionContext(extension);
        this.context = context;
        extension.callOnClose(context);
        ready.resolve(context.api);
      } catch (error) {
        ready.reject(error);
        throw error;
      }
    };
    // Bootstrap must attach its listeners before the background page can send
    // migration messages, not after extension.startup() has completed.
    extension.on("startup", onStartup);
    this.startupComplete = extension.startup();
    this.startupComplete.catch(error => {
      extension.off("startup", onStartup);
      ready.reject(error);
    });
    return ready.promise;
  }

  async shutdown(reason) {
    const extension = this.extension;
    if (!extension) {
      return;
    }
    this.extension = null;
    try {
      if (!extension.hasShutdown) {
        await extension.shutdown(reasonNames.get(reason));
      }
    } finally {
      this.context?.unload();
      this.context = null;
      this.startupComplete = null;
    }
  }

  uninstall(data, reason) {
    if (reason === AddonManagerPrivate.BOOTSTRAP_REASONS.ADDON_UNINSTALL) {
      Extension.getBootstrapScope().uninstall(data);
    }
  }
}
