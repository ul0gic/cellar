import {
  type FieldError,
  type Ingredient,
  type IngredientInput,
  UNIT_IDS,
  UNIT_LABELS,
  type UnitId,
} from '@cellar/contract';
import { html, nothing, render, type TemplateResult } from '@lightstart/light/html';
import { ApiError, call } from '../../app/api.ts';
import { eventText } from '../../app/events.ts';
import { type LoadState, watch } from '../../app/load.ts';
import { actionFailed } from '../../app/problems.ts';
import { invalidate, resourceFor } from '../../app/resources.ts';
import { href, setScreenTitle } from '../../app/router.ts';
import type { ScreenContext } from '../../app/types.ts';
import type { ImageUpload } from '../../design-system/cl-image-field.ts';
import { toast } from '../../design-system/toast.ts';
import { text } from '../../text/index.ts';
import { fieldError, waiting } from '../shelf/parts/kit.ts';
import './ingredients.css';

const COLOR = /^#[0-9a-fA-F]{6}$/;
// D-1 §9.7: tree rows indent one step per level; the select shows that depth with leading spaces.
const INDENT = ' ';

interface PartDraft {
  ingredientId: string;
  amount: string;
  unit: string;
}

interface Draft {
  name: string;
  parentId: string;
  strength: string;
  defaultUnit: string;
  origin: string;
  color: string;
  description: string;
  imageId: number | null;
  imageUrl: string | null;
  parts: PartDraft[];
}

function unitOf(value: string): UnitId | null {
  return UNIT_IDS.find((unit) => unit === value) ?? null;
}

function draftOf(item: Ingredient | null, name: string): Draft {
  if (item === null) {
    return {
      name,
      parentId: '',
      strength: '0',
      defaultUnit: '',
      origin: '',
      color: '',
      description: '',
      imageId: null,
      imageUrl: null,
      parts: [],
    };
  }
  return {
    name: item.name,
    parentId: item.parent === null ? '' : String(item.parent.id),
    strength: String(item.strength),
    defaultUnit: item.defaultUnit ?? '',
    origin: item.origin,
    color: item.color ?? '',
    description: item.description,
    imageId: item.image?.id ?? null,
    imageUrl: item.image?.url ?? null,
    parts: item.parts.map((part) => ({
      ingredientId: String(part.ingredient.id),
      amount: part.amount === null ? '' : String(part.amount),
      unit: part.unit ?? '',
    })),
  };
}

function numberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function inputOf(draft: Draft): IngredientInput {
  return {
    name: draft.name.trim(),
    parentId: numberOrNull(draft.parentId),
    strength: numberOrNull(draft.strength) ?? 0,
    description: draft.description,
    origin: draft.origin.trim(),
    color: draft.color.trim() === '' ? null : draft.color.trim(),
    defaultUnit: unitOf(draft.defaultUnit),
    imageId: draft.imageId,
    parts: draft.parts
      .filter((part) => part.ingredientId !== '')
      .map((part) => ({
        ingredientId: Number(part.ingredientId),
        amount: numberOrNull(part.amount),
        unit: unitOf(part.unit),
      })),
  };
}

export function screen(ctx: ScreenContext): HTMLElement {
  const element = document.createElement('section');
  element.className = 'cl-kit-screen cl-ingr-form';
  const editing = ctx.params.id === undefined ? null : Number(ctx.params.id);
  const tree = resourceFor('getIngredientTree', {}, { tags: ['ingredients'] });
  const existing =
    editing === null ? null : resourceFor('getIngredient', { params: { id: editing } }, { tags: ['ingredients'] });
  let draft: Draft | null = null;
  let errors: FieldError[] = [];
  let saving = false;
  let uploading = false;
  let state: LoadState | null = null;
  const redraw = (): void => {
    if (state !== null) {
      draw(state);
    }
  };

  const messageFor = (current: Draft, error: FieldError): FieldError => {
    switch (error.code) {
      case 'tree_cycle':
        return { ...error, message: text('ingredients.cycle', { name: current.name }) };
      case 'tree_too_deep':
        return { ...error, message: text('ingredients.tooDeep') };
      case 'parts_cycle':
        return { ...error, message: text('ingredients.partsCycle', { name: current.name }) };
      default:
        return error;
    }
  };

  async function save(current: Draft): Promise<void> {
    errors = [];
    if (current.color.trim() !== '' && !COLOR.test(current.color.trim())) {
      errors = [{ path: 'color', code: 'invalid_format', message: text('ingredients.colorInvalid') }];
      redraw();
      return;
    }
    saving = true;
    redraw();
    try {
      const body = inputOf(current);
      const saved =
        editing === null
          ? await call('createIngredient', { body })
          : await call('updateIngredient', { params: { id: editing }, body });
      invalidate('ingredients', 'recipes', 'shelf', 'stats');
      toast({ title: text('ingredients.saved', { name: saved.name }) });
      ctx.navigate(`/ingredients/${saved.id}`, { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.fields.length > 0) {
        errors = error.fields.map((field) => messageFor(current, field));
        toast({ title: error.detail, variant: 'error' });
      } else {
        actionFailed(error, () => void save(current));
      }
    } finally {
      saving = false;
      redraw();
    }
  }

  async function upload(current: Draft, image: ImageUpload): Promise<void> {
    uploading = true;
    redraw();
    try {
      const form = new FormData();
      form.append('file', image.file);
      form.append('purpose', image.purpose);
      form.append('width', String(image.width));
      form.append('height', String(image.height));
      form.append('thumbhash', image.thumbhash);
      const ref = await call('uploadImage', { body: form });
      current.imageId = ref.id;
      current.imageUrl = ref.url;
    } catch (error) {
      actionFailed(error, () => void upload(current, image));
    } finally {
      uploading = false;
      redraw();
    }
  }

  const ingredientOptions = (blank: string): { value: string; label: string }[] => [
    { value: '', label: blank },
    ...(tree.peek()?.nodes ?? [])
      .filter((node) => node.id !== editing)
      .map((node) => ({ value: String(node.id), label: `${INDENT.repeat(node.depth)}${node.name}` })),
  ];

  const unitOptions = (blank: string): { value: string; label: string }[] => [
    { value: '', label: blank },
    ...UNIT_IDS.map((unit) => ({ value: unit, label: UNIT_LABELS[unit] })),
  ];

  const partRow = (current: Draft, part: PartDraft, index: number): TemplateResult => {
    const n = index + 1;
    return html`<div class="cl-ingr-part">
      <lc-select
        searchable
        label=${text('ingredients.partIngredient', { n })}
        .options=${ingredientOptions(text('ingredients.choose'))}
        .value=${part.ingredientId}
        error-message=${fieldError(errors, `parts.${index}.ingredientId`) || fieldError(errors, `parts.${index}`)}
        @change=${(event: Event) => {
          part.ingredientId = eventText(event);
        }}
      ></lc-select>
      <lc-input
        type="number"
        inputmode="decimal"
        label=${text('ingredients.partAmount', { n })}
        .value=${part.amount}
        @input=${(event: Event) => {
          part.amount = eventText(event);
        }}
      ></lc-input>
      <lc-select
        label=${text('ingredients.partUnit', { n })}
        .options=${unitOptions(text('ingredients.unitNone'))}
        .value=${part.unit}
        @change=${(event: Event) => {
          part.unit = eventText(event);
        }}
      ></lc-select>
      <button
        type="button"
        class="cl-icon-button"
        aria-label=${text('ingredients.partRemove', { n })}
        @click=${() => {
          current.parts.splice(index, 1);
          redraw();
        }}
      >
        <lc-icon name="x" aria-hidden="true"></lc-icon>
      </button>
    </div>`;
  };

  const photoField = (current: Draft): TemplateResult =>
    current.imageUrl === null
      ? html`<div class="cl-kit-section">
          <span class="cl-kit-field-label">${text('ingredients.photo')}</span>
          <cl-image-field purpose="ingredient" .change=${(image: ImageUpload) => void upload(current, image)}></cl-image-field>
          ${uploading ? html`<lc-spinner size="sm"></lc-spinner>` : nothing}
        </div>`
      : html`<div class="cl-ingr-photo">
          <lc-image class="cl-ingr-hero-art" src=${current.imageUrl} alt=${text('photo.of', { name: current.name })}></lc-image>
          <lc-button
            variant="quiet"
            @click=${() => {
              current.imageId = null;
              current.imageUrl = null;
              redraw();
            }}
            >${text('ingredients.photoRemove')}</lc-button
          >
        </div>`;

  const formView = (current: Draft): TemplateResult => html`
    <h1 class="cl-kit-title cl-kit-wide-only">
      ${editing === null ? text('ingredients.newTitle') : text('ingredients.editTitle', { name: current.name })}
    </h1>
    <form
      class="cl-kit-form"
      novalidate
      @submit=${(event: SubmitEvent) => {
        event.preventDefault();
        void save(current);
      }}
    >
      <lc-input
        required
        label=${text('ingredients.name')}
        .value=${current.name}
        error-message=${fieldError(errors, 'name')}
        @input=${(event: Event) => {
          current.name = eventText(event);
        }}
      ></lc-input>
      <div class="cl-kit-section">
        <lc-select
          searchable
          label=${text('ingredients.parent')}
          .options=${ingredientOptions(text('ingredients.parentNone'))}
          .value=${current.parentId}
          error-message=${fieldError(errors, 'parentId')}
          @change=${(event: Event) => {
            current.parentId = eventText(event);
          }}
        ></lc-select>
        <p class="cl-kit-hint">${text('ingredients.parentHint')}</p>
        ${
          fieldError(errors, 'parentId') === ''
            ? nothing
            : html`<p class="cl-kit-error" role="alert">${fieldError(errors, 'parentId')}</p>`
        }
      </div>
      <div class="cl-kit-pair">
        <lc-input
          type="number"
          inputmode="decimal"
          min="0"
          max="100"
          label=${text('ingredients.strengthField')}
          .value=${current.strength}
          error-message=${fieldError(errors, 'strength')}
          @input=${(event: Event) => {
            current.strength = eventText(event);
          }}
        ></lc-input>
        <lc-select
          label=${text('ingredients.defaultUnit')}
          .options=${unitOptions(text('ingredients.unitNone'))}
          .value=${current.defaultUnit}
          @change=${(event: Event) => {
            current.defaultUnit = eventText(event);
          }}
        ></lc-select>
        <lc-input
          label=${text('ingredients.originField')}
          .value=${current.origin}
          error-message=${fieldError(errors, 'origin')}
          @input=${(event: Event) => {
            current.origin = eventText(event);
          }}
        ></lc-input>
        <lc-input
          label=${text('ingredients.color')}
          placeholder="#C47A2C"
          hint=${text('ingredients.colorHint')}
          .value=${current.color}
          error-message=${fieldError(errors, 'color')}
          @input=${(event: Event) => {
            current.color = eventText(event);
          }}
        ></lc-input>
      </div>
      <lc-textarea
        label=${text('ingredients.description')}
        .value=${current.description}
        error-message=${fieldError(errors, 'description')}
        @input=${(event: Event) => {
          current.description = eventText(event);
        }}
      ></lc-textarea>
      ${photoField(current)}
      <fieldset class="cl-kit-section cl-ingr-parts">
        <legend class="cl-kit-field-label">${text('ingredients.parts')}</legend>
        ${current.parts.map((part, index) => partRow(current, part, index))}
        <p class="cl-kit-hint">${text('ingredients.partsHint')}</p>
        <div>
          <lc-button
            variant="ghost"
            @click=${() => {
              current.parts.push({ ingredientId: '', amount: '', unit: '' });
              redraw();
            }}
          >
            <lc-icon name="plus" aria-hidden="true"></lc-icon>${text('ingredients.addPart')}
          </lc-button>
        </div>
      </fieldset>
      <div class="cl-kit-sheet-footer">
        <lc-button
          variant="quiet"
          href=${href(editing === null ? '/ingredients' : `/ingredients/${editing}`)}
          >${text('action.cancel')}</lc-button
        >
        <lc-button variant="primary" type="submit" ?disabled=${saving || uploading} aria-busy=${saving ? 'true' : nothing}
          >${text('ingredients.save')}</lc-button
        >
      </div>
    </form>
  `;

  const draw = (current: LoadState): void => {
    state = current;
    if (draft === null) {
      if (existing === null) {
        draft = draftOf(null, ctx.query.get('name') ?? '');
      } else {
        const item = existing.peek();
        if (item !== undefined) {
          draft = draftOf(item, '');
          setScreenTitle(text('ingredients.editTitle', { name: item.name }));
        }
      }
    }
    const pending = existing === null ? null : waiting(current, existing, text('title.editIngredient'), 'lines');
    render(draft === null ? pending : formView(draft), element);
  };

  watch(element, existing === null ? [tree] : [tree, existing], draw);
  return element;
}
