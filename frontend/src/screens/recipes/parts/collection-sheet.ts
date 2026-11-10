import type { Recipe } from '@cellar/contract';
import type { FormField } from '@lightstart/components/types.js';
import { html } from '@lightstart/light/html';
import { signal } from '@lightstart/light/signals';
import { call } from '../../../app/api.ts';
import { eventChecked, eventText } from '../../../app/events.ts';
import { actionFailed } from '../../../app/problems.ts';
import { dataChanged } from '../../../app/resources.ts';
import type { OverlayHost } from '../../../app/types.ts';
import { text } from '../../../text/index.ts';
import '../../../design-system/lc/button.ts';
import '../../../design-system/lc/checkbox.ts';
import '../../../design-system/lc/form.ts';
import { openSheet } from './sheet.ts';

const FIELDS: FormField[] = [{ name: 'name', type: 'text', label: text('recipes.newCollection') }];

export async function openCollectionSheet(host: OverlayHost, recipe: Recipe): Promise<void> {
  const listed = await call('listCollections', {});
  if (!host.isConnected) {
    return;
  }
  const collections = signal(listed.collections);
  const holding = signal<ReadonlySet<number>>(new Set(recipe.collections.map((collection) => collection.id)));
  const newName = signal('');
  const busy = signal(false);

  const hold = (id: number, held: boolean): void => {
    const next = new Set(holding.peek());
    if (held) {
      next.add(id);
    } else {
      next.delete(id);
    }
    holding.value = next;
  };

  const toggle = async (id: number, add: boolean): Promise<void> => {
    try {
      if (add) {
        await call('addRecipeToCollection', { params: { id }, body: { recipeId: recipe.id } });
      } else {
        await call('removeRecipeFromCollection', { params: { id, recipeId: recipe.id } });
      }
      hold(id, add);
      dataChanged('collections', 'recipes');
    } catch (error) {
      actionFailed(error, () => void toggle(id, add));
    }
  };

  const create = async (): Promise<void> => {
    busy.value = true;
    try {
      const created = await call('createCollection', { body: { name: newName.peek().trim(), description: '' } });
      await call('addRecipeToCollection', { params: { id: created.id }, body: { recipeId: recipe.id } });
      hold(created.id, true);
      collections.value = (await call('listCollections', {})).collections;
      newName.value = '';
      dataChanged('collections', 'recipes');
    } catch (error) {
      actionFailed(error, () => void create());
    }
    busy.value = false;
  };

  const sheet = openSheet(host, {
    heading: () => text('recipes.collectionHeading', { name: recipe.name }),
    body: () => html`
      <div class="cl-sheet-checks">
        ${collections.value.map(
          (collection) => html`<lc-checkbox
            label=${collection.name}
            ?checked=${holding.value.has(collection.id)}
            ?disabled=${!collection.canEdit}
            @change=${(event: Event) => void toggle(collection.id, eventChecked(event))}
          ></lc-checkbox>`,
        )}
      </div>
      <lc-form
        class="cl-sheet-inline"
        layout="stacked"
        .fields=${FIELDS}
        .data=${{ name: newName.value }}
        @field-change=${(event: Event) => {
          newName.value = eventText(event);
        }}
        @form-submit=${() => {
          if (newName.peek().trim() !== '' && !busy.peek()) {
            void create();
          }
        }}
      >
        <lc-button type="submit" ?disabled=${busy.value || newName.value.trim() === ''}>${text('recipes.createCollection')}</lc-button>
      </lc-form>
    `,
    footer: () => html`<lc-button variant="primary" @click=${() => sheet.close()}>${text('recipes.done')}</lc-button>`,
  });
}
