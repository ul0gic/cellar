import type { FormField } from '@lightstart/components/types.js';
import View from '@lightstart/light';
import { html, nothing, type TemplateResult } from '@lightstart/light/html';
import { effect, signal } from '@lightstart/light/signals';
import { ApiError, call } from '../../app/api.ts';
import { session } from '../../app/controllers/session.ts';
import { eventField, formValues } from '../../app/events.ts';
import { actionFailed } from '../../app/problems.ts';
import { navigate } from '../../app/router.ts';
import '../../design-system/lc/alert.ts';
import '../../design-system/lc/button.ts';
import '../../design-system/lc/form.ts';
import '../../design-system/lc/icon.ts';
import '../../design-system/lc/progress-bar.ts';
import '../../design-system/lc/textarea.ts';
import { text } from '../../text/index.ts';

const tag = 'cl-import-export-web';

type Mode = 'url' | 'text';
type Busy = 'url' | 'url-ai' | 'text' | 'text-ai';

function isWebAddress(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (error) {
    if (error instanceof TypeError) {
      return false;
    }
    throw error;
  }
}

function urlProblem(error: ApiError): string | null {
  switch (error.code) {
    case 'url_not_allowed':
      return text('import-export.urlRefused');
    case 'fetch_timeout':
      return text('import-export.urlTimeout');
    case 'page_too_large':
      return text('import-export.urlTooLarge');
    case 'fetch_failed':
      return text('import-export.urlFailed', { reason: error.detail });
    case 'ai_provider_error':
    case 'ai_timeout':
      return text('import-export.aiFailed', { reason: error.detail });
    case 'validation_failed':
      return text('import-export.urlNotWeb');
    default:
      return null;
  }
}

const NO_ERRORS: Readonly<Record<string, string>> = {};

class WebPanel extends View {
  readonly mode = signal<Mode>('url');
  readonly values = signal<Readonly<Record<string, unknown>>>({ url: '' });
  readonly pasted = signal('');
  readonly busy = signal<Busy | null>(null);
  readonly urlError = signal<string | null>(null);
  readonly textError = signal<string | null>(null);
  readonly noRecipe = signal(false);

  connected(): void {
    this.classList.add('cl-import-web');
    let shown = this.mode.peek();
    let frame: number | null = null;
    const follow = effect(() => {
      const mode = this.mode.value;
      if (mode === shown) {
        return;
      }
      shown = mode;
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          frame = null;
          this.querySelector<HTMLElement>(this.mode.peek() === 'url' ? 'lc-input' : 'lc-textarea')?.focus();
        });
      });
    });
    this.$own(() => {
      follow.dispose();
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
    });
  }

  aiEnabled(): boolean {
    return session.current.value?.household.aiEnabled === true;
  }

  async readUrl(useAi: boolean): Promise<void> {
    const submitted = this.values.peek().url;
    const url = typeof submitted === 'string' ? submitted.trim() : '';
    this.noRecipe.value = false;
    if (!isWebAddress(url)) {
      this.urlError.value = text('import-export.urlNotWeb');
      return;
    }
    this.urlError.value = null;
    this.busy.value = useAi ? 'url-ai' : 'url';
    try {
      const draft = await call('importFromUrl', { body: { url, useAi } });
      if (this.isConnected) {
        navigate('/recipes/new', { state: { draft } });
      }
    } catch (error) {
      if (!(error instanceof ApiError)) {
        throw error;
      }
      if (error.code === 'no_recipe_data') {
        this.noRecipe.value = true;
        this.urlError.value = text('import-export.urlNone');
      } else {
        const message = urlProblem(error);
        if (message === null) {
          actionFailed(error, () => void this.readUrl(useAi));
        }
        this.urlError.value = message;
      }
    } finally {
      this.busy.value = null;
    }
  }

  async readText(useAi: boolean): Promise<void> {
    const body = this.pasted.peek().trim();
    if (body.length === 0) {
      return;
    }
    this.textError.value = null;
    this.busy.value = useAi ? 'text-ai' : 'text';
    try {
      const draft = await call('importFromText', { body: { text: body, useAi } });
      if (this.isConnected) {
        navigate('/recipes/new', { state: { draft } });
      }
    } catch (error) {
      if (!(error instanceof ApiError)) {
        throw error;
      }
      const message = error.code === 'ai_provider_error' || error.code === 'ai_timeout' ? urlProblem(error) : null;
      if (message === null && error.code !== 'validation_failed') {
        actionFailed(error, () => void this.readText(useAi));
      }
      this.textError.value = message ?? (error.code === 'validation_failed' ? error.detail : null);
    } finally {
      this.busy.value = null;
    }
  }

  progress(): TemplateResult | typeof nothing {
    const busy = this.busy.value;
    if (busy === null) {
      return nothing;
    }
    const label = busy.startsWith('url') ? text('import-export.reading') : text('import-export.readingText');
    return html`<lc-progress-bar indeterminate label=${label}></lc-progress-bar>
      <p class="cl-import-text" role="status">${label}</p>`;
  }

  urlView(): TemplateResult {
    const busy = this.busy.value;
    const urlError = this.urlError.value;
    const fields: FormField[] = [
      { name: 'url', type: 'url', label: text('import-export.urlField'), disabled: busy !== null },
    ];
    return html`
      <h2 class="cl-import-heading">${text('import-export.urlTitle')}</h2>
      <p class="cl-import-text">${text('import-export.urlBody')}</p>
      <lc-form
        class="cl-import-form"
        layout="stacked"
        .fields=${fields}
        .data=${this.values.value}
        .errors=${urlError === null ? NO_ERRORS : { url: urlError }}
        @field-change=${(event: Event) => {
          const values = formValues(event);
          if (values !== null) {
            this.values.value = values;
          }
        }}
        @form-submit=${(event: Event) => {
          const url = eventField(event, 'url');
          this.values.value = { url: typeof url === 'string' ? url : '' };
          void this.readUrl(false);
        }}
      >
        <div class="cl-import-actions">
          <lc-button type="submit" variant="primary" ?disabled=${busy !== null}>${text('import-export.readRecipe')}</lc-button>
          <lc-button variant="quiet" ?disabled=${busy !== null} @click=${() => {
            this.mode.value = 'text';
          }}>
            ${text('import-export.pasteInstead')}
          </lc-button>
        </div>
      </lc-form>
      ${this.progress()}
      ${
        this.noRecipe.value
          ? html`<lc-alert variant="info" title=${text('import-export.pasteTitle')}>
              ${text('import-export.pasteBody')}
              <div class="cl-banner-actions">
                <lc-button variant="quiet" @click=${() => {
                  this.mode.value = 'text';
                }}>${text('import-export.pasteText')}</lc-button>
                ${
                  this.aiEnabled()
                    ? html`<lc-button variant="quiet" ?disabled=${busy !== null} @click=${() => void this.readUrl(true)}>
                        <lc-icon name="sparkles" aria-hidden="true"></lc-icon>${text('import-export.readWithAi')}
                      </lc-button>`
                    : nothing
                }
              </div>
            </lc-alert>`
          : nothing
      }
    `;
  }

  textView(): TemplateResult {
    const busy = this.busy.value;
    const pasted = this.pasted.value;
    const textError = this.textError.value;
    return html`
      <h2 class="cl-import-heading">${text('import-export.textTitle')}</h2>
      <p class="cl-import-text">${text('import-export.pasteBody')}</p>
      <lc-textarea
        name="text"
        label=${text('import-export.textField')}
        rows="10"
        value=${pasted}
        ?disabled=${busy !== null}
        @input=${(event: Event) => {
          const value = eventField(event, 'value');
          this.pasted.value = typeof value === 'string' ? value : '';
        }}
      ></lc-textarea>
      ${textError === null ? nothing : html`<p class="cl-import-error" role="alert">${textError}</p>`}
      <div class="cl-import-actions">
        <lc-button variant="primary" ?disabled=${busy !== null || pasted.trim().length === 0} @click=${() => void this.readText(false)}>
          ${text('import-export.readRecipe')}
        </lc-button>
        ${
          this.aiEnabled()
            ? html`<lc-button
                variant="quiet"
                ?disabled=${busy !== null || pasted.trim().length === 0}
                @click=${() => void this.readText(true)}
              >
                <lc-icon name="sparkles" aria-hidden="true"></lc-icon>${text('import-export.readWithAi')}
              </lc-button>`
            : nothing
        }
        <lc-button variant="quiet" ?disabled=${busy !== null} @click=${() => {
          this.mode.value = 'url';
        }}>
          ${text('import-export.tab.url')}
        </lc-button>
      </div>
      ${this.progress()}
    `;
  }

  render() {
    return this.mode.value === 'url' ? this.urlView() : this.textView();
  }
}

View.register(tag, WebPanel);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: WebPanel;
  }
}
