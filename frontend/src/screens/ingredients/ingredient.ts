import type { Ingredient, LineCoverage, Note, RatingValue, RecipeSummary, Verdict, Visibility } from '@cellar/contract';
import type { LightElements } from '@lightstart/components/elements.js';
import { html, nothing, render, type TemplateResult } from '@lightstart/light/html';
import { call } from '../../app/api.ts';
import { eventField, eventText } from '../../app/events.ts';
import { type WatchState, watch } from '../../app/load.ts';
import { invalidate, resourceFor } from '../../app/resources.ts';
import { href, setScreenTitle } from '../../app/router.ts';
import { today } from '../../app/today.ts';
import type { ScreenContext } from '../../app/types.ts';
import type { HaveSegment } from '../../design-system/cl-have-bar.ts';
import { plateForIngredient } from '../../design-system/cl-plate.ts';
import { confirm } from '../../design-system/dialogs.ts';
import { thumbHashDataUrl } from '../../design-system/thumbhash.ts';
import { toast } from '../../design-system/toast.ts';
import { formatCount, formatDate, formatNumber } from '../../text/format.ts';
import { type TextKey, text } from '../../text/index.ts';
import { attempt, sheet, waiting } from '../shelf/parts/kit.ts';
import './ingredients.css';

type Dropdown = LightElements['lc-dropdown'];

const RATINGS: readonly RatingValue[] = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
const USED_IN_ROWS = 3;
const NOTES_PAGE = 50;
const oneDecimal = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function segmentOf(coverage: LineCoverage): HaveSegment {
  switch (coverage) {
    case 'on_hand':
      return 'on';
    case 'covered':
      return 'via';
    case 'missing':
      return 'off';
  }
}

function recipes(count: number): string {
  return formatCount(count, text('ingredients.recipeOne'), text('ingredients.recipeMany'));
}

function bottles(count: number): string {
  return formatCount(count, text('ingredients.bottleOne'), text('ingredients.bottleMany'));
}

function ratingOf(value: number): RatingValue | null {
  return RATINGS.find((rating) => rating === value) ?? null;
}

const VERDICT_LABELS = {
  avoid: 'ingredients.verdictAvoid',
  decent: 'ingredients.verdictDecent',
  recommend: 'ingredients.verdictRecommend',
} as const satisfies Record<Verdict, TextKey>;

function verdictOf(value: unknown): Verdict | null {
  return value === 'avoid' || value === 'decent' || value === 'recommend' ? value : null;
}

function visibilityOf(value: unknown, fallback: Visibility): Visibility {
  return value === 'household' || value === 'private' ? value : fallback;
}

export function screen(ctx: ScreenContext): HTMLElement {
  const element = document.createElement('section');
  element.className = 'cl-kit-screen cl-ingr-page';
  const id = Number(ctx.params.id);
  const ingredient = resourceFor('getIngredient', { params: { id } }, { tags: ['ingredients', 'shelf'] });
  const usedIn = resourceFor(
    'listRecipes',
    { query: { ingredient: id, pageSize: USED_IN_ROWS, sort: 'rating', order: 'desc' } },
    { tags: ['recipes', 'ingredients'] },
  );
  const notes = resourceFor(
    'listIngredientNotes',
    { params: { id }, query: { pageSize: NOTES_PAGE } },
    { tags: ['notes'] },
  );
  const descriptors = resourceFor('listDescriptors', {}, { tags: ['settings'] });
  let busy = false;
  let noteOpen = false;
  let noteText = '';
  let noteWords: string[] = [];
  let noteTastedOn = today();
  let noteVerdict: Verdict | null = null;
  let noteVisibility: Visibility = ctx.person.current()?.person.defaultVisibility ?? 'household';
  let noteError = '';
  let titled = false;
  let state: WatchState | null = null;
  const redraw = (): void => {
    if (state !== null) {
      draw(state);
    }
  };

  async function toggleOnHand(item: Ingredient): Promise<void> {
    busy = true;
    redraw();
    try {
      await attempt(async () => {
        const result = await call('setOnHand', { params: { id: item.id }, body: { marked: !item.onHand } });
        if (item.onHand && result.onHand && result.onHandReason === 'bottle') {
          const count = item.bottles.onShelf.length;
          toast({
            title:
              count === 1
                ? text('ingredients.stayOne', { name: item.name })
                : text('ingredients.stayMany', { name: item.name, count: formatNumber(count) }),
          });
        } else if (item.onHand && result.onHand && result.onHandReason === 'parts') {
          toast({ title: text('ingredients.stayParts', { name: item.name }) });
        }
        invalidate('ingredients', 'recipes', 'stats');
      });
    } finally {
      busy = false;
      redraw();
    }
  }

  const addToList = (item: Ingredient): Promise<void> =>
    attempt(async () => {
      const change = await call('addIngredientToShoppingList', { params: { id: item.id } });
      toast({
        title:
          change.alreadyListed > 0
            ? text('ingredients.listAlready', { name: item.name })
            : text('ingredients.listAdded', { name: item.name }),
      });
      invalidate('shopping', 'stats');
    });

  const rate = (item: Ingredient, value: number): Promise<void> =>
    attempt(async () => {
      const rating = ratingOf(value);
      if (rating === null) {
        await call('clearIngredientRating', { params: { id: item.id } });
        toast({ title: text('ingredients.ratingCleared') });
      } else {
        await call('rateIngredient', {
          params: { id: item.id },
          body: { value: rating, visibility: item.mine.rating?.visibility ?? noteVisibility },
        });
        toast({ title: text('ingredients.rated') });
      }
      invalidate('ingredients', 'stats');
    });

  const saveNote = (item: Ingredient): Promise<void> =>
    attempt(async () => {
      noteError = '';
      const known = descriptors.peek()?.items ?? [];
      await call('createIngredientNote', {
        params: { id: item.id },
        body: {
          text: noteText,
          tastedOn: noteTastedOn,
          descriptorIds: known.filter((word) => noteWords.includes(String(word.id))).map((word) => word.id),
          verdict: noteVerdict,
          visibility: noteVisibility,
        },
      });
      noteOpen = false;
      noteText = '';
      noteWords = [];
      noteTastedOn = today();
      noteVerdict = null;
      toast({ title: text('ingredients.noteSaved') });
      invalidate('notes', 'stats');
    });

  async function remove(item: Ingredient): Promise<void> {
    const sure = await confirm({
      title: text('ingredients.deleteTitle', { name: item.name }),
      message:
        item.bottles.onShelf.length === 0
          ? text('ingredients.deleteBody')
          : item.bottles.onShelf.length === 1
            ? text('ingredients.deleteBodyBottle')
            : text('ingredients.deleteBodyBottles', { count: formatNumber(item.bottles.onShelf.length) }),
      confirmLabel: text('ingredients.deleteConfirm'),
      danger: true,
    });
    if (!sure) {
      return;
    }
    await attempt(async () => {
      await call('deleteIngredient', { params: { id: item.id } });
      toast({ title: text('ingredients.deleted', { name: item.name }) });
      stopWatching();
      invalidate('ingredients', 'recipes', 'shelf', 'stats');
      ctx.navigate('/ingredients', { replace: true });
    });
  }

  const openMenu = (event: MouseEvent): void => {
    const menu = element.querySelector<Dropdown>('.cl-ingr-menu');
    if (event.currentTarget instanceof Element && menu !== null) {
      menu.toggle(event.currentTarget);
    }
  };

  const recipeRow = (recipe: RecipeSummary): TemplateResult => html`<li>
    <cl-recipe-row
      href=${`/recipes/${recipe.id}`}
      name=${recipe.name}
      .image=${recipe.image}
      .glass=${recipe.glass?.name ?? null}
      .segments=${recipe.coverage.map(segmentOf)}
      .rating=${recipe.household.rating.average}
    ></cl-recipe-row>
  </li>`;

  const noteRow = (note: Note): TemplateResult => html`<li class="cl-ingr-note">
    <span class="cl-kit-meta">
      ${text('ingredients.noteBy', { name: note.author.name, date: formatDate(note.tastedOn) })}
      · ${note.visibility === 'private' ? text('ingredients.onlyYou') : text('ingredients.household')}
    </span>
    ${note.text === '' ? nothing : html`<p class="cl-ingr-note-text">${note.text}</p>`}
    ${
      note.descriptors.length === 0 && note.verdict === null
        ? nothing
        : html`<span class="cl-ingr-tags">
            ${note.verdict === null ? nothing : html`<lc-tag size="sm">${text(VERDICT_LABELS[note.verdict])}</lc-tag>`}
            ${note.descriptors.map((word) => html`<lc-tag size="sm">${word.name}</lc-tag>`)}
          </span>`
    }
  </li>`;

  const noteSheet = (item: Ingredient): TemplateResult =>
    sheet({
      open: noteOpen,
      title: text('ingredients.noteTitle', { name: item.name }),
      onClose: () => {
        noteOpen = false;
        redraw();
      },
      body: html`
        <lc-textarea
          label=${text('ingredients.noteText')}
          .value=${noteText}
          @input=${(event: Event) => {
            noteText = eventText(event);
          }}
        ></lc-textarea>
        <lc-input
          type="date"
          label=${text('ingredients.noteTastedOn')}
          .value=${noteTastedOn}
          @input=${(event: Event) => {
            noteTastedOn = eventText(event);
          }}
        ></lc-input>
        <lc-select
          multiple
          searchable
          label=${text('ingredients.noteWords')}
          .options=${(descriptors.peek()?.items ?? []).map((word) => ({ value: String(word.id), label: word.name }))}
          .value=${noteWords}
          @change=${(event: Event) => {
            const value = eventField(event, 'value');
            noteWords = Array.isArray(value) ? value.filter((word): word is string => typeof word === 'string') : [];
          }}
        ></lc-select>
        <lc-segmented
          label=${text('ingredients.noteVerdict')}
          .options=${[
            { value: 'avoid', label: text(VERDICT_LABELS.avoid) },
            { value: 'decent', label: text(VERDICT_LABELS.decent) },
            { value: 'recommend', label: text(VERDICT_LABELS.recommend) },
            { value: 'none', label: text('ingredients.verdictNone') },
          ]}
          value=${noteVerdict ?? 'none'}
          @change=${(event: Event) => {
            noteVerdict = verdictOf(eventField(event, 'value'));
          }}
        ></lc-segmented>
        <lc-segmented
          label=${text('ingredients.noteVisibility')}
          .options=${[
            { value: 'household', label: text('ingredients.household') },
            { value: 'private', label: text('ingredients.onlyYou') },
          ]}
          value=${noteVisibility}
          @change=${(event: Event) => {
            noteVisibility = visibilityOf(eventField(event, 'value'), noteVisibility);
          }}
        ></lc-segmented>
        ${noteError === '' ? nothing : html`<p class="cl-kit-error" role="alert">${noteError}</p>`}
      `,
      footer: html`
        <lc-button
          variant="quiet"
          @click=${() => {
            noteOpen = false;
            redraw();
          }}
          >${text('action.cancel')}</lc-button
        >
        <lc-button variant="primary" @click=${() => void saveNote(item).then(redraw)}>${text('ingredients.noteSave')}</lc-button>
      `,
    });

  const heroView = (item: Ingredient): TemplateResult => {
    const facts = [
      item.strength > 0 ? text('ingredients.strength', { strength: formatNumber(item.strength) }) : '',
      item.origin === '' ? '' : text('ingredients.origin', { origin: item.origin }),
    ]
      .filter((fact) => fact !== '')
      .join(' ');
    return html`
      <header class="cl-ingr-hero">
        ${
          item.image === null
            ? html`<cl-plate
                class="cl-ingr-hero-art"
                kind=${plateForIngredient(item.path[0]?.name ?? item.name, item.parts.length > 0)}
                name=${item.name}
              ></cl-plate>`
            : html`<lc-image
                class="cl-ingr-hero-art"
                src=${item.image.url}
                alt=${text('photo.of', { name: item.name })}
                placeholder=${item.image.thumbhash === null ? nothing : thumbHashDataUrl(item.image.thumbhash)}
              ></lc-image>`
        }
        <div>
          ${
            item.path.length === 0
              ? nothing
              : html`<nav aria-label=${text('ingredients.breadcrumb')}>
                  <ol class="cl-ingr-crumbs">
                    ${item.path.map((step) => html`<li><a href=${href(`/ingredients/${step.id}`)}>${step.name}</a></li>`)}
                    <li aria-current="page">${item.name}</li>
                  </ol>
                </nav>`
          }
          <h1 class="cl-ingr-name">${item.name}</h1>
          ${facts === '' ? nothing : html`<p class="cl-kit-lede">${facts}</p>`}
        </div>
      </header>
    `;
  };
  const actionsView = (item: Ingredient): TemplateResult => {
    return html`
      <div class="cl-ingr-actions">
        <button
          type="button"
          class="cl-kit-toggle"
          aria-pressed=${item.onHand ? 'true' : 'false'}
          aria-busy=${busy ? 'true' : nothing}
          @click=${() => {
            if (!busy) {
              void toggleOnHand(item);
            }
          }}
        >
          <cl-bulb size="mini" status=${item.onHand ? 'on' : 'off'}></cl-bulb>
          <span class="cl-vh">${text('ingredients.toggleLabel', { name: item.name })}</span>
    <span>${item.onHand ? text('ingredients.onHand') : text('ingredients.notHere')}</span>
        </button>
        <lc-button
          variant="quiet"
          @click=${() => ctx.navigate('/shelf?add=1', { state: { bottleDraft: { name: '', ingredientId: item.id } } })}
        >
          <lc-icon name="plus" aria-hidden="true"></lc-icon>${text('ingredients.addBottle')}
        </lc-button>
        <lc-button variant="quiet" @click=${() => void addToList(item)}>
          <lc-icon name="list-checks" aria-hidden="true"></lc-icon>${text('ingredients.addToList')}
        </lc-button>
        <lc-button
          variant="quiet"
          @click=${() => {
            noteOpen = true;
            void descriptors.ensure();
            redraw();
          }}
        >
          <lc-icon name="notebook-pen" aria-hidden="true"></lc-icon>${text('ingredients.note')}
        </lc-button>
        <button
          type="button"
          class="cl-icon-button"
          aria-haspopup="menu"
          aria-label=${text('ingredients.more', { name: item.name })}
          @click=${openMenu}
        >
          <lc-icon name="ellipsis" aria-hidden="true"></lc-icon>
        </button>
        <lc-dropdown
          class="cl-ingr-menu"
          .items=${[
            {
              label: text('ingredients.edit'),
              icon: 'pencil',
              onClick: () => ctx.navigate(`/ingredients/${item.id}/edit`),
            },
            { label: text('ingredients.delete'), icon: 'trash-2', danger: true, onClick: () => void remove(item) },
          ]}
        ></lc-dropdown>
      </div>
    `;
  };
  const aboutView = (item: Ingredient): TemplateResult => {
    const shelfCount = item.bottles.onShelf.length;
    return html`
      ${
        item.onHandReason === 'bottle'
          ? html`<p class="cl-ingr-because">
              ${
                shelfCount === 1
                  ? text('ingredients.becauseBottlesOne')
                  : text('ingredients.becauseBottlesMany', { count: formatNumber(shelfCount) })
              }
            </p>`
          : item.onHandReason === 'parts'
            ? html`<p class="cl-ingr-because">${text('ingredients.becauseParts')}</p>`
            : nothing
      }
      ${item.description === '' ? nothing : html`<p class="cl-ingr-description">${item.description}</p>`}
      <lc-rating
        step="0.5"
        clearable
        label=${text('rating.label')}
        .value=${item.mine.rating?.value ?? 0}
        .change=${(value: number) => void rate(item, value)}
      ></lc-rating>
    `;
  };
  const shelfView = (item: Ingredient): TemplateResult => {
    const shelfCount = item.bottles.onShelf.length;
    return html`
      <section class="cl-kit-section" aria-labelledby="cl-ingr-shelf">
        <div class="cl-kit-section-head">
          <h2 class="cl-kit-section-title" id="cl-ingr-shelf">${text('ingredients.onShelf')}</h2>
          <p class="cl-kit-meta">
            ${text('ingredients.shelfCount', { bottles: bottles(shelfCount), finished: formatNumber(item.bottles.finishedCount) })}
          </p>
        </div>
        ${
          shelfCount === 0
            ? html`<p class="cl-kit-meta">${text('ingredients.shelfEmpty', { name: item.name })}</p>`
            : html`<ul class="cl-kit-list cl-kit-panel">
                ${item.bottles.onShelf.map(
                  (bottle) => html`<li class="cl-kit-row">
                    <span class="cl-kit-row-text">
                      <span class="cl-kit-row-name">${bottle.name}</span>
                      <span class="cl-kit-row-sub"
                        >${
                          bottle.status === 'open' && bottle.openedOn !== null
                            ? text('ingredients.openSince', {
                                date: formatDate(bottle.openedOn),
                                size: bottle.labeledSize,
                              })
                            : text('ingredients.sealed', { size: bottle.labeledSize })
                        }</span
                      >
                    </span>
                    <cl-bulb size="mini" status=${bottle.status === 'open' ? 'on' : 'off'}></cl-bulb>
                  </li>`,
                )}
              </ul>`
        }
      </section>
    `;
  };
  const usedView = (item: Ingredient): TemplateResult => {
    const recipePage = usedIn.peek();
    const aside = [
      item.substitutesIn.count > 0
        ? text('ingredients.substituteIn', { recipes: recipes(item.substitutesIn.count) })
        : '',
      item.children.length > 0
        ? text('ingredients.children', { names: item.children.map((child) => child.name).join(', ') })
        : '',
      item.parts.length > 0
        ? text('ingredients.madeFrom', { parts: item.parts.map((part) => part.ingredient.name).join(', ') })
        : '',
    ].filter((line) => line !== '');
    return html`
      <section class="cl-kit-section" aria-labelledby="cl-ingr-used">
        <div class="cl-kit-section-head">
          <h2 class="cl-kit-section-title" id="cl-ingr-used">
            ${item.usedIn.count === 0 ? text('ingredients.usedIn', { recipes: recipes(0) }) : text('ingredients.usedIn', { recipes: recipes(item.usedIn.count) })}
          </h2>
          ${
            item.usedIn.count > 0
              ? html`<a class="cl-ingr-link" href=${href(`/recipes?ingredient=${item.id}`)}>${text('ingredients.seeAll')}</a>`
              : nothing
          }
        </div>
        ${
          item.usedIn.count === 0
            ? html`<p class="cl-kit-meta">${text('ingredients.usedInNone', { name: item.name })}</p>`
            : recipePage === undefined
              ? nothing
              : html`<ul class="cl-kit-list">${recipePage.items.map(recipeRow)}</ul>`
        }
        ${aside.length === 0 ? nothing : html`<p class="cl-kit-meta">${aside.join(' ')}</p>`}
      </section>
    `;
  };
  const notesView = (item: Ingredient): TemplateResult => {
    const notePage = notes.peek();
    const average = item.household.rating.average;
    return html`
      <section class="cl-kit-section" aria-labelledby="cl-ingr-notes">
        <div class="cl-kit-section-head">
          <h2 class="cl-kit-section-title" id="cl-ingr-notes">${text('ingredients.notes')}</h2>
          <p class="cl-kit-meta">
            ${
              average === null
                ? text('ingredients.noRatings')
                : text('ingredients.houseAverage', {
                    average: oneDecimal.format(average),
                    count: formatNumber(item.household.rating.count),
                  })
            }
          </p>
        </div>
        ${
          notePage === undefined
            ? nothing
            : notePage.items.length === 0
              ? html`<p class="cl-kit-meta">${text('ingredients.noNotes')}</p>`
              : html`<ul class="cl-kit-list">${notePage.items.map(noteRow)}</ul>`
        }
      </section>
    `;
  };
  const page = (item: Ingredient): TemplateResult => html`
    ${heroView(item)} ${actionsView(item)} ${aboutView(item)} ${shelfView(item)} ${usedView(item)} ${notesView(item)}
    ${noteSheet(item)}
  `;

  const draw = (current: WatchState): void => {
    state = current;
    const item = ingredient.peek();
    if (item !== undefined && !titled) {
      titled = true;
      setScreenTitle(item.name);
    }
    render(item === undefined ? waiting(current, ingredient, text('title.ingredient'), 'lines') : page(item), element);
  };

  const stopWatching = watch(element, [ingredient, usedIn, notes], draw).stop;
  return element;
}
