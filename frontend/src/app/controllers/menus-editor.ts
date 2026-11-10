import type { ImageRef } from '@cellar/contract';
import type { SearchDoc } from '@lightstart/components/types.js';
import { Controller } from '@lightstart/light/controller/class';
import { signal } from '@lightstart/light/signals';

export interface Drink {
  readonly kind: 'recipe' | 'ingredient';
  readonly refId: number;
  readonly name: string;
  readonly image: ImageRef | null;
  readonly hostNote: string;
  readonly hideWhenUnavailable: boolean;
  readonly available: boolean;
}

export class MenusEditorController extends Controller {
  readonly suggestions = signal<readonly SearchDoc[]>([]);
  private readonly picked = new Map<string, Drink>();

  constructor() {
    super('menus-editor');
  }

  reset(): void {
    this.picked.clear();
    this.suggestions.value = [];
  }

  remember(id: string, drink: Drink): void {
    this.picked.set(id, drink);
  }

  recall(id: string): Drink | undefined {
    return this.picked.get(id);
  }
}

export const menusEditor = new MenusEditorController();
await menusEditor.start();
