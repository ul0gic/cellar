import { type Collection, LIMITS, type RecipeSummary } from '@cellar/contract';
import { html, nothing, render, type TemplateResult } from '@lightstart/light/html';
import { call } from '../../app/api.ts';
import { invalidate, resourceFor } from '../../app/resources.ts';
import { href, setScreenTitle } from '../../app/router.ts';
import { setAppBar } from '../../app/shell.ts';
import type { ScreenContext } from '../../app/types.ts';
import { confirm } from '../../design-system/dialogs.ts';
import { illustration } from '../../design-system/illustration.ts';
import { skeleton } from '../../design-system/skeleton.ts';
import { toast } from '../../design-system/toast.ts';
import { text } from '../../text/index.ts';
import { openActions } from '../recipes/parts/actions.ts';
import { eventText } from '../recipes/parts/events.ts';
import { actionFailed } from '../recipes/parts/failures.ts';
import { segmentsOf } from '../recipes/parts/segments.ts';
import { openSheet } from '../recipes/parts/sheet.ts';
import { errorOf, onLeave, reload, slowFlag, watch } from '../recipes/parts/view.ts';
import './collections.css';

export function screen(ctx: ScreenContext): HTMLElement {
  const element = document.createElement('section');
  element.className = 'cl-collection';
  const id = Number(ctx.params.id);
  setAppBar({ back: '/collections' });
  const missing = (): void => {
    render(
      html`<lc-empty-state title=${text('collections.notFoundTitle')} description=${text('collections.notFoundBody')}>
        ${illustration('empty-lost')}
        <lc-button variant="primary" href=${href('/collections')}>${text('collections.back')}</lc-button>
      </lc-empty-state>`,
      element,
    );
  };
  if (!Number.isSafeInteger(id) || id < 1) {
    missing();
    return element;
  }
  const source = resourceFor('getCollection', { params: { id } }, { tags: ['collections', 'recipes', 'shelf'] });
  const slow = slowFlag(() => draw());

  const reorder = async (recipeIds: readonly number[]): Promise<void> => {
    try {
      await call('updateCollection', { params: { id }, body: { recipeIds: [...recipeIds] } });
      invalidate('collections');
    } catch (error) {
      actionFailed(error, () => void reorder(recipeIds));
    }
  };

  const move = (collection: Collection, index: number, by: number): void => {
    const ids = collection.recipes.map((recipe) => recipe.id);
    const moving = ids[index];
    const other = ids[index + by];
    if (moving === undefined || other === undefined) {
      return;
    }
    ids[index] = other;
    ids[index + by] = moving;
    void reorder(ids);
  };

  const removeRecipe = async (recipe: RecipeSummary): Promise<void> => {
    try {
      await call('removeRecipeFromCollection', { params: { id, recipeId: recipe.id } });
      invalidate('collections', 'recipes');
      toast({ title: text('collections.removed', { name: recipe.name }) });
    } catch (error) {
      actionFailed(error, () => void removeRecipe(recipe));
    }
  };

  const remove = async (collection: Collection): Promise<void> => {
    const sure = await confirm({
      title: text('collections.deleteTitle', { name: collection.name }),
      message: text('collections.deleteBody'),
      confirmLabel: text('collections.delete'),
      danger: true,
    });
    if (!sure) {
      return;
    }
    try {
      await call('deleteCollection', { params: { id } });
      invalidate('collections', 'recipes');
      ctx.navigate('/collections', { replace: true });
      toast({ title: text('toast.deleted') });
    } catch (error) {
      actionFailed(error, () => void remove(collection));
    }
  };

  const edit = (collection: Collection): void => {
    let name = collection.name;
    let saving = false;
    const save = async (): Promise<void> => {
      saving = true;
      sheet.redraw();
      try {
        await call('updateCollection', { params: { id }, body: { name: name.trim() } });
        invalidate('collections');
        sheet.close();
      } catch (error) {
        saving = false;
        sheet.redraw();
        actionFailed(error, () => void save());
      }
    };
    const sheet = openSheet({
      heading: () => text('collections.editHeading'),
      body: () => html`
        <lc-input
          label=${text('collections.name')}
          maxlength=${LIMITS.shortName.max}
          value=${name}
          @input=${(event: Event) => {
            name = eventText(event);
            sheet.redraw();
          }}
        ></lc-input>
        <lc-button
          variant="ghost"
          @click=${() => {
            sheet.close();
            void remove(collection);
          }}
        ><lc-icon name="trash-2" aria-hidden="true"></lc-icon>${text('collections.delete')}</lc-button>
      `,
      footer: () => html`
        <lc-button variant="quiet" @click=${() => sheet.close()}>${text('action.cancel')}</lc-button>
        <lc-button variant="primary" ?disabled=${saving || name.trim() === ''} @click=${() => void save()}
          >${text('collections.save')}</lc-button
        >
      `,
    });
  };

  const row = (collection: Collection, recipe: RecipeSummary, index: number): TemplateResult => html`<li
    class="cl-collection-row"
  >
    <cl-recipe-row
      href=${`/recipes/${recipe.id}`}
      name=${recipe.name}
      .image=${recipe.image}
      .glass=${recipe.glass?.name ?? null}
      .segments=${segmentsOf(recipe)}
      .rating=${recipe.household.rating.average}
    ></cl-recipe-row>
    ${
      collection.canEdit
        ? html`<span class="cl-collection-row-actions">
            <lc-button
              variant="ghost"
              size="sm"
              ?disabled=${index === 0}
              aria-label=${text('collections.moveUp', { name: recipe.name })}
              @click=${() => move(collection, index, -1)}
            ><lc-icon name="chevron-up" aria-hidden="true"></lc-icon></lc-button>
            <lc-button
              variant="ghost"
              size="sm"
              ?disabled=${index === collection.recipes.length - 1}
              aria-label=${text('collections.moveDown', { name: recipe.name })}
              @click=${() => move(collection, index, 1)}
            ><lc-icon name="chevron-down" aria-hidden="true"></lc-icon></lc-button>
            <lc-button
              variant="ghost"
              size="sm"
              aria-haspopup="menu"
              aria-label=${text('collections.rowActions', { name: recipe.name })}
              @click=${(event: MouseEvent) => {
                if (event.currentTarget instanceof Element) {
                  openActions(event.currentTarget, recipe.name, [
                    {
                      label: text('collections.removeRecipe'),
                      icon: 'x',
                      danger: true,
                      onClick: () => void removeRecipe(recipe),
                    },
                  ]);
                }
              }}
            ><lc-icon name="ellipsis" aria-hidden="true"></lc-icon></lc-button>
          </span>`
        : nothing
    }
  </li>`;

  const draw = (): void => {
    const collection = source.peek();
    const problem = errorOf(source);
    if (collection === undefined) {
      if (problem?.code === 'not_found') {
        missing();
      } else if (problem !== null) {
        render(
          html`<lc-empty-state title=${text('loadFailed.title', { screen: text('title.collection') })} description=${text('loadFailed.body')}>
            ${illustration('empty-lost')}
            <lc-button variant="primary" @click=${() => reload(source)}>${text('loadFailed.retry')}</lc-button>
          </lc-empty-state>`,
          element,
        );
      } else if (slow.slow() && element.querySelector('.cl-skeleton') === null) {
        element.replaceChildren(skeleton('rows', text('title.collection')));
      }
      return;
    }
    slow.cancel();
    element.querySelector('.cl-skeleton')?.remove();
    setScreenTitle(collection.name);
    const canMake = collection.recipes.filter((recipe) => recipe.canMake).length;
    render(
      html`<header class="cl-collection-head">
          <div>
            <h1 class="cl-collections-title">${collection.name}</h1>
            <p class="cl-collections-muted">
              ${text(collection.recipeCount === 1 ? 'collections.countOne' : 'collections.count', { count: collection.recipeCount })}
              ${collection.createdBy === null ? '' : text('collections.madeBy', { name: collection.createdBy.name })}
              ${text('collections.canMake', { count: canMake })}
            </p>
            ${collection.description === '' ? nothing : html`<p class="cl-collections-muted">${collection.description}</p>`}
          </div>
          <div class="cl-collection-actions">
            <lc-button variant="primary" href=${href(`/party?collection=${id}`)}>
              <lc-icon name="scale" aria-hidden="true"></lc-icon>${text('nav.party')}
            </lc-button>
            ${
              collection.canEdit
                ? html`<lc-button variant="quiet" @click=${() => edit(collection)}>
                    <lc-icon name="pencil" aria-hidden="true"></lc-icon>${text('collections.edit')}
                  </lc-button>`
                : nothing
            }
          </div>
        </header>
        ${
          collection.recipes.length === 0
            ? html`<p class="cl-collections-muted">${text('collections.emptyCollection')}</p>`
            : html`<ul class="cl-collection-rows">
                ${collection.recipes.map((recipe, index) => row(collection, recipe, index))}
              </ul>`
        }`,
      element,
    );
  };

  const stop = watch(source, draw);
  onLeave(element, () => {
    slow.cancel();
    stop();
  });
  return element;
}
