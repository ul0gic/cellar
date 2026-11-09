import { type HouseholdSettings, LIMITS } from '@cellar/contract';
import { html, render, type TemplateResult } from '@lightstart/light/html';
import { ApiError, call } from '../../app/api.ts';
import { invalidate, resourceFor } from '../../app/resources.ts';
import type { ScreenContext } from '../../app/types.ts';
import { confirm } from '../../design-system/dialogs.ts';
import { skeleton } from '../../design-system/skeleton.ts';
import { text } from '../../text/index.ts';
import { eventValue } from './parts/events.ts';
import { settingsPage } from './parts/frame.ts';
import { actionFailed, fieldError } from './parts/problems.ts';
import { loadFailed, watch } from './parts/watch.ts';

export function screen(ctx: ScreenContext): HTMLElement {
  return settingsPage(ctx, 'ai', (main) => {
    const settings = resourceFor('getSettings', {}, { tags: ['settings'] });
    let key = '';
    let keyError = '';
    let busy = false;

    const saved = async (): Promise<void> => {
      invalidate('settings');
      await ctx.person.refresh();
    };

    const save = async (): Promise<void> => {
      const trimmed = key.trim();
      keyError = trimmed.length < LIMITS.aiKey.min ? text('settings.ai.keyShort') : '';
      if (keyError !== '') {
        redraw();
        return;
      }
      busy = true;
      redraw();
      try {
        await call('saveAiKey', { body: { key: trimmed } });
        key = '';
        await saved();
      } catch (error) {
        if (error instanceof ApiError && error.code === 'validation_failed') {
          keyError = fieldError(error, 'key') || text('settings.ai.keyRefused');
        } else {
          actionFailed(error, () => void save());
        }
      } finally {
        busy = false;
      }
      redraw();
    };

    const remove = async (): Promise<void> => {
      const sure = await confirm({
        title: text('settings.ai.removeTitle'),
        message: text('settings.ai.removeBody'),
        confirmLabel: text('settings.ai.remove'),
        danger: true,
      });
      if (!sure) {
        return;
      }
      try {
        await call('removeAiKey', {});
        await saved();
      } catch (error) {
        actionFailed(error, () => void remove());
      }
    };

    const keyForm = (label: string, button: string): TemplateResult => html`<form
      class="cl-ai-form"
      novalidate
      @submit=${(event: SubmitEvent) => {
        event.preventDefault();
        if (!busy) {
          void save();
        }
      }}
    >
      <div class="cl-field">
        <lc-input
          label=${label}
          type="password"
          autocomplete="off"
          placeholder="sk-..."
          .value=${key}
          error-message=${keyError}
          hint=${text('settings.ai.hint')}
          @input=${(event: Event) => {
            key = eventValue(event);
          }}
        ></lc-input>
      </div>
      <div class="cl-actions">
        <lc-button variant="primary" type="submit" ?disabled=${busy}>${button}</lc-button>
      </div>
    </form>`;

    const view = (
      current: HouseholdSettings,
    ): TemplateResult => html`<section class="cl-sgroup" aria-labelledby="settings-ai">
      <h2 id="settings-ai">${text('settings.ai')}</h2>
      <p>${text('settings.ai.lead')}</p>
      ${
        current.ai.keySet
          ? html`<div class="cl-panel">
                <div class="cl-srow">
                  <span class="cl-srow-text"
                    ><b>${text('settings.ai.key')}</b
                    ><span>${text('settings.ai.savedKey', { last4: current.ai.keyLast4 ?? '' })}</span></span
                  >
                  <lc-button variant="ghost" @click=${() => void remove()}>${text('settings.ai.remove')}</lc-button>
                </div>
              </div>
              ${keyForm(text('settings.ai.replace'), text('settings.ai.replaceSave'))}`
          : keyForm(text('settings.ai.key'), text('settings.ai.save'))
      }
    </section>`;

    const redraw = watch(main, [settings], ({ state, retry }) => {
      const current = settings.peek();
      if (state === 'failed') {
        render(loadFailed(text('settings.ai'), retry), main);
      } else if (state === 'slow') {
        render(skeleton('lines', text('settings.ai')), main);
      } else if (state === 'ready' && current !== undefined) {
        render(view(current), main);
      }
    });
  });
}
