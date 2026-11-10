import { type ImageRef, LIMITS, type Recipe } from '@cellar/contract';
import { html, nothing, type TemplateResult } from '@lightstart/light/html';
import { signal } from '@lightstart/light/signals';
import { ApiError, call } from '../../../app/api.ts';
import { actionFailed } from '../../../app/problems.ts';
import { dataChanged } from '../../../app/resources.ts';
import type { OverlayHost } from '../../../app/types.ts';
import { hostOverlay } from '../../../design-system/overlay.ts';
import { thumbHashDataUrl } from '../../../design-system/thumbhash.ts';
import { toast } from '../../../design-system/toast.ts';
import { text } from '../../../text/index.ts';
import '../../../design-system/lc/alert.ts';
import '../../../design-system/lc/button.ts';
import '../../../design-system/lc/icon.ts';
import '../../../design-system/lc/image.ts';
import '../../../design-system/lc/progress-bar.ts';
import { recipeInputOf } from './recipe-input.ts';
import { openSheet } from './sheet.ts';

type Step<T> =
  | { readonly kind: 'working' }
  | { readonly kind: 'done'; readonly value: T }
  | { readonly kind: 'failed'; readonly message: string };

function failure(error: unknown): string {
  if (!(error instanceof ApiError)) {
    throw error;
  }
  if (error.code === 'ai_timeout') {
    return text('recipes.aiTimeout');
  }
  if (error.code === 'ai_provider_error') {
    return text('recipes.aiProvider', { detail: error.problem?.providerMessage ?? error.detail });
  }
  return error.detail;
}

function failedBanner(message: string, retry: () => void): TemplateResult {
  return html`<lc-alert variant="error" icon="circle-alert" title=${text('recipes.aiFailedTitle')}>
    <p>${message}</p>
    <div class="cl-banner-actions">
      <lc-button size="sm" @click=${retry}>${text('loadFailed.retry')}</lc-button>
    </div>
  </lc-alert>`;
}

function aiNote(): TemplateResult {
  return html`<p class="cl-sheet-hint cl-ai-note">
    <lc-icon name="sparkles" aria-hidden="true"></lc-icon>${text('recipes.aiWrittenBy')}
  </p>`;
}

export function openHistorySheet(host: OverlayHost, recipe: Recipe): void {
  const step = signal<Step<string>>({ kind: 'working' });
  const saving = signal(false);

  const run = async (): Promise<void> => {
    step.value = { kind: 'working' };
    try {
      const history = await call('aiDrinkHistory', { body: { recipeId: recipe.id } });
      step.value = { kind: 'done', value: history.text };
    } catch (error) {
      step.value = { kind: 'failed', message: failure(error) };
    }
  };

  const keep = async (addition: string): Promise<void> => {
    saving.value = true;
    const input = recipeInputOf(recipe);
    const description = input.description.trim() === '' ? addition : `${input.description}\n\n${addition}`;
    try {
      await call('replaceRecipe', { params: { id: recipe.id }, body: { ...input, description } });
      dataChanged('recipes');
      sheet.close();
      toast({ title: text('recipes.historyAdded') });
    } catch (error) {
      saving.value = false;
      step.value = { kind: 'failed', message: failure(error) };
    }
  };

  const sheet = openSheet(host, {
    centered: true,
    heading: () => text('recipes.historyHeading', { name: recipe.name }),
    body: () => {
      const current = step.value;
      switch (current.kind) {
        case 'working':
          return html`<lc-progress-bar indeterminate label=${text('recipes.historyWorking')}></lc-progress-bar>
            <p class="cl-sheet-hint" aria-live="polite">${text('recipes.historyWorking')}</p>`;
        case 'failed':
          return failedBanner(current.message, () => void run());
        case 'done':
          return html`<p class="cl-ai-text">${current.value}</p>
            ${aiNote()}`;
      }
    },
    footer: () => {
      const current = step.value;
      return current.kind === 'done'
        ? html`<lc-button variant="quiet" @click=${() => sheet.close()}>${text('recipes.discard')}</lc-button>
            <lc-button variant="primary" ?disabled=${saving.value} @click=${() => void keep(current.value)}
              >${text('recipes.addToDescription')}</lc-button
            >`
        : html`<lc-button variant="quiet" @click=${() => sheet.close()}>${text('action.close')}</lc-button>`;
    },
  });
  void run();
}

export function openPhotoSheet(host: OverlayHost, recipe: Recipe): void {
  const step = signal<Step<ImageRef>>({ kind: 'working' });
  const kept = signal(false);

  const run = async (): Promise<void> => {
    step.value = { kind: 'working' };
    try {
      const image = await call('aiGenerateImage', { body: { target: { type: 'recipe', id: recipe.id }, prompt: '' } });
      step.value = { kind: 'done', value: image };
    } catch (error) {
      step.value = { kind: 'failed', message: failure(error) };
    }
  };

  const use = async (image: ImageRef): Promise<void> => {
    const input = recipeInputOf(recipe);
    kept.value = true;
    try {
      await call('replaceRecipe', {
        params: { id: recipe.id },
        body: { ...input, imageIds: [image.id, ...input.imageIds].slice(0, LIMITS.recipeImages.max) },
      });
      dataChanged('recipes');
      sheet.close();
      endDiscard();
      toast({ title: text('recipes.photoAdded') });
    } catch (error) {
      kept.value = false;
      step.value = { kind: 'failed', message: failure(error) };
    }
  };

  const discard = async (): Promise<void> => {
    const current = step.peek();
    if (current.kind === 'done' && !kept.peek()) {
      const id = current.value.id;
      await call('deleteImage', { params: { id } }).catch((error: unknown) =>
        actionFailed(error, () => void call('deleteImage', { params: { id } })),
      );
    }
  };

  const discardNow = (): void => {
    sheet.close();
    endDiscard();
  };

  const endDiscard = hostOverlay(host, document.createElement('span'), () => void discard());
  const sheet = openSheet(host, {
    centered: true,
    heading: () => text('recipes.photoHeading', { name: recipe.name }),
    body: () => {
      const current = step.value;
      switch (current.kind) {
        case 'working':
          return html`<lc-progress-bar indeterminate label=${text('recipes.photoWorking')}></lc-progress-bar>
            <p class="cl-sheet-hint" aria-live="polite">${text('recipes.photoWorking')}</p>`;
        case 'failed':
          return failedBanner(current.message, () => void run());
        case 'done':
          return html`<lc-image
              class="cl-ai-photo"
              src=${current.value.url}
              alt=${text('photo.of', { name: recipe.name })}
              placeholder=${current.value.thumbhash === null ? nothing : thumbHashDataUrl(current.value.thumbhash)}
            ></lc-image>
            ${aiNote()}`;
      }
    },
    footer: () => {
      const current = step.value;
      return current.kind === 'done'
        ? html`<lc-button variant="quiet" @click=${discardNow}>${text('recipes.discard')}</lc-button>
            <lc-button variant="primary" @click=${() => void use(current.value)}>${text('crop.use')}</lc-button>`
        : html`<lc-button variant="quiet" @click=${discardNow}>${text('action.close')}</lc-button>`;
    },
    onClose: () => endDiscard(),
  });
  void run();
}
