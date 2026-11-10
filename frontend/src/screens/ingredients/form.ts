import {
  type FieldError,
  type Ingredient,
  type IngredientInput,
  UNIT_IDS,
  UNIT_LABELS,
  type UnitId,
} from '@cellar/contract';
import View from '@lightstart/light';
import { html, nothing, type TemplateResult } from '@lightstart/light/html';
import { effect, signal } from '@lightstart/light/signals';
import { ApiError, call } from '../../app/api.ts';
import { route } from '../../app/controllers/route.ts';
import { eventText } from '../../app/events.ts';
import { loadState } from '../../app/load.ts';
import { actionFailed } from '../../app/problems.ts';
import { apiResource, dataChanged } from '../../app/resources.ts';
import { href, navigate, setScreenTitle } from '../../app/router.ts';
import type { RouteParams } from '../../app/types.ts';
import type { ImageUpload } from '../../design-system/cl-image-field.ts';
import '../../design-system/cl-image-field.ts';
import { waiting } from '../../design-system/load-view.ts';
import { toast } from '../../design-system/toast.ts';
import { text } from '../../text/index.ts';
import '../../design-system/lc/button.ts';
import '../../design-system/lc/icon.ts';
import '../../design-system/lc/image.ts';
import '../../design-system/lc/input.ts';
import '../../design-system/lc/select.ts';
import '../../design-system/lc/spinner.ts';
import '../../design-system/lc/textarea.ts';
import { fieldError } from '../shelf/parts/kit.ts';
import './ingredients.css';

export const tag = 'cl-screen-ingredients-form';

const COLOR = /^#[0-9a-fA-F]{6}$/;
// D-1 §9.7: tree rows indent one step per level; the select shows that depth with leading spaces.
const INDENT = ' ';

interface PartDraft {
  readonly ingredientId: string;
  readonly amount: string;
  readonly unit: string;
}

interface Draft {
  readonly name: string;
  readonly parentId: string;
  readonly strength: string;
  readonly defaultUnit: string;
  readonly origin: string;
  readonly color: string;
  readonly description: string;
  readonly imageId: number | null;
  readonly imageUrl: string | null;
  readonly parts: readonly PartDraft[];
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

function messageFor(current: Draft, error: FieldError): FieldError {
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
}

function unitOptions(blank: string): { value: string; label: string }[] {
  return [{ value: '', label: blank }, ...UNIT_IDS.map((unit) => ({ value: unit, label: UNIT_LABELS[unit] }))];
}

class IngredientForm extends View {
  params: RouteParams = {};
  readonly tree = apiResource('getIngredientTree', ['ingredients']);
  readonly existing = apiResource('getIngredient', ['ingredients']);
  readonly state = loadState([this.existing]);
  readonly draft = signal<Draft | null>(null);
  readonly errors = signal<readonly FieldError[]>([]);
  readonly saving = signal(false);
  readonly uploading = signal(false);

  private get editing(): number | null {
    return this.params.id === undefined ? null : Number(this.params.id);
  }

  connected(): void {
    this.classList.add('cl-kit-screen', 'cl-ingr-form');
    this.tree.bind(this, {});
    const editing = this.editing;
    if (editing !== null) {
      this.existing.bind(this, { params: { id: editing } });
    }
    const filling = effect(() => this.fill(editing));
    this.$own(() => filling.dispose());
  }

  private fill(editing: number | null): void {
    if (this.draft.peek() !== null) {
      return;
    }
    if (editing === null) {
      this.draft.value = draftOf(null, route.query.peek().get('name') ?? '');
      return;
    }
    const item = this.existing.value.value;
    if (item !== undefined) {
      this.draft.value = draftOf(item, '');
      setScreenTitle(text('ingredients.editTitle', { name: item.name }));
    }
  }

  private change(patch: Partial<Draft>): void {
    const current = this.draft.peek();
    if (current !== null) {
      this.draft.value = { ...current, ...patch };
    }
  }

  private changePart(index: number, patch: Partial<PartDraft>): void {
    const current = this.draft.peek();
    if (current !== null) {
      this.change({ parts: current.parts.map((part, at) => (at === index ? { ...part, ...patch } : part)) });
    }
  }

  private async save(): Promise<void> {
    const current = this.draft.peek();
    if (current === null) {
      return;
    }
    this.errors.value = [];
    if (current.color.trim() !== '' && !COLOR.test(current.color.trim())) {
      this.errors.value = [{ path: 'color', code: 'invalid_format', message: text('ingredients.colorInvalid') }];
      return;
    }
    this.saving.value = true;
    try {
      const body = inputOf(current);
      const editing = this.editing;
      const saved =
        editing === null
          ? await call('createIngredient', { body })
          : await call('updateIngredient', { params: { id: editing }, body });
      dataChanged('ingredients', 'recipes', 'shelf', 'stats');
      toast({ title: text('ingredients.saved', { name: saved.name }) });
      if (this.isConnected) {
        navigate(`/ingredients/${saved.id}`, { replace: true });
      }
    } catch (error) {
      if (error instanceof ApiError && error.fields.length > 0) {
        this.errors.value = error.fields.map((field) => messageFor(current, field));
        toast({ title: error.detail, variant: 'error' });
      } else {
        actionFailed(error, () => void this.save());
      }
    } finally {
      this.saving.value = false;
    }
  }

  private async upload(image: ImageUpload): Promise<void> {
    this.uploading.value = true;
    try {
      const form = new FormData();
      form.append('file', image.file);
      form.append('purpose', image.purpose);
      form.append('width', String(image.width));
      form.append('height', String(image.height));
      form.append('thumbhash', image.thumbhash);
      const ref = await call('uploadImage', { body: form });
      this.change({ imageId: ref.id, imageUrl: ref.url });
    } catch (error) {
      actionFailed(error, () => void this.upload(image));
    } finally {
      this.uploading.value = false;
    }
  }

  private ingredientOptions(blank: string): { value: string; label: string }[] {
    const editing = this.editing;
    return [
      { value: '', label: blank },
      ...(this.tree.value.value?.nodes ?? [])
        .filter((node) => node.id !== editing)
        .map((node) => ({ value: String(node.id), label: `${INDENT.repeat(node.depth)}${node.name}` })),
    ];
  }

  private partRow(part: PartDraft, index: number): TemplateResult {
    const n = index + 1;
    const errors = this.errors.value;
    return html`<div class="cl-ingr-part">
      <lc-select
        searchable
        label=${text('ingredients.partIngredient', { n })}
        .options=${this.ingredientOptions(text('ingredients.choose'))}
        .value=${part.ingredientId}
        error-message=${fieldError(errors, `parts.${index}.ingredientId`) || fieldError(errors, `parts.${index}`)}
        @change=${(event: Event) => this.changePart(index, { ingredientId: eventText(event) })}
      ></lc-select>
      <lc-input
        type="number"
        inputmode="decimal"
        label=${text('ingredients.partAmount', { n })}
        .value=${part.amount}
        @input=${(event: Event) => this.changePart(index, { amount: eventText(event) })}
      ></lc-input>
      <lc-select
        label=${text('ingredients.partUnit', { n })}
        .options=${unitOptions(text('ingredients.unitNone'))}
        .value=${part.unit}
        @change=${(event: Event) => this.changePart(index, { unit: eventText(event) })}
      ></lc-select>
      <button
        type="button"
        class="cl-icon-button"
        aria-label=${text('ingredients.partRemove', { n })}
        @click=${() => this.change({ parts: (this.draft.peek()?.parts ?? []).filter((_, at) => at !== index) })}
      >
        <lc-icon name="x" aria-hidden="true"></lc-icon>
      </button>
    </div>`;
  }

  private photoField(current: Draft): TemplateResult {
    return current.imageUrl === null
      ? html`<div class="cl-kit-section">
          <span class="cl-kit-field-label">${text('ingredients.photo')}</span>
          <cl-image-field purpose="ingredient" .change=${(image: ImageUpload) => void this.upload(image)}></cl-image-field>
          ${this.uploading.value ? html`<lc-spinner size="sm"></lc-spinner>` : nothing}
        </div>`
      : html`<div class="cl-ingr-photo">
          <lc-image class="cl-ingr-hero-art" src=${current.imageUrl} alt=${text('photo.of', { name: current.name })}></lc-image>
          <lc-button variant="quiet" @click=${() => this.change({ imageId: null, imageUrl: null })}
            >${text('ingredients.photoRemove')}</lc-button
          >
        </div>`;
  }

  private formView(current: Draft): TemplateResult {
    const editing = this.editing;
    const errors = this.errors.value;
    const saving = this.saving.value;
    return html`
      <h1 class="cl-kit-title cl-kit-wide-only">
        ${editing === null ? text('ingredients.newTitle') : text('ingredients.editTitle', { name: current.name })}
      </h1>
      <form
        class="cl-kit-form"
        novalidate
        @submit=${(event: SubmitEvent) => {
          event.preventDefault();
          void this.save();
        }}
      >
        <lc-input
          required
          label=${text('ingredients.name')}
          .value=${current.name}
          error-message=${fieldError(errors, 'name')}
          @input=${(event: Event) => this.change({ name: eventText(event) })}
        ></lc-input>
        <div class="cl-kit-section">
          <lc-select
            searchable
            label=${text('ingredients.parent')}
            .options=${this.ingredientOptions(text('ingredients.parentNone'))}
            .value=${current.parentId}
            error-message=${fieldError(errors, 'parentId')}
            @change=${(event: Event) => this.change({ parentId: eventText(event) })}
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
            @input=${(event: Event) => this.change({ strength: eventText(event) })}
          ></lc-input>
          <lc-select
            label=${text('ingredients.defaultUnit')}
            .options=${unitOptions(text('ingredients.unitNone'))}
            .value=${current.defaultUnit}
            @change=${(event: Event) => this.change({ defaultUnit: eventText(event) })}
          ></lc-select>
          <lc-input
            label=${text('ingredients.originField')}
            .value=${current.origin}
            error-message=${fieldError(errors, 'origin')}
            @input=${(event: Event) => this.change({ origin: eventText(event) })}
          ></lc-input>
          <lc-input
            label=${text('ingredients.color')}
            placeholder="#C47A2C"
            hint=${text('ingredients.colorHint')}
            .value=${current.color}
            error-message=${fieldError(errors, 'color')}
            @input=${(event: Event) => this.change({ color: eventText(event) })}
          ></lc-input>
        </div>
        <lc-textarea
          label=${text('ingredients.description')}
          .value=${current.description}
          error-message=${fieldError(errors, 'description')}
          @input=${(event: Event) => this.change({ description: eventText(event) })}
        ></lc-textarea>
        ${this.photoField(current)}
        <fieldset class="cl-kit-section cl-ingr-parts">
          <legend class="cl-kit-field-label">${text('ingredients.parts')}</legend>
          ${current.parts.map((part, index) => this.partRow(part, index))}
          <p class="cl-kit-hint">${text('ingredients.partsHint')}</p>
          <div>
            <lc-button
              variant="ghost"
              @click=${() => this.change({ parts: [...(this.draft.peek()?.parts ?? []), { ingredientId: '', amount: '', unit: '' }] })}
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
          <lc-button variant="primary" type="submit" ?disabled=${saving || this.uploading.value} aria-busy=${saving ? 'true' : nothing}
            >${text('ingredients.save')}</lc-button
          >
        </div>
      </form>
    `;
  }

  render() {
    const current = this.draft.value;
    return current === null ? waiting(this.state, text('title.editIngredient'), 'lines') : this.formView(current);
  }
}

View.register(tag, IngredientForm);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: IngredientForm;
  }
}
