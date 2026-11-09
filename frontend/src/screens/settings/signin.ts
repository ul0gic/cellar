import type { HouseholdSettings, SettingsPatch } from '@cellar/contract';
import { html, render } from '@lightstart/light/html';
import { ApiError, call } from '../../app/api.ts';
import { invalidate, resourceFor } from '../../app/resources.ts';
import type { ScreenContext } from '../../app/types.ts';
import { skeleton } from '../../design-system/skeleton.ts';
import { text } from '../../text/index.ts';
import { eventValue } from './parts/events.ts';
import { segmentedField, switchField } from './parts/fields.ts';
import { settingsPage } from './parts/frame.ts';
import { actionFailed, problemText } from './parts/problems.ts';
import { openSheet } from './parts/sheet.ts';
import { loadFailed, watch } from './parts/watch.ts';

const CURRENCY = /^[A-Z]{3}$/;

function confirmRequireLogin(on: boolean, done: (changed: boolean) => void, refresh: () => Promise<void>): void {
  let password = '';
  let error = '';
  let busy = false;
  let changed = false;
  const submit = async (): Promise<void> => {
    error = password.length === 0 ? text('settings.signin.passwordMissing') : '';
    if (error !== '') {
      sheet.redraw();
      return;
    }
    busy = true;
    sheet.redraw();
    try {
      await call('setRequireLogin', { body: { requireLogin: on, ownerPassword: password } });
      changed = true;
      invalidate('settings');
      await refresh();
      sheet.close();
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === 'validation_failed') {
        error = text('settings.signin.wrongPassword');
      } else if (failure instanceof ApiError && failure.code === 'require_login_blocked') {
        error = problemText(failure);
      } else {
        actionFailed(failure, () => void submit());
      }
    } finally {
      busy = false;
    }
    sheet.redraw();
  };
  const sheet = openSheet(
    on ? text('settings.signin.onTitle') : text('settings.signin.offTitle'),
    () => ({
      body: html`<form
      class="cl-sheet-form"
      novalidate
      @submit=${(event: SubmitEvent) => {
        event.preventDefault();
        if (!busy) {
          void submit();
        }
      }}
    >
      <p class="cl-muted">${on ? text('settings.signin.onBody') : text('settings.signin.offBody')}</p>
      <lc-input
        label=${text('settings.signin.yourPassword')}
        type="password"
        autocomplete="current-password"
        .value=${password}
        error-message=${error}
        @input=${(event: Event) => {
          password = eventValue(event);
        }}
      ></lc-input>
    </form>`,
      footer: html`<lc-button variant="quiet" @click=${() => sheet.close()}>${text('action.cancel')}</lc-button>
      <lc-button variant=${on ? 'primary' : 'danger'} ?disabled=${busy} @click=${() => void submit()}
        >${on ? text('settings.signin.onConfirm') : text('settings.signin.offConfirm')}</lc-button
      >`,
    }),
    () => done(changed),
  );
}

export function screen(ctx: ScreenContext): HTMLElement {
  return settingsPage(ctx, 'signin', (main) => {
    const settings = resourceFor('getSettings', {}, { tags: ['settings'] });
    let currency: string | null = null;
    let currencyError = '';

    const save = async (patch: SettingsPatch): Promise<void> => {
      try {
        await call('updateSettings', { body: patch });
        invalidate('settings', 'shelf', 'stats');
        await ctx.person.refresh();
      } catch (error) {
        actionFailed(error, () => void save(patch));
      }
    };

    const saveCurrency = (current: HouseholdSettings): void => {
      const next = (currency ?? current.currency).trim().toUpperCase();
      currencyError = CURRENCY.test(next) ? '' : text('settings.signin.currencyInvalid');
      if (currencyError === '' && next !== current.currency) {
        void save({ currency: next });
      }
      redraw();
    };

    const view = (current: HouseholdSettings) => html`<section class="cl-sgroup" aria-labelledby="settings-signin">
        <h2 id="settings-signin">${text('settings.signin')}</h2>
        ${switchField(
          text('settings.signin.require'),
          current.requireLogin ? text('settings.signin.onState') : text('settings.signin.offState'),
          current.requireLogin,
          (checked, revert) =>
            confirmRequireLogin(
              checked,
              (changed) => {
                if (!changed) {
                  revert();
                }
              },
              () => ctx.person.refresh(),
            ),
        )}
      </section>
      <section class="cl-sgroup" aria-labelledby="settings-household">
        <h2 id="settings-household">${text('settings.signin.household')}</h2>
        <div class="cl-form-grid">
          <div class="cl-field">
            <lc-input
              label=${text('settings.signin.currency')}
              autocapitalize="characters"
              .value=${currency ?? current.currency}
              error-message=${currencyError}
              hint=${text('settings.signin.currencyHint')}
              @input=${(event: Event) => {
                currency = eventValue(event);
              }}
              @change=${() => saveCurrency(current)}
            ></lc-input>
          </div>
          ${segmentedField(
            text('settings.signin.displayUnit'),
            [
              { value: 'oz', label: text('settings.profile.oz') },
              { value: 'ml', label: text('settings.profile.ml') },
            ],
            current.displayUnit,
            (unit) => void save({ displayUnit: unit === 'ml' ? 'ml' : 'oz' }),
          )}
        </div>
      </section>`;

    const redraw = watch(main, [settings], ({ state, retry }) => {
      const current = settings.peek();
      if (state === 'failed') {
        render(loadFailed(text('settings.signin'), retry), main);
      } else if (state === 'slow') {
        render(skeleton('lines', text('settings.signin')), main);
      } else if (state === 'ready' && current !== undefined) {
        render(view(current), main);
      }
    });
  });
}
