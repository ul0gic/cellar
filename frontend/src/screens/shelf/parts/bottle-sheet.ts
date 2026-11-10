import { type FieldError, parseLabeledSize, parseMoney } from '@cellar/contract';
import View from '@lightstart/light';
import { html, nothing, type TemplateResult } from '@lightstart/light/html';
import { ApiError, call } from '../../../app/api.ts';
import { bottleSheet, OTHER, SIZES, type SheetDraft } from '../../../app/controllers/shelf-bottle-sheet.ts';
import { session } from '../../../app/controllers/session.ts';
import { eventField, eventNumber, eventText } from '../../../app/events.ts';
import { actionFailed } from '../../../app/problems.ts';
import { apiResource, dataChanged } from '../../../app/resources.ts';
import { setQuery } from '../../../app/router.ts';
import { route } from '../../../app/controllers/route.ts';
import { today } from '../../../app/today.ts';
import { toast } from '../../../design-system/toast.ts';
import { formatNumber } from '../../../text/format.ts';
import { text } from '../../../text/index.ts';
import '../../../design-system/lc/button.ts';
import '../../../design-system/lc/icon.ts';
import '../../../design-system/lc/input.ts';
import '../../../design-system/lc/number-input.ts';
import '../../../design-system/lc/segmented.ts';
import '../../../design-system/lc/select.ts';
import '../../../design-system/lc/textarea.ts';
import { fieldError, sheet } from './kit.ts';

const tag = 'cl-shelf-bottle-sheet';

// D-1 §8.8: the bottle count stepper runs 1 to 24.
const COUNT_MAX = 24;
const INDENT = ' ';

function numberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

const labelOf = (current: SheetDraft): string => (current.size === OTHER ? current.otherSize.trim() : current.size);

function currency(): string {
  const current = session.current.peek();
  if (current === null) {
    throw new Error('The bottle sheet needs a signed-in person');
  }
  return current.household.currency;
}

class ShelfBottleSheet extends View {
  readonly tree = apiResource('getIngredientTree', ['ingredients']);

  connected(): void {
    this.tree.bind(this, {});
  }

  private closed(): void {
    const query = route.query.peek();
    if (this.isConnected && (query.has('add') || query.has('bottle'))) {
      setQuery({ add: null, bottle: null }, 'replace');
    }
  }

  private close(): void {
    bottleSheet.close();
    this.closed();
  }

  private async createIngredient(current: SheetDraft): Promise<void> {
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
      dataChanged('ingredients');
      toast({ title: text('shelf.sheet.newIngredientCreated', { name: created.name }) });
      if (this.isConnected) {
        bottleSheet.change({ ingredientId: String(created.id), creating: false, newName: '' });
        bottleSheet.errors.value = bottleSheet.errors.peek().filter((error) => error.path !== 'newName');
      }
    } catch (error) {
      if (error instanceof ApiError && error.fields.length > 0) {
        if (this.isConnected) {
          bottleSheet.errors.value = error.fields.map((field) => ({
            ...field,
            path: field.path === 'name' ? 'newName' : field.path,
          }));
        }
      } else {
        actionFailed(error, () => void this.createIngredient(current));
      }
    }
  }

  private checked(current: SheetDraft): { ingredientId: number; priceMinor: number | null } | null {
    const found: FieldError[] = [];
    const ingredientId = numberOrNull(current.ingredientId);
    const priceText = current.price.trim();
    const priceMinor = priceText === '' ? null : parseMoney(priceText, currency());
    if (ingredientId === null) {
      found.push({ path: 'ingredientId', code: 'required', message: text('shelf.sheet.ingredientMissing') });
    }
    if (priceText !== '' && priceMinor === null) {
      found.push({ path: 'pricePaidMinor', code: 'invalid_format', message: text('shelf.sheet.priceInvalid') });
    }
    bottleSheet.errors.value = found;
    return ingredientId === null || found.length > 0 ? null : { ingredientId, priceMinor };
  }

  private async persist(current: SheetDraft, ingredientId: number, priceMinor: number | null): Promise<void> {
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

  private async save(): Promise<void> {
    const current = bottleSheet.draft.peek();
    if (current === null) {
      return;
    }
    const valid = this.checked(current);
    if (valid === null) {
      return;
    }
    bottleSheet.saving.value = true;
    try {
      await this.persist(current, valid.ingredientId, valid.priceMinor);
      dataChanged('shelf', 'ingredients', 'recipes', 'stats');
      if (this.isConnected) {
        bottleSheet.draft.value = null;
        this.closed();
      }
    } catch (error) {
      if (error instanceof ApiError && error.fields.length > 0) {
        if (this.isConnected) {
          bottleSheet.errors.value = [...error.fields];
        }
      } else {
        actionFailed(error, () => void this.save());
      }
    } finally {
      if (this.isConnected) {
        bottleSheet.saving.value = false;
      }
    }
  }

  private ingredientOptions(blank: string): { value: string; label: string }[] {
    return [
      { value: '', label: blank },
      ...(this.tree.value.value?.nodes ?? []).map((node) => ({
        value: String(node.id),
        label: `${INDENT.repeat(node.depth)}${node.name}`,
      })),
    ];
  }

  private ingredientHint(current: SheetDraft): string {
    const nodes = this.tree.value.value?.nodes ?? [];
    const chosen = nodes.find((node) => String(node.id) === current.ingredientId);
    if (chosen === undefined) {
      return '';
    }
    const parent = nodes.find((node) => node.id === chosen.parentId);
    return parent === undefined || parent.depth === 0
      ? text('shelf.sheet.ingredientHint', { name: chosen.name })
      : text('shelf.sheet.ingredientHintParent', { parent: parent.name, name: chosen.name });
  }

  private newIngredient(current: SheetDraft): TemplateResult {
    const errors = bottleSheet.errors.value;
    return current.creating
      ? html`<div class="cl-kit-section cl-shelf-new-ingredient">
          <lc-input
            label=${text('shelf.sheet.newIngredientName')}
            .value=${current.newName}
            error-message=${fieldError(errors, 'newName')}
            @input=${(event: Event) => bottleSheet.change({ newName: eventText(event) })}
          ></lc-input>
          <lc-select
            searchable
            label=${text('shelf.sheet.newIngredientParent')}
            .options=${this.ingredientOptions(text('shelf.sheet.newIngredientTop'))}
            .value=${current.newParent}
            error-message=${fieldError(errors, 'parentId')}
            @change=${(event: Event) => bottleSheet.change({ newParent: eventText(event) })}
          ></lc-select>
          <div>
            <lc-button variant="quiet" @click=${() => void this.createIngredient(current)}
              >${text('shelf.sheet.newIngredientCreate')}</lc-button
            >
          </div>
        </div>`
      : html`<div>
          <lc-button variant="ghost" @click=${() => bottleSheet.change({ creating: true })}
            ><lc-icon name="plus" aria-hidden="true"></lc-icon>${text('shelf.sheet.newIngredient')}</lc-button
          >
        </div>`;
  }

  private sizeFields(current: SheetDraft): TemplateResult {
    return html`
      <lc-select
        label=${text('shelf.sheet.size')}
        .options=${[
          ...SIZES.map((size) => ({ value: size, label: size })),
          { value: OTHER, label: text('shelf.sheet.sizeOther') },
        ]}
        .value=${current.size}
        @change=${(event: Event) => bottleSheet.change({ size: eventText(event) })}
      ></lc-select>
      ${
        current.size === OTHER
          ? html`<lc-input
              label=${text('shelf.sheet.sizeOtherLabel')}
              .value=${current.otherSize}
              error-message=${fieldError(bottleSheet.errors.value, 'labeledSize')}
              @input=${(event: Event) => bottleSheet.change({ otherSize: eventText(event) })}
            ></lc-input>`
          : nothing
      }
    `;
  }

  private addOnly(current: SheetDraft): TemplateResult {
    return html`
      <lc-number-input
        stepper
        label=${text('shelf.sheet.count')}
        min="1"
        max=${COUNT_MAX}
        .value=${current.count}
        @change=${(event: Event) => bottleSheet.change({ count: eventNumber(event) ?? 1 })}
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
          @change=${(event: Event) =>
            bottleSheet.change({ status: eventField(event, 'value') === 'open' ? 'open' : 'sealed' })}
        ></lc-segmented>
      </div>
    `;
  }

  private body(current: SheetDraft): TemplateResult {
    const errors = bottleSheet.errors.value;
    const hint = this.ingredientHint(current);
    return html`
      <lc-input
        required
        label=${text('shelf.sheet.name')}
        .value=${current.name}
        error-message=${fieldError(errors, 'name')}
        @input=${(event: Event) => bottleSheet.change({ name: eventText(event) })}
      ></lc-input>
      <div class="cl-kit-section">
        <lc-select
          searchable
          label=${text('shelf.sheet.ingredient')}
          .options=${this.ingredientOptions(text('shelf.sheet.chooseIngredient'))}
          .value=${current.ingredientId}
          error-message=${fieldError(errors, 'ingredientId')}
          @change=${(event: Event) => bottleSheet.change({ ingredientId: eventText(event) })}
        ></lc-select>
        ${hint === '' ? nothing : html`<p class="cl-kit-hint">${hint}</p>`}
        ${this.newIngredient(current)}
      </div>
      ${current.editing === null ? html`<div class="cl-shelf-add-row">${this.addOnly(current)}</div>` : nothing}
      <div class="cl-kit-pair">
        ${this.sizeFields(current)}
        <lc-input
          type="number"
          inputmode="decimal"
          min="0"
          max="100"
          label=${text('shelf.sheet.abv')}
          .value=${current.abv}
          error-message=${fieldError(errors, 'abv')}
          @input=${(event: Event) => bottleSheet.change({ abv: eventText(event) })}
        ></lc-input>
        <lc-input
          inputmode="decimal"
          label=${text('shelf.sheet.price')}
          placeholder="0.00"
          .value=${current.price}
          error-message=${fieldError(errors, 'pricePaidMinor')}
          @input=${(event: Event) => bottleSheet.change({ price: eventText(event) })}
        ></lc-input>
        <lc-input
          type="date"
          label=${text('shelf.sheet.bought')}
          .value=${current.boughtOn}
          error-message=${fieldError(errors, 'purchasedOn')}
          @input=${(event: Event) => bottleSheet.change({ boughtOn: eventText(event) })}
        ></lc-input>
      </div>
      <lc-textarea
        label=${text('shelf.sheet.note')}
        placeholder=${text('shelf.sheet.notePlaceholder')}
        .value=${current.note}
        error-message=${fieldError(errors, 'note')}
        @input=${(event: Event) => bottleSheet.change({ note: eventText(event) })}
      ></lc-textarea>
      <p class="cl-kit-hint">${text('shelf.sheet.priceHint')}</p>
    `;
  }

  private submitLabel(current: SheetDraft): string {
    if (current.editing !== null) {
      return text('shelf.sheet.save');
    }
    return current.count === 1
      ? text('shelf.sheet.addOne')
      : text('shelf.sheet.addMany', { count: formatNumber(current.count) });
  }

  render() {
    const current = bottleSheet.draft.value;
    if (current === null) {
      return sheet({ open: false, title: '', onClose: () => this.close(), body: html``, footer: html`` });
    }
    const saving = bottleSheet.saving.value;
    return sheet({
      open: true,
      title:
        current.editing === null
          ? text('shelf.sheet.addTitle')
          : text('shelf.sheet.editTitle', { name: current.editing.name }),
      onClose: () => this.close(),
      body: this.body(current),
      footer: html`
        <lc-button variant="quiet" @click=${() => this.close()}>${text('action.cancel')}</lc-button>
        <lc-button
          variant="primary"
          ?disabled=${saving}
          aria-busy=${saving ? 'true' : nothing}
          @click=${() => void this.save()}
          >${this.submitLabel(current)}</lc-button
        >
      `,
    });
  }
}

View.register(tag, ShelfBottleSheet);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: ShelfBottleSheet;
  }
}
