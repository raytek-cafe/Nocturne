"use strict";

const NOCTURNE_SELECT_OPTION_COUNTS = {
  "browser.display.windows.non_native_menus": 3,
  "widget.native-controls.scrollbar-style": 3,
  "widget.non-native-theme.scrollbar.style": 6,
  "widget.native-controls.override-win-version": 6,
  "nocturne.colors": 5,
  "nocturne.aero.fog": 3,
  "nocturne.caption.text.color": 3,
  "accessibility.force_disabled": 3,
  "cookiebanners.service.mode": 2,
  "cookiebanners.service.mode.privateBrowsing": 2,
  "security.sandbox.content.level": 3,
};

const NOCTURNE_LEGACY_OPTION_COUNTS = {
  nocturneNativeMenulistType: 3,
  nocturneNativeScrollType: 3,
  nocturneFakeScrollType: 6,
  nocturneWinThemeType: 6,
  nocturneColorsType: 5,
  nocturneFogType: 3,
  nocturneCaptionTextType: 3,
  nocturneAccessibilityType: 3,
  nocturneCookieBannersType: 2,
  nocturneCookieBannersPrivateType: 2,
  nocturneSandboxLevelType: 3,
};

const PROMPT_TAB_MODAL_PREF = "prompts.tab_modal.enabled";
const ABOUT_FIREFOX_HIDDEN_PREF = "browser.preferences.aboutFirefox.hidden";

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

add_task(async function test_nocturne_preferences_have_localized_controls() {
  let tab = await openPrefsTab("nocturne");
  let doc = tab.linkedBrowser.contentDocument;

  if (SRD_PREF_VALUE) {
    await BrowserTestUtils.waitForCondition(
      () => doc.querySelector('setting-group[groupid="nocturneAdvanced"]'),
      "Wait for the redesigned Nocturne advanced group"
    );
    await BrowserTestUtils.waitForCondition(() => {
      let controls = doc.querySelectorAll(
        'setting-group[groupid^="nocturne"] setting-control'
      );
      return (
        controls.length === 47 &&
        [...controls].every(control =>
          control
            .querySelector("moz-checkbox, moz-select, moz-input-number")
            ?.getAttribute("label")
        )
      );
    }, "Wait for all redesigned Nocturne control labels");

    for (let [settingId, optionCount] of Object.entries(
      NOCTURNE_SELECT_OPTION_COUNTS
    )) {
      await BrowserTestUtils.waitForCondition(() => {
        let select = doc.querySelector(
          `setting-control[id="setting-control-${settingId}"] moz-select`
        );
        let options = select?.querySelectorAll("moz-option");
        return (
          options?.length === optionCount &&
          [...options].every(option => option.getAttribute("label"))
        );
      }, `Wait for the redesigned ${settingId} select and its labels`);
    }

    for (let [settingId, optionCount] of Object.entries(
      NOCTURNE_SELECT_OPTION_COUNTS
    )) {
      let select = doc.querySelector(
        `setting-control[id="setting-control-${settingId}"] moz-select`
      );
      let options = select.querySelectorAll("moz-option");
      Assert.equal(
        options.length,
        optionCount,
        `${settingId} has select options`
      );
      ok(
        [...options].every(option => option.getAttribute("label")),
        `${settingId} select options have localized labels`
      );
    }
  } else {
    await BrowserTestUtils.waitForCondition(
      () => doc.getElementById("nocturneAdvancedGroup")?.hidden === false,
      "Wait for the legacy Nocturne advanced group"
    );

    await BrowserTestUtils.waitForCondition(() => {
      return Object.entries(NOCTURNE_LEGACY_OPTION_COUNTS).every(
        ([id, optionCount]) => {
          let menu = doc.getElementById(id);
          let options = menu?.querySelectorAll("menuitem");
          return (
            options?.length === optionCount &&
            [...options].every(option => option.getAttribute("label"))
          );
        }
      );
    }, "Wait for all legacy Nocturne menu labels");

    await BrowserTestUtils.waitForCondition(() => {
      let textElements = doc.querySelectorAll(
        "#nocturnecategory h1[data-l10n-id]," +
          "#nocturneVisualGroup label[data-l10n-id]," +
          "#nocturneVisualGroup h2[data-l10n-id]," +
          "#nocturneFunctionalGroup label[data-l10n-id]," +
          "#nocturneFunctionalGroup h2[data-l10n-id]," +
          "#nocturneAdvancedGroup label[data-l10n-id]," +
          "#nocturneAdvancedGroup h2[data-l10n-id]"
      );
      let checkboxes = doc.querySelectorAll(
        "#nocturneVisualGroup checkbox[data-l10n-id]," +
          "#nocturneFunctionalGroup checkbox[data-l10n-id]," +
          "#nocturneAdvancedGroup checkbox[data-l10n-id]"
      );
      let descriptions = doc.querySelectorAll(
        "#nocturneVisualGroup description[data-l10n-id]," +
          "#nocturneFunctionalGroup description[data-l10n-id]," +
          "#nocturneAdvancedGroup description[data-l10n-id]"
      );
      return (
        textElements.length === 17 &&
        [...textElements].every(element => {
          let text = element.matches("label[data-l10n-id]")
            ? element.getAttribute("value")
            : element.textContent;
          return text?.trim();
        }) &&
        [...checkboxes].every(checkbox => checkbox.getAttribute("label")) &&
        [...descriptions].every(description => description.textContent.trim())
      );
    }, "Wait for all legacy Nocturne text labels");

    for (let [id, optionCount] of Object.entries(
      NOCTURNE_LEGACY_OPTION_COUNTS
    )) {
      let menu = doc.getElementById(id);
      let options = menu.querySelectorAll("menuitem");
      Assert.equal(options.length, optionCount, `${id} has menu options`);
      ok(
        [...options].every(option => option.getAttribute("label")),
        `${id} menu options have localized labels`
      );
    }
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
