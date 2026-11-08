import {
  type AmountDisplay,
  type AmountInput,
  formatAmount,
  type LineStatus,
  type PreferredUnit,
  type SubstitutionEffect,
} from '@cellar/contract';
import { defineComponent } from '@lightstart/light';
import { navigation } from '@lightstart/light/navigation';
import { html, type TemplateResult } from '@lightstart/light/html';
import T from '@lightstart/light/types';
import { text } from '../text/index.ts';
import type { BulbStatus } from './cl-bulb.ts';
import './cl-ingredient-line.css';
import { typedDefault } from './typed-default.ts';

type AmountColumns =
  | { readonly kind: 'word'; readonly word: string }
  | {
      readonly kind: 'amount';
      readonly whole: string;
      readonly fraction: string;
      readonly range: boolean;
      readonly unit: string;
      readonly unitWord: string;
    };

const SHORT_UNITS: Readonly<Record<string, string>> = { barspoon: 'bsp', barspoons: 'bsp' };
const UNIT_COLUMN_CHARS = 6;
const QUARTER = /^(\d+)?\s?([¼½¾])$/;
const HALF_ML = /^(\d+)(\.\d+)$/;

export function amountColumns(display: AmountDisplay): AmountColumns {
  if (display.value === '') {
    return { kind: 'word', word: display.text };
  }
  const shortUnit =
    display.unit.length > UNIT_COLUMN_CHARS ? (SHORT_UNITS[display.unit] ?? display.unit) : display.unit;
  const base = { kind: 'amount' as const, unit: shortUnit, unitWord: display.unit };
  if (display.value.includes('–')) {
    return { ...base, whole: display.value, fraction: '', range: true };
  }
  const quarter = QUARTER.exec(display.value) ?? HALF_ML.exec(display.value);
  if (quarter !== null) {
    return { ...base, whole: quarter[1] ?? '', fraction: quarter[2] ?? '', range: false };
  }
  return { ...base, whole: display.value, fraction: '', range: false };
}

const NO_AMOUNT = typedDefault<AmountInput>({ amount: null, amountMax: null, unit: 'ml' });
const OZ = typedDefault<PreferredUnit>('oz');
const ON_HAND = typedDefault<LineStatus>('on_hand');
const NO_EFFECT = typedDefault<SubstitutionEffect | null>(null);

export const clIngredientLine = defineComponent({
  tag: 'cl-ingredient-line',
  style: true,
  props: {
    amount: NO_AMOUNT,
    unit: OZ,
    servings: 1,
    name: '',
    href: '',
    status: ON_HAND,
    via: '',
    bottle: '',
    effect: NO_EFFECT,
    optional: false,
    note: '',
  },
  events: {
    more: T.object(),
  },
  _bulb(): BulbStatus {
    if (this.optional) {
      return 'optional';
    }
    if (this.status === 'on_hand') {
      return 'on';
    }
    return this.status === 'missing' ? 'off' : 'via';
  },
  _statusLine(): TemplateResult {
    const prefix = this.optional ? `${text('line.optional')} ` : '';
    switch (this.status) {
      case 'on_hand':
        return html`${prefix}${this.bottle ? text('line.onHandBottle', { bottle: this.bottle }) : text('line.onHand')}`;
      case 'missing':
        return html`${prefix}${text('line.missing')}`;
      case 'via_substitute':
        return html`${prefix}<b>${text('line.viaSubstitute')}</b> ${this.via}`;
      case 'via_variant':
        return html`${prefix}<b>${text('line.viaVariant')}</b> ${this.via}`;
      case 'via_house_made':
        return html`${prefix}<b>${text('line.viaHouseMade')}</b> ${this.via}`;
      case 'via_household_substitution':
        return html`${prefix}<b>${text('line.viaHousehold')}</b> ${this.via}.
          ${this.effect === 'changes_drink' ? text('line.changesDrink') : text('line.sameDrink')}`;
    }
  },
  _amount(): TemplateResult {
    const columns = amountColumns(formatAmount(this.amount, this.unit, this.servings));
    if (columns.kind === 'word') {
      return html`<span part="cl-ingredient-line-word">${columns.word}</span>`;
    }
    return html`
      ${
        columns.range
          ? html`<span part="cl-ingredient-line-range">${columns.whole}</span>`
          : html`<span part="cl-ingredient-line-whole">${columns.whole}</span><span part="cl-ingredient-line-fraction">${columns.fraction}</span>`
      }
      <span part="cl-ingredient-line-unit" aria-hidden="true">${columns.unit}</span>
      <span class="cl-vh">${columns.unitWord}</span>
    `;
  },
  render() {
    const missing = this.status === 'missing' && !this.optional;
    return html`
      <div part="cl-ingredient-line-row" class=${`${missing ? 'is-missing' : ''} ${this.optional ? 'is-optional' : ''}`}>
        <cl-bulb part="cl-ingredient-line-bulb" status=${this._bulb()} label=${text(missing ? 'bulb.missing' : this.optional ? 'bulb.optional' : this.status === 'on_hand' ? 'bulb.onHand' : 'bulb.via')}></cl-bulb>
        ${this._amount()}
        <span part="cl-ingredient-line-main">
          <a part="cl-ingredient-line-name" href=${navigation.href(this.href)}>${this.name}</a>
          ${this.note ? html`<span part="cl-ingredient-line-note">${this.note}</span>` : ''}
          <span part="cl-ingredient-line-status">${this._statusLine()}</span>
        </span>
        <button
          type="button"
          part="cl-ingredient-line-more"
          aria-label=${text('line.moreActions', { ingredient: this.name })}
          @click=${(event: MouseEvent) => this.$emit('more', { trigger: event.currentTarget })}
        ><lc-icon name="ellipsis" aria-hidden="true"></lc-icon></button>
      </div>
    `;
  },
});
