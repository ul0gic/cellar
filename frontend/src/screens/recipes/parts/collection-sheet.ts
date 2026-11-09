import { LIMITS, type Recipe } from '@cellar/contract';
import { html } from '@lightstart/light/html';
import { call } from '../../../app/api.ts';
import { eventChecked, eventText } from '../../../app/events.ts';
import { actionFailed } from '../../../app/problems.ts';
import { invalidate } from '../../../app/resources.ts';
import { text } from '../../../text/index.ts';
import { openSheet } from './sheet.ts';

export async function openCollectionSheet(recipe: Recipe): Promise<void> {
  let { collections } = await call('listCollections', {});
  const holding = new Set(recipe.collections.map((collection) => collection.id));
  let newName = '';
  let busy = false;

  const toggle = async (id: number, add: boolean): Promise<void> => {
    try {
      if (add) {
        await call('addRecipeToCollection', { params: { id }, body: { recipeId: recipe.id } });
        holding.add(id);
      } else {
        await call('removeRecipeFromCollection', { params: { id, recipeId: recipe.id } });
        holding.delete(id);
      }
      invalidate('collections', 'recipes');
    } catch (error) {
      actionFailed(error, () => void toggle(id, add));
    }
    sheet.redraw();
  };

  const create = async (): Promise<void> => {
    busy = true;
    sheet.redraw();
    try {
      const created = await call('createCollection', { body: { name: newName.trim(), description: '' } });
      await call('addRecipeToCollection', { params: { id: created.id }, body: { recipeId: recipe.id } });
      holding.add(created.id);
      ({ collections } = await call('listCollections', {}));
      newName = '';
      invalidate('collections', 'recipes');
    } catch (error) {
      actionFailed(error, () => void create());
    }
    busy = false;
    sheet.redraw();
  };

  const sheet = openSheet({
    heading: () => text('recipes.collectionHeading', { name: recipe.name }),
    body: () => html`
      <div class="cl-sheet-checks">
        ${collections.map(
          (collection) => html`<lc-checkbox
            label=${collection.name}
            ?checked=${holding.has(collection.id)}
            ?disabled=${!collection.canEdit}
            @change=${(event: Event) => void toggle(collection.id, eventChecked(event))}
          ></lc-checkbox>`,
        )}
      </div>
      <form
        class="cl-sheet-inline"
        @submit=${(event: SubmitEvent) => {
          event.preventDefault();
          if (newName.trim() !== '' && !busy) {
            void create();
          }
        }}
      >
        <lc-input
          label=${text('recipes.newCollection')}
          maxlength=${LIMITS.shortName.max}
          value=${newName}
          @input=${(event: Event) => {
            newName = eventText(event);
            sheet.redraw();
          }}
        ></lc-input>
        <lc-button type="submit" ?disabled=${busy || newName.trim() === ''}>${text('recipes.createCollection')}</lc-button>
      </form>
    `,
    footer: () => html`<lc-button variant="primary" @click=${() => sheet.close()}>${text('recipes.done')}</lc-button>`,
  });
}
