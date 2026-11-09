import { formatAbv, formatVolume, type PreferredUnit, type Recipe, type RecipeLine } from '@cellar/contract';
import type { DropdownItem } from '@lightstart/light/components/types.js';
import { html, nothing, render, type TemplateResult } from '@lightstart/light/html';
import { call } from '../../app/api.ts';
import { eventChecked, eventNumber, eventText } from '../../app/events.ts';
import { type LoadState, onLeave, watch } from '../../app/load.ts';
import { actionFailed } from '../../app/problems.ts';
import { invalidate, resourceFor } from '../../app/resources.ts';
import { href, setScreenTitle } from '../../app/router.ts';
import type { ScreenContext, SessionPerson } from '../../app/types.ts';
import type { BulbStatus } from '../../design-system/cl-bulb.ts';
import { plateForGlass } from '../../design-system/cl-plate.ts';
import { confirm } from '../../design-system/dialogs.ts';
import { illustration } from '../../design-system/illustration.ts';
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
import { triggerOf } from './parts/view.ts';
import './recipe.css';

// D-1 §9.5: eight notes show before "Show all".
const NOTES_SHOWN = 8;
const NOTES_ALL = 100;

function unitOf(raw: string | null, session: SessionPerson | null): PreferredUnit {
  if (raw === 'oz' || raw === 'ml') {
    return raw;
  }
  return session?.person.unit ?? 'oz';
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
      html`<span class="cl-recipe-tags">${recipe.tags.map((tag) => html`<lc-tag size="sm">${tag.name}</lc-tag>`)}</span>`,
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

export function screen(ctx: ScreenContext): HTMLElement {
  const element = document.createElement('article');
  element.className = 'cl-recipe-screen';
  const id = Number(ctx.params.id);
  const notFound = (bookSize: number | null = null): void => {
    render(
      html`<lc-empty-state
        title=${text('recipes.notFoundTitle')}
        description=${bookSize === null ? text('recipes.notFoundBody') : text(bookSize === 1 ? 'recipes.notFoundCountOne' : 'recipes.notFoundCount', { count: bookSize })}
      >
        ${illustration('empty-lost')}
        <lc-button variant="primary" href=${href('/recipes')}>${text('recipes.backToRecipes')}</lc-button>
      </lc-empty-state>`,
      element,
    );
  };
  if (!Number.isSafeInteger(id) || id < 1) {
    notFound();
    return element;
  }

  const recipe = resourceFor('getRecipe', { params: { id } }, { tags: ['recipes', 'shelf', 'notes', 'collections'] });
  const shopping = resourceFor('getShoppingList', {}, { tags: ['shopping'] });
  let others: number | null = null;
  let notes = resourceFor('listRecipeNotes', { params: { id }, query: { pageSize: NOTES_SHOWN } }, { tags: ['notes'] });
  let wakeLock: WakeLockSentinel | null = null;
  let wakeWanted = true;
  let wakeRefused = false;
  const wakeSupported = 'wakeLock' in navigator && window.isSecureContext;

  const acquireWake = async (): Promise<void> => {
    if (!wakeSupported || !wakeWanted || wakeLock !== null || document.visibilityState !== 'visible') {
      return;
    }
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => {
        wakeLock = null;
      });
    } catch (error) {
      if (!(error instanceof DOMException)) {
        throw error;
      }
      wakeWanted = false;
      wakeRefused = true;
      draw();
    }
  };

  const releaseWake = async (): Promise<void> => {
    const held = wakeLock;
    wakeLock = null;
    await held?.release();
  };

  const onVisible = (): void => void acquireWake();

  let loadState: LoadState | null = null;

  const toggleFavorite = async (current: Recipe): Promise<void> => {
    try {
      await (current.mine.favorite
        ? call('unfavoriteRecipe', { params: { id } })
        : call('favoriteRecipe', { params: { id } }));
      invalidate('recipes');
    } catch (error) {
      actionFailed(error, () => void toggleFavorite(current));
    }
  };

  const undoMadeIt = async (entryId: number): Promise<void> => {
    try {
      await call('undoMadeIt', { params: { entryId } });
      invalidate('recipes', 'stats');
      toast({ title: text('toast.undone') });
    } catch (error) {
      actionFailed(error, () => void undoMadeIt(entryId));
    }
  };

  const madeIt = async (): Promise<void> => {
    try {
      const state = await call('recordMadeIt', { params: { id } });
      invalidate('recipes', 'stats');
      const entryId = state.entryId;
      toast({
        title: text(state.mine.count === 1 ? 'recipes.madeItOnce' : 'recipes.madeIt', { count: state.mine.count }),
        ...(entryId === null ? {} : { action: { label: text('toast.undo'), run: () => void undoMadeIt(entryId) } }),
      });
    } catch (error) {
      actionFailed(error, () => void madeIt());
    }
  };

  const addMissing = async (): Promise<void> => {
    try {
      const before = await call('getShoppingList', {});
      const listed = new Set(before.items.map((item) => item.ingredient.id));
      const change = await call('addMissingToShoppingList', { params: { id } });
      invalidate('shopping');
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
      actionFailed(error, () => void addMissing());
    }
  };

  const remove = async (current: Recipe): Promise<void> => {
    const sure = await confirm({
      title: text('recipes.deleteTitle', { name: current.name }),
      message: text('recipes.deleteBody'),
      confirmLabel: text('recipes.deleteRecipe'),
      danger: true,
    });
    if (!sure) {
      return;
    }
    try {
      await call('deleteRecipe', { params: { id } });
      invalidate('recipes', 'collections', 'menus', 'stats');
      ctx.navigate('/recipes', { replace: true });
      toast({ title: text('toast.deleted') });
    } catch (error) {
      actionFailed(error, () => void remove(current));
    }
  };

  const printPath = (servings: number, unit: PreferredUnit): string =>
    `/recipes/${id}/print?servings=${servings}&unit=${unit}`;

  const moreItems = (
    current: Recipe,
    session: SessionPerson,
    servings: number,
    unit: PreferredUnit,
  ): DropdownItem[] => {
    const ai = session.household.aiEnabled;
    return [
      { label: text('recipes.editRecipe'), icon: 'pencil', onClick: () => ctx.navigate(`/recipes/${id}/edit`) },
      {
        label: text('recipes.addToCollection'),
        icon: 'folder-heart',
        onClick: () => void openCollectionSheet(current),
      },
      { label: text('recipes.addToMenu'), icon: 'tv', onClick: () => void openMenuSheet(current) },
      { label: text('recipes.print'), icon: 'printer', onClick: () => ctx.navigate(printPath(servings, unit)) },
      ...(ai
        ? [
            { divider: true },
            { label: text('recipes.lookUpHistory'), icon: 'sparkles', onClick: () => openHistorySheet(current) },
            { label: text('recipes.generatePhoto'), icon: 'sparkles', onClick: () => openPhotoSheet(current) },
          ]
        : []),
      { divider: true },
      { label: text('recipes.deleteRecipe'), icon: 'trash-2', danger: true, onClick: () => void remove(current) },
    ];
  };

  const setOnHand = async (line: RecipeLine, marked: boolean): Promise<void> => {
    try {
      await call('setOnHand', { params: { id: line.ingredient.id }, body: { marked } });
      invalidate('shelf', 'recipes');
    } catch (error) {
      actionFailed(error, () => void setOnHand(line, marked));
    }
  };

  const listIngredient = async (line: RecipeLine): Promise<void> => {
    try {
      await call('addIngredientToShoppingList', { params: { id: line.ingredient.id } });
      invalidate('shopping');
      toast({ title: text('recipes.addedToList', { names: line.ingredient.name }) });
    } catch (error) {
      actionFailed(error, () => void listIngredient(line));
    }
  };

  const lineMenu = (trigger: Element, line: RecipeLine): void => {
    const name = line.ingredient.name;
    const listed = shopping.peek()?.items.some((item) => item.ingredient.id === line.ingredient.id) ?? false;
    openActions(trigger, name, [
      line.ingredient.onHand
        ? { label: text('recipes.markOff', { name }), icon: 'circle-x', onClick: () => void setOnHand(line, false) }
        : {
            label: text('recipes.markOn', { name }),
            icon: 'circle-check',
            onClick: () => void setOnHand(line, true),
          },
      listed
        ? { label: text('recipes.onTheList'), icon: 'list-checks', disabled: true }
        : { label: text('recipes.addToList'), icon: 'plus', onClick: () => void listIngredient(line) },
      {
        label: text('recipes.openIngredient', { name }),
        icon: 'citrus',
        onClick: () => ctx.navigate(`/ingredients/${line.ingredient.id}`),
      },
    ]);
  };

  const notesSection = (current: Recipe, session: SessionPerson): TemplateResult => {
    const page = notes.peek();
    return html`<section class="cl-recipe-section" aria-labelledby="cl-recipe-notes">
      <div class="cl-recipe-section-head">
        <h2 id="cl-recipe-notes" class="cl-recipe-heading">${text('recipes.notes')}</h2>
        <lc-button variant="ghost" @click=${() => void openNoteSheet(current, session)}>
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
                      <lc-avatar size="sm" name=${note.author.name} src=${note.author.avatar?.url ?? nothing}></lc-avatar>
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
                        notesWatch.stop();
                        notes = resourceFor(
                          'listRecipeNotes',
                          { params: { id }, query: { pageSize: NOTES_ALL } },
                          { tags: ['notes'] },
                        );
                        notesWatch = watch(element, [notes], () => draw());
                      }}
                    >${text('recipes.showAllNotes', { count: page.total })}</lc-button>`
                  : nothing
              }`
      }
    </section>`;
  };

  const statusWell = (current: Recipe): TemplateResult => html`<div class="cl-recipe-status">
    <p class="cl-recipe-status-word">
      ${current.canMake ? text('recipes.ready') : text('recipes.missingN', { count: current.missingCount })}
    </p>
    <span class="cl-recipe-bulbs" aria-hidden="true">
      ${current.lines.map((line) => html`<cl-bulb size="mini" status=${lineBulb(line)}></cl-bulb>`)}
    </span>
    <p class="cl-recipe-status-text">${statusSummary(current)}</p>
  </div>`;

  const servingsRow = (servings: number, unit: PreferredUnit): TemplateResult => html`<div class="cl-recipe-servings">
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
            ctx.query.set({ servings: clamped === 1 ? null : String(clamped) }, 'replace');
          }
        }}
      ></lc-number-input>
      <lc-segmented
        label=${text('recipes.units')}
        value=${unit}
        .options=${[{ value: 'oz', label: 'oz' }, { value: 'ml', label: 'ml' }]}
        @change=${(event: Event) => ctx.query.set({ unit: eventText(event) || null }, 'replace')}
      ></lc-segmented>
    </div>
    ${servings === 1 ? nothing : html`<p class="cl-recipe-scaled" role="status">${text('recipes.scaled', { count: servings })}</p>`}`;

  const linesBlock = (current: Recipe, servings: number, unit: PreferredUnit): TemplateResult => html`<div
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
        @more=${(event: Event) => lineMenu(triggerOf(event, element), line)}
      ></cl-ingredient-line>`,
    )}
  </div>`;

  const wakeRow = (): TemplateResult | typeof nothing =>
    wakeSupported || wakeRefused
      ? html`<div class="cl-recipe-wake">
          <lc-switch
            label=${text('recipes.keepAwake')}
            hint=${wakeRefused ? text('recipes.keepAwakeRefused') : text('recipes.keepAwakeHint')}
            ?checked=${wakeWanted}
            @change=${(event: Event) => {
              wakeWanted = eventChecked(event);
              wakeRefused = false;
              void (wakeWanted ? acquireWake() : releaseWake());
              draw();
            }}
          ></lc-switch>
        </div>`
      : nothing;

  const primaryButton = (current: Recipe): TemplateResult =>
    current.missingCount > 0
      ? html`<lc-button variant="primary" @click=${() => void addMissing()}
          >${text(current.missingCount === 1 ? 'recipes.addMissingOne' : 'recipes.addMissing', { count: current.missingCount })}</lc-button
        >`
      : html`<lc-button variant="primary" @click=${() => void openMenuSheet(current)}>${text('recipes.addToMenu')}</lc-button>`;

  const madeButton = (): TemplateResult => html`<lc-button variant="quiet" @click=${() => void madeIt()}>
    <lc-icon name="check" aria-hidden="true"></lc-icon>${text('recipes.madeItButton')}
  </lc-button>`;

  const actionsRow = (current: Recipe, servings: number, unit: PreferredUnit): TemplateResult => html`<div
    class="cl-recipe-actions"
  >
    ${madeButton()} ${primaryButton(current)}
    ${
      current.missingCount > 0
        ? html`<lc-button variant="quiet" @click=${() => void openMenuSheet(current)}>${text('recipes.addToMenu')}</lc-button>`
        : nothing
    }
    <lc-button variant="quiet" @click=${() => void openCollectionSheet(current)}>${text('recipes.addToCollection')}</lc-button>
    <lc-button variant="quiet" href=${href(printPath(servings, unit))}>
      <lc-icon name="printer" aria-hidden="true"></lc-icon>${text('recipes.print')}
    </lc-button>
    <lc-button variant="quiet" href=${href(`/recipes/${id}/edit`)}>
      <lc-icon name="pencil" aria-hidden="true"></lc-icon>${text('recipes.edit')}
    </lc-button>
  </div>`;

  const favoriteButton = (current: Recipe): TemplateResult => html`<button
    type="button"
    class="cl-recipe-onphoto"
    aria-pressed=${current.mine.favorite ? 'true' : 'false'}
    aria-label=${text('card.favorite', { name: current.name })}
    @click=${() => void toggleFavorite(current)}
  ><lc-icon name="heart" ?solid=${current.mine.favorite} aria-hidden="true"></lc-icon></button>`;

  const moreButton = (
    current: Recipe,
    session: SessionPerson,
    servings: number,
    unit: PreferredUnit,
  ): TemplateResult => html`<button
    type="button"
    class="cl-recipe-onphoto"
    aria-haspopup="menu"
    aria-label=${text('recipes.moreActions', { name: current.name })}
    @click=${(event: MouseEvent) =>
      openActions(triggerOf(event, element), current.name, moreItems(current, session, servings, unit))}
  ><lc-icon name="ellipsis" aria-hidden="true"></lc-icon></button>`;

  const media = (
    current: Recipe,
    session: SessionPerson,
    servings: number,
    unit: PreferredUnit,
  ): TemplateResult => html`<div
    class="cl-recipe-media"
  >
    ${photo(current)}
    <div class="cl-recipe-photo-bar">
      <a class="cl-recipe-onphoto" href=${href('/recipes')} aria-label=${text('action.back')}
        ><lc-icon name="chevron-left" aria-hidden="true"></lc-icon
      ></a>
      <span class="cl-recipe-photo-bar-end">
        ${favoriteButton(current)}
        ${moreButton(current, session, servings, unit)}
      </span>
    </div>
  </div>`;

  const failed = (): void => {
    render(
      html`<lc-empty-state
        title=${text('loadFailed.title', { screen: text('title.recipe') })}
        description=${text('loadFailed.body')}
      >
        ${illustration('empty-lost')}
        <lc-button variant="primary" @click=${() => loadState?.retry()}>${text('loadFailed.retry')}</lc-button>
      </lc-empty-state>`,
      element,
    );
  };

  const draw = (): void => {
    const current = recipe.peek();
    const session = ctx.person.current();
    const problem = loadState?.error(recipe) ?? null;
    if (problem !== null && current === undefined) {
      if (problem.code === 'not_found') {
        notFound(others);
        if (others === null) {
          call('listRecipes', { query: { pageSize: 1 } }).then(
            (page) => {
              others = page.facets.all;
              notFound(others);
            },
            (error: unknown) => actionFailed(error, () => draw()),
          );
        }
      } else {
        failed();
      }
      return;
    }
    if (current === undefined || session === null) {
      if (loadState?.slow === true && element.querySelector('.cl-skeleton') === null) {
        element.replaceChildren(skeleton('figure', text('title.recipe')), skeleton('lines', text('title.recipe')));
      }
      return;
    }
    setScreenTitle(current.name);
    const servings = servingsOf(ctx.query.get('servings'));
    const unit = unitOf(ctx.query.get('unit'), session);
    render(
      html`
        ${media(current, session, servings, unit)}
        <div class="cl-recipe-sheet">
          <header class="cl-recipe-head">
            <h1 class="cl-recipe-name">${current.name}</h1>
            <span class="cl-recipe-head-favorite">${favoriteButton(current)} ${moreButton(current, session, servings, unit)}</span>
          </header>
          ${current.description === '' ? nothing : html`<p class="cl-recipe-description">${current.description}</p>`}
          <p class="cl-recipe-facts">${facts(current, unit).map((fact) => html`<span>${fact}</span>`)}</p>
          <div class="cl-recipe-rating-row">
            ${ratingControl({
              value: current.mine.rating?.value ?? 0,
              household: current.household.rating,
              recipeId: id,
              onRated: () => undefined,
            })}
            ${madeLine(current)}
          </div>
          ${statusWell(current)} ${servingsRow(servings, unit)} ${linesBlock(current, servings, unit)} ${wakeRow()}
          ${actionsRow(current, servings, unit)}
          ${method(current)} ${details(current)} ${variations(current)} ${notesSection(current, session)}
        </div>
        <div class="cl-recipe-actionbar">${madeButton()} ${primaryButton(current)}</div>
      `,
      element,
    );
  };

  watch(element, [recipe], (state) => {
    loadState = state;
    draw();
  });
  let notesWatch = watch(element, [notes], () => draw());
  watch(element, [shopping], () => undefined);
  const stopQuery = ctx.query.subscribe(draw);
  const stopPerson = ctx.person.subscribe(draw);
  document.addEventListener('visibilitychange', onVisible);
  void acquireWake();
  onLeave(element, () => {
    stopQuery();
    stopPerson();
    document.removeEventListener('visibilitychange', onVisible);
    void releaseWake();
  });
  return element;
}
