/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Tests disabling sponsored Suggest results for existing profiles.

"use strict";

const DEFAULT_PREFS = {
  "quicksuggest.enabled": true,
  "quicksuggest.dataCollection.enabled": false,
  "suggest.quicksuggest.nonsponsored": true,
  "suggest.quicksuggest.sponsored": false,
};

add_setup(async () => {
  await UrlbarTestUtils.initNimbusFeature();
});

add_task(async function no_user_value() {
  await doMigrateTest({
    expectedPrefs: {
      defaultBranch: DEFAULT_PREFS,
    },
  });
});

add_task(async function user_disabled_sponsored_suggestions() {
  await doMigrateTest({
    initialUserBranch: {
      "suggest.quicksuggest.sponsored": false,
    },
    expectedPrefs: {
      defaultBranch: DEFAULT_PREFS,
      userBranch: {
        "suggest.quicksuggest.sponsored": false,
      },
    },
  });
});

add_task(async function user_enabled_sponsored_suggestions() {
  await doMigrateTest({
    initialUserBranch: {
      "suggest.quicksuggest.sponsored": true,
    },
    expectedPrefs: {
      defaultBranch: DEFAULT_PREFS,
      userBranch: {
        "suggest.quicksuggest.sponsored": false,
      },
    },
  });
});
