import { type FieldError, UNIT_IDS, UNIT_LABELS } from '@cellar/contract';
import { lcText } from '@lightstart/components/utils/text.js';
import { registerFormFieldRenderer } from '@lightstart/components/form/field-renderers.js';
import type { FormField } from '@lightstart/components/types.js';
import type { LightElements } from '@lightstart/components/elements.js';
import View from '@lightstart/light';
import { html, nothing } from '@lightstart/light/html';
import { signal } from '@lightstart/light/signals';
import { ApiError } from '../app/api.ts';
import { eventField } from '../app/events.ts';
import { formErrors } from '../app/problems.ts';
import '../design-system/cl-image-field.ts';
import '../design-system/lc/button.ts';
import '../design-system/lc/form.ts';
import '../design-system/lc/icon.ts';
import '../design-system/lc/input.ts';
import '../design-system/lc/select.ts';
import '../design-system/lc/textarea.ts';
import { text } from '../text/index.ts';
import '../screens/ingredients/ingredients.css';
import '../screens/shelf/parts/kit.css';

type Form = LightElements['lc-form'];

export const tag = 'cl-demo-form';

interface Part {
  ingredientId: string;
  amount: string;
  unit: string;
}

const NAMES = ['name', 'parentId', 'strength', 'defaultUnit', 'origin', 'color', 'description', 'image', 'parts'];

const TREE = [
  { value: '', label: text('ingredients.parentNone') },
  { value: '1', label: 'Spirits' },
  { value: '2', label: ' Whiskey' },
  { value: '3', label: ' Gin' },
];

const NO_DEFAULT = 'none';

const UNITS = [
  { value: '', label: text('ingredients.unitNone') },
  ...UNIT_IDS.map((unit) => ({ value: unit, label: UNIT_LABELS[unit] })),
];

function isPart(value: unknown): value is Part {
  return (
    typeof value === 'object' &&
    value !== null &&
    'ingredientId' in value &&
    'amount' in value &&
    'unit' in value &&
    typeof value.ingredientId === 'string' &&
    typeof value.amount === 'string' &&
    typeof value.unit === 'string'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

registerFormFieldRenderer('ingredients-parts', (_field, value, onChange, template) => {
  const parts: Part[] = Array.isArray(value) ? value.filter(isPart) : [];
  const replace = (index: number, patch: Partial<Part>): void =>
    onChange(parts.map((part, at) => (at === index ? { ...part, ...patch } : part)));
  return template`<fieldset class="cl-kit-section cl-ingr-parts">
    <legend class="cl-kit-field-label">${text('ingredients.parts')}</legend>
    ${parts.map((part, index) => {
      const n = index + 1;
      return template`<div class="cl-ingr-part">
        <lc-select
          searchable
          label=${text('ingredients.partIngredient', { n })}
          .options=${TREE}
          .value=${part.ingredientId}
          @change=${(event: Event) => replace(index, { ingredientId: String(eventField(event, 'value') ?? '') })}
        ></lc-select>
        <lc-input
          type="number"
          inputmode="decimal"
          label=${text('ingredients.partAmount', { n })}
          .value=${part.amount}
          @input=${(event: Event) => replace(index, { amount: String(eventField(event, 'value') ?? '') })}
        ></lc-input>
        <lc-select
          label=${text('ingredients.partUnit', { n })}
          .options=${UNITS}
          .value=${part.unit}
          @change=${(event: Event) => replace(index, { unit: String(eventField(event, 'value') ?? '') })}
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

const FIELDS: FormField[] = [
  { name: 'name', type: 'text', label: text('ingredients.name'), required: true, class: 'cl-demo-wide' },
  {
    name: 'parentId',
    type: 'select',
    label: text('ingredients.parent'),
    searchable: true,
    placeholder: lcText('lc-select', 'search'),
    options: TREE,
    help: text('ingredients.parentHint'),
    class: 'cl-demo-wide cl-demo-gap',
  },
  { name: 'strength', type: 'number', label: text('ingredients.strengthField'), min: 0, max: 100 },
  {
    name: 'defaultUnit',
    type: 'select',
    label: text('ingredients.defaultUnit'),
    options: [{ value: NO_DEFAULT, label: text('ingredients.unitNone') }, ...UNITS.slice(1)],
  },
  { name: 'origin', type: 'text', label: text('ingredients.originField'), class: 'cl-demo-tight' },
  {
    name: 'color',
    type: 'text',
    label: text('ingredients.color'),
    placeholder: '#C47A2C',
    help: text('ingredients.colorHint'),
    class: 'cl-demo-tight cl-demo-hint',
  },
  { name: 'description', type: 'textarea', label: text('ingredients.description'), rows: 4, class: 'cl-demo-wide' },
  {
    name: 'image',
    type: 'image',
    cmsType: 'image',
    label: text('ingredients.photo'),
    purpose: 'ingredient',
    class: 'cl-demo-wide cl-demo-image',
  },
  { name: 'parts', type: 'ingredients-parts', cmsType: 'ingredients-parts', class: 'cl-demo-wide' },
];

const SERVER_ERROR = new ApiError('validation_failed', 422, 'Check the form', {
  type: 'about:blank',
  title: 'Validation failed',
  status: 422,
  code: 'validation_failed',
  detail: 'Check the form',
  requestId: 'demo',
  fields: [
    { path: 'name', code: 'duplicate', message: 'There is already an ingredient with this name.' },
    { path: 'parentId', code: 'tree_cycle', message: 'An ingredient cannot go under itself.' },
    { path: 'parts.0.ingredientId', code: 'not_found', message: 'This part no longer exists.' },
    { path: 'unknown', code: 'invalid_value', message: 'A problem that belongs to no field.' },
  ],
});

class DemoForm extends View {
  readonly values = signal<Record<string, unknown>>({
    name: '',
    parentId: '',
    strength: '0',
    defaultUnit: NO_DEFAULT,
    origin: '',
    color: '',
    description: '',
    parts: [],
  });
  readonly rest = signal<readonly FieldError[]>([]);
  readonly submitted = signal('');

  connected(): void {
    this.classList.add('cl-kit-screen', 'cl-ingr-form', 'cl-demo-form');
  }

  showServerErrors(): void {
    const form = this.querySelector<Form>('lc-form');
    if (form === null) {
      return;
    }
    const { fields, rest } = formErrors(SERVER_ERROR, NAMES);
    form.setErrors(fields);
    this.rest.value = rest;
  }

  render() {
    return html`
      <h1 class="cl-kit-title cl-kit-wide-only">${text('ingredients.newTitle')}</h1>
      <lc-form
        class="cl-kit-form"
        layout="stacked"
        .fields=${FIELDS}
        .data=${this.values.value}
        @field-change=${(event: Event) => {
          const values = eventField(event, 'values');
          if (isRecord(values)) {
            this.values.value = values;
          }
        }}
        @form-submit=${(event: Event) => {
          this.submitted.value = JSON.stringify(eventField(event, 'name') ?? 'submitted');
        }}
      >
        <div class="cl-kit-sheet-footer">
          <lc-button variant="quiet">${text('action.cancel')}</lc-button>
          <lc-button variant="primary" type="submit">${text('ingredients.save')}</lc-button>
        </div>
      </lc-form>
      <lc-button variant="quiet" @click=${() => this.showServerErrors()}>Set server errors</lc-button>
      ${this.rest.value.map((error) => html`<p class="cl-kit-error" role="alert">${error.message}</p>`)}
      ${this.submitted.value === '' ? nothing : html`<p>Submitted ${this.submitted.value}</p>`}
    `;
  }
}

View.register(tag, DemoForm);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: DemoForm;
  }
}
