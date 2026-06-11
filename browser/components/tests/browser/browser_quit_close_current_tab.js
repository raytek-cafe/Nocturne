/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

/**
 * Ensure that the buttons are ordered as expected, and that the
 * "Close current tab" button actually closes the current tab.
 */
add_task(async function test_close_current_tab() {
  let tab = await BrowserTestUtils.openNewForegroundTab(gBrowser);

  async function observer(subject) {
    let dialogElement = subject.document.getElementById("commonDialog");

    ok(
      subject?.docShell?.chromeEventHandler,
      "The modern close warning should use Firefox's stock internal dialog"
    );
    is(
      dialogElement.querySelector("#infoBody").textContent,
      "",
      "The stock modern close warning should not have body text"
    );
    is(
      dialogElement.getAttribute("buttonpack"),
      "end",
      "Button pack should use the modern right-aligned layout"
    );
    let buttons = Array.from(
      dialogElement.buttonBox.getElementsByTagName("button")
    );

    // button reordering only happens on Unix
    if (AppConstants.XP_UNIX) {
      is(
        buttons[2].label,
        dialogElement.getButton("cancel").label,
        "Cancel button should be at position 2"
      );
    }

    let closePromise = BrowserTestUtils.waitForTabClosing(tab);
    dialogElement.getButton("extra1").click();
    await closePromise;

    is(
      gBrowser.tabs.find(t => t === tab),
      undefined,
      "Tab should no longer be open"
    );
  }

  Services.obs.addObserver(observer, "common-dialog-loaded");

  await SpecialPowers.pushPrefEnv({
    set: [
      ["browser.warnOnQuitShortcut", true],
      ["browser.warnOnQuit", true],
      ["nocturne.tabs.oldWarnOnClose", true],
      ["prompts.tab_modal.enabled", true],
    ],
  });

  // triggers quit-application-requested
  canQuitApplication(undefined, "shortcut");

  Services.obs.removeObserver(observer, "common-dialog-loaded");
});

add_task(async function test_close_current_tab_option_is_pref_gated() {
  async function observer(subject) {
    let dialogElement = subject.document.getElementById("commonDialog");

    is(
      dialogElement.getAttribute("buttonpack"),
      "end",
      "Button pack should use the stock right-aligned layout when the pref is disabled"
    );
    ok(
      dialogElement.getButton("extra1").hidden,
      "Close current tab button should be hidden when the pref is disabled"
    );

    dialogElement.getButton("cancel").click();
  }

  Services.obs.addObserver(observer, "common-dialog-loaded");

  await SpecialPowers.pushPrefEnv({
    set: [
      ["browser.warnOnQuitShortcut", true],
      ["browser.warnOnQuit", true],
      ["nocturne.tabs.oldWarnOnClose", false],
      ["prompts.tab_modal.enabled", true],
    ],
  });

  canQuitApplication(undefined, "shortcut");

  Services.obs.removeObserver(observer, "common-dialog-loaded");
});
