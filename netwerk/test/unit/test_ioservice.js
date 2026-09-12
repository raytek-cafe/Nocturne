"use strict";

add_task(function test_extractScheme() {
  equal(Services.io.extractScheme("HtTp://example.com"), "http");
  Assert.throws(
    () => {
      Services.io.extractScheme("://example.com");
    },
    /NS_ERROR_MALFORMED_URI/,
    "missing scheme"
  );
  Assert.throws(
    () => {
      Services.io.extractScheme("ht%tp://example.com");
    },
    /NS_ERROR_MALFORMED_URI/,
    "bad scheme"
  );
});

add_task(function test_runtime_handler_owned_removal() {
  const scheme = "owned-handler-test";
  const pref = `network.protocol-handler.external.${scheme}`;
  const makeHandler = () => ({
    scheme,
    QueryInterface: ChromeUtils.generateQI(["nsIProtocolHandler"]),
    get wrappedJSObject() {
      return this;
    },
    allowPort() {
      return false;
    },
    newChannel(uri, loadInfo) {
      return Services.io.newChannelFromURIWithLoadInfo(
        Services.io.newURI("data:text/plain,owned-handler"),
        loadInfo
      );
    },
  });
  const first = makeHandler();
  const replacement = makeHandler();
  const flags =
    Ci.nsIProtocolHandler.URI_NORELATIVE |
    Ci.nsIProtocolHandler.URI_LOADABLE_BY_ANYONE;

  registerCleanupFunction(() => {
    Services.prefs.clearUserPref(pref);
    try {
      Services.io.unregisterProtocolHandler(scheme);
    } catch (error) {
      if (error.result !== Cr.NS_ERROR_FACTORY_NOT_REGISTERED) {
        throw error;
      }
    }
  });

  Services.io.registerProtocolHandler(scheme, first, flags, -1);
  Services.prefs.setBoolPref(pref, true);
  Assert.notEqual(
    Services.io.getProtocolHandler(scheme).wrappedJSObject,
    first,
    "External protocol policy masks the runtime handler"
  );
  Services.io.unregisterProtocolHandler(scheme, first);
  Services.io.registerProtocolHandler(scheme, replacement, flags, -1);
  Assert.throws(
    () => Services.io.unregisterProtocolHandler(scheme, first),
    /NS_ERROR_FACTORY_NOT_REGISTERED/,
    "The previous owner cannot remove the masked replacement"
  );
  Services.prefs.clearUserPref(pref);
  Assert.equal(
    Services.io.getProtocolHandler(scheme).wrappedJSObject,
    replacement,
    "The replacement remains usable after clearing external protocol policy"
  );
});
