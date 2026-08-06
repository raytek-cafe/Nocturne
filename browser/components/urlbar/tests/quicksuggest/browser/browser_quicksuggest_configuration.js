/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

/**
 * Tests QuickSuggest configurations.
 */

ChromeUtils.defineESModuleGetters(this, {
  EnterprisePolicyTesting:
    "resource://testing-common/EnterprisePolicyTesting.sys.mjs",
});

// We use this pref in enterprise preference policy tests. We specifically use a
// pref that's sticky and exposed in the UI to make sure it can be set properly.
const POLICY_PREF = "suggest.quicksuggest.all";

let gDefaultBranch = Services.prefs.getDefaultBranch("browser.urlbar.");
let gUserBranch = Services.prefs.getBranch("browser.urlbar.");

add_setup(async function () {
  await QuickSuggestTestUtils.ensureQuickSuggestInit();
});

add_task(async function test_indexes() {
  await QuickSuggestTestUtils.withExperiment({
    valueOverrides: {
      quickSuggestNonSponsoredIndex: 99,
      quickSuggestSponsoredIndex: -1337,
    },
    callback: () => {
      Assert.equal(
        UrlbarPrefs.get("quickSuggestNonSponsoredIndex"),
        99,
        "quickSuggestNonSponsoredIndex"
      );
      Assert.equal(
        UrlbarPrefs.get("quickSuggestSponsoredIndex"),
        -1337,
        "quickSuggestSponsoredIndex"
      );
    },
  });
});

add_task(async function test_merino() {
  await QuickSuggestTestUtils.withExperiment({
    valueOverrides: {
      merinoEndpointURL: "http://example.com/test_merino_config",
      merinoClientVariants: "test-client-variants",
      merinoProviders: "test-providers",
    },
    callback: () => {
      Assert.equal(
        UrlbarPrefs.get("merinoEndpointURL"),
        "http://example.com/test_merino_config",
        "merinoEndpointURL"
      );
      Assert.equal(
        UrlbarPrefs.get("merinoClientVariants"),
        "test-client-variants",
        "merinoClientVariants"
      );
      Assert.equal(
        UrlbarPrefs.get("merinoProviders"),
        "test-providers",
        "merinoProviders"
      );
    },
  });
});

// The following tasks test enterprise preference policies

// Preference policy test for the following:
// * Status: locked
// * Value: false
add_task(async function () {
  await doPolicyTest({
    prefPolicy: {
      Status: "locked",
      Value: false,
    },
    expectedDefault: false,
    expectedUser: undefined,
    expectedLocked: true,
  });
});

// Preference policy test for the following:
// * Status: locked
// * Value: true
add_task(async function () {
  await doPolicyTest({
    prefPolicy: {
      Status: "locked",
      Value: true,
    },
    expectedDefault: true,
    expectedUser: undefined,
    expectedLocked: true,
  });
});

// Preference policy test for the following:
// * Status: default
// * Value: false
add_task(async function () {
  await doPolicyTest({
    prefPolicy: {
      Status: "default",
      Value: false,
    },
    expectedDefault: false,
    expectedUser: undefined,
    expectedLocked: false,
  });
});

// Preference policy test for the following:
// * Status: default
// * Value: true
add_task(async function () {
  await doPolicyTest({
    prefPolicy: {
      Status: "default",
      Value: true,
    },
    expectedDefault: true,
    expectedUser: undefined,
    expectedLocked: false,
  });
});

// Preference policy test for the following:
// * Status: user
// * Value: false
add_task(async function () {
  await doPolicyTest({
    prefPolicy: {
      Status: "user",
      Value: false,
    },
    expectedDefault: true,
    expectedUser: false,
    expectedLocked: false,
  });
});

// Preference policy test for the following:
// * Status: user
// * Value: true
add_task(async function () {
  await doPolicyTest({
    prefPolicy: {
      Status: "user",
      Value: true,
    },
    expectedDefault: true,
    // Because the pref is sticky, it's true on the user branch even though it's
    // also true on the default branch. Sticky prefs retain their user-branch
    // values even when they're the same as their default-branch values.
    expectedUser: true,
    expectedLocked: false,
  });
});

/**
 * This tests an enterprise preference policy with one of the quick suggest
 * sticky prefs (defined by `POLICY_PREF`). Pref policies should apply to the
 * quick suggest sticky prefs just as they do to non-sticky prefs.
 *
 * @param {object} options
 *   Options object.
 * @param {object} options.prefPolicy
 *   An object `{ Status, Value }` that will be included in the policy.
 * @param {boolean} options.expectedDefault
 *   The expected default-branch pref value after setting the policy.
 * @param {boolean} options.expectedUser
 *   The expected user-branch pref value after setting the policy or undefined
 *   if the pref should not exist on the user branch.
 * @param {boolean} options.expectedLocked
 *   Whether the pref is expected to be locked after setting the policy.
 */
async function doPolicyTest({
  prefPolicy,
  expectedDefault,
  expectedUser,
  expectedLocked,
}) {
  info(
    "Starting pref policy test: " +
      JSON.stringify({
        prefPolicy,
        expectedDefault,
        expectedUser,
        expectedLocked,
      })
  );

  let pref = POLICY_PREF;

  // Check initial state.
  Assert.ok(
    gDefaultBranch.getBoolPref(pref),
    `${pref} is initially true on default branch (assuming en-US)`
  );
  Assert.ok(
    !gUserBranch.prefHasUserValue(pref),
    `${pref} does not have initial user value`
  );

  // Set up the policy.
  await EnterprisePolicyTesting.setupPolicyEngineWithJson({
    policies: {
      Preferences: {
        [`browser.urlbar.${pref}`]: prefPolicy,
      },
    },
  });
  Assert.equal(
    Services.policies.status,
    Ci.nsIEnterprisePolicies.ACTIVE,
    "Policy engine is active"
  );

  // Check the default branch.
  Assert.equal(
    gDefaultBranch.getBoolPref(pref),
    expectedDefault,
    `${pref} has expected default-branch value after setting policy`
  );

  // Check the user branch.
  Assert.equal(
    gUserBranch.prefHasUserValue(pref),
    expectedUser !== undefined,
    `${pref} is on user branch as expected after setting policy`
  );
  if (expectedUser !== undefined) {
    Assert.equal(
      gUserBranch.getBoolPref(pref),
      expectedUser,
      `${pref} has expected user-branch value after setting policy`
    );
  }

  // Check the locked state.
  Assert.equal(
    gDefaultBranch.prefIsLocked(pref),
    expectedLocked,
    `${pref} is locked as expected after setting policy`
  );

  // Clean up.
  await EnterprisePolicyTesting.setupPolicyEngineWithJson("");
  Assert.equal(
    Services.policies.status,
    Ci.nsIEnterprisePolicies.INACTIVE,
    "Policy engine is inactive"
  );

  gDefaultBranch.unlockPref(pref);
  gUserBranch.clearUserPref(pref);
  await QuickSuggest._test_reset();

  Assert.ok(
    !gDefaultBranch.prefIsLocked(pref),
    `${pref} is not locked after cleanup`
  );
  Assert.ok(
    gDefaultBranch.getBoolPref(pref),
    `${pref} is true on default branch after cleanup (assuming en-US)`
  );
  Assert.ok(
    !gUserBranch.prefHasUserValue(pref),
    `${pref} does not have user value after cleanup`
  );
}
