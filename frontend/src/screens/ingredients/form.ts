import {
  type FieldError,
  type Ingredient,
  type IngredientInput,
  UNIT_IDS,
  UNIT_LABELS,
  type UnitId,
} from '@cellar/contract';
import type { LightElements } from '@lightstart/components/elements.js';
import { lcText } from '@lightstart/components/utils/text.js';
import { registerFormFieldRenderer } from '@lightstart/components/form/field-renderers.js';
import type { FormField } from '@lightstart/components/types.js';
import View from '@lightstart/light';
import { html } from '@lightstart/light/html';
import { computed, effect, signal } from '@lightstart/light/signals';
import { ApiError, call } from '../../app/api.ts';
import { route } from '../../app/controllers/route.ts';
import { eventField, formValues } from '../../app/events.ts';
import { loadState } from '../../app/load.ts';
import { actionFailed, formErrors } from '../../app/problems.ts';
import { apiResource, dataChanged } from '../../app/resources.ts';
import { href, navigate, setScreenTitle } from '../../app/router.ts';
import type { RouteParams } from '../../app/types.ts';
import type { ImageUpload } from '../../design-system/cl-image-field.ts';
import '../../design-system/cl-image-field.ts';
import { waiting } from '../../design-system/load-view.ts';
import { toast } from '../../design-system/toast.ts';
import { text } from '../../text/index.ts';
import '../../design-system/lc/button.ts';
import '../../design-system/lc/form.ts';
import '../../design-system/lc/icon.ts';
import '../../design-system/lc/image.ts';
import '../../design-system/lc/input.ts';
import '../../design-system/lc/select.ts';
import '../../design-system/lc/spinner.ts';
import '../../design-system/lc/textarea.ts';
import './ingredients.css';

export const tag = 'cl-screen-ingredients-form';

type Form = LightElements['lc-form'];

const COLOR = /^#[0-9a-fA-F]{6}$/;
// D-1 §9.7: tree rows indent one step per level; the select shows that depth with leading spaces.
const INDENT = ' ';
const FIELD_NAMES = ['name', 'parentId', 'strength', 'origin', 'color', 'description'];
const PART_PATH = /^parts\.\d+/;

interface PartDraft {
  readonly ingredientId: string;
  readonly amount: string;
  readonly unit: string;
}

interface Photo {
  readonly imageId: number | null;
  readonly imageUrl: string | null;
  readonly uploading: boolean;
  readonly alt: string;
}

const NO_PHOTO: Photo = { imageId: null, imageUrl: null, uploading: false, alt: '' };

const UNIT_OPTIONS = [
  { value: '', label: text('ingredients.unitNone') },
  ...UNIT_IDS.map((unit) => ({ value: unit, label: UNIT_LABELS[unit] })),
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPart(value: unknown): value is PartDraft {
  return (
    isRecord(value) &&
    typeof value.ingredientId === 'string' &&
    typeof value.amount === 'string' &&
    typeof value.unit === 'string'
  );
}

function isPhoto(value: unknown): value is Photo {
  return (
    isRecord(value) &&
    (value.imageId === null || typeof value.imageId === 'number') &&
    (value.imageUrl === null || typeof value.imageUrl === 'string') &&
    typeof value.uploading === 'boolean' &&
    typeof value.alt === 'string'
  );
}

function isImageUpload(value: unknown): value is ImageUpload {
  return isRecord(value) && value.file instanceof Blob && typeof value.thumbhash === 'string';
}

function partsOf(value: unknown): PartDraft[] {
  return Array.isArray(value) ? value.filter(isPart) : [];
}

function photoOf(value: unknown): Photo {
  return isPhoto(value) ? value : NO_PHOTO;
}

function textOf(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function unitOf(value: string): UnitId | null {
  return UNIT_IDS.find((unit) => unit === value) ?? null;
}

function valuesOf(item: Ingredient | null, name: string): Record<string, unknown> {
  if (item === null) {
    return {
      name,
      parentId: '',
      strength: '0',
      defaultUnit: '',
      origin: '',
      color: '',
      description: '',
      photo: NO_PHOTO,
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
    photo: {
      imageId: item.image?.id ?? null,
      imageUrl: item.image?.url ?? null,
      uploading: false,
      alt: text('photo.of', { name: item.name }),
    },
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

function inputOf(values: Record<string, unknown>): IngredientInput {
  const color = textOf(values.color).trim();
  return {
    name: textOf(values.name).trim(),
    parentId: numberOrNull(textOf(values.parentId)),
    strength: numberOrNull(textOf(values.strength)) ?? 0,
    description: textOf(values.description),
    origin: textOf(values.origin).trim(),
    color: color === '' ? null : color,
    defaultUnit: unitOf(textOf(values.defaultUnit)),
    imageId: photoOf(values.photo).imageId,
    parts: partsOf(values.parts)
      .filter((part) => part.ingredientId !== '')
      .map((part) => ({
        ingredientId: Number(part.ingredientId),
        amount: numberOrNull(part.amount),
        unit: unitOf(part.unit),
      })),
  };
}

function messageFor(name: string, error: FieldError): FieldError {
  switch (error.code) {
    case 'tree_cycle':
      return { ...error, message: text('ingredients.cycle', { name }) };
    case 'tree_too_deep':
      return { ...error, message: text('ingredients.tooDeep') };
    case 'parts_cycle':
      return { ...error, message: text('ingredients.partsCycle', { name }) };
    default:
      return error;
  }
}

registerFormFieldRenderer('ingredients-parts', (field, value, onChange, template) => {
  const parts = partsOf(value);
  const errors = field.errors ?? {};
  const replace = (index: number, patch: Partial<PartDraft>): void =>
    onChange(parts.map((part, at) => (at === index ? { ...part, ...patch } : part)));
  return template`<fieldset class="cl-kit-section cl-ingr-parts">
    <legend class="cl-kit-field-label">${text('ingredients.parts')}</legend>
    ${parts.map((part, index) => {
      const n = index + 1;
      return template`<div class="cl-ingr-part">
        <lc-select
          searchable
          label=${text('ingredients.partIngredient', { n })}
          .options=${field.options ?? []}
          .value=${part.ingredientId}
          error-message=${errors[`parts.${index}.ingredientId`] ?? errors[`parts.${index}`] ?? ''}
          @change=${(event: Event) => replace(index, { ingredientId: textOf(eventField(event, 'value')) })}
        ></lc-select>
        <lc-input
          type="number"
          inputmode="decimal"
          label=${text('ingredients.partAmount', { n })}
          .value=${part.amount}
          @input=${(event: Event) => replace(index, { amount: textOf(eventField(event, 'value')) })}
        ></lc-input>
        <lc-select
          label=${text('ingredients.partUnit', { n })}
          .options=${UNIT_OPTIONS}
          .value=${part.unit}
          @change=${(event: Event) => replace(index, { unit: textOf(eventField(event, 'value')) })}
        ></lc-select>
        <button
          type="button"
          class="cl-icon-button"
          aria-label=${text('ingredients.partRemove', { n })}
          @click=${() => onChange(parts.filter((_, at) => at !== index))}
        >
          <lc-icon name="x" aria-hidden="true"></lc-icon>
        </button>
      </div>`;
    })}
    <p class="cl-kit-hint">${text('ingredients.partsHint')}</p>
    <div>
      <lc-button variant="ghost" @click=${() => onChange([...parts, { ingredientId: '', amount: '', unit: '' }])}>
        <lc-icon name="plus" aria-hidden="true"></lc-icon>${text('ingredients.addPart')}
      </lc-button>
    </div>
  </fieldset>`;
});

registerFormFieldRenderer('ingredients-photo', (_field, value, onChange, template) => {
  const photo = photoOf(value);
  if (photo.imageUrl === null) {
    return template`<div class="cl-kit-section">
      <span class="cl-kit-field-label">${text('ingredients.photo')}</span>
      <cl-image-field purpose="ingredient" .change=${(upload: ImageUpload) => onChange(upload)}></cl-image-field>
      ${photo.uploading ? template`<lc-spinner size="sm"></lc-spinner>` : ''}
    </div>`;
  }
  return template`<div class="cl-ingr-photo">
    <lc-image class="cl-ingr-hero-art" src=${photo.imageUrl} alt=${photo.alt}></lc-image>
    <lc-button variant="quiet" @click=${() => onChange(NO_PHOTO)}>${text('ingredients.photoRemove')}</lc-button>
  </div>`;
});

class IngredientForm extends View {
  params: RouteParams = {};
  readonly tree = apiResource('getIngredientTree', ['ingredients']);
  readonly existing = apiResource('getIngredient', ['ingredients']);
  readonly state = loadState([this.existing]);
  readonly values = signal<Record<string, unknown> | null>(null);
  readonly saving = signal(false);
  readonly fields = computed<FormField[]>(() => this.fieldsFor());

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
    if (this.values.peek() !== null) {
      return;
    }
    if (editing === null) {
      this.values.value = valuesOf(null, route.query.peek().get('name') ?? '');
      return;
    }
    const item = this.existing.value.value;
    if (item !== undefined) {
      this.values.value = valuesOf(item, '');
      setScreenTitle(text('ingredients.editTitle', { name: item.name }));
    }
  }

  private fieldsFor(): FormField[] {
    const editing = this.editing;
    const tree = (blank: string): { value: string; label: string }[] => [
      { value: '', label: blank },
      ...(this.tree.value.value?.nodes ?? [])
        .filter((node) => node.id !== editing)
        .map((node) => ({ value: String(node.id), label: `${INDENT.repeat(node.depth)}${node.name}` })),
    ];
    return [
      { name: 'name', type: 'text', label: text('ingredients.name'), required: true, class: 'cl-ingr-wide' },
      {
        name: 'parentId',
        type: 'select',
        label: text('ingredients.parent'),
        searchable: true,
        placeholder: lcText('lc-select', 'search'),
        options: tree(text('ingredients.parentNone')),
        help: text('ingredients.parentHint'),
        class: 'cl-ingr-wide',
      },
      { name: 'strength', type: 'number', label: text('ingredients.strengthField'), min: 0, max: 100 },
      { name: 'defaultUnit', type: 'select', label: text('ingredients.defaultUnit'), options: UNIT_OPTIONS },
      { name: 'origin', type: 'text', label: text('ingredients.originField') },
      {
        name: 'color',
        type: 'text',
        label: text('ingredients.color'),
        placeholder: '#C47A2C',
        help: text('ingredients.colorHint'),
      },
      { name: 'description', type: 'textarea', label: text('ingredients.description'), rows: 4, class: 'cl-ingr-wide' },
      { name: 'photo', type: 'ingredients-photo', cmsType: 'ingredients-photo', class: 'cl-ingr-wide' },
      {
        name: 'parts',
        type: 'ingredients-parts',
        cmsType: 'ingredients-parts',
        options: tree(text('ingredients.choose')),
        class: 'cl-ingr-wide',
      },
    ];
  }

  private showErrors(errors: Readonly<Record<string, string>>): void {
    this.querySelector<Form>('lc-form')?.setErrors({ ...errors });
  }

  private async save(): Promise<void> {
    const current = this.values.peek();
    if (current === null) {
      return;
    }
    const color = textOf(current.color).trim();
    if (color !== '' && !COLOR.test(color)) {
      this.showErrors({ color: text('ingredients.colorInvalid') });
      return;
    }
    this.showErrors({});
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
        const named = new ApiError(
          error.code,
          error.status,
          error.detail,
          error.problem === null
            ? null
            : { ...error.problem, fields: error.fields.map((field) => messageFor(textOf(current.name), field)) },
        );
        const names = [
          ...FIELD_NAMES,
          ...named.fields.map((field) => field.path).filter((path) => PART_PATH.test(path)),
        ];
        this.showErrors(formErrors(named, names).fields);
        toast({ title: error.detail, variant: 'error' });
      } else {
        actionFailed(error, () => void this.save());
      }
    } finally {
      this.saving.value = false;
    }
  }

  private async upload(image: ImageUpload, name: string): Promise<void> {
    try {
      const form = new FormData();
      form.append('file', image.file);
      form.append('purpose', image.purpose);
      form.append('width', String(image.width));
      form.append('height', String(image.height));
      form.append('thumbhash', image.thumbhash);
      const ref = await call('uploadImage', { body: form });
      this.setPhoto({ imageId: ref.id, imageUrl: ref.url, uploading: false, alt: text('photo.of', { name }) });
    } catch (error) {
      this.setPhoto(NO_PHOTO);
      actionFailed(error, () => void this.upload(image, name));
    }
  }

  private setPhoto(photo: Photo): void {
    const current = this.values.peek();
    if (current !== null) {
      this.values.value = { ...current, photo };
    }
  }

  private changed(event: Event): void {
    const values = formValues(event);
    if (values === null) {
      return;
    }
    if (isImageUpload(values.photo)) {
      this.values.value = { ...values, photo: { ...NO_PHOTO, uploading: true } };
      void this.upload(values.photo, textOf(values.name));
      return;
    }
    this.values.value = values;
  }

  render() {
    const values = this.values.value;
    if (values === null) {
      return waiting(this.state, text('title.editIngredient'), 'lines');
    }
    const editing = this.editing;
    const busy = this.saving.value || photoOf(values.photo).uploading;
    return html`
      <h1 class="cl-kit-title cl-kit-wide-only">
        ${editing === null ? text('ingredients.newTitle') : text('ingredients.editTitle', { name: textOf(values.name) })}
      </h1>
      <lc-form
        class="cl-kit-form"
        layout="stacked"
        novalidate
        .fields=${this.fields.value}
        .data=${values}
        @field-change=${(event: Event) => this.changed(event)}
        @form-submit=${() => void this.save()}
      >
        <div class="cl-kit-sheet-footer">
          <lc-button variant="quiet" href=${href(editing === null ? '/ingredients' : `/ingredients/${editing}`)}
            >${text('action.cancel')}</lc-button
          >
          <lc-button variant="primary" type="submit" ?disabled=${busy} aria-busy=${this.saving.value ? 'true' : 'false'}
            >${text('ingredients.save')}</lc-button
          >
        </div>
      </lc-form>
    `;
  }
}

View.register(tag, IngredientForm);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: IngredientForm;
  }
}
