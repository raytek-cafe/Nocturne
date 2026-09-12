/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const { AddonManager } = ChromeUtils.importESModule(
  "resource://gre/modules/AddonManager.sys.mjs"
);
const { NetUtil } = ChromeUtils.importESModule(
  "resource://gre/modules/NetUtil.sys.mjs"
);

const COMMAND_TOPIC = "legacy-sdk-preference-command";

function readURI(uri) {
  const channel = NetUtil.newChannel({ uri, loadUsingSystemPrincipal: true });
  const stream = channel.open();
  try {
    return NetUtil.readInputStreamToString(stream, stream.available(), {
      charset: "UTF-8",
    });
  } finally {
    stream.close();
  }
}

function parseProperties(text) {
  const strings = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line || /^\s*[#!]/.test(line)) {
      continue;
    }
    const separator = line.search(/[:=]/);
    if (separator !== -1) {
      strings.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
    }
  }
  return strings;
}

function localized(strings, preference, field) {
  return strings.get(`${preference.name}_${field}`) ?? preference[field] ?? "";
}

function showError(message) {
  const error = document.querySelector("#error");
  error.textContent = message;
  error.hidden = false;
}

async function initialize() {
  const id = new URL(document.URL).searchParams.get("id");
  if (!id) {
    throw new Error("The add-on id is missing from the options URL");
  }
  const addon = await AddonManager.getAddonByID(id);
  if (!addon?.isActive) {
    throw new Error("This add-on is not active");
  }

  const metadata = JSON.parse(readURI(addon.getResourceURI("package.json")));
  if (metadata.id !== id) {
    throw new Error("The options URL does not match the add-on package");
  }

  const locale = Services.locale.appLocaleAsBCP47.toLowerCase().split("-")[0];
  let strings = new Map();
  for (const candidate of [locale, "en"]) {
    try {
      strings = parseProperties(readURI(addon.getResourceURI(`locale/${candidate}.properties`)));
      break;
    } catch {}
  }

  document.title = metadata.title;
  document.querySelector("#addon-title").textContent = metadata.title;
  document.querySelector("#addon-description").textContent = metadata.description;

  const branch = Services.prefs.getBranch(`extensions.${id}.`);
  const form = document.querySelector("#preferences");
  for (const preference of metadata.preferences ?? []) {
    const fieldset = document.createElement("fieldset");
    const legend = document.createElement("legend");
    legend.textContent = localized(strings, preference, "title");
    fieldset.append(legend);

    if (preference.type === "bool") {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = branch.getBoolPref(preference.name, Boolean(preference.value));
      checkbox.addEventListener("change", () => {
        branch.setBoolPref(preference.name, checkbox.checked);
      });
      label.append(checkbox, ` ${localized(strings, preference, "description")}`);
      fieldset.append(label);
    } else if (preference.type === "control") {
      const description = localized(strings, preference, "description");
      if (description) {
        const paragraph = document.createElement("p");
        paragraph.textContent = description;
        fieldset.append(paragraph);
      }
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = localized(strings, preference, "label");
      button.addEventListener("click", () => {
        Services.obs.notifyObservers(
          null,
          COMMAND_TOPIC,
          JSON.stringify({ id, name: preference.name })
        );
      });
      fieldset.append(button);
    } else {
      throw new Error(`Unsupported SDK preference type: ${preference.type}`);
    }
    form.append(fieldset);
  }
}

initialize().catch(error => {
  console.error("Could not load legacy SDK options", error);
  showError(error.message);
});
