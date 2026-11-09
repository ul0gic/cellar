import {
  type Bottle,
  currencyDigits,
  type FieldError,
  type IngredientTree,
  parseLabeledSize,
  parseMoney,
} from '@cellar/contract';
import type { Resource } from '@lightstart/light/controller';
import { html, nothing, type TemplateResult } from '@lightstart/light/html';
import { ApiError, call } from '../../../app/api.ts';
import { invalidate } from '../../../app/resources.ts';
import type { PersonSignal } from '../../../app/types.ts';
import { toast } from '../../../design-system/toast.ts';
import { formatNumber } from '../../../text/format.ts';
import { text } from '../../../text/index.ts';
import { actionFailed, eventNumber, eventText, eventValue, fieldError, sheet, today } from './kit.ts';

// D-1 §9.8: the labeled sizes the size select offers.
const SIZES = ['50 ml', '200 ml', '375 ml', '500 ml', '700 ml', '750 ml', '1 L', '1.75 L', '12 fl oz', '25.4 fl oz'];
const DEFAULT_SIZE = '750 ml';
const OTHER = 'other';
// D-1 §8.8: the bottle count stepper runs 1 to 24.
const COUNT_MAX = 24;
const INDENT = ' ';

export interface BottleDraft {
  readonly name: string;
  readonly ingredientId: number | null;
}

interface Draft {
  editing: Bottle | null;
  name: string;
  ingredientId: string;
  size: string;
  otherSize: string;
  count: number;
  abv: string;
  price: string;
  boughtOn: string;
  status: 'sealed' | 'open';
  note: string;
  creating: boolean;
  newName: string;
  newParent: string;
}

export interface BottleSheetHost {
  readonly person: PersonSignal;
  readonly tree: Resource<IngredientTree>;
  redraw(): void;
  closed(): void;
}

export interface BottleSheet {
  openAdd(draft: BottleDraft | null): void;
  openEdit(bottle: Bottle): void;
  view(): TemplateResult;
}

function numberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function blankDraft(seed: BottleDraft | null): Draft {
  return {
    editing: null,
    name: seed?.name ?? '',
    ingredientId: seed?.ingredientId === null || seed === null ? '' : String(seed.ingredientId),
    size: DEFAULT_SIZE,
    otherSize: '',
    count: 1,
    abv: '',
    price: '',
    boughtOn: '',
    status: 'sealed',
    note: '',
    creating: false,
    newName: '',
    newParent: '',
  };
}

export function bottleSheet(host: BottleSheetHost): BottleSheet {
  let draft: Draft | null = null;
  let errors: FieldError[] = [];
  let saving = false;

  const currency = (): string => {
    const session = host.person.current();
    if (session === null) {
      throw new Error('The bottle sheet needs a signed-in person');
    }
    return session.household.currency;
  };

  const close = (): void => {
    draft = null;
    errors = [];
    host.closed();
    host.redraw();
  };

  const labelOf = (current: Draft): string => (current.size === OTHER ? current.otherSize.trim() : current.size);

  async function createIngredient(current: Draft): Promise<void> {
    try {
      const created = await call('createIngredient', {
        body: {
          name: current.newName.trim(),
          parentId: numberOrNull(current.newParent),
          strength: 0,
          description: '',
          origin: '',
          color: null,
          defaultUnit: null,
          imageId: null,
          parts: [],
        },
      });
      current.ingredientId = String(created.id);
      current.creating = false;
      current.newName = '';
      errors = errors.filter((error) => error.path !== 'newName');
      invalidate('ingredients');
      toast({ title: text('shelf.sheet.newIngredientCreated', { name: created.name }) });
    } catch (error) {
      if (error instanceof ApiError && error.fields.length > 0) {
        errors = error.fields.map((field) => ({ ...field, path: field.path === 'name' ? 'newName' : field.path }));
      } else {
        actionFailed(error, () => void createIngredient(current));
      }
    } finally {
      host.redraw();
    }
  }

  const checked = (current: Draft): { ingredientId: number; priceMinor: number | null } | null => {
    errors = [];
    const ingredientId = numberOrNull(current.ingredientId);
    const priceText = current.price.trim();
    const priceMinor = priceText === '' ? null : parseMoney(priceText, currency());
    if (ingredientId === null) {
      errors.push({ path: 'ingredientId', code: 'required', message: text('shelf.sheet.ingredientMissing') });
    }
    if (priceText !== '' && priceMinor === null) {
      errors.push({ path: 'pricePaidMinor', code: 'invalid_format', message: text('shelf.sheet.priceInvalid') });
    }
    return ingredientId === null || errors.length > 0 ? null : { ingredientId, priceMinor };
  };

  async function persist(current: Draft, ingredientId: number, priceMinor: number | null): Promise<void> {
    const label = labelOf(current);
    const fields = {
      name: current.name.trim(),
      ingredientId,
      labeledSize: label,
      volumeMl: parseLabeledSize(label),
      abv: numberOrNull(current.abv),
      pricePaidMinor: priceMinor,
      purchasedOn: current.boughtOn === '' ? null : current.boughtOn,
      note: current.note,
      imageId: current.editing?.image?.id ?? null,
    };
    if (current.editing !== null) {
      await call('updateBottle', { params: { id: current.editing.id }, body: fields });
      toast({ title: text('shelf.sheet.saved') });
      return;
    }
    await call('createBottles', {
      body: {
        ...fields,
        openedOn: current.status === 'open' ? today() : null,
        status: current.status,
        count: current.count,
      },
    });
    toast({
      title:
        current.count === 1
          ? text('shelf.sheet.addedOne')
          : text('shelf.sheet.addedMany', { count: formatNumber(current.count) }),
    });
  }

  async function save(current: Draft): Promise<void> {
    const valid = checked(current);
    if (valid === null) {
      host.redraw();
      return;
    }
    saving = true;
    host.redraw();
    try {
      await persist(current, valid.ingredientId, valid.priceMinor);
      invalidate('shelf', 'ingredients', 'recipes', 'stats');
      draft = null;
      host.closed();
    } catch (error) {
      if (error instanceof ApiError && error.fields.length > 0) {
        errors = [...error.fields];
      } else {
        actionFailed(error, () => void save(current));
      }
    } finally {
      saving = false;
      host.redraw();
    }
  }

  const ingredientOptions = (blank: string): { value: string; label: string }[] => [
    { value: '', label: blank },
    ...(host.tree.peek()?.nodes ?? []).map((node) => ({
      value: String(node.id),
      label: `${INDENT.repeat(node.depth)}${node.name}`,
    })),
  ];

  const ingredientHint = (current: Draft): string => {
    const nodes = host.tree.peek()?.nodes ?? [];
    const chosen = nodes.find((node) => String(node.id) === current.ingredientId);
    if (chosen === undefined) {
      return '';
    }
    const parent = nodes.find((node) => node.id === chosen.parentId);
    return parent === undefined || parent.depth === 0
      ? text('shelf.sheet.ingredientHint', { name: chosen.name })
      : text('shelf.sheet.ingredientHintParent', { parent: parent.name, name: chosen.name });
  };

  const newIngredient = (current: Draft): TemplateResult =>
    current.creating
      ? html`<div class="cl-kit-section cl-shelf-new-ingredient">
          <lc-input
            label=${text('shelf.sheet.newIngredientName')}
            .value=${current.newName}
            error-message=${fieldError(errors, 'newName')}
            @input=${(event: Event) => {
              current.newName = eventText(event);
            }}
          ></lc-input>
          <lc-select
            searchable
            label=${text('shelf.sheet.newIngredientParent')}
            .options=${ingredientOptions(text('shelf.sheet.newIngredientTop'))}
            .value=${current.newParent}
            error-message=${fieldError(errors, 'parentId')}
            @change=${(event: Event) => {
              current.newParent = eventText(event);
            }}
          ></lc-select>
          <div>
            <lc-button variant="quiet" @click=${() => void createIngredient(current)}
              >${text('shelf.sheet.newIngredientCreate')}</lc-button
            >
          </div>
        </div>`
      : html`<div>
          <lc-button
            variant="ghost"
            @click=${() => {
              current.creating = true;
              host.redraw();
            }}
            ><lc-icon name="plus" aria-hidden="true"></lc-icon>${text('shelf.sheet.newIngredient')}</lc-button
          >
        </div>`;

  const sizeFields = (current: Draft): TemplateResult => html`
    <lc-select
      label=${text('shelf.sheet.size')}
      .options=${[
        ...SIZES.map((size) => ({ value: size, label: size })),
        { value: OTHER, label: text('shelf.sheet.sizeOther') },
      ]}
      .value=${current.size}
      @change=${(event: Event) => {
        current.size = eventText(event);
        host.redraw();
      }}
    ></lc-select>
    ${
      current.size === OTHER
        ? html`<lc-input
            label=${text('shelf.sheet.sizeOtherLabel')}
            .value=${current.otherSize}
            error-message=${fieldError(errors, 'labeledSize')}
            @input=${(event: Event) => {
              current.otherSize = eventText(event);
            }}
          ></lc-input>`
        : nothing
    }
  `;

  const addOnly = (current: Draft): TemplateResult => html`
    <lc-number-input
      stepper
      label=${text('shelf.sheet.count')}
      min="1"
      max=${COUNT_MAX}
      .value=${current.count}
      @change=${(event: Event) => {
        current.count = eventNumber(event) ?? 1;
        host.redraw();
      }}
    ></lc-number-input>
    <div class="cl-kit-section">
      <span class="cl-kit-field-label" aria-hidden="true">${text('shelf.sheet.status')}</span>
      <lc-segmented
        label=${text('shelf.sheet.status')}
        .options=${[
          { value: 'sealed', label: text('shelf.status.sealed') },
          { value: 'open', label: text('shelf.status.open') },
        ]}
        value=${current.status}
        @change=${(event: Event) => {
          current.status = eventValue(event) === 'open' ? 'open' : 'sealed';
        }}
      ></lc-segmented>
    </div>
  `;

  const body = (current: Draft): TemplateResult => html`
    <lc-input
      required
      label=${text('shelf.sheet.name')}
      .value=${current.name}
      error-message=${fieldError(errors, 'name')}
      @input=${(event: Event) => {
        current.name = eventText(event);
      }}
    ></lc-input>
    <div class="cl-kit-section">
      <lc-select
        searchable
        label=${text('shelf.sheet.ingredient')}
        .options=${ingredientOptions(text('shelf.sheet.chooseIngredient'))}
        .value=${current.ingredientId}
        error-message=${fieldError(errors, 'ingredientId')}
        @change=${(event: Event) => {
          current.ingredientId = eventText(event);
          host.redraw();
        }}
      ></lc-select>
      ${ingredientHint(current) === '' ? nothing : html`<p class="cl-kit-hint">${ingredientHint(current)}</p>`}
      ${newIngredient(current)}
    </div>
    ${current.editing === null ? html`<div class="cl-shelf-add-row">${addOnly(current)}</div>` : nothing}
    <div class="cl-kit-pair">
      ${sizeFields(current)}
      <lc-input
        type="number"
        inputmode="decimal"
        min="0"
        max="100"
        label=${text('shelf.sheet.abv')}
        .value=${current.abv}
        error-message=${fieldError(errors, 'abv')}
        @input=${(event: Event) => {
          current.abv = eventText(event);
        }}
      ></lc-input>
      <lc-input
        inputmode="decimal"
        label=${text('shelf.sheet.price')}
        placeholder="0.00"
        .value=${current.price}
        error-message=${fieldError(errors, 'pricePaidMinor')}
        @input=${(event: Event) => {
          current.price = eventText(event);
        }}
      ></lc-input>
      <lc-input
        type="date"
        label=${text('shelf.sheet.bought')}
        .value=${current.boughtOn}
        error-message=${fieldError(errors, 'purchasedOn')}
        @input=${(event: Event) => {
          current.boughtOn = eventText(event);
        }}
      ></lc-input>
    </div>
    <lc-textarea
      label=${text('shelf.sheet.note')}
      placeholder=${text('shelf.sheet.notePlaceholder')}
      .value=${current.note}
      error-message=${fieldError(errors, 'note')}
      @input=${(event: Event) => {
        current.note = eventText(event);
      }}
    ></lc-textarea>
    <p class="cl-kit-hint">${text('shelf.sheet.priceHint')}</p>
  `;

  const submitLabel = (current: Draft): string => {
    if (current.editing !== null) {
      return text('shelf.sheet.save');
    }
    return current.count === 1
      ? text('shelf.sheet.addOne')
      : text('shelf.sheet.addMany', { count: formatNumber(current.count) });
  };

  return {
    openAdd(seed) {
      draft = blankDraft(seed);
      errors = [];
      host.redraw();
    },
    openEdit(bottle) {
      const sized = SIZES.includes(bottle.labeledSize);
      draft = {
        ...blankDraft(null),
        editing: bottle,
        name: bottle.name,
        ingredientId: String(bottle.ingredient.id),
        size: sized ? bottle.labeledSize : OTHER,
        otherSize: sized ? '' : bottle.labeledSize,
        abv: bottle.abv === null ? '' : String(bottle.abv),
        price:
          bottle.pricePaidMinor === null || bottle.pricePaidMinor === undefined
            ? ''
            : String(bottle.pricePaidMinor / 10 ** currencyDigits(currency())),
        boughtOn: bottle.purchasedOn ?? '',
        status: bottle.status === 'open' ? 'open' : 'sealed',
        note: bottle.note,
      };
      errors = [];
      host.redraw();
    },
    view() {
      const current = draft;
      if (current === null) {
        return sheet({ open: false, title: '', onClose: close, body: html``, footer: html`` });
      }
      return sheet({
        open: true,
        title:
          current.editing === null
            ? text('shelf.sheet.addTitle')
            : text('shelf.sheet.editTitle', { name: current.editing.name }),
        onClose: close,
        body: body(current),
        footer: html`
          <lc-button variant="quiet" @click=${close}>${text('action.cancel')}</lc-button>
          <lc-button
            variant="primary"
            ?disabled=${saving}
            aria-busy=${saving ? 'true' : nothing}
            @click=${() => void save(current)}
            >${submitLabel(current)}</lc-button
          >
        `,
      });
    },
  };
}
