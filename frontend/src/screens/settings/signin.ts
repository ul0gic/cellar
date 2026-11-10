import type { HouseholdSettings, SettingsPatch } from '@cellar/contract';
import type { FormField, FormTypeHandlers } from '@lightstart/components/types.js';
import View from '@lightstart/light';
import { html, nothing } from '@lightstart/light/html';
import { signal } from '@lightstart/light/signals';
import { ApiError, call } from '../../app/api.ts';
import { session } from '../../app/controllers/session.ts';
import { eventText, formValues, valueText } from '../../app/events.ts';
import { loadState } from '../../app/load.ts';
import { actionFailed, problemText } from '../../app/problems.ts';
import { apiResource, dataChanged } from '../../app/resources.ts';
import { setAppBar } from '../../app/shell.ts';
import { text } from '../../text/index.ts';
import { segmentedField, switchField } from './parts/fields.ts';
import { settingsFrame, settingsLoad, settingsReadable } from './parts/frame.ts';
import { openSheet, type Sheet } from './parts/sheet.ts';
import '../../design-system/lc/button.ts';
import '../../design-system/lc/form.ts';
import '../../design-system/lc/input.ts';

export const tag = 'cl-screen-settings-signin';

const CURRENCY = /^[A-Z]{3}$/;
const LEAD_TYPE = 'settings-lead';

const PASSWORD_FIELD: FormField = {
  name: 'ownerPassword',
  type: 'password',
  label: text('settings.signin.yourPassword'),
};

class SettingsSignin extends View {
  readonly settings = apiResource('getSettings', ['settings']);
  readonly state = loadState([this.settings]);
  readonly currency = signal<string | null>(null);
  readonly currencyError = signal('');

  connected(): void {
    this.classList.add('cl-settings');
    setAppBar({ back: '/more' });
    if (settingsReadable('signin')) {
      this.settings.bind(this, {});
    }
  }

  private async save(patch: SettingsPatch): Promise<void> {
    try {
      await call('updateSettings', { body: patch });
      dataChanged('settings', 'shelf', 'stats');
      await session.refresh();
    } catch (error) {
      actionFailed(error, () => void this.save(patch));
    }
  }

  private saveCurrency(current: HouseholdSettings): void {
    const next = (this.currency.value ?? current.currency).trim().toUpperCase();
    this.currencyError.value = CURRENCY.test(next) ? '' : text('settings.signin.currencyInvalid');
    if (this.currencyError.value === '' && next !== current.currency) {
      void this.save({ currency: next });
    }
  }

  private confirmRequireLogin(on: boolean, revert: () => void): void {
    const fieldValues = signal<Record<string, unknown>>({});
    const fieldErrors = signal<Record<string, string>>({});
    const working = signal(false);
    const applied = signal(false);
    const submit = async (): Promise<void> => {
      const password = valueText(fieldValues.peek(), 'ownerPassword');
      if (password.length === 0) {
        fieldErrors.value = { ownerPassword: text('settings.signin.passwordMissing') };
        return;
      }
      fieldErrors.value = {};
      working.value = true;
      try {
        await call('setRequireLogin', { body: { requireLogin: on, ownerPassword: password } });
        applied.value = true;
        dataChanged('settings');
        await session.refresh();
        sheet.close();
      } catch (failure) {
        if (failure instanceof ApiError && failure.code === 'validation_failed') {
          fieldErrors.value = { ownerPassword: text('settings.signin.wrongPassword') };
        } else if (failure instanceof ApiError && failure.code === 'require_login_blocked') {
          fieldErrors.value = { ownerPassword: problemText(failure) };
        } else {
          actionFailed(failure, () => void submit());
        }
      } finally {
        working.value = false;
      }
    };
    const fields: FormField[] = [{ name: 'lead', type: LEAD_TYPE }, PASSWORD_FIELD];
    const handlers: FormTypeHandlers = {
      [LEAD_TYPE]: {
        render: () =>
          html`<p class="cl-muted">${on ? text('settings.signin.onBody') : text('settings.signin.offBody')}</p>`,
      },
    };
    const sheet: Sheet = openSheet(
      this,
      on ? text('settings.signin.onTitle') : text('settings.signin.offTitle'),
      () => ({
        body: html`<lc-form
          class="cl-settings-form"
          layout="stacked"
          .fields=${fields}
          .typeHandlers=${handlers}
          .data=${fieldValues.value}
          .errors=${fieldErrors.value}
          @field-change=${(event: Event) => {
            const values = formValues(event);
            if (values !== null) {
              fieldValues.value = values;
            }
          }}
          @form-submit=${() => {
            if (!working.peek()) {
              void submit();
            }
          }}
        ></lc-form>`,
        footer: html`<lc-button variant="quiet" @click=${() => sheet.close()}>${text('action.cancel')}</lc-button>
          <lc-button variant=${on ? 'primary' : 'danger'} ?disabled=${working.value} @click=${() => void submit()}
            >${on ? text('settings.signin.onConfirm') : text('settings.signin.offConfirm')}</lc-button
          >`,
      }),
      () => {
        if (!applied.peek()) {
          revert();
        }
      },
    );
  }

  private view(current: HouseholdSettings) {
    return html`<section class="cl-sgroup" aria-labelledby="settings-signin">
        <h2 id="settings-signin">${text('settings.signin')}</h2>
        ${switchField(
          text('settings.signin.require'),
          current.requireLogin ? text('settings.signin.onState') : text('settings.signin.offState'),
          current.requireLogin,
          (checked, revert) => this.confirmRequireLogin(checked, revert),
        )}
      </section>
      <section class="cl-sgroup" aria-labelledby="settings-household">
        <h2 id="settings-household">${text('settings.signin.household')}</h2>
        <div class="cl-form-grid">
          <div class="cl-field">
            <lc-input
              label=${text('settings.signin.currency')}
              autocapitalize="characters"
              .value=${this.currency.value ?? current.currency}
              error-message=${this.currencyError.value}
              hint=${text('settings.signin.currencyHint')}
              @input=${(event: Event) => {
                this.currency.value = eventText(event);
              }}
              @change=${() => this.saveCurrency(current)}
            ></lc-input>
          </div>
          ${segmentedField(
            text('settings.signin.displayUnit'),
            [
              { value: 'oz', label: text('settings.profile.oz') },
              { value: 'ml', label: text('settings.profile.ml') },
            ],
            current.displayUnit,
            (unit) => void this.save({ displayUnit: unit === 'ml' ? 'ml' : 'oz' }),
          )}
        </div>
      </section>`;
  }

  render() {
    return settingsFrame('signin', () => {
      const current = this.settings.value.value;
      return (
        settingsLoad(this.state, text('settings.signin'), 'lines') ??
        (current === undefined ? nothing : this.view(current))
      );
    });
  }
}

View.register(tag, SettingsSignin);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: SettingsSignin;
  }
}
