/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/.
 */

interface XULControllers;

[ChromeOnly, Exposed=Window]
interface XULElement : Element {
  [HTMLConstructor] constructor();

  // Properties for hiding elements.
  attribute boolean hidden;
  attribute boolean collapsed;

  attribute EventHandler onbroadcast;
  attribute EventHandler oncommandupdate;
  attribute EventHandler ondialogaccept;
  attribute EventHandler ondialogcancel;
  attribute EventHandler ondialogdisclosure;
  attribute EventHandler ondialogextra1;
  attribute EventHandler ondialogextra2;
  attribute EventHandler ondialoghelp;
  attribute EventHandler onpopuphidden;
  attribute EventHandler onpopuphiding;
  attribute EventHandler onpopuppositioned;
  attribute EventHandler onpopupshowing;
  attribute EventHandler onpopupshown;

  // Property for hooking up to broadcasters
  [SetterThrows]
  attribute DOMString observes;

  // Properties for hooking up to popups
  [SetterThrows]
  attribute DOMString menu;
  [SetterThrows]
  attribute DOMString contextMenu;
  [SetterThrows]
  attribute DOMString tooltip;

  // Tooltip
  [SetterThrows]
  attribute DOMString tooltipText;

  // Properties for images
  [SetterThrows]
  attribute DOMString src;

  [BinaryName="ensureControllers"]
  readonly attribute XULControllers controllers;

  [NeedsCallerType]
  undefined click();
  undefined doCommand();

  // Returns true if this is a menu-type element that has a menu
  // frame associated with it.
  boolean hasMenu();

  // If this is a menu-type element, opens or closes the menu
  // depending on the argument passed.
  undefined openMenu(boolean open);
};

XULElement includes ElementOffsetAttributes;
XULElement includes GlobalEventHandlers;
XULElement includes HTMLOrSVGOrMathMLElement;
XULElement includes ElementCSSInlineStyle;
XULElement includes TouchEventHandlers;
XULElement includes OnErrorEventHandlerForNodes;
