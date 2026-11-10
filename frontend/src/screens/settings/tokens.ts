import type { ApiToken, CreatedApiToken } from '@cellar/contract';
import type { FormField } from '@lightstart/components/types.js';
import View from '@lightstart/light';
import { html, nothing } from '@lightstart/light/html';
import { signal } from '@lightstart/light/signals';
import { ApiError, call } from '../../app/api.ts';
import { loadState } from '../../app/load.ts';
import { actionFailed, problemText } from '../../app/problems.ts';
import { apiResource, dataChanged } from '../../app/resources.ts';
import { setAppBar } from '../../app/shell.ts';
import { formValues, valueText } from '../../app/events.ts';
import { confirm } from '../../design-system/dialogs.ts';
import { toast } from '../../design-system/toast.ts';
import { formatDate } from '../../text/format.ts';
import { text } from '../../text/index.ts';
import { settingsFrame, settingsLoad } from './parts/frame.ts';
import { openSheet, type Sheet } from './parts/sheet.ts';
import '../../design-system/lc/alert.ts';
import '../../design-system/lc/button.ts';
import '../../design-system/lc/clipboard.ts';
import '../../design-system/lc/form.ts';
import '../../design-system/lc/icon.ts';

export const tag = 'cl-screen-settings-tokens';

const NAME_FIELDS: FormField[] = [
  {
    name: 'name',
    type: 'text',
    label: text('settings.tokens.name'),
    placeholder: text('settings.tokens.namePlaceholder'),
  },
];

function usage(token: ApiToken): string {
  const created = text('settings.tokens.created', { date: formatDate(token.createdAt) });
  return token.lastUsedAt === null
    ? `${created} ${text('settings.tokens.neverUsed')}`
    : `${created} ${text('settings.tokens.lastUsed', { date: formatDate(token.lastUsedAt) })}`;
}

class SettingsTokens extends View {
  readonly tokens = apiResource('listMyTokens', ['settings']);
  readonly state = loadState([this.tokens]);
  readonly created = signal<CreatedApiToken | null>(null);

  connected(): void {
    this.classList.add('cl-settings');
    setAppBar({ back: '/more' });
    this.tokens.bind(this, {});
  }

  private async revoke(token: ApiToken): Promise<void> {
    if (!this.isConnected) {
      return;
    }
    const sure = await confirm(this, {
      title: text('settings.tokens.revokeTitle', { name: token.name }),
      message: text('settings.tokens.revokeBody'),
      confirmLabel: text('settings.tokens.revokeConfirm'),
      danger: true,
    });
    if (!sure) {
      return;
    }
    try {
      await call('revokeMyToken', { params: { id: token.id } });
      dataChanged('settings');
      if (this.isConnected && this.created.peek()?.id === token.id) {
        this.created.value = null;
      }
    } catch (error) {
      actionFailed(error, () => void this.revoke(token));
    }
  }

  private newToken(): void {
    const fieldValues = signal<Record<string, unknown>>({});
    const fieldErrors = signal<Record<string, string>>({});
    const working = signal(false);
    const submit = async (): Promise<void> => {
      const trimmed = valueText(fieldValues.peek(), 'name').trim();
      if (trimmed.length === 0) {
        fieldErrors.value = { name: text('settings.tokens.nameMissing') };
        return;
      }
      fieldErrors.value = {};
      working.value = true;
      try {
        const token = await call('createMyToken', { body: { name: trimmed } });
        dataChanged('settings');
        if (this.isConnected) {
          this.created.value = token;
        }
        sheet.close();
      } catch (failure) {
        if (failure instanceof ApiError && (failure.code === 'token_limit' || failure.code === 'validation_failed')) {
          fieldErrors.value = { name: problemText(failure) };
        } else {
          actionFailed(failure, () => void submit());
        }
      } finally {
        working.value = false;
      }
    };
    const sheet: Sheet = openSheet(this, text('settings.tokens.new'), () => ({
      body: html`<lc-form
        class="cl-settings-form"
        layout="stacked"
        .fields=${NAME_FIELDS}
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
        <lc-button variant="primary" ?disabled=${working.value} @click=${() => void submit()}
          >${text('settings.tokens.create')}</lc-button
        >`,
    }));
  }

  private reveal(token: CreatedApiToken) {
    return html`<lc-alert
      class="cl-settings-banner"
      variant="info"
      icon="key-round"
      title=${text('settings.tokens.copyNow', { name: token.name })}
    >
      ${text('settings.tokens.copyNowBody')}
      <p class="cl-code">${token.token}</p>
      <div class="cl-banner-actions">
        <lc-clipboard
          text=${token.token}
          label=${text('settings.tokens.copy')}
          @copy=${() => toast({ title: text('settings.tokens.copied') })}
        ></lc-clipboard>
      </div>
    </lc-alert>`;
  }

  private view(list: readonly ApiToken[]) {
    const shown = this.created.value;
    return html`<section class="cl-sgroup" aria-labelledby="settings-tokens">
      <h2 id="settings-tokens">${text('settings.tokens')}</h2>
      <p>${text('settings.tokens.lead')}</p>
      ${shown === null ? nothing : this.reveal(shown)}
      ${
        list.length === 0
          ? html`<p class="cl-muted">${text('settings.tokens.none')}</p>`
          : html`<div class="cl-panel">
              ${list.map(
                (token) => html`<div class="cl-srow">
                  <span class="cl-srow-text"><b>${token.name}</b><span>${usage(token)}</span></span>
                  <lc-button
                    variant="ghost"
                    aria-label=${text('settings.tokens.revokeNamed', { name: token.name })}
                    @click=${() => void this.revoke(token)}
                    >${text('settings.tokens.revoke')}</lc-button
                  >
                </div>`,
              )}
            </div>`
      }
      <div class="cl-actions">
        <lc-button variant="quiet" @click=${() => this.newToken()}>
          <lc-icon name="plus" aria-hidden="true"></lc-icon>${text('settings.tokens.new')}
        </lc-button>
      </div>
    </section>`;
  }

  render() {
    return settingsFrame('tokens', () => {
      const list = this.tokens.value.value;
      return (
        settingsLoad(this.state, text('settings.tokens'), 'rows') ??
        (list === undefined ? nothing : this.view(list.tokens))
      );
    });
  }
}

View.register(tag, SettingsTokens);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: SettingsTokens;
  }
}
