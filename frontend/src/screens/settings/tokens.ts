import type { ApiToken, CreatedApiToken } from '@cellar/contract';
import { html, nothing, render } from '@lightstart/light/html';
import { ApiError, call } from '../../app/api.ts';
import { invalidate, resourceFor } from '../../app/resources.ts';
import type { ScreenContext } from '../../app/types.ts';
import { confirm } from '../../design-system/dialogs.ts';
import { skeleton } from '../../design-system/skeleton.ts';
import { toast } from '../../design-system/toast.ts';
import { formatDate } from '../../text/format.ts';
import { text } from '../../text/index.ts';
import { eventValue } from './parts/events.ts';
import { settingsPage } from './parts/frame.ts';
import { actionFailed, problemText } from './parts/problems.ts';
import { openSheet } from './parts/sheet.ts';
import { loadFailed, watch } from './parts/watch.ts';

function usage(token: ApiToken): string {
  const created = text('settings.tokens.created', { date: formatDate(token.createdAt) });
  return token.lastUsedAt === null
    ? `${created} ${text('settings.tokens.neverUsed')}`
    : `${created} ${text('settings.tokens.lastUsed', { date: formatDate(token.lastUsedAt) })}`;
}

function newToken(created: (token: CreatedApiToken) => void): void {
  let name = '';
  let error = '';
  let busy = false;
  const submit = async (): Promise<void> => {
    const trimmed = name.trim();
    error = trimmed.length === 0 ? text('settings.tokens.nameMissing') : '';
    if (error !== '') {
      sheet.redraw();
      return;
    }
    busy = true;
    sheet.redraw();
    try {
      created(await call('createMyToken', { body: { name: trimmed } }));
      invalidate('settings');
      sheet.close();
    } catch (failure) {
      if (failure instanceof ApiError && (failure.code === 'token_limit' || failure.code === 'validation_failed')) {
        error = problemText(failure);
      } else {
        actionFailed(failure, () => void submit());
      }
    } finally {
      busy = false;
    }
    sheet.redraw();
  };
  const sheet = openSheet(text('settings.tokens.new'), () => ({
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
      <lc-input
        label=${text('settings.tokens.name')}
        placeholder=${text('settings.tokens.namePlaceholder')}
        .value=${name}
        error-message=${error}
        @input=${(event: Event) => {
          name = eventValue(event);
        }}
      ></lc-input>
    </form>`,
    footer: html`<lc-button variant="quiet" @click=${() => sheet.close()}>${text('action.cancel')}</lc-button>
      <lc-button variant="primary" ?disabled=${busy} @click=${() => void submit()}
        >${text('settings.tokens.create')}</lc-button
      >`,
  }));
}

export function screen(ctx: ScreenContext): HTMLElement {
  return settingsPage(ctx, 'tokens', (main) => {
    const tokens = resourceFor('listMyTokens', {}, { tags: ['settings'] });
    let created: CreatedApiToken | null = null;

    const revoke = async (token: ApiToken): Promise<void> => {
      const sure = await confirm({
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
        if (created?.id === token.id) {
          created = null;
        }
        invalidate('settings');
      } catch (error) {
        actionFailed(error, () => void revoke(token));
      }
    };

    const reveal = (token: CreatedApiToken) => html`<lc-alert
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

    const view = (list: readonly ApiToken[]) => html`<section class="cl-sgroup" aria-labelledby="settings-tokens">
      <h2 id="settings-tokens">${text('settings.tokens')}</h2>
      <p>${text('settings.tokens.lead')}</p>
      ${created === null ? nothing : reveal(created)}
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
                    @click=${() => void revoke(token)}
                    >${text('settings.tokens.revoke')}</lc-button
                  >
                </div>`,
              )}
            </div>`
      }
      <div class="cl-actions">
        <lc-button
          variant="quiet"
          @click=${() =>
            newToken((token) => {
              created = token;
              redraw();
            })}
        >
          <lc-icon name="plus" aria-hidden="true"></lc-icon>${text('settings.tokens.new')}
        </lc-button>
      </div>
    </section>`;

    const redraw = watch(main, [tokens], ({ state, retry }) => {
      const list = tokens.peek();
      if (state === 'failed') {
        render(loadFailed(text('settings.tokens'), retry), main);
      } else if (state === 'slow') {
        render(skeleton('rows', text('settings.tokens')), main);
      } else if (state === 'ready' && list !== undefined) {
        render(view(list.tokens), main);
      }
    });
  });
}
