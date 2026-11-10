import { type Collection, LIMITS, type RecipeSummary } from '@cellar/contract';
import View from '@lightstart/light';
import { html, nothing, type TemplateResult } from '@lightstart/light/html';
import { effect, signal } from '@lightstart/light/signals';
import { call } from '../../app/api.ts';
import { eventText } from '../../app/events.ts';
import { loadState } from '../../app/load.ts';
import { actionFailed } from '../../app/problems.ts';
import { apiResource, dataChanged } from '../../app/resources.ts';
import { href, navigate, setScreenTitle } from '../../app/router.ts';
import { setAppBar } from '../../app/shell.ts';
import type { RouteParams } from '../../app/types.ts';
import '../../design-system/cl-recipe-row.ts';
import { confirm } from '../../design-system/dialogs.ts';
import { illustration } from '../../design-system/illustration.ts';
import '../../design-system/lc/button.ts';
import '../../design-system/lc/empty-state.ts';
import '../../design-system/lc/icon.ts';
import '../../design-system/lc/input.ts';
import { waiting } from '../../design-system/load-view.ts';
import { toast } from '../../design-system/toast.ts';
import { text } from '../../text/index.ts';
import { openActions } from '../recipes/parts/actions.ts';
import { segmentsOf } from '../recipes/parts/segments.ts';
import { openSheet, type Sheet } from '../recipes/parts/sheet.ts';
import './collections.css';

export const tag = 'cl-screen-collections-collection';

class CollectionScreen extends View {
  params: RouteParams = {};
  readonly source = apiResource('getCollection', ['collections', 'recipes', 'shelf']);
  readonly state = loadState([this.source]);
  readonly name = signal('');
  readonly saving = signal(false);

  get collectionId(): number {
    return Number(this.params.id);
  }

  get valid(): boolean {
    return Number.isSafeInteger(this.collectionId) && this.collectionId >= 1;
  }

  connected(): void {
    this.classList.add('cl-collection');
    setAppBar({ back: '/collections' });
    if (!this.valid) {
      return;
    }
    this.source.bind(this, { params: { id: this.collectionId } });
    const follow = effect(() => {
      const collection = this.source.value.value;
      if (collection !== undefined) {
        setScreenTitle(collection.name);
      }
    });
    this.$own(() => follow.dispose());
  }

  async reorder(recipeIds: readonly number[]): Promise<void> {
    try {
      await call('updateCollection', { params: { id: this.collectionId }, body: { recipeIds: [...recipeIds] } });
      dataChanged('collections');
    } catch (error) {
      actionFailed(error, () => void this.reorder(recipeIds));
    }
  }

  move(collection: Collection, index: number, by: number): void {
    const ids = collection.recipes.map((recipe) => recipe.id);
    const moving = ids[index];
    const other = ids[index + by];
    if (moving === undefined || other === undefined) {
      return;
    }
    ids[index] = other;
    ids[index + by] = moving;
    void this.reorder(ids);
  }

  async removeRecipe(recipe: RecipeSummary): Promise<void> {
    try {
      await call('removeRecipeFromCollection', { params: { id: this.collectionId, recipeId: recipe.id } });
      dataChanged('collections', 'recipes');
      toast({ title: text('collections.removed', { name: recipe.name }) });
    } catch (error) {
      actionFailed(error, () => void this.removeRecipe(recipe));
    }
  }

  async removeCollection(collection: Collection): Promise<void> {
    const sure = await confirm(this, {
      title: text('collections.deleteTitle', { name: collection.name }),
      message: text('collections.deleteBody'),
      confirmLabel: text('collections.delete'),
      danger: true,
    });
    if (!sure) {
      return;
    }
    try {
      await call('deleteCollection', { params: { id: this.collectionId } });
      this.source.release();
      dataChanged('collections', 'recipes');
      if (this.isConnected) {
        navigate('/collections', { replace: true });
      }
      toast({ title: text('toast.deleted') });
    } catch (error) {
      actionFailed(error, () => void this.removeCollection(collection));
    }
  }

  async save(sheet: Sheet): Promise<void> {
    this.saving.value = true;
    try {
      await call('updateCollection', { params: { id: this.collectionId }, body: { name: this.name.peek().trim() } });
      dataChanged('collections');
      sheet.close();
    } catch (error) {
      this.saving.value = false;
      actionFailed(error, () => void this.save(sheet));
    }
  }

  edit(collection: Collection): void {
    this.name.value = collection.name;
    this.saving.value = false;
    const sheet = openSheet(this, {
      heading: () => text('collections.editHeading'),
      body: () => html`
        <lc-input
          label=${text('collections.name')}
          maxlength=${LIMITS.shortName.max}
          value=${this.name.value}
          @input=${(event: Event) => {
            this.name.value = eventText(event);
          }}
        ></lc-input>
        <lc-button
          variant="ghost"
          @click=${() => {
            sheet.close();
            void this.removeCollection(collection);
          }}
        ><lc-icon name="trash-2" aria-hidden="true"></lc-icon>${text('collections.delete')}</lc-button>
      `,
      footer: () => html`
        <lc-button variant="quiet" @click=${() => sheet.close()}>${text('action.cancel')}</lc-button>
        <lc-button variant="primary" ?disabled=${this.saving.value || this.name.value.trim() === ''} @click=${() => void this.save(sheet)}
          >${text('collections.save')}</lc-button
        >
      `,
    });
  }

  row(collection: Collection, recipe: RecipeSummary, index: number): TemplateResult {
    return html`<li class="cl-collection-row">
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
                @click=${() => this.move(collection, index, -1)}
              ><lc-icon name="chevron-up" aria-hidden="true"></lc-icon></lc-button>
              <lc-button
                variant="ghost"
                size="sm"
                ?disabled=${index === collection.recipes.length - 1}
                aria-label=${text('collections.moveDown', { name: recipe.name })}
                @click=${() => this.move(collection, index, 1)}
              ><lc-icon name="chevron-down" aria-hidden="true"></lc-icon></lc-button>
              <lc-button
                variant="ghost"
                size="sm"
                aria-haspopup="menu"
                aria-label=${text('collections.rowActions', { name: recipe.name })}
                @click=${(event: MouseEvent) => {
                  if (event.currentTarget instanceof Element) {
                    openActions(this, event.currentTarget, recipe.name, [
                      {
                        label: text('collections.removeRecipe'),
                        icon: 'x',
                        danger: true,
                        onClick: () => void this.removeRecipe(recipe),
                      },
                    ]);
                  }
                }}
              ><lc-icon name="ellipsis" aria-hidden="true"></lc-icon></lc-button>
            </span>`
          : nothing
      }
    </li>`;
  }

  missing(): TemplateResult {
    return html`<lc-empty-state title=${text('collections.notFoundTitle')} description=${text('collections.notFoundBody')}>
      ${illustration('empty-lost')}
      <lc-button variant="primary" href=${href('/collections')}>${text('collections.back')}</lc-button>
    </lc-empty-state>`;
  }

  render() {
    if (!this.valid) {
      return this.missing();
    }
    const collection = this.source.value.value;
    if (collection === undefined) {
      if (this.state.error.value?.code === 'not_found') {
        return this.missing();
      }
      return waiting(this.state, text('title.collection'), 'rows');
    }
    const canMake = collection.recipes.filter((recipe) => recipe.canMake).length;
    return html`<header class="cl-collection-head">
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
          <lc-button variant="primary" href=${href(`/party?collection=${this.collectionId}`)}>
            <lc-icon name="scale" aria-hidden="true"></lc-icon>${text('nav.party')}
          </lc-button>
          ${
            collection.canEdit
              ? html`<lc-button variant="quiet" @click=${() => this.edit(collection)}>
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
              ${collection.recipes.map((recipe, index) => this.row(collection, recipe, index))}
            </ul>`
      }`;
  }
}

View.register(tag, CollectionScreen);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: CollectionScreen;
  }
}
