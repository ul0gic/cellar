import type { Ingredient, LineCoverage, Note, RatingValue, RecipeSummary, Verdict, Visibility } from '@cellar/contract';
import type { LightElements } from '@lightstart/components/elements.js';
import View from '@lightstart/light';
import { html, nothing, type TemplateResult } from '@lightstart/light/html';
import { effect, signal, untracked } from '@lightstart/light/signals';
import { call } from '../../app/api.ts';
import { session } from '../../app/controllers/session.ts';
import { eventField, eventText } from '../../app/events.ts';
import { loadState } from '../../app/load.ts';
import { apiResource, dataChanged } from '../../app/resources.ts';
import { href, navigate, setScreenTitle } from '../../app/router.ts';
import { today } from '../../app/today.ts';
import type { RouteParams } from '../../app/types.ts';
import type { HaveSegment } from '../../design-system/cl-have-bar.ts';
import { plateForIngredient } from '../../design-system/cl-plate.ts';
import { confirm } from '../../design-system/dialogs.ts';
import { waiting } from '../../design-system/load-view.ts';
import { thumbHashDataUrl } from '../../design-system/thumbhash.ts';
import { toast } from '../../design-system/toast.ts';
import { formatCount, formatDate, formatNumber } from '../../text/format.ts';
import { type TextKey, text } from '../../text/index.ts';
import '../../design-system/cl-bulb.ts';
import '../../design-system/cl-recipe-row.ts';
import '../../design-system/lc/button.ts';
import '../../design-system/lc/dropdown.ts';
import '../../design-system/lc/icon.ts';
import '../../design-system/lc/image.ts';
import '../../design-system/lc/input.ts';
import '../../design-system/lc/rating.ts';
import '../../design-system/lc/segmented.ts';
import '../../design-system/lc/select.ts';
import '../../design-system/lc/tag.ts';
import '../../design-system/lc/textarea.ts';
import { attempt, sheet } from '../shelf/parts/kit.ts';
import './ingredients.css';

export const tag = 'cl-screen-ingredients-ingredient';

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

function recipeRow(recipe: RecipeSummary): TemplateResult {
  return html`<li>
    <cl-recipe-row
      href=${`/recipes/${recipe.id}`}
      name=${recipe.name}
      .image=${recipe.image}
      .glass=${recipe.glass?.name ?? null}
      .segments=${recipe.coverage.map(segmentOf)}
      .rating=${recipe.household.rating.average}
    ></cl-recipe-row>
  </li>`;
}

function noteRow(note: Note): TemplateResult {
  return html`<li class="cl-ingr-note">
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
}

function heroView(item: Ingredient): TemplateResult {
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
}

function shelfView(item: Ingredient): TemplateResult {
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
}

class IngredientScreen extends View {
  params: RouteParams = {};
  readonly ingredient = apiResource('getIngredient', ['ingredients', 'shelf']);
  readonly usedIn = apiResource('listRecipes', ['recipes', 'ingredients']);
  readonly notes = apiResource('listIngredientNotes', ['notes']);
  readonly descriptors = apiResource('listDescriptors', ['settings']);
  readonly state = loadState([this.ingredient]);
  readonly busy = signal(false);
  readonly noteOpen = signal(false);
  readonly noteText = signal('');
  readonly noteWords = signal<readonly string[]>([]);
  readonly noteTastedOn = signal(today());
  readonly noteVerdict = signal<Verdict | null>(null);
  readonly noteVisibility = signal<Visibility>(session.current.peek()?.person.defaultVisibility ?? 'household');

  connected(): void {
    this.classList.add('cl-kit-screen', 'cl-ingr-page');
    const id = Number(this.params.id);
    this.ingredient.bind(this, { params: { id } });
    this.usedIn.bind(this, { query: { ingredient: id, pageSize: USED_IN_ROWS, sort: 'rating', order: 'desc' } });
    this.notes.bind(this, { params: { id }, query: { pageSize: NOTES_PAGE } });
    this.followDescriptors();
    const titling = effect(() => {
      const item = this.ingredient.value.value;
      if (item !== undefined) {
        setScreenTitle(item.name);
      }
    });
    this.$own(() => titling.dispose());
  }

  private followDescriptors(): void {
    let bound = false;
    const wanted = effect(() => {
      if (this.noteOpen.value && !bound) {
        bound = true;
        untracked(() => this.descriptors.bind(this, {}));
      }
    });
    this.$own(() => wanted.dispose());
  }

  private async toggleOnHand(item: Ingredient): Promise<void> {
    this.busy.value = true;
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
        dataChanged('ingredients', 'recipes', 'stats');
      });
    } finally {
      this.busy.value = false;
    }
  }

  private addToList(item: Ingredient): Promise<void> {
    return attempt(async () => {
      const change = await call('addIngredientToShoppingList', { params: { id: item.id } });
      toast({
        title:
          change.alreadyListed > 0
            ? text('ingredients.listAlready', { name: item.name })
            : text('ingredients.listAdded', { name: item.name }),
      });
      dataChanged('shopping', 'stats');
    });
  }

  private rate(item: Ingredient, value: number): Promise<void> {
    return attempt(async () => {
      const rating = ratingOf(value);
      if (rating === null) {
        await call('clearIngredientRating', { params: { id: item.id } });
        toast({ title: text('ingredients.ratingCleared') });
      } else {
        await call('rateIngredient', {
          params: { id: item.id },
          body: { value: rating, visibility: item.mine.rating?.visibility ?? this.noteVisibility.peek() },
        });
        toast({ title: text('ingredients.rated') });
      }
      dataChanged('ingredients', 'stats');
    });
  }

  private saveNote(item: Ingredient): Promise<void> {
    return attempt(async () => {
      const known = this.descriptors.value.peek()?.items ?? [];
      const words = this.noteWords.peek();
      await call('createIngredientNote', {
        params: { id: item.id },
        body: {
          text: this.noteText.peek(),
          tastedOn: this.noteTastedOn.peek(),
          descriptorIds: known.filter((word) => words.includes(String(word.id))).map((word) => word.id),
          verdict: this.noteVerdict.peek(),
          visibility: this.noteVisibility.peek(),
        },
      });
      this.noteOpen.value = false;
      this.noteText.value = '';
      this.noteWords.value = [];
      this.noteTastedOn.value = today();
      this.noteVerdict.value = null;
      toast({ title: text('ingredients.noteSaved') });
      dataChanged('notes', 'stats');
    });
  }

  private async removeIngredient(item: Ingredient): Promise<void> {
    const sure = await confirm(this, {
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
      this.ingredient.release();
      this.usedIn.release();
      this.notes.release();
      dataChanged('ingredients', 'recipes', 'shelf', 'stats');
      if (this.isConnected) {
        navigate('/ingredients', { replace: true });
      }
    });
  }

  private openMenu(event: MouseEvent): void {
    const menu = this.querySelector<Dropdown>('.cl-ingr-menu');
    if (event.currentTarget instanceof Element && menu !== null) {
      menu.toggle(event.currentTarget);
    }
  }

  private noteSheet(item: Ingredient): TemplateResult {
    const close = (): void => {
      this.noteOpen.value = false;
    };
    return sheet({
      open: this.noteOpen.value,
      title: text('ingredients.noteTitle', { name: item.name }),
      onClose: close,
      body: html`
        <lc-textarea
          label=${text('ingredients.noteText')}
          .value=${this.noteText.value}
          @input=${(event: Event) => {
            this.noteText.value = eventText(event);
          }}
        ></lc-textarea>
        <lc-input
          type="date"
          label=${text('ingredients.noteTastedOn')}
          .value=${this.noteTastedOn.value}
          @input=${(event: Event) => {
            this.noteTastedOn.value = eventText(event);
          }}
        ></lc-input>
        <lc-select
          multiple
          searchable
          label=${text('ingredients.noteWords')}
          .options=${(this.descriptors.value.value?.items ?? []).map((word) => ({
            value: String(word.id),
            label: word.name,
          }))}
          .value=${this.noteWords.value}
          @change=${(event: Event) => {
            const value = eventField(event, 'value');
            this.noteWords.value = Array.isArray(value)
              ? value.filter((word): word is string => typeof word === 'string')
              : [];
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
          value=${this.noteVerdict.value ?? 'none'}
          @change=${(event: Event) => {
            this.noteVerdict.value = verdictOf(eventField(event, 'value'));
          }}
        ></lc-segmented>
        <lc-segmented
          label=${text('ingredients.noteVisibility')}
          .options=${[
            { value: 'household', label: text('ingredients.household') },
            { value: 'private', label: text('ingredients.onlyYou') },
          ]}
          value=${this.noteVisibility.value}
          @change=${(event: Event) => {
            this.noteVisibility.value = visibilityOf(eventField(event, 'value'), this.noteVisibility.peek());
          }}
        ></lc-segmented>
      `,
      footer: html`
        <lc-button variant="quiet" @click=${close}>${text('action.cancel')}</lc-button>
        <lc-button variant="primary" @click=${() => void this.saveNote(item)}>${text('ingredients.noteSave')}</lc-button>
      `,
    });
  }

  private actionsView(item: Ingredient): TemplateResult {
    const busy = this.busy.value;
    return html`
      <div class="cl-ingr-actions">
        <button
          type="button"
          class="cl-kit-toggle"
          aria-pressed=${item.onHand ? 'true' : 'false'}
          aria-busy=${busy ? 'true' : nothing}
          @click=${() => {
            if (!this.busy.peek()) {
              void this.toggleOnHand(item);
            }
          }}
        >
          <cl-bulb size="mini" status=${item.onHand ? 'on' : 'off'}></cl-bulb>
          <span class="cl-vh">${text('ingredients.toggleLabel', { name: item.name })}</span>
    <span>${item.onHand ? text('ingredients.onHand') : text('ingredients.notHere')}</span>
        </button>
        <lc-button
          variant="quiet"
          @click=${() => navigate('/shelf?add=1', { state: { bottleDraft: { name: '', ingredientId: item.id } } })}
        >
          <lc-icon name="plus" aria-hidden="true"></lc-icon>${text('ingredients.addBottle')}
        </lc-button>
        <lc-button variant="quiet" @click=${() => void this.addToList(item)}>
          <lc-icon name="list-checks" aria-hidden="true"></lc-icon>${text('ingredients.addToList')}
        </lc-button>
        <lc-button
          variant="quiet"
          @click=${() => {
            this.noteOpen.value = true;
          }}
        >
          <lc-icon name="notebook-pen" aria-hidden="true"></lc-icon>${text('ingredients.note')}
        </lc-button>
        <button
          type="button"
          class="cl-icon-button"
          aria-haspopup="menu"
          aria-label=${text('ingredients.more', { name: item.name })}
          @click=${(event: MouseEvent) => this.openMenu(event)}
        >
          <lc-icon name="ellipsis" aria-hidden="true"></lc-icon>
        </button>
        <lc-dropdown
          class="cl-ingr-menu"
          .items=${[
            {
              label: text('ingredients.edit'),
              icon: 'pencil',
              onClick: () => navigate(`/ingredients/${item.id}/edit`),
            },
            {
              label: text('ingredients.delete'),
              icon: 'trash-2',
              danger: true,
              onClick: () => void this.removeIngredient(item),
            },
          ]}
        ></lc-dropdown>
      </div>
    `;
  }

  private aboutView(item: Ingredient): TemplateResult {
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
        .change=${(value: number) => void this.rate(item, value)}
      ></lc-rating>
    `;
  }

  private usedView(item: Ingredient): TemplateResult {
    const recipePage = this.usedIn.value.value;
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
  }

  private notesView(item: Ingredient): TemplateResult {
    const notePage = this.notes.value.value;
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
  }

  render() {
    const item = this.ingredient.value.value;
    if (item === undefined) {
      return waiting(this.state, text('title.ingredient'), 'lines');
    }
    return html`
      ${heroView(item)} ${this.actionsView(item)} ${this.aboutView(item)} ${shelfView(item)} ${this.usedView(item)}
      ${this.notesView(item)} ${this.noteSheet(item)}
    `;
  }
}

View.register(tag, IngredientScreen);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: IngredientScreen;
  }
}
