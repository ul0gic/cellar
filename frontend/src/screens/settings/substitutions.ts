import type { HouseholdSubstitution, SubstitutionEffect } from '@cellar/contract';
import type { FormField, FormTypeHandlers } from '@lightstart/components/types.js';
import View from '@lightstart/light';
import { html, nothing, type TemplateResult } from '@lightstart/light/html';
import { type Signal, signal } from '@lightstart/light/signals';
import { ApiError, call } from '../../app/api.ts';
import { detailText, eventPick } from '../../app/events.ts';
import { loadState } from '../../app/load.ts';
import { actionFailed, problemText } from '../../app/problems.ts';
import { apiResource, dataChanged } from '../../app/resources.ts';
import { setAppBar } from '../../app/shell.ts';
import { text } from '../../text/index.ts';
import { segmentedField } from './parts/fields.ts';
import { settingsFrame, settingsLoad } from './parts/frame.ts';
import '../../design-system/lc/button.ts';
import '../../design-system/lc/form.ts';
import '../../design-system/lc/icon.ts';
import '../../design-system/lc/search.ts';

export const tag = 'cl-screen-settings-substitutions';

const PICKER_ROWS = 8;
const PICKER_TYPE = 'settings-ingredient-picker';

interface Picked {
  readonly id: number;
  readonly title: string;
}

interface Picker {
  readonly picked: Picked | null;
  readonly docs: readonly { readonly id: number; readonly group: string; readonly title: string }[];
  readonly asked: number;
}

const EMPTY_PICKER: Picker = { picked: null, docs: [], asked: 0 };

const FIELDS: FormField[] = [
  { name: 'from', type: PICKER_TYPE },
  { name: 'to', type: PICKER_TYPE },
];

class SettingsSubstitutions extends View {
  readonly substitutions = apiResource('listSubstitutions', ['shelf']);
  readonly state = loadState([this.substitutions]);
  readonly from = signal<Picker>(EMPTY_PICKER);
  readonly to = signal<Picker>(EMPTY_PICKER);
  readonly effect = signal<SubstitutionEffect>('same_drink');
  readonly formError = signal('');
  readonly busy = signal(false);
  readonly handlers: FormTypeHandlers = {
    [PICKER_TYPE]: {
      render: (field) =>
        field.name === 'from'
          ? this.pickerField(text('settings.subs.from'), this.from)
          : this.pickerField(text('settings.subs.to'), this.to),
    },
  };

  connected(): void {
    this.classList.add('cl-settings');
    setAppBar({ back: '/more' });
    this.substitutions.bind(this, {});
  }

  private async lookup(picker: Signal<Picker>, query: string): Promise<void> {
    const asked = picker.peek().asked + 1;
    picker.value = { picked: null, docs: query.trim().length === 0 ? [] : picker.peek().docs, asked };
    if (query.trim().length === 0) {
      return;
    }
    try {
      const page = await call('listIngredients', { query: { q: query.trim(), pageSize: PICKER_ROWS } });
      if (this.isConnected && picker.peek().asked === asked) {
        const group = text('settings.subs.ingredients');
        picker.value = {
          picked: null,
          docs: page.items.map((item) => ({ id: item.id, group, title: item.name })),
          asked,
        };
      }
    } catch (error) {
      actionFailed(error, () => void this.lookup(picker, query));
    }
  }

  private pickerField(label: string, picker: Signal<Picker>): TemplateResult {
    const state = picker.value;
    return html`<div class="cl-field">
      <lc-search
        remote
        inline
        label=${label}
        placeholder=${text('settings.subs.placeholder')}
        query=${state.picked?.title ?? ''}
        .docs=${state.docs}
        @search-input=${(event: Event) => void this.lookup(picker, detailText(event))}
        @search-select=${(event: Event) => {
          picker.value = { ...picker.peek(), picked: eventPick(event) };
          this.formError.value = '';
        }}
      ></lc-search>
    </div>`;
  }

  private async add(): Promise<void> {
    const from = this.from.peek().picked;
    const to = this.to.peek().picked;
    if (from === null || to === null) {
      this.formError.value = text('settings.subs.pickBoth');
      return;
    }
    if (from.id === to.id) {
      this.formError.value = text('settings.subs.different');
      return;
    }
    this.formError.value = '';
    this.busy.value = true;
    try {
      await call('createSubstitution', {
        body: { fromIngredientId: from.id, toIngredientId: to.id, effect: this.effect.peek() },
      });
      dataChanged('shelf', 'recipes');
      if (this.isConnected) {
        this.from.value = EMPTY_PICKER;
        this.to.value = EMPTY_PICKER;
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === 'validation_failed') {
        if (this.isConnected) {
          this.formError.value = problemText(error);
        }
      } else {
        actionFailed(error, () => void this.add());
      }
    } finally {
      if (this.isConnected) {
        this.busy.value = false;
      }
    }
  }

  private async removeSubstitution(substitution: HouseholdSubstitution): Promise<void> {
    try {
      await call('deleteSubstitution', { params: { id: substitution.id } });
      dataChanged('shelf', 'recipes');
    } catch (error) {
      actionFailed(error, () => void this.removeSubstitution(substitution));
    }
  }

  private row(substitution: HouseholdSubstitution) {
    const pair = text('settings.subs.pair', { have: substitution.to.name, asked: substitution.from.name });
    const effectText =
      substitution.effect === 'same_drink' ? text('settings.subs.same') : text('settings.subs.changes');
    return html`<div class="cl-srow">
      <span class="cl-srow-text"
        ><b>${pair}</b
        ><span
          >${
            substitution.createdBy === null
              ? `${effectText}.`
              : text('settings.subs.addedBy', { effect: effectText, name: substitution.createdBy.name })
          }</span
        ></span
      >
      <lc-button
        variant="ghost"
        icon-only
        aria-label=${text('settings.subs.remove', { pair })}
        @click=${() => void this.removeSubstitution(substitution)}
        ><lc-icon name="x" aria-hidden="true"></lc-icon
      ></lc-button>
    </div>`;
  }

  private view(list: readonly HouseholdSubstitution[]) {
    return html`<section class="cl-sgroup" aria-labelledby="settings-subs">
      <h2 id="settings-subs">${text('settings.subs.title')}</h2>
      <p>${text('settings.subs.lead')}</p>
      ${
        list.length === 0
          ? html`<p class="cl-muted">${text('settings.subs.none')}</p>`
          : html`<div class="cl-panel">${list.map((substitution) => this.row(substitution))}</div>`
      }
      <lc-form
        class="cl-settings-form cl-subs-form"
        .fields=${FIELDS}
        .data=${{ from: this.from.value, to: this.to.value }}
        .typeHandlers=${this.handlers}
        @form-submit=${() => {
          if (!this.busy.peek()) {
            void this.add();
          }
        }}
      >
        ${segmentedField(
          text('settings.subs.effect'),
          [
            { value: 'same_drink', label: text('settings.subs.sameLong') },
            { value: 'changes_drink', label: text('settings.subs.changesLong') },
          ],
          this.effect.value,
          (value) => {
            this.effect.value = value === 'changes_drink' ? 'changes_drink' : 'same_drink';
          },
        )}
        ${this.formError.value === '' ? nothing : html`<p class="cl-field-error" role="alert">${this.formError.value}</p>`}
        <div class="cl-actions">
          <lc-button variant="primary" type="submit" ?disabled=${this.busy.value}>${text('settings.subs.add')}</lc-button>
        </div>
      </lc-form>
    </section>`;
  }

  render() {
    return settingsFrame('substitutions', () => {
      const list = this.substitutions.value.value;
      return (
        settingsLoad(this.state, text('settings.substitutions'), 'rows') ??
        (list === undefined ? nothing : this.view(list.substitutions))
      );
    });
  }
}

View.register(tag, SettingsSubstitutions);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: SettingsSubstitutions;
  }
}
