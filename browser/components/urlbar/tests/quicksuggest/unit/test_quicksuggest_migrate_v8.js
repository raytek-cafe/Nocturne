/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Tests disabling sponsored Suggest results for existing profiles.

"use strict";

const TO_VERSION = 8;

add_setup(async () => {
  await setUpMigrateTest();
});

add_task(async function () {
  await doMigrateTest({
    toVersion: TO_VERSION,
  });
});

add_task(async function () {
  await doMigrateTest({
    toVersion: TO_VERSION,
    preMigrationUserPrefs: {
      "suggest.quicksuggest.sponsored": false,
    },
    expectedPostMigrationUserPrefs: {
      "suggest.quicksuggest.sponsored": false,
    },
  });
});

add_task(async function () {
  await doMigrateTest({
    toVersion: TO_VERSION,
    preMigrationUserPrefs: {
      "suggest.quicksuggest.sponsored": true,
    },
    expectedPostMigrationUserPrefs: {
      "suggest.quicksuggest.sponsored": false,
    },
  });
});
