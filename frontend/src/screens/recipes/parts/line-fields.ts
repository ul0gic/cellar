import {
  INPUT_VOLUME_UNITS,
  type InputVolumeUnit,
  LIMITS,
  type RecipeLineInput,
  UNIT_IDS,
  UNIT_LABELS,
  type UnitId,
} from '@cellar/contract';
import { registerFormFieldRenderer } from '@lightstart/light/components/form/field-renderers.js';
import type { SearchDoc } from '@lightstart/light/components/types.js';
import { html, nothing, type TemplateResult } from '@lightstart/light/html';
import { call } from '../../../app/api.ts';
import { invalidate } from '../../../app/resources.ts';
import { text } from '../../../text/index.ts';
import { eventChecked, eventText } from './events.ts';
import { actionFailed } from './failures.ts';
import { openSheet } from './sheet.ts';

export interface PickedIngredient {
  readonly id: number;
  readonly name: string;
}

export interface LineSubstituteDraft {
  readonly ingredient: PickedIngredient;
  readonly amount: number | null;
  readonly amountMax: number | null;
  readonly unit: RecipeLineInput['unit'];
}

export interface LineDraft {
  readonly ingredient: PickedIngredient | null;
  readonly ingredientText: string;
  readonly amount: string;
  readonly amountMax: string;
  readonly unit: string;
  readonly optional: boolean;
  readonly specified: boolean;
  readonly note: string;
  readonly substitutes: readonly LineSubstituteDraft[];
  readonly error: string;
}

export const BLANK_LINE: LineDraft = {
  ingredient: null,
  ingredientText: '',
  amount: '',
  amountMax: '',
  unit: '',
  optional: false,
  specified: false,
  note: '',
  substitutes: [],
  error: '',
};

const SEARCH_LIMIT = 8;
const CREATE_ID = 'create';
const UNIT_CHOICES: readonly (UnitId | InputVolumeUnit)[] = [
  ...INPUT_VOLUME_UNITS.filter((unit) => unit !== 'ml'),
  ...UNIT_IDS,
];

function isPicked(value: unknown): value is PickedIngredient {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'number' &&
    'name' in value &&
    typeof value.name === 'string'
  );
}

function isLineDraft(value: unknown): value is LineDraft {
  return typeof value === 'object' && value !== null && 'substitutes' in value && 'ingredientText' in value;
}

export function unitLabel(unit: UnitId | InputVolumeUnit): string {
  return unit === 'oz' || unit === 'cl' ? unit : UNIT_LABELS[unit];
}

export function toUnit(raw: string): UnitId | InputVolumeUnit | null {
  return UNIT_CHOICES.find((unit) => unit === raw) ?? null;
}

async function openCreateSheet(name: string, heading: string, picked: (ingredient: PickedIngredient) => void) {
  const { nodes } = await call('getIngredientTree', {});
  let newName = name;
  let parent = '';
  let strength = '';
  let saving = false;
  const save = async (): Promise<void> => {
    saving = true;
    sheet.redraw();
    try {
      const created = await call('createIngredient', {
        body: {
          name: newName.trim(),
          parentId: parent === '' ? null : Number(parent),
          strength: strength === '' ? 0 : Number(strength),
          description: '',
          origin: '',
          color: null,
          defaultUnit: null,
          imageId: null,
          parts: [],
        },
      });
      invalidate('ingredients');
      sheet.close();
      picked({ id: created.id, name: created.name });
    } catch (error) {
      saving = false;
      sheet.redraw();
      actionFailed(error, () => void save());
    }
  };
  const parentName = nodes.find((node) => String(node.id) === parent)?.name ?? '';
  const sheet = openSheet({
    heading: () => heading,
    body: () => html`
      <lc-input
        label=${text('recipes.createName')}
        maxlength=${LIMITS.name.max}
        value=${newName}
        @input=${(event: Event) => {
          newName = eventText(event);
          sheet.redraw();
        }}
      ></lc-input>
      <lc-select
        label=${text('recipes.createParent')}
        searchable
        value=${parent}
        .options=${nodes.map((node) => ({ value: String(node.id), label: `${'· '.repeat(node.depth)}${node.name}` }))}
        @change=${(event: Event) => {
          parent = eventText(event);
          sheet.redraw();
        }}
      ></lc-select>
      <p class="cl-sheet-hint">
        ${parent === '' ? text('recipes.createParentHint') : text('recipes.createParentUses', { parent: parentName })}
      </p>
      <lc-input
        label=${text('recipes.createStrength')}
        type="number"
        min="0"
        max="100"
        step="0.1"
        value=${strength}
        @input=${(event: Event) => {
          strength = eventText(event);
        }}
      ></lc-input>
    `,
    footer: () => html`
      <lc-button variant="quiet" @click=${() => sheet.close()}>${text('action.back')}</lc-button>
      <lc-button variant="primary" ?disabled=${saving || newName.trim() === ''} @click=${() => void save()}
        >${text('recipes.createAndUse')}</lc-button
      >
    `,
  });
}

function ingredientPick(
  label: string,
  heading: string,
  value: PickedIngredient | null,
  onChange: (picked: PickedIngredient) => void,
  error: string,
): TemplateResult {
  const search = async (event: Event): Promise<void> => {
    const target = event.currentTarget;
    const query = event instanceof CustomEvent && typeof event.detail === 'string' ? event.detail.trim() : '';
    if (!(target instanceof HTMLElement) || !('docs' in target)) {
      return;
    }
    if (query === '') {
      target.docs = [];
      return;
    }
    const page = await call('listIngredients', { query: { q: query, pageSize: SEARCH_LIMIT } });
    const docs: SearchDoc[] = page.items.map((item) => ({
      id: item.id,
      group: text('recipes.matches'),
      title: item.name,
      hint: item.parent?.name ?? item.root.name,
    }));
    docs.push({
      id: CREATE_ID,
      group: text('recipes.matches'),
      title: text('recipes.createNamed', { name: query }),
      hint: text('recipes.createHint'),
      query,
    });
    target.docs = docs;
  };
  const select = (event: Event): void => {
    const doc: unknown = event instanceof CustomEvent ? event.detail : null;
    if (typeof doc !== 'object' || doc === null || !('id' in doc)) {
      return;
    }
    if (doc.id === CREATE_ID) {
      const name = 'query' in doc && typeof doc.query === 'string' ? doc.query : '';
      void openCreateSheet(name, heading, onChange);
      return;
    }
    if (typeof doc.id === 'number' && 'title' in doc && typeof doc.title === 'string') {
      onChange({ id: doc.id, name: doc.title });
    }
  };
  return html`<div class="cl-pick">
    <lc-search
      remote
      label=${label}
      placeholder=${value?.name ?? text('recipes.findIngredient')}
      .query=${''}
      @search-input=${(event: Event) =>
        void search(event).catch((failure: unknown) => actionFailed(failure, () => undefined))}
      @search-select=${select}
    ></lc-search>
    ${value === null ? nothing : html`<p class="cl-pick-chosen">${value.name}</p>`}
    ${error === '' ? nothing : html`<p class="cl-field-error" role="alert">${error}</p>`}
  </div>`;
}

function lineRow(position: number, line: LineDraft, onChange: (next: LineDraft) => void): TemplateResult {
  const set = (patch: Partial<LineDraft>): void => onChange({ ...line, ...patch, error: '' });
  const unitOptions = [
    { value: '', label: text('recipes.noUnit') },
    ...UNIT_CHOICES.map((unit) => ({ value: unit, label: unitLabel(unit) })),
  ];
  return html`<div class="cl-line-card">
    <p class="cl-line-number">${text('recipes.lineNumber', { position })}</p>
    <div class="cl-line-amounts">
      <lc-input
        label=${text('recipes.amount')}
        inputmode="decimal"
        value=${line.amount}
        @input=${(event: Event) => set({ amount: eventText(event) })}
      ></lc-input>
      <lc-input
        label=${text('recipes.amountTo')}
        inputmode="decimal"
        value=${line.amountMax}
        @input=${(event: Event) => set({ amountMax: eventText(event) })}
      ></lc-input>
      <lc-select
        label=${text('recipes.unit')}
        value=${line.unit}
        .options=${unitOptions}
        @change=${(event: Event) => set({ unit: eventText(event) })}
      ></lc-select>
    </div>
    ${ingredientPick(
      text('recipes.ingredientLabel'),
      text('recipes.lineIngredient', { position }),
      line.ingredient,
      (ingredient) => set({ ingredient }),
      line.error,
    )}
    ${line.ingredient === null && line.ingredientText !== '' ? html`<p class="cl-sheet-hint">${text('recipes.draftRead', { text: line.ingredientText })}</p>` : nothing}
    <div class="cl-line-checks">
      <lc-checkbox
        label=${text('recipes.optional')}
        ?checked=${line.optional}
        @change=${(event: Event) => set({ optional: eventChecked(event) })}
      ></lc-checkbox>
      <lc-checkbox
        label=${text('recipes.exactOnly')}
        ?checked=${line.specified}
        @change=${(event: Event) => set({ specified: eventChecked(event) })}
      ></lc-checkbox>
    </div>
    <div class="cl-line-subs">
      ${line.substitutes.map(
        (substitute) => html`<lc-tag
          closable
          aria-label=${text('recipes.removeSubstitute', { name: substitute.ingredient.name })}
          @close=${() => set({ substitutes: line.substitutes.filter((item) => item !== substitute) })}
        >${substitute.ingredient.name}</lc-tag>`,
      )}
      ${
        line.substitutes.length < LIMITS.substitutesPerLine.max
          ? ingredientPick(
              text('recipes.addSubstitute'),
              text('recipes.lineSubstitute', { position }),
              null,
              (ingredient) =>
                set({
                  substitutes: [...line.substitutes, { ingredient, amount: null, amountMax: null, unit: null }],
                }),
              '',
            )
          : nothing
      }
    </div>
    <lc-input
      label=${text('recipes.lineNote')}
      maxlength=${LIMITS.lineNote.max}
      value=${line.note}
      @input=${(event: Event) => set({ note: eventText(event) })}
    ></lc-input>
  </div>`;
}

let registered = false;

export function registerLineFields(): void {
  if (registered) {
    return;
  }
  registered = true;
  registerFormFieldRenderer('ingredient-pick', (field, value, onChange) =>
    ingredientPick(
      field.label ?? '',
      field.label ?? '',
      isPicked(value) ? value : null,
      onChange,
      typeof field.errorMessage === 'string' ? field.errorMessage : '',
    ),
  );
  registerFormFieldRenderer('recipe-line', (field, value, onChange) => {
    const index = /\[(\d+)\]$/.exec(field.name)?.[1];
    const position = index === undefined ? 1 : Number(index) + 1;
    return lineRow(position, isLineDraft(value) ? value : BLANK_LINE, onChange);
  });
}
