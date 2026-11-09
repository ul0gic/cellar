import { type ImageRef, LIMITS, type Recipe } from '@cellar/contract';
import { html, nothing, type TemplateResult } from '@lightstart/light/html';
import { ApiError, call } from '../../../app/api.ts';
import { invalidate } from '../../../app/resources.ts';
import { thumbHashDataUrl } from '../../../design-system/thumbhash.ts';
import { toast } from '../../../design-system/toast.ts';
import { text } from '../../../text/index.ts';
import { actionFailed } from './failures.ts';
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

export function openHistorySheet(recipe: Recipe): void {
  let step: Step<string> = { kind: 'working' };
  let saving = false;

  const run = async (): Promise<void> => {
    step = { kind: 'working' };
    sheet.redraw();
    try {
      const history = await call('aiDrinkHistory', { body: { recipeId: recipe.id } });
      step = { kind: 'done', value: history.text };
    } catch (error) {
      step = { kind: 'failed', message: failure(error) };
    }
    sheet.redraw();
  };

  const keep = async (addition: string): Promise<void> => {
    saving = true;
    sheet.redraw();
    const input = recipeInputOf(recipe);
    const description = input.description.trim() === '' ? addition : `${input.description}\n\n${addition}`;
    try {
      await call('replaceRecipe', { params: { id: recipe.id }, body: { ...input, description } });
      invalidate('recipes');
      sheet.close();
      toast({ title: text('recipes.historyAdded') });
    } catch (error) {
      saving = false;
      step = { kind: 'failed', message: failure(error) };
      sheet.redraw();
    }
  };

  const sheet = openSheet({
    centered: true,
    heading: () => text('recipes.historyHeading', { name: recipe.name }),
    body: () => {
      switch (step.kind) {
        case 'working':
          return html`<lc-progress-bar indeterminate label=${text('recipes.historyWorking')}></lc-progress-bar>
            <p class="cl-sheet-hint" aria-live="polite">${text('recipes.historyWorking')}</p>`;
        case 'failed':
          return failedBanner(step.message, () => void run());
        case 'done':
          return html`<p class="cl-ai-text">${step.value}</p>
            ${aiNote()}`;
      }
    },
    footer: () => {
      const current = step;
      return current.kind === 'done'
        ? html`<lc-button variant="quiet" @click=${() => sheet.close()}>${text('recipes.discard')}</lc-button>
            <lc-button variant="primary" ?disabled=${saving} @click=${() => void keep(current.value)}
              >${text('recipes.addToDescription')}</lc-button
            >`
        : html`<lc-button variant="quiet" @click=${() => sheet.close()}>${text('action.close')}</lc-button>`;
    },
  });
  void run();
}

export function openPhotoSheet(recipe: Recipe): void {
  let step: Step<ImageRef> = { kind: 'working' };
  let kept = false;

  const run = async (): Promise<void> => {
    step = { kind: 'working' };
    sheet.redraw();
    try {
      const image = await call('aiGenerateImage', { body: { target: { type: 'recipe', id: recipe.id }, prompt: '' } });
      step = { kind: 'done', value: image };
    } catch (error) {
      step = { kind: 'failed', message: failure(error) };
    }
    sheet.redraw();
  };

  const use = async (image: ImageRef): Promise<void> => {
    const input = recipeInputOf(recipe);
    try {
      await call('replaceRecipe', {
        params: { id: recipe.id },
        body: { ...input, imageIds: [image.id, ...input.imageIds].slice(0, LIMITS.recipeImages.max) },
      });
      kept = true;
      invalidate('recipes');
      sheet.close();
      toast({ title: text('recipes.photoAdded') });
    } catch (error) {
      step = { kind: 'failed', message: failure(error) };
      sheet.redraw();
    }
  };

  const discard = async (): Promise<void> => {
    if (step.kind === 'done' && !kept) {
      const id = step.value.id;
      await call('deleteImage', { params: { id } }).catch((error: unknown) =>
        actionFailed(error, () => void call('deleteImage', { params: { id } })),
      );
    }
  };

  const sheet = openSheet({
    centered: true,
    heading: () => text('recipes.photoHeading', { name: recipe.name }),
    body: () => {
      switch (step.kind) {
        case 'working':
          return html`<lc-progress-bar indeterminate label=${text('recipes.photoWorking')}></lc-progress-bar>
            <p class="cl-sheet-hint" aria-live="polite">${text('recipes.photoWorking')}</p>`;
        case 'failed':
          return failedBanner(step.message, () => void run());
        case 'done':
          return html`<lc-image
              class="cl-ai-photo"
              src=${step.value.url}
              alt=${text('photo.of', { name: recipe.name })}
              placeholder=${step.value.thumbhash === null ? nothing : thumbHashDataUrl(step.value.thumbhash)}
            ></lc-image>
            ${aiNote()}`;
      }
    },
    footer: () => {
      const current = step;
      return current.kind === 'done'
        ? html`<lc-button variant="quiet" @click=${() => sheet.close()}>${text('recipes.discard')}</lc-button>
            <lc-button variant="primary" @click=${() => void use(current.value)}>${text('crop.use')}</lc-button>`
        : html`<lc-button variant="quiet" @click=${() => sheet.close()}>${text('action.close')}</lc-button>`;
    },
    onClose: () => void discard(),
  });
  void run();
}
