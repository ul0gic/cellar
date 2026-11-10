import { type Bottle, currencyDigits, type FieldError } from '@cellar/contract';
import { Controller } from '@lightstart/light/controller/class';
import { batch, signal } from '@lightstart/light/signals';
import { session } from './session.ts';

// D-1 §9.8: the labeled sizes the size select offers.
export const SIZES = [
  '50 ml',
  '200 ml',
  '375 ml',
  '500 ml',
  '700 ml',
  '750 ml',
  '1 L',
  '1.75 L',
  '12 fl oz',
  '25.4 fl oz',
];
export const OTHER = 'other';
const DEFAULT_SIZE = '750 ml';

export interface BottleDraft {
  readonly name: string;
  readonly ingredientId: number | null;
}

export interface SheetDraft {
  readonly editing: Bottle | null;
  readonly name: string;
  readonly ingredientId: string;
  readonly size: string;
  readonly otherSize: string;
  readonly count: number;
  readonly abv: string;
  readonly price: string;
  readonly boughtOn: string;
  readonly status: 'sealed' | 'open';
  readonly note: string;
  readonly creating: boolean;
  readonly newName: string;
  readonly newParent: string;
}

function blankDraft(seed: BottleDraft | null): SheetDraft {
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

export class ShelfBottleSheetController extends Controller {
  readonly draft = signal<SheetDraft | null>(null);
  readonly errors = signal<readonly FieldError[]>([]);
  readonly saving = signal(false);

  constructor() {
    super('shelf-bottle-sheet');
  }

  reset(): void {
    batch(() => {
      this.draft.value = null;
      this.errors.value = [];
      this.saving.value = false;
    });
  }

  openAdd(seed: BottleDraft | null): void {
    batch(() => {
      this.draft.value = blankDraft(seed);
      this.errors.value = [];
    });
  }

  openEdit(bottle: Bottle): void {
    const current = session.current.peek();
    if (current === null) {
      throw new Error('The bottle sheet needs a signed-in person');
    }
    const sized = SIZES.includes(bottle.labeledSize);
    batch(() => {
      this.draft.value = {
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
            : String(bottle.pricePaidMinor / 10 ** currencyDigits(current.household.currency)),
        boughtOn: bottle.purchasedOn ?? '',
        status: bottle.status === 'open' ? 'open' : 'sealed',
        note: bottle.note,
      };
      this.errors.value = [];
    });
  }

  change(patch: Partial<SheetDraft>): void {
    const current = this.draft.peek();
    if (current !== null) {
      this.draft.value = { ...current, ...patch };
    }
  }

  close(): void {
    batch(() => {
      this.draft.value = null;
      this.errors.value = [];
    });
  }
}

export const bottleSheet = new ShelfBottleSheetController();
await bottleSheet.start();
