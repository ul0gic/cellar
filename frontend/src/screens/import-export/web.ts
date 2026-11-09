import type { RecipeDraft } from '@cellar/contract';
import { html, nothing, render, type TemplateResult } from '@lightstart/light/html';
import { ApiError, call } from '../../app/api.ts';
import type { ScreenContext } from '../../app/types.ts';
import { text } from '../../text/index.ts';
import { actionFailed } from '../menus/support.ts';
import { detailField } from './files.ts';

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

export function webPanel(ctx: ScreenContext): HTMLElement {
  const element = document.createElement('div');
  element.className = 'cl-import-web';

  let mode: Mode = 'url';
  let address = '';
  let pasted = '';
  let busy: Busy | null = null;
  let urlError: string | null = null;
  let textError: string | null = null;
  let noRecipe = false;

  const aiEnabled = (): boolean => ctx.person.current()?.household.aiEnabled === true;

  const open = (draft: RecipeDraft): void => {
    ctx.navigate('/recipes/new', { state: { draft } });
  };

  const readUrl = async (useAi: boolean): Promise<void> => {
    const url = address.trim();
    noRecipe = false;
    if (!isWebAddress(url)) {
      urlError = text('import-export.urlNotWeb');
      draw();
      return;
    }
    urlError = null;
    busy = useAi ? 'url-ai' : 'url';
    draw();
    try {
      open(await call('importFromUrl', { body: { url, useAi } }));
    } catch (error) {
      if (!(error instanceof ApiError)) {
        throw error;
      }
      if (error.code === 'no_recipe_data') {
        noRecipe = true;
        urlError = text('import-export.urlNone');
      } else {
        const message = urlProblem(error);
        if (message === null) {
          actionFailed(error, () => void readUrl(useAi));
        }
        urlError = message;
      }
    } finally {
      busy = null;
      draw();
    }
  };

  const readText = async (useAi: boolean): Promise<void> => {
    const body = pasted.trim();
    if (body.length === 0) {
      return;
    }
    textError = null;
    busy = useAi ? 'text-ai' : 'text';
    draw();
    try {
      open(await call('importFromText', { body: { text: body, useAi } }));
    } catch (error) {
      if (!(error instanceof ApiError)) {
        throw error;
      }
      const message = error.code === 'ai_provider_error' || error.code === 'ai_timeout' ? urlProblem(error) : null;
      if (message === null && error.code !== 'validation_failed') {
        actionFailed(error, () => void readText(useAi));
      }
      textError = message ?? (error.code === 'validation_failed' ? error.detail : null);
    } finally {
      busy = null;
      draw();
    }
  };

  const switchTo = (next: Mode): void => {
    mode = next;
    draw();
    element.querySelector<HTMLElement>(next === 'url' ? 'lc-input' : 'lc-textarea')?.focus();
  };

  const progress = (): TemplateResult | typeof nothing => {
    if (busy === null) {
      return nothing;
    }
    const label = busy.startsWith('url') ? text('import-export.reading') : text('import-export.readingText');
    return html`<lc-progress-bar indeterminate label=${label}></lc-progress-bar>
      <p class="cl-import-text" role="status">${label}</p>`;
  };

  const urlView = (): TemplateResult => html`
    <h2 class="cl-import-heading">${text('import-export.urlTitle')}</h2>
    <p class="cl-import-text">${text('import-export.urlBody')}</p>
    <form
      class="cl-import-form"
      @submit=${(event: Event) => {
        event.preventDefault();
        void readUrl(false);
      }}
    >
      <lc-input
        type="url"
        name="url"
        label=${text('import-export.urlField')}
        placeholder="https://"
        value=${address}
        error-message=${urlError ?? nothing}
        ?disabled=${busy !== null}
        @input=${(event: Event) => {
          const value = detailField(event, 'value');
          address = typeof value === 'string' ? value : '';
        }}
      ></lc-input>
      <div class="cl-import-actions">
        <lc-button type="submit" variant="primary" ?disabled=${busy !== null}>${text('import-export.readRecipe')}</lc-button>
        <lc-button variant="quiet" ?disabled=${busy !== null} @click=${() => switchTo('text')}>
          ${text('import-export.pasteInstead')}
        </lc-button>
      </div>
    </form>
    ${progress()}
    ${
      noRecipe
        ? html`<lc-alert variant="info" title=${text('import-export.pasteTitle')}>
            ${text('import-export.pasteBody')}
            <div class="cl-banner-actions">
              <lc-button variant="quiet" @click=${() => switchTo('text')}>${text('import-export.pasteText')}</lc-button>
              ${
                aiEnabled()
                  ? html`<lc-button variant="quiet" ?disabled=${busy !== null} @click=${() => void readUrl(true)}>
                      <lc-icon name="sparkles" aria-hidden="true"></lc-icon>${text('import-export.readWithAi')}
                    </lc-button>`
                  : nothing
              }
            </div>
          </lc-alert>`
        : nothing
    }
  `;

  const textView = (): TemplateResult => html`
    <h2 class="cl-import-heading">${text('import-export.textTitle')}</h2>
    <p class="cl-import-text">${text('import-export.pasteBody')}</p>
    <lc-textarea
      name="text"
      label=${text('import-export.textField')}
      rows="10"
      value=${pasted}
      ?disabled=${busy !== null}
      @input=${(event: Event) => {
        const value = detailField(event, 'value');
        pasted = typeof value === 'string' ? value : '';
        draw();
      }}
    ></lc-textarea>
    ${textError === null ? nothing : html`<p class="cl-import-error" role="alert">${textError}</p>`}
    <div class="cl-import-actions">
      <lc-button variant="primary" ?disabled=${busy !== null || pasted.trim().length === 0} @click=${() => void readText(false)}>
        ${text('import-export.readRecipe')}
      </lc-button>
      ${
        aiEnabled()
          ? html`<lc-button
              variant="quiet"
              ?disabled=${busy !== null || pasted.trim().length === 0}
              @click=${() => void readText(true)}
            >
              <lc-icon name="sparkles" aria-hidden="true"></lc-icon>${text('import-export.readWithAi')}
            </lc-button>`
          : nothing
      }
      <lc-button variant="quiet" ?disabled=${busy !== null} @click=${() => switchTo('url')}>
        ${text('import-export.tab.url')}
      </lc-button>
    </div>
    ${progress()}
  `;

  function draw(): void {
    render(mode === 'url' ? urlView() : textView(), element);
  }

  draw();
  return element;
}
