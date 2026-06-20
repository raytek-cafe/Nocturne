/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

/**
 * Ensure that when different combinations of warnings are enabled,
 * quitting produces the correct warning (if any), and the checkbox
 * is also correct.
 */
add_task(async function test_check_right_prompt() {
  let tests = [
    {
      oldWarnOnClose: false,
      tabModalEnabled: true,
      warnOnQuitShortcut: true,
      warnOnClose: false,
      expectedDialog: "shortcut",
      messageSuffix: "with shortcut but no tabs warning",
    },
    {
      oldWarnOnClose: false,
      tabModalEnabled: true,
      warnOnQuitShortcut: false,
      warnOnClose: true,
      expectedDialog: "tabs",
      messageSuffix: "with tabs but no shortcut warning",
    },
    {
      oldWarnOnClose: false,
      tabModalEnabled: true,
      warnOnQuitShortcut: false,
      warnOnClose: false,
      messageSuffix: "with no warning",
      expectedDialog: null,
    },
    {
      oldWarnOnClose: false,
      tabModalEnabled: true,
      warnOnQuitShortcut: true,
      warnOnClose: true,
      messageSuffix: "with both warnings",
      expectedDialog: "shortcut",
    },
    {
      oldWarnOnClose: true,
      tabModalEnabled: true,
      warnOnQuitShortcut: true,
      warnOnClose: true,
      expectedDialog: "legacy-tabs",
      messageSuffix: "with legacy close warning enabled",
    },
    {
      oldWarnOnClose: true,
      tabModalEnabled: false,
      warnOnQuitShortcut: true,
      warnOnClose: true,
      expectedDialog: "tabs",
      messageSuffix: "with legacy close warning but tab-modal prompts disabled",
    },
    {
      oldWarnOnClose: true,
      tabModalEnabled: true,
      warnOnQuitShortcut: true,
      warnOnClose: false,
      messageSuffix: "with legacy close warning but no tabs warning",
      expectedDialog: null,
    },
  ];
  let tab = BrowserTestUtils.addTab(gBrowser);

  function checkDialog(dialog, expectedDialog, messageSuffix) {
    let dialogElement = dialog.document.getElementById("commonDialog");
    let acceptLabel = dialogElement.getButton("accept").label;
    is(
      acceptLabel.startsWith("Quit"),
      expectedDialog == "shortcut",
      `dialog label ${
        expectedDialog == "shortcut" ? "should" : "should not"
      } start with Quit ${messageSuffix}`
    );
    let checkLabel = dialogElement.querySelector("checkbox").label;
    if (expectedDialog == "shortcut") {
      ok(
        checkLabel.startsWith("Ask before quitting with"),
        `checkbox label should be for quitting ${messageSuffix}`
      );
    } else {
      let expectedCheckLabel =
        expectedDialog == "legacy-tabs"
          ? "Warn me when I attempt to close multiple tabs"
          : "Ask before closing multiple tabs";
      is(
        checkLabel,
        expectedCheckLabel,
        `checkbox label should match ${expectedDialog} ${messageSuffix}`
      );
    }

    dialogElement.getButton("cancel").click();
  }

  let dialogOpened = false;
  function setDialogOpened() {
    dialogOpened = true;
  }
  Services.obs.addObserver(setDialogOpened, "common-dialog-loaded");
  for (let {
    oldWarnOnClose,
    tabModalEnabled,
    warnOnClose,
    warnOnQuitShortcut,
    expectedDialog,
    messageSuffix,
  } of tests) {
    dialogOpened = false;
    let promise = null;
    await SpecialPowers.pushPrefEnv({
      set: [
        ["browser.tabs.warnOnClose", warnOnClose],
        ["browser.warnOnQuitShortcut", warnOnQuitShortcut],
        ["browser.warnOnQuit", true],
        ["nocturne.tabs.oldWarnOnClose", oldWarnOnClose],
        ["prompts.tab_modal.enabled", tabModalEnabled],
      ],
    });
    if (expectedDialog) {
      promise = BrowserTestUtils.promiseAlertDialogOpen("", undefined, {
        callback(win) {
          checkDialog(win, expectedDialog, messageSuffix);
        },
      });
    }
    is(
      !canQuitApplication(undefined, "shortcut"),
      !!expectedDialog,
      `canQuitApplication ${
        expectedDialog ? "should" : "should not"
      } block ${messageSuffix}.`
    );
    await promise;
    is(
      dialogOpened,
      !!expectedDialog,
      `Should ${
        expectedDialog ? "" : "not "
      }have opened a dialog ${messageSuffix}.`
    );
  }
  Services.obs.removeObserver(setDialogOpened, "common-dialog-loaded");
  BrowserTestUtils.removeTab(tab);
});
