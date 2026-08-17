/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Content handler for downloaded Brightwork packages, cloned from
 * amContentHandler (the application/x-xpinstall handler). A site serves a
 * package with Content-Type: application/x-brightwork or a bwpkg named file.
 * When the user follows such a link, this intercepts the load, cancels the would-be download, and
 * hands the URL to the parent-process BrightworkProvider.
 */

const BRIGHTWORK_CONTENT_TYPE = "application/x-brightwork";
const MSG_INSTALL_BRIGHTWORK = "Brightwork:InstallFromWeb";

export function BrightworkContentHandler() {}

BrightworkContentHandler.prototype = {
  /**
   * Handles a new request for an application/x-brightwork file.
   *
   * @param  aMimetype  the mimetype of the file
   * @param  aContext   the context passed to nsIChannel.asyncOpen
   * @param  aRequest   the nsIRequest dealing with the content
   */
  handleContent(aMimetype, aContext, aRequest) {
    if (aMimetype != BRIGHTWORK_CONTENT_TYPE) {
      throw Components.Exception("", Cr.NS_ERROR_WONT_HANDLE_CONTENT);
    }

    if (!(aRequest instanceof Ci.nsIChannel)) {
      throw Components.Exception("", Cr.NS_ERROR_WONT_HANDLE_CONTENT);
    }

    let uri = aRequest.URI;

    // A user gesture must be in play, so window.open or
    // window.location can't silently start a brightwork install even from
    // inside a user-triggered event listener.
    if (
      !aRequest.loadInfo.hasValidUserGestureActivation &&
      Services.prefs.getBoolPref("xpinstall.userActivation.required", true)
    ) {
      let error = Components.Exception(
        `${uri.spec} bwork install cancelled because of missing activation trigger`,
        Cr.NS_ERROR_WONT_HANDLE_CONTENT
      );
      Cu.reportError(error);
      throw error;
    }

    aRequest.cancel(Cr.NS_BINDING_ABORTED);

    let { loadInfo } = aRequest;
    let sourceHost;
    let sourceURL;
    try {
      let { triggeringPrincipal } = loadInfo;
      sourceURL =
        triggeringPrincipal.spec != "" ? triggeringPrincipal.spec : undefined;
      sourceHost = triggeringPrincipal.host;
    } catch (e) {
      // TODO: what to do here?
    }

    // Hand off to the parent process (coz the provider lives there). cpmm->ppmm
    // works whether this runs in a content or the parent process. The browsing
    // context lets the parent anchor the install doorhanger to the right tab.
    Services.cpmm.sendAsyncMessage(MSG_INSTALL_BRIGHTWORK, {
      uri: uri.spec,
      sourceHost,
      sourceURL,
      browsingContext: aRequest.loadInfo.targetBrowsingContext,
    });
  },

  classID: Components.ID("{37ce74f6-834c-4151-ae03-25d9ccadda7e}"),
  QueryInterface: ChromeUtils.generateQI(["nsIContentHandler"]),
};
