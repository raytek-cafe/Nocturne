/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/
 */

const ID = "legacy-nonbootstrap@tests.mozilla.org";

const { AddonManager } = ChromeUtils.importESModule(
  "resource://gre/modules/AddonManager.sys.mjs"
);
const { AddonTestUtils } = ChromeUtils.importESModule(
  "resource://testing-common/AddonTestUtils.sys.mjs"
);
const { NetUtil } = ChromeUtils.importESModule(
  "resource://gre/modules/NetUtil.sys.mjs"
);

AddonTestUtils.init(this);
AddonTestUtils.overrideCertDB();
AddonTestUtils.createAppInfo("xpcshell@tests.mozilla.org", "XPCShell", "1", "42");

const registry = Cc["@mozilla.org/chrome/chrome-registry;1"].getService(
  Ci.nsIChromeRegistry
);

const ADDON = {
  "install.rdf": `<?xml version="1.0"?>
    <RDF xmlns="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
         xmlns:em="http://www.mozilla.org/2004/em-rdf#">
      <Description about="urn:mozilla:install-manifest">
        <em:id>${ID}</em:id>
        <em:version>1.0</em:version>
        <em:type>2</em:type>
        <em:name>Legacy non-bootstrap chrome test</em:name>
        <em:optionsURL>chrome://legacytest/content/options.xhtml</em:optionsURL>
        <em:targetApplication>
          <Description>
            <em:id>xpcshell@tests.mozilla.org</em:id>
            <em:minVersion>1</em:minVersion>
            <em:maxVersion>42</em:maxVersion>
          </Description>
        </em:targetApplication>
      </Description>
    </RDF>`,
  "chrome.manifest": [
    "content legacytest content/",
    "locale legacytest en-US locale/",
    "resource legacytestres content/",
  ].join("\n"),
  "content/options.xhtml": "<window xmlns=\"http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul\" id=\"legacy-options\"/>",
  "locale/strings.dtd": "<!ENTITY legacytest.label \"Legacy Test\">",
};

function readResource(spec) {
  let channel = NetUtil.newChannel({
    uri: Services.io.newURI(spec),
    loadUsingSystemPrincipal: true,
  });
  let stream = channel.open();
  try {
    return NetUtil.readInputStreamToString(stream, stream.available(), {
      charset: "utf-8",
    });
  } finally {
    stream.close();
  }
}

function checkMappings(addon) {
  equal(addon.optionsURL, "chrome://legacytest/content/options.xhtml");

  let contentURL = Services.io.newURI("chrome://legacytest/content/options.xhtml");
  ok(
    registry.convertChromeURL(contentURL).spec.endsWith("/content/options.xhtml"),
    "content mapping resolves"
  );

  let localeURL = Services.io.newURI("chrome://legacytest/locale/strings.dtd");
  ok(
    registry.convertChromeURL(localeURL).spec.endsWith("/locale/strings.dtd"),
    "locale mapping resolves"
  );

  equal(
    readResource("resource://legacytestres/options.xhtml"),
    ADDON["content/options.xhtml"],
    "resource mapping resolves"
  );
}

add_task(async function test_legacy_nonbootstrap_chrome_registration() {
  await AddonTestUtils.promiseStartupManager();

  let { addon } = await AddonTestUtils.promiseInstallXPI(ADDON);
  checkMappings(addon);

  await AddonTestUtils.promiseRestartManager();

  addon = await AddonManager.getAddonByID(ID);
  Assert.notEqual(addon, null);
  checkMappings(addon);

  await addon.uninstall();
  await AddonTestUtils.promiseRestartManager();

  Assert.throws(
    () => registry.convertChromeURL(Services.io.newURI("chrome://legacytest/content/options.xhtml")),
    e => e.result == Cr.NS_ERROR_FILE_NOT_FOUND,
    "chrome mapping removed after uninstall"
  );
});
