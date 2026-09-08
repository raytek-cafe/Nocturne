"use strict";

add_task(async function test_nocturne_custom_color_stays_in_sync() {
  await SpecialPowers.pushPrefEnv({
    set: [
      ["nocturne.colors", 6],
      ["nocturne.colors.custom", "#123456"],
    ],
  });
  let tab = await openPrefsTab("nocturne");
  try {
    let doc = tab.linkedBrowser.contentDocument;
    await BrowserTestUtils.waitForCondition(
      () => doc.getElementById("nocturneCustomPalette-accents")?.summaryEl,
      "The accent colors submenu is ready"
    );
    doc.getElementById("nocturneCustomPalette-accents").summaryEl.click();
    let picker;
    await BrowserTestUtils.waitForCondition(() => {
      picker =
        doc.getElementById("nocturne.colors.custom") ||
        doc.querySelector('[preference="nocturne.colors.custom"]');
      return picker?.value == "#123456" && picker.checkVisibility();
    }, "Custom mode shows the saved color");

    Services.prefs.setStringPref("nocturne.colors.custom", "#abcdef");
    await BrowserTestUtils.waitForCondition(
      () => picker.value == "#abcdef",
      "The picker follows external color changes"
    );

    Services.prefs.setIntPref("nocturne.colors", 5);
    await BrowserTestUtils.waitForCondition(
      () => !picker.checkVisibility(),
      "System accent hides the custom picker"
    );
    Services.prefs.setIntPref("nocturne.colors", 6);
    await BrowserTestUtils.waitForCondition(
      () => picker.checkVisibility() && picker.value == "#abcdef",
      "Returning to custom preserves the selected color"
    );

    picker.value = "#654321";
    picker.dispatchEvent(new doc.defaultView.Event("change", { bubbles: true }));
    is(
      Services.prefs.getStringPref("nocturne.colors.custom"),
      "#654321",
      "Choosing a color saves the preference"
    );
  } finally {
    await BrowserTestUtils.removeTab(tab);
  }
});

add_task(async function test_unset_custom_background_uses_firefox_default() {
  const { NOCTURNE_COLOR_FIELDS, nocturneColorPref } = ChromeUtils.importESModule(
    "resource:///modules/NocturneColors.sys.mjs"
  );
  await SpecialPowers.pushPrefEnv({
    set: [
      ["nocturne.colors", 0],
      ["layout.css.prefers-color-scheme.content-override", 1],
      ...NOCTURNE_COLOR_FIELDS.flatMap(({ id }) =>
        ["light", "dark"].map(scheme => [nocturneColorPref(id, scheme), ""])
      ),
    ],
  });
  let tab = await openPrefsTab("nocturne");
  try {
    let doc = tab.linkedBrowser.contentDocument;
    let win = doc.defaultView;
    let background = () => win.getComputedStyle(doc.documentElement).backgroundColor;
    let stockBackground = background();
    Services.prefs.setIntPref("nocturne.colors", 6);
    await new Promise(resolve =>
      win.requestAnimationFrame(() => win.requestAnimationFrame(resolve))
    );
    is(background(), stockBackground, "Unset custom colors preserve Firefox's background");

    let lightPref = nocturneColorPref("in-content-page-background", "light");
    let darkPref = nocturneColorPref("in-content-page-background", "dark");
    Services.prefs.setStringPref(lightPref, "#123456");
    await BrowserTestUtils.waitForCondition(
      () => background() == "rgb(18, 52, 86)",
      "An explicit light background is applied"
    );
    Services.prefs.setStringPref(darkPref, "#abcdef");
    doc.getElementById("nocturneCustomPalette-settings").summaryEl.click();
    let picker =
      doc.getElementById(lightPref) ||
      doc.querySelector(`[preference="${lightPref}"]`);
    await BrowserTestUtils.waitForCondition(
      () => picker.shadowRoot.querySelector("moz-button")?.checkVisibility(),
      "The color override can be removed"
    );
    picker.shadowRoot.querySelector("moz-button").click();
    await BrowserTestUtils.waitForCondition(
      () => background() == stockBackground,
      "Clearing the light background restores Firefox's default despite a dark override"
    );
  } finally {
    await BrowserTestUtils.removeTab(tab);
  }
});

const PROMPT_TAB_MODAL_PREF = "prompts.tab_modal.enabled";
const ABOUT_FIREFOX_HIDDEN_PREF = "browser.preferences.aboutFirefox.hidden";
const OLD_AUTOFILL_PREF = "nocturne.ui.oldautofill";

add_task(async function test_about_firefox_category_visibility() {
  is(
    Services.prefs.getBoolPref(ABOUT_FIREFOX_HIDDEN_PREF, false),
    true,
    "About Firefox category is hidden by default"
  );

  let tab = await openPrefsTab();
  let doc = tab.linkedBrowser.contentDocument;
  await BrowserTestUtils.waitForCondition(
    () => !doc.getElementById("category-about-firefox"),
    "Wait for the About Firefox category to be hidden"
  );
  await BrowserTestUtils.removeTab(tab);

  await SpecialPowers.pushPrefEnv({
    set: [[ABOUT_FIREFOX_HIDDEN_PREF, false]],
  });

  tab = await openPrefsTab();
  doc = tab.linkedBrowser.contentDocument;
  if (SRD_PREF_VALUE) {
    await BrowserTestUtils.waitForCondition(
      () => doc.getElementById("category-about-firefox")?.hidden === false,
      "Wait for the About Firefox category to be shown"
    );
    is_element_visible(
      doc.getElementById("category-about-firefox"),
      "About Firefox category is visible when the preference is disabled"
    );
  } else {
    ok(
      !doc.getElementById("category-about-firefox"),
      "About Firefox category remains hidden when settings redesign is disabled"
    );
  }
  await BrowserTestUtils.removeTab(tab);
});

add_task(async function test_nocturne_prompt_tab_modal_matches_pref() {
  await SpecialPowers.pushPrefEnv({
    set: [[PROMPT_TAB_MODAL_PREF, false]],
  });

  let tab = await openPrefsTab("nocturne");
  let win = tab.linkedBrowser.contentWindow;
  let checkbox;

  if (SRD_PREF_VALUE) {
    let control = await settingControlRenders(PROMPT_TAB_MODAL_PREF, win);
    checkbox = control.controlEl;
  } else {
    checkbox = win.document.getElementById("nocturnePromptTabModal");
    await BrowserTestUtils.waitForCondition(
      () => checkbox,
      "Wait for the legacy prompt tab modal checkbox"
    );
  }

  is(
    checkbox.checked,
    false,
    "Prompt tab modal checkbox is unchecked when the preference is disabled"
  );

  checkbox.click();
  await BrowserTestUtils.waitForCondition(
    () => Services.prefs.getBoolPref(PROMPT_TAB_MODAL_PREF) && checkbox.checked,
    "Wait for the prompt tab modal preference to be enabled"
  );
  is(
    checkbox.checked,
    true,
    "Prompt tab modal checkbox is checked when the preference is enabled"
  );

  await BrowserTestUtils.removeTab(tab);
});

add_task(async function test_nocturne_old_autofill_matches_pref() {
  await SpecialPowers.pushPrefEnv({
    set: [[OLD_AUTOFILL_PREF, false]],
  });

  let tab = await openPrefsTab("nocturne");
  let win = tab.linkedBrowser.contentWindow;
  let checkbox;

  if (SRD_PREF_VALUE) {
    let control = await settingControlRenders(OLD_AUTOFILL_PREF, win);
    checkbox = control.controlEl;
  } else {
    checkbox = win.document.getElementById("nocturneOldAutofill");
    await BrowserTestUtils.waitForCondition(
      () => checkbox,
      "Wait for the old autofill checkbox"
    );
  }

  is(checkbox.checked, false, "Old autofill checkbox is unchecked by default");

  checkbox.click();
  await BrowserTestUtils.waitForCondition(
    () => Services.prefs.getBoolPref(OLD_AUTOFILL_PREF) && checkbox.checked,
    "Wait for the old autofill preference to be enabled"
  );

  await BrowserTestUtils.removeTab(tab);
  await SpecialPowers.popPrefEnv();
});
