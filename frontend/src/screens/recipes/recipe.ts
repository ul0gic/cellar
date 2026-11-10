import { formatAbv, formatVolume, type PreferredUnit, type Recipe, type RecipeLine } from '@cellar/contract';
import type { DropdownItem } from '@lightstart/components/types.js';
import View from '@lightstart/light';
import { html, nothing, type TemplateResult } from '@lightstart/light/html';
import { effect, signal } from '@lightstart/light/signals';
import { call } from '../../app/api.ts';
import { route } from '../../app/controllers/route.ts';
import { session } from '../../app/controllers/session.ts';
import { eventChecked, eventNumber, eventText } from '../../app/events.ts';
import { loadState } from '../../app/load.ts';
import { actionFailed } from '../../app/problems.ts';
import { apiResource, dataChanged } from '../../app/resources.ts';
import { href, navigate, setQuery, setScreenTitle } from '../../app/router.ts';
import type { RouteParams, SessionPerson } from '../../app/types.ts';
import type { BulbStatus } from '../../design-system/cl-bulb.ts';
import { plateForGlass } from '../../design-system/cl-plate.ts';
import { confirm } from '../../design-system/dialogs.ts';
import { loadFailed } from '../../design-system/load-view.ts';
import { skeleton } from '../../design-system/skeleton.ts';
import { thumbHashDataUrl } from '../../design-system/thumbhash.ts';
import { toast } from '../../design-system/toast.ts';
import { formatDate } from '../../text/format.ts';
import { text } from '../../text/index.ts';
import { openActions } from './parts/actions.ts';
import { openHistorySheet, openPhotoSheet } from './parts/ai-sheets.ts';
import { openCollectionSheet } from './parts/collection-sheet.ts';
import { openMenuSheet } from './parts/menu-sheet.ts';
import { openNoteSheet } from './parts/note-sheet.ts';
import { ratingControl } from './parts/rating.ts';
import { SERVINGS_MAX, servingsOf } from './parts/servings.ts';
import { undoAdded } from './parts/shopping-undo.ts';
import { methodSteps } from './parts/steps.ts';
import { notFound, triggerOf } from './parts/view.ts';
import '../../design-system/cl-bulb.ts';
import '../../design-system/cl-ingredient-line.ts';
import '../../design-system/lc/avatar.ts';
import '../../design-system/lc/button.ts';
import '../../design-system/lc/icon.ts';
import '../../design-system/lc/image.ts';
import '../../design-system/lc/number-input.ts';
import '../../design-system/lc/segmented.ts';
import '../../design-system/lc/switch.ts';
import '../../design-system/lc/tag.ts';
import './recipe.css';

export const tag = 'cl-screen-recipes-recipe';

// D-1 §9.5: eight notes show before "Show all".
const NOTES_SHOWN = 8;
const NOTES_ALL = 100;

function unitOf(raw: string | null, person: SessionPerson | null): PreferredUnit {
  if (raw === 'oz' || raw === 'ml') {
    return raw;
  }
  return person?.person.unit ?? 'oz';
}

function lineBulb(line: RecipeLine): BulbStatus {
  if (line.optional) {
    return 'optional';
  }
  if (line.status === 'on_hand') {
    return 'on';
  }
  return line.status === 'missing' ? 'off' : 'via';
}

function statusSummary(recipe: Recipe): string {
  const counted = recipe.lines.filter((line) => !line.optional);
  const onHand = counted.filter((line) => line.status === 'on_hand').length;
  const swaps = counted.filter((line) => line.status !== 'on_hand' && line.status !== 'missing').length;
  const parts = [text('recipes.summaryOnHand', { count: onHand })];
  if (swaps > 0) {
    parts.push(text(swaps === 1 ? 'recipes.summarySwap' : 'recipes.summarySwaps', { count: swaps }));
  }
  if (recipe.missingCount > 0) {
    parts.push(text('recipes.summaryMissing', { count: recipe.missingCount }));
  }
  const optional = recipe.lines.length > counted.length ? ` ${text('recipes.summaryOptional')}` : '';
  return `${parts.join(', ')}.${optional}`;
}

function facts(recipe: Recipe, unit: PreferredUnit): string[] {
  const list: string[] = [];
  if (recipe.abv !== null && recipe.volumeMl !== null) {
    list.push(text('recipes.factAbv', { abv: formatAbv(recipe.abv) }));
    list.push(text('recipes.factVolume', { volume: formatVolume(recipe.volumeMl, unit) }));
  }
  if (recipe.method !== null && recipe.glass !== null) {
    list.push(text('recipes.factMethodGlass', { method: recipe.method.name, glass: recipe.glass.name.toLowerCase() }));
  } else if (recipe.method !== null) {
    list.push(recipe.method.name);
  } else if (recipe.glass !== null) {
    list.push(text('recipes.factGlass', { glass: recipe.glass.name.toLowerCase() }));
  }
  return list;
}

function madeLine(recipe: Recipe): TemplateResult {
  if (recipe.household.madeCount === 0) {
    return html`<div class="cl-recipe-made"><p class="cl-recipe-made-sub">${text('recipes.notMadeYet')}</p></div>`;
  }
  const last =
    recipe.household.lastMadeAt === null
      ? ''
      : ` ${text('recipes.lastMade', { date: formatDate(recipe.household.lastMadeAt, 'this-year') })}`;
  return html`<div class="cl-recipe-made">
    <p class="cl-recipe-made-count">
      ${text(recipe.mine.madeCount === 1 ? 'recipes.timesOne' : 'recipes.times', { count: recipe.mine.madeCount })}
    </p>
    <p class="cl-recipe-made-sub">${text('recipes.madeBy', { house: recipe.household.madeCount })}${last}</p>
  </div>`;
}

function photo(recipe: Recipe): TemplateResult {
  const image = recipe.images[0];
  return image === undefined
    ? html`<cl-plate class="cl-recipe-photo" kind=${plateForGlass(recipe.glass?.name ?? null)} name=${recipe.name}></cl-plate>`
    : html`<lc-image
        class="cl-recipe-photo"
        src=${image.url}
        alt=${text('photo.of', { name: recipe.name })}
        placeholder=${image.thumbhash === null ? nothing : thumbHashDataUrl(image.thumbhash)}
      ></lc-image>`;
}

function isUrl(source: string): boolean {
  return /^https?:\/\//i.test(source);
}

function details(recipe: Recipe): TemplateResult {
  const rows: [string, TemplateResult | string][] = [];
  if (recipe.glass !== null) {
    rows.push([text('recipes.detailGlass'), recipe.glass.name]);
  }
  if (recipe.method !== null) {
    rows.push([text('recipes.detailMethod'), recipe.method.name]);
  }
  if (recipe.garnish !== '') {
    rows.push([text('recipes.detailGarnish'), recipe.garnish]);
  }
  if (recipe.utensils.length > 0) {
    rows.push([text('recipes.detailUtensils'), recipe.utensils.map((utensil) => utensil.name).join(', ')]);
  }
  if (recipe.tags.length > 0) {
    rows.push([
      text('recipes.detailTags'),
      html`<span class="cl-recipe-tags">${recipe.tags.map((chip) => html`<lc-tag size="sm">${chip.name}</lc-tag>`)}</span>`,
    ]);
  }
  if (recipe.year !== null) {
    rows.push([text('recipes.detailYear'), String(recipe.year)]);
  }
  if (recipe.source !== '') {
    rows.push([
      text('recipes.detailSource'),
      isUrl(recipe.source)
        ? html`<a href=${recipe.source} rel="noopener noreferrer" target="_blank"
            >${text('recipes.sourceLink')} <lc-icon name="external-link" aria-hidden="true"></lc-icon
          ></a>`
        : recipe.source,
    ]);
  }
  if (rows.length === 0) {
    return html``;
  }
  return html`<section class="cl-recipe-section" aria-labelledby="cl-recipe-details">
    <h2 id="cl-recipe-details" class="cl-recipe-heading">${text('recipes.details')}</h2>
    <dl class="cl-recipe-details">
      ${rows.map(([term, value]) => html`<div><dt>${term}</dt><dd>${value}</dd></div>`)}
    </dl>
  </section>`;
}

function variations(recipe: Recipe): TemplateResult {
  const related = [...(recipe.parent === null ? [] : [recipe.parent]), ...recipe.variants];
  if (related.length === 0) {
    return html``;
  }
  return html`<section class="cl-recipe-section" aria-labelledby="cl-recipe-variations">
    <h2 id="cl-recipe-variations" class="cl-recipe-heading">${text('recipes.variations')}</h2>
    <ul class="cl-recipe-variations">
      ${related.map(
        (variant) => html`<li>
          <a class="cl-recipe-variant" href=${href(`/recipes/${variant.id}`)}>
            ${
              variant.image === null
                ? html`<cl-plate kind="glass" small name=${variant.name}></cl-plate>`
                : html`<lc-image src=${variant.image.url} alt=""></lc-image>`
            }
            <span>${variant.name}</span>
          </a>
        </li>`,
      )}
    </ul>
  </section>`;
}

function method(recipe: Recipe): TemplateResult {
  const steps = methodSteps(recipe.instructions);
  if (steps.length === 0) {
    return html``;
  }
  return html`<section class="cl-recipe-section" aria-labelledby="cl-recipe-method">
    <h2 id="cl-recipe-method" class="cl-recipe-heading">${text('recipes.method')}</h2>
    <ol class="cl-recipe-steps">${steps.map((step) => html`<li>${step}</li>`)}</ol>
  </section>`;
}

const WAKE_SUPPORTED = 'wakeLock' in navigator && window.isSecureContext;

function printPath(id: number, servings: number, unit: PreferredUnit): string {
  return `/recipes/${id}/print?servings=${servings}&unit=${unit}`;
}

function statusWell(current: Recipe): TemplateResult {
  return html`<div class="cl-recipe-status">
    <p class="cl-recipe-status-word">
      ${current.canMake ? text('recipes.ready') : text('recipes.missingN', { count: current.missingCount })}
    </p>
    <span class="cl-recipe-bulbs" aria-hidden="true">
      ${current.lines.map((line) => html`<cl-bulb size="mini" status=${lineBulb(line)}></cl-bulb>`)}
    </span>
    <p class="cl-recipe-status-text">${statusSummary(current)}</p>
  </div>`;
}

function servingsRow(servings: number, unit: PreferredUnit): TemplateResult {
  return html`<div class="cl-recipe-servings">
      <lc-number-input
        stepper
        label=${text('recipes.servings')}
        min="1"
        max=${SERVINGS_MAX}
        .value=${servings}
        @change=${(event: Event) => {
          const next = eventNumber(event);
          if (next !== null) {
            const clamped = servingsOf(String(next));
            setQuery({ servings: clamped === 1 ? null : String(clamped) }, 'replace');
          }
        }}
      ></lc-number-input>
      <lc-segmented
        label=${text('recipes.units')}
        value=${unit}
        .options=${[{ value: 'oz', label: 'oz' }, { value: 'ml', label: 'ml' }]}
        @change=${(event: Event) => setQuery({ unit: eventText(event) || null }, 'replace')}
      ></lc-segmented>
    </div>
    ${servings === 1 ? nothing : html`<p class="cl-recipe-scaled" role="status">${text('recipes.scaled', { count: servings })}</p>`}`;
}

function madeButton(onMade: () => void): TemplateResult {
  return html`<lc-button variant="quiet" @click=${onMade}>
    <lc-icon name="check" aria-hidden="true"></lc-icon>${text('recipes.madeItButton')}
  </lc-button>`;
}

class RecipesRecipe extends View {
  params: RouteParams = {};
  readonly wakeWanted = signal(true);
  readonly wakeRefused = signal(false);
  readonly visible = signal(document.visibilityState === 'visible');
  readonly notesAll = signal(false);
  readonly others = signal<number | null>(null);
  readonly recipe = apiResource('getRecipe', ['recipes', 'shelf', 'notes', 'collections']);
  readonly shopping = apiResource('getShoppingList', ['shopping']);
  readonly notes = apiResource('listRecipeNotes', ['notes']);
  readonly load = loadState([this.recipe]);
  wakeLock: WakeLockSentinel | null = null;

  get recipeId(): number {
    return Number(this.params.id);
  }

  get valid(): boolean {
    return Number.isSafeInteger(this.recipeId) && this.recipeId >= 1;
  }

  connected(): void {
    this.classList.add('cl-recipe-screen');
    this.setAttribute('role', 'article');
    if (!this.valid) {
      return;
    }
    this.recipe.bind(this, { params: { id: this.recipeId } });
    this.shopping.bind(this, {});
    this.notes.bind(this, () => ({
      params: { id: this.recipeId },
      query: { pageSize: this.notesAll.value ? NOTES_ALL : NOTES_SHOWN },
    }));
    const title = effect(() => {
      const current = this.recipe.value.value;
      if (current !== undefined) {
        setScreenTitle(current.name);
      }
    });
    this.$own(() => title.dispose());
    const missing = effect(() => {
      if (this.load.error.value?.code === 'not_found' && this.others.peek() === null) {
        void this.countOthers();
      }
    });
    this.$own(() => missing.dispose());
    const onVisible = (): void => {
      this.visible.value = document.visibilityState === 'visible';
    };
    document.addEventListener('visibilitychange', onVisible);
    this.$own(() => document.removeEventListener('visibilitychange', onVisible));
    const wake = effect(() => {
      if (this.wakeWanted.value && this.visible.value) {
        void this.acquireWake();
      } else {
        void this.releaseWake();
      }
    });
    this.$own(() => wake.dispose());
    this.$own(() => void this.releaseWake());
  }

  async acquireWake(): Promise<void> {
    if (!WAKE_SUPPORTED || this.wakeLock !== null) {
      return;
    }
    try {
      const lock = await navigator.wakeLock.request('screen');
      if (!this.isConnected || !this.wakeWanted.peek() || this.wakeLock !== null) {
        await lock.release();
        return;
      }
      this.wakeLock = lock;
      lock.addEventListener('release', () => {
        if (this.wakeLock === lock) {
          this.wakeLock = null;
        }
      });
    } catch (error) {
      if (!(error instanceof DOMException)) {
        throw error;
      }
      if (this.isConnected) {
        this.wakeWanted.value = false;
        this.wakeRefused.value = true;
      }
    }
  }

  async releaseWake(): Promise<void> {
    const held = this.wakeLock;
    this.wakeLock = null;
    await held?.release();
  }

  async countOthers(): Promise<void> {
    try {
      const page = await call('listRecipes', { query: { pageSize: 1 } });
      if (this.isConnected) {
        this.others.value = page.facets.all;
      }
    } catch (error) {
      actionFailed(error, () => void this.countOthers());
    }
  }

  async toggleFavorite(current: Recipe): Promise<void> {
    try {
      await (current.mine.favorite
        ? call('unfavoriteRecipe', { params: { id: this.recipeId } })
        : call('favoriteRecipe', { params: { id: this.recipeId } }));
      dataChanged('recipes');
    } catch (error) {
      actionFailed(error, () => void this.toggleFavorite(current));
    }
  }

  async undoMadeIt(entryId: number): Promise<void> {
    try {
      await call('undoMadeIt', { params: { entryId } });
      dataChanged('recipes', 'stats');
      toast({ title: text('toast.undone') });
    } catch (error) {
      actionFailed(error, () => void this.undoMadeIt(entryId));
    }
  }

  async madeIt(): Promise<void> {
    try {
      const state = await call('recordMadeIt', { params: { id: this.recipeId } });
      dataChanged('recipes', 'stats');
      const entryId = state.entryId;
      toast({
        title: text(state.mine.count === 1 ? 'recipes.madeItOnce' : 'recipes.madeIt', { count: state.mine.count }),
        ...(entryId === null
          ? {}
          : { action: { label: text('toast.undo'), run: () => void this.undoMadeIt(entryId) } }),
      });
    } catch (error) {
      actionFailed(error, () => void this.madeIt());
    }
  }

  async addMissing(): Promise<void> {
    try {
      const before = await call('getShoppingList', {});
      const listed = new Set(before.items.map((item) => item.ingredient.id));
      const change = await call('addMissingToShoppingList', { params: { id: this.recipeId } });
      dataChanged('shopping');
      if (change.added === 0) {
        toast({ title: text('recipes.alreadyListed') });
        return;
      }
      const added = change.list.items.filter((item) => !listed.has(item.ingredient.id));
      const names = added.map((item) => item.ingredient.name).join(', ');
      toast({
        title: text('recipes.addedToList', { names }),
        action: { label: text('toast.undo'), run: () => void undoAdded(added.map((item) => item.id)) },
      });
    } catch (error) {
      actionFailed(error, () => void this.addMissing());
    }
  }

  async deleteRecipe(current: Recipe): Promise<void> {
    const sure = await confirm(this, {
      title: text('recipes.deleteTitle', { name: current.name }),
      message: text('recipes.deleteBody'),
      confirmLabel: text('recipes.deleteRecipe'),
      danger: true,
    });
    if (!sure) {
      return;
    }
    try {
      await call('deleteRecipe', { params: { id: this.recipeId } });
      this.recipe.release();
      this.notes.release();
      dataChanged('recipes', 'collections', 'menus', 'stats');
      if (this.isConnected) {
        navigate('/recipes', { replace: true });
      }
      toast({ title: text('toast.deleted') });
    } catch (error) {
      actionFailed(error, () => void this.deleteRecipe(current));
    }
  }

  moreItems(current: Recipe, person: SessionPerson, servings: number, unit: PreferredUnit): DropdownItem[] {
    const ai = person.household.aiEnabled;
    return [
      { label: text('recipes.editRecipe'), icon: 'pencil', onClick: () => navigate(`/recipes/${this.recipeId}/edit`) },
      {
        label: text('recipes.addToCollection'),
        icon: 'folder-heart',
        onClick: () => void openCollectionSheet(this, current),
      },
      { label: text('recipes.addToMenu'), icon: 'tv', onClick: () => void openMenuSheet(this, current) },
      {
        label: text('recipes.print'),
        icon: 'printer',
        onClick: () => navigate(printPath(this.recipeId, servings, unit)),
      },
      ...(ai
        ? [
            { divider: true },
            { label: text('recipes.lookUpHistory'), icon: 'sparkles', onClick: () => openHistorySheet(this, current) },
            { label: text('recipes.generatePhoto'), icon: 'sparkles', onClick: () => openPhotoSheet(this, current) },
          ]
        : []),
      { divider: true },
      {
        label: text('recipes.deleteRecipe'),
        icon: 'trash-2',
        danger: true,
        onClick: () => void this.deleteRecipe(current),
      },
    ];
  }

  async setOnHand(line: RecipeLine, marked: boolean): Promise<void> {
    try {
      await call('setOnHand', { params: { id: line.ingredient.id }, body: { marked } });
      dataChanged('shelf', 'recipes');
    } catch (error) {
      actionFailed(error, () => void this.setOnHand(line, marked));
    }
  }

  async listIngredient(line: RecipeLine): Promise<void> {
    try {
      await call('addIngredientToShoppingList', { params: { id: line.ingredient.id } });
      dataChanged('shopping');
      toast({ title: text('recipes.addedToList', { names: line.ingredient.name }) });
    } catch (error) {
      actionFailed(error, () => void this.listIngredient(line));
    }
  }

  lineMenu(trigger: Element, line: RecipeLine): void {
    const name = line.ingredient.name;
    const listed = this.shopping.value.peek()?.items.some((item) => item.ingredient.id === line.ingredient.id) ?? false;
    openActions(this, trigger, name, [
      line.ingredient.onHand
        ? {
            label: text('recipes.markOff', { name }),
            icon: 'circle-x',
            onClick: () => void this.setOnHand(line, false),
          }
        : {
            label: text('recipes.markOn', { name }),
            icon: 'circle-check',
            onClick: () => void this.setOnHand(line, true),
          },
      listed
        ? { label: text('recipes.onTheList'), icon: 'list-checks', disabled: true }
        : { label: text('recipes.addToList'), icon: 'plus', onClick: () => void this.listIngredient(line) },
      {
        label: text('recipes.openIngredient', { name }),
        icon: 'citrus',
        onClick: () => navigate(`/ingredients/${line.ingredient.id}`),
      },
    ]);
  }

  notesSection(current: Recipe, person: SessionPerson): TemplateResult {
    const page = this.notes.value.value;
    return html`<section class="cl-recipe-section" aria-labelledby="cl-recipe-notes">
      <div class="cl-recipe-section-head">
        <h2 id="cl-recipe-notes" class="cl-recipe-heading">${text('recipes.notes')}</h2>
        <lc-button variant="ghost" @click=${() => void openNoteSheet(this, current, person)}>
          <lc-icon name="pencil" aria-hidden="true"></lc-icon>${text('recipes.writeNote')}
        </lc-button>
      </div>
      ${
        page === undefined
          ? nothing
          : page.items.length === 0
            ? html`<p class="cl-recipe-muted">${text('recipes.noNotes')}</p>`
            : html`<ul class="cl-recipe-notes">
                ${page.items.map(
                  (note) => html`<li class="cl-note">
                    <div class="cl-note-head">
                      <lc-avatar shape="rounded" size="sm" name=${note.author.name} src=${note.author.avatar?.url ?? nothing}></lc-avatar>
                      <span class="cl-note-who">${note.mine ? text('recipes.you') : note.author.name}</span>
                      <span class="cl-recipe-muted">${formatDate(note.tastedOn, 'this-year')}</span>
                      ${
                        note.visibility === 'private'
                          ? html`<lc-tag size="sm"><lc-icon name="lock" aria-hidden="true"></lc-icon>${text('recipes.onlyYou')}</lc-tag>`
                          : html`<lc-tag size="sm">${text('recipes.household')}</lc-tag>`
                      }
                    </div>
                    ${note.text === '' ? nothing : html`<p class="cl-note-text">${note.text}</p>`}
                    ${
                      note.descriptors.length === 0
                        ? nothing
                        : html`<p class="cl-note-tags">${note.descriptors.map((word) => html`<lc-tag size="sm">${word.name}</lc-tag>`)}</p>`
                    }
                  </li>`,
                )}
              </ul>
              ${
                page.total > page.items.length
                  ? html`<lc-button
                      variant="ghost"
                      @click=${() => {
                        this.notesAll.value = true;
                      }}
                    >${text('recipes.showAllNotes', { count: page.total })}</lc-button>`
                  : nothing
              }`
      }
    </section>`;
  }

  linesBlock(current: Recipe, servings: number, unit: PreferredUnit): TemplateResult {
    return html`<div
    class="cl-recipe-lines"
    role="list"
    aria-label=${text('recipes.ingredients')}
  >
    ${current.lines.map(
      (line) => html`<cl-ingredient-line
        role="listitem"
        .amount=${{ amount: line.amount, amountMax: line.amountMax, unit: line.unit }}
        .unit=${unit}
        .servings=${servings}
        name=${line.ingredient.name}
        href=${`/ingredients/${line.ingredient.id}`}
        .status=${line.status}
        via=${line.satisfiedBy?.name ?? ''}
        .effect=${line.substitutionEffect}
        ?optional=${line.optional}
        note=${line.note}
        @more=${(event: Event) => this.lineMenu(triggerOf(event, this), line)}
      ></cl-ingredient-line>`,
    )}
  </div>`;
  }

  wakeRow(): TemplateResult | typeof nothing {
    const refused = this.wakeRefused.value;
    return WAKE_SUPPORTED || refused
      ? html`<div class="cl-recipe-wake">
          <lc-switch
            label=${text('recipes.keepAwake')}
            hint=${refused ? text('recipes.keepAwakeRefused') : text('recipes.keepAwakeHint')}
            ?checked=${this.wakeWanted.value}
            @change=${(event: Event) => {
              this.wakeWanted.value = eventChecked(event);
              this.wakeRefused.value = false;
            }}
          ></lc-switch>
        </div>`
      : nothing;
  }

  primaryButton(current: Recipe): TemplateResult {
    return current.missingCount > 0
      ? html`<lc-button variant="primary" @click=${() => void this.addMissing()}
          >${text(current.missingCount === 1 ? 'recipes.addMissingOne' : 'recipes.addMissing', { count: current.missingCount })}</lc-button
        >`
      : html`<lc-button variant="primary" @click=${() => void openMenuSheet(this, current)}>${text('recipes.addToMenu')}</lc-button>`;
  }

  actionsRow(current: Recipe, servings: number, unit: PreferredUnit): TemplateResult {
    return html`<div
    class="cl-recipe-actions"
  >
    ${madeButton(() => void this.madeIt())} ${this.primaryButton(current)}
    ${
      current.missingCount > 0
        ? html`<lc-button variant="quiet" @click=${() => void openMenuSheet(this, current)}>${text('recipes.addToMenu')}</lc-button>`
        : nothing
    }
    <lc-button variant="quiet" @click=${() => void openCollectionSheet(this, current)}>${text('recipes.addToCollection')}</lc-button>
    <lc-button variant="quiet" href=${href(printPath(this.recipeId, servings, unit))}>
      <lc-icon name="printer" aria-hidden="true"></lc-icon>${text('recipes.print')}
    </lc-button>
    <lc-button variant="quiet" href=${href(`/recipes/${this.recipeId}/edit`)}>
      <lc-icon name="pencil" aria-hidden="true"></lc-icon>${text('recipes.edit')}
    </lc-button>
  </div>`;
  }

  favoriteButton(current: Recipe): TemplateResult {
    return html`<button
    type="button"
    class="cl-recipe-onphoto"
    aria-pressed=${current.mine.favorite ? 'true' : 'false'}
    aria-label=${text('card.favorite', { name: current.name })}
    @click=${() => void this.toggleFavorite(current)}
  ><lc-icon name="heart" ?solid=${current.mine.favorite} aria-hidden="true"></lc-icon></button>`;
  }

  moreButton(current: Recipe, person: SessionPerson, servings: number, unit: PreferredUnit): TemplateResult {
    return html`<button
    type="button"
    class="cl-recipe-onphoto"
    aria-haspopup="menu"
    aria-label=${text('recipes.moreActions', { name: current.name })}
    @click=${(event: MouseEvent) =>
      openActions(this, triggerOf(event, this), current.name, this.moreItems(current, person, servings, unit))}
  ><lc-icon name="ellipsis" aria-hidden="true"></lc-icon></button>`;
  }

  media(current: Recipe, person: SessionPerson, servings: number, unit: PreferredUnit): TemplateResult {
    return html`<div
    class="cl-recipe-media"
  >
    ${photo(current)}
    <div class="cl-recipe-photo-bar">
      <a class="cl-recipe-onphoto" href=${href('/recipes')} aria-label=${text('action.back')}
        ><lc-icon name="chevron-left" aria-hidden="true"></lc-icon
      ></a>
      <span class="cl-recipe-photo-bar-end">
        ${this.favoriteButton(current)}
        ${this.moreButton(current, person, servings, unit)}
      </span>
    </div>
  </div>`;
  }

  render() {
    if (!this.valid) {
      return notFound();
    }
    const current = this.recipe.value.value;
    const person = session.current.value;
    if (current === undefined) {
      switch (this.load.phase.value) {
        case 'failed':
          return this.load.error.value?.code === 'not_found'
            ? notFound(this.others.value)
            : loadFailed(text('title.recipe'), () => this.load.retry(), 'none');
        case 'slow':
          return html`${skeleton('figure', text('title.recipe'))}${skeleton('lines', text('title.recipe'))}`;
        default:
          return nothing;
      }
    }
    if (person === null) {
      return nothing;
    }
    const query = route.query.value;
    const servings = servingsOf(query.get('servings'));
    const unit = unitOf(query.get('unit'), person);
    return html`
        ${this.media(current, person, servings, unit)}
        <div class="cl-recipe-sheet">
          <header class="cl-recipe-head">
            <h1 class="cl-recipe-name">${current.name}</h1>
            <span class="cl-recipe-head-favorite">${this.favoriteButton(current)} ${this.moreButton(current, person, servings, unit)}</span>
          </header>
          ${current.description === '' ? nothing : html`<p class="cl-recipe-description">${current.description}</p>`}
          <p class="cl-recipe-facts">${facts(current, unit).map((fact) => html`<span>${fact}</span>`)}</p>
          <div class="cl-recipe-rating-row">
            ${ratingControl({
              value: current.mine.rating?.value ?? 0,
              household: current.household.rating,
              recipeId: this.recipeId,
              onRated: () => undefined,
            })}
            ${madeLine(current)}
          </div>
          ${statusWell(current)} ${servingsRow(servings, unit)} ${this.linesBlock(current, servings, unit)} ${this.wakeRow()}
          ${this.actionsRow(current, servings, unit)}
          ${method(current)} ${details(current)} ${variations(current)} ${this.notesSection(current, person)}
        </div>
        <div class="cl-recipe-actionbar">${madeButton(() => void this.madeIt())} ${this.primaryButton(current)}</div>
      `;
  }
}

View.register(tag, RecipesRecipe);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: RecipesRecipe;
  }
}
