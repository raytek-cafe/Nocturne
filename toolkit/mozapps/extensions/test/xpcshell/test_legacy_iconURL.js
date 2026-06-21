/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/
 */

const ID = "legacy-iconurl@tests.mozilla.org";

const { AddonManager } = ChromeUtils.importESModule(
  "resource://gre/modules/AddonManager.sys.mjs"
);
const { AddonTestUtils } = ChromeUtils.importESModule(
  "resource://testing-common/AddonTestUtils.sys.mjs"
);

AddonTestUtils.init(this);
AddonTestUtils.overrideCertDB();
AddonTestUtils.createAppInfo("xpcshell@tests.mozilla.org", "XPCShell", "1", "42");

const ADDON = {
  "install.rdf": `<?xml version="1.0"?>
    <RDF xmlns="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
         xmlns:em="http://www.mozilla.org/2004/em-rdf#">
      <Description about="urn:mozilla:install-manifest">
        <em:id>${ID}</em:id>
        <em:version>1.0</em:version>
        <em:type>2</em:type>
        <em:name>Legacy iconURL test</em:name>
        <em:bootstrap>true</em:bootstrap>
        <em:iconURL>icon.png</em:iconURL>
        <em:targetApplication>
          <Description>
            <em:id>xpcshell@tests.mozilla.org</em:id>
            <em:minVersion>1</em:minVersion>
            <em:maxVersion>42</em:maxVersion>
          </Description>
        </em:targetApplication>
      </Description>
    </RDF>`,
  "bootstrap.js": `
    function install() {}
    function uninstall() {}
    function startup() {}
    function shutdown() {}
  `,
  "icon.png": "",
};

function checkIcons(addon) {
  const iconURL = addon.getResourceURI("icon.png").spec;

  Assert.deepEqual(addon.icons, {
    32: iconURL,
    48: iconURL,
  });
  equal(addon.iconURL, iconURL);
  equal(AddonManager.getPreferredIconURL(addon, 32), iconURL);
  equal(AddonManager.getPreferredIconURL(addon, 48), iconURL);
}

add_task(async function test_legacy_iconURL_is_resolved() {
  await AddonTestUtils.promiseStartupManager();

  let { addon } = await AddonTestUtils.promiseInstallXPI(ADDON);
  checkIcons(addon);

  await AddonTestUtils.promiseRestartManager();

  addon = await AddonManager.getAddonByID(ID);
  Assert.notEqual(addon, null);
  checkIcons(addon);

  await addon.uninstall();
});
