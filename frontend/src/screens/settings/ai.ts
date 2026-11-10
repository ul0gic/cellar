import { type HouseholdSettings, LIMITS } from '@cellar/contract';
import type { FormField } from '@lightstart/components/types.js';
import View from '@lightstart/light';
import { html, nothing, type TemplateResult } from '@lightstart/light/html';
import { signal } from '@lightstart/light/signals';
import { ApiError, call } from '../../app/api.ts';
import { session } from '../../app/controllers/session.ts';
import { loadState } from '../../app/load.ts';
import { actionFailed, formErrors } from '../../app/problems.ts';
import { apiResource, dataChanged } from '../../app/resources.ts';
import { setAppBar } from '../../app/shell.ts';
import { formValues, valueText } from '../../app/events.ts';
import { confirm } from '../../design-system/dialogs.ts';
import { text } from '../../text/index.ts';
import { settingsFrame, settingsLoad, settingsReadable } from './parts/frame.ts';
import '../../design-system/lc/button.ts';
import '../../design-system/lc/form.ts';

export const tag = 'cl-screen-settings-ai';

const KEY_NAMES = ['key'];

function keyFields(label: string): FormField[] {
  return [{ name: 'key', type: 'password', label, placeholder: 'sk-...', help: text('settings.ai.hint') }];
}

const SET_FIELDS = keyFields(text('settings.ai.key'));
const REPLACE_FIELDS = keyFields(text('settings.ai.replace'));

class SettingsAi extends View {
  readonly settings = apiResource('getSettings', ['settings']);
  readonly state = loadState([this.settings]);
  readonly values = signal<Record<string, unknown>>({});
  readonly errors = signal<Record<string, string>>({});
  readonly busy = signal(false);

  connected(): void {
    this.classList.add('cl-settings');
    setAppBar({ back: '/more' });
    if (settingsReadable('ai')) {
      this.settings.bind(this, {});
    }
  }

  private async saved(): Promise<void> {
    dataChanged('settings');
    await session.refresh();
  }

  private async save(): Promise<void> {
    const trimmed = valueText(this.values.peek(), 'key').trim();
    if (trimmed.length < LIMITS.aiKey.min) {
      this.errors.value = { key: text('settings.ai.keyShort') };
      return;
    }
    this.errors.value = {};
    this.busy.value = true;
    try {
      await call('saveAiKey', { body: { key: trimmed } });
      if (this.isConnected) {
        this.values.value = {};
      }
      await this.saved();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'validation_failed') {
        if (this.isConnected) {
          this.errors.value = { key: formErrors(error, KEY_NAMES).fields.key ?? text('settings.ai.keyRefused') };
        }
      } else {
        actionFailed(error, () => void this.save());
      }
    } finally {
      if (this.isConnected) {
        this.busy.value = false;
      }
    }
  }

  private async removeKey(): Promise<void> {
    if (!this.isConnected) {
      return;
    }
    const sure = await confirm(this, {
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
      await this.saved();
    } catch (error) {
      actionFailed(error, () => void this.removeKey());
    }
  }

  private keyForm(fields: FormField[], button: string): TemplateResult {
    return html`<lc-form
      class="cl-settings-form cl-ai-form"
      layout="stacked"
      .fields=${fields}
      .data=${this.values.value}
      .errors=${this.errors.value}
      @field-change=${(event: Event) => {
        const values = formValues(event);
        if (values !== null) {
          this.values.value = values;
        }
      }}
      @form-submit=${() => {
        if (!this.busy.peek()) {
          void this.save();
        }
      }}
    >
      <div class="cl-actions">
        <lc-button variant="primary" type="submit" ?disabled=${this.busy.value}>${button}</lc-button>
      </div>
    </lc-form>`;
  }

  private view(current: HouseholdSettings): TemplateResult {
    return html`<section class="cl-sgroup" aria-labelledby="settings-ai">
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
                  <lc-button variant="ghost" @click=${() => void this.removeKey()}>${text('settings.ai.remove')}</lc-button>
                </div>
              </div>
              ${this.keyForm(REPLACE_FIELDS, text('settings.ai.replaceSave'))}`
          : this.keyForm(SET_FIELDS, text('settings.ai.save'))
      }
    </section>`;
  }

  render() {
    return settingsFrame('ai', () => {
      const current = this.settings.value.value;
      return (
        settingsLoad(this.state, text('settings.ai'), 'lines') ?? (current === undefined ? nothing : this.view(current))
      );
    });
  }
}

View.register(tag, SettingsAi);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: SettingsAi;
  }
}
