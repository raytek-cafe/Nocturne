/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { html, ifDefined } from "../vendor/lit.all.mjs";
import "chrome://global/content/elements/moz-button.mjs";
import { MozLitElement } from "../lit-utils.mjs";

/**
 * @tagname moz-input-color
 * @property {string} [value] - A CSS hex value of the initial color shown in the swatch area.
 * @property {string} [name] - Any name that will be associated with the component's nested `input` element. Useful when used in `form`s.
 * @property {string} label - The text of the label.
 * @property {boolean} [optional] - Whether an empty value represents a default color.
 * @property {string} [removeLabel] - The label for the optional value removal action.
 */
export default class MozInputColor extends MozLitElement {
  static properties = {
    value: { type: String },
    name: { type: String },
    label: { type: String, fluent: true },
    removeLabel: {
      type: String,
      attribute: "remove-label",
      fluent: true,
    },
    disabled: { type: Boolean, reflect: true },
    optional: { type: Boolean, reflect: true },
  };

  static queries = {
    inputEl: ".swatch",
  };

  static shadowRootOptions = {
    ...MozLitElement.shadowRootOptions,
    delegatesFocus: true,
  };

  constructor() {
    super();

    this.name = "";
    this.label = "";
    this.removeLabel = "";
    this.value = "";
    this.disabled = false;
    this.optional = false;
  }

  /**
   * @param {Event} e
   */
  updateInputFromEvent(e) {
    /**
     * @type {HTMLInputElement}
     */
    const input = /** @type {object} */ (e.target);
    this.value = input.value;
  }

  /**
   * @param {MouseEvent} event
   */
  removeOverride(event) {
    event.stopPropagation();
    this.inputEl.focus();
    this.value = "";
    this.dispatchEvent(new Event("change", { bubbles: true }));
  }

  /**
   * Dispatches an event from the host element so that outside
   * listeners can react to these events
   *
   * @param {Event} e
   * @memberof MozBaseInputElement
   */
  redispatchEvent(e) {
    this.updateInputFromEvent(e);

    let { bubbles, cancelable, composed, type } = e;
    let newEvent = new Event(type, {
      bubbles,
      cancelable,
      composed,
    });
    this.dispatchEvent(newEvent);
  }

  render() {
    const unset =
      this.optional && !/^#[0-9a-f]{6}$/i.test(this.value);
    return html`
      <link
        rel="stylesheet"
        href="chrome://global/content/elements/moz-input-color.css"
      />

      <label title=${ifDefined(unset ? undefined : this.value)}>
        <span class="swatch-container">
          <input
            type="color"
            name=${ifDefined(this.name)}
            .value=${unset ? "#ffffff" : this.value}
            ?disabled=${this.disabled}
            class="swatch"
            @input=${this.optional ? null : this.updateInputFromEvent}
            @change=${this.redispatchEvent}
          />
          ${unset
            ? html`<span class="default-swatch" aria-hidden="true"></span>`
            : null}
        </span>
        <span class="label">${this.label}</span>
        <img
          class="icon"
          alt=""
          src="chrome://global/skin/icons/edit-outline.svg"
        />
      </label>
      ${this.optional && this.value && !this.disabled
        ? html`
            <moz-button
              class="remove-override"
              type="ghost"
              size="small"
              .iconSrc=${"chrome://global/skin/icons/close.svg"}
              .title=${this.removeLabel}
              .ariaLabel=${this.removeLabel}
              @click=${this.removeOverride}
            ></moz-button>
          `
        : null}
    `;
  }
}
customElements.define("moz-input-color", MozInputColor);
