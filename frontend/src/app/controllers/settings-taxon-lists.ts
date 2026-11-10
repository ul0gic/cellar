import { Controller } from '@lightstart/light/controller/class';
import { signal } from '@lightstart/light/signals';

export interface TaxonDraft {
  readonly values: Record<string, unknown>;
  readonly error: string;
  readonly busy: boolean;
}

const BLANK_DRAFT: TaxonDraft = { values: {}, error: '', busy: false };

export class SettingsTaxonLists extends Controller {
  readonly drafts = signal<ReadonlyMap<string, TaxonDraft>>(new Map());

  constructor() {
    super('settings-taxon-lists');
  }

  draft(key: string): TaxonDraft {
    return this.drafts.value.get(key) ?? BLANK_DRAFT;
  }

  patch(key: string, change: Partial<TaxonDraft>): void {
    const current = this.drafts.peek().get(key) ?? BLANK_DRAFT;
    this.drafts.value = new Map(this.drafts.peek()).set(key, { ...current, ...change });
  }

  reset(): void {
    this.drafts.value = new Map();
  }
}

export const settingsTaxonLists = new SettingsTaxonLists();
await settingsTaxonLists.start();
