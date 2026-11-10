import type { BottleSummary, BuyNextItem, Home, Job, RecipeSummary, ShoppingListItem } from '@cellar/contract';
import View from '@lightstart/light';
import { html, nothing, type TemplateResult } from '@lightstart/light/html';
import { signal } from '@lightstart/light/signals';
import { call } from '../../app/api.ts';
import { session } from '../../app/controllers/session.ts';
import { eventChecked } from '../../app/events.ts';
import { loadState } from '../../app/load.ts';
import { actionFailed } from '../../app/problems.ts';
import { apiResource, dataChanged } from '../../app/resources.ts';
import { href } from '../../app/router.ts';
import { setAppBar } from '../../app/shell.ts';
import type { SessionPerson } from '../../app/types.ts';
import { plateForGlass } from '../../design-system/cl-plate.ts';
import { loadFailed } from '../../design-system/load-view.ts';
import { takeFirstArrival } from '../../design-system/motion.ts';
import { skeleton } from '../../design-system/skeleton.ts';
import { thumbHashDataUrl, thumbHashLuma } from '../../design-system/thumbhash.ts';
import { toast } from '../../design-system/toast.ts';
import { formatNumber } from '../../text/format.ts';
import { text } from '../../text/index.ts';
import { followJob, jobProgress } from '../settings/parts/job.ts';
import '../../design-system/cl-figure.ts';
import '../../design-system/cl-live-card.ts';
import '../../design-system/lc/alert.ts';
import '../../design-system/lc/button.ts';
import '../../design-system/lc/checkbox.ts';
import '../../design-system/lc/icon.ts';
import '../../design-system/lc/image.ts';
import '../../design-system/lc/scroller.ts';
import './home.css';

export const tag = 'cl-screen-home';

const COLLAGE_SIZE = 3;
const HERO_POOL = 24;
const HERO_MAX_LUMA = 0.6;
const MORNING_FROM_HOUR = 5;
const AFTERNOON_FROM_HOUR = 12;
const EVENING_FROM_HOUR = 17;
const SHELF_STRIP_SIZE = 8;
const SHOPPING_PREVIEW_SIZE = 3;
const EMPTY_PLATES = ['coupe', 'rocks', 'highball'] as const;

function collage(recipes: readonly RecipeSummary[], settle: boolean): TemplateResult {
  const tiles =
    recipes.length === 0
      ? EMPTY_PLATES.map((kind) => html`<div><cl-plate kind=${kind} name=${text('app.name')}></cl-plate></div>`)
      : recipes.slice(0, COLLAGE_SIZE).map(
          (recipe) =>
            html`<a href=${href(`/recipes/${recipe.id}`)}>
              ${
                recipe.image === null
                  ? html`<cl-plate kind=${plateForGlass(recipe.glass?.name ?? null)} name=${recipe.name}></cl-plate>`
                  : html`<lc-image
                      src=${recipe.image.url}
                      alt=${text('photo.of', { name: recipe.name })}
                      placeholder=${recipe.image.thumbhash === null ? nothing : thumbHashDataUrl(recipe.image.thumbhash)}
                    ></lc-image>`
              }
            </a>`,
        );
  return html`<div class=${settle ? 'cl-collage cl-settle' : 'cl-collage'}>${tiles}</div>`;
}

function greeting(name: string, now: Date): string {
  const hour = now.getHours();
  if (hour >= MORNING_FROM_HOUR && hour < AFTERNOON_FROM_HOUR) {
    return text('home.greetMorning', { name });
  }
  if (hour >= AFTERNOON_FROM_HOUR && hour < EVENING_FROM_HOUR) {
    return text('home.greetAfternoon', { name });
  }
  return text('home.greetEvening', { name });
}

function darkPhotosFirst(recipes: readonly RecipeSummary[]): RecipeSummary[] {
  const dark = (recipe: RecipeSummary): boolean => {
    const hash = recipe.image?.thumbhash ?? null;
    return hash !== null && thumbHashLuma(hash) <= HERO_MAX_LUMA;
  };
  return [...recipes.filter(dark), ...recipes.filter((recipe) => !dark(recipe))];
}

function bottleTile(bottle: BottleSummary): TemplateResult {
  const status = bottle.status === 'open' ? text('bulb.open') : text('bulb.sealed');
  return html`<a class="cl-bottle-tile" href=${href(`/shelf?bottle=${bottle.id}`)}>
    <span class="cl-bottle-photo">
      ${
        bottle.image === null
          ? html`<cl-plate kind="bottle" name=${bottle.name}></cl-plate>`
          : html`<lc-image
              src=${bottle.image.url}
              alt=${text('photo.of', { name: bottle.name })}
              placeholder=${bottle.image.thumbhash === null ? nothing : thumbHashDataUrl(bottle.image.thumbhash)}
            ></lc-image>`
      }
    </span>
    <span class="cl-bottle-name">${bottle.name}</span>
    <span class="cl-bottle-size">${text('home.bottleSize', { status, size: bottle.labeledSize })}</span>
  </a>`;
}

class HomeScreen extends View {
  readonly arrival = takeFirstArrival();
  readonly owner = session.current.peek()?.person.role === 'owner';
  readonly home = apiResource('getHome', ['shelf', 'recipes', 'shopping', 'menus', 'wishlists']);
  readonly top = apiResource('listRecipes', ['recipes', 'shelf']);
  readonly anyRecipes = apiResource('listRecipes', ['recipes']);
  readonly bottles = apiResource('listBottles', ['shelf']);
  readonly shopping = apiResource('getShoppingList', ['shopping']);
  readonly notifications = apiResource('listNotifications', ['settings']);
  readonly state = loadState([
    this.home,
    this.top,
    this.anyRecipes,
    this.bottles,
    this.shopping,
    ...(this.owner ? [this.notifications] : []),
  ]);
  readonly added = signal<ReadonlySet<number>>(new Set());
  readonly catalogJob = signal<Job | null>(null);

  connected(): void {
    this.classList.add('cl-home');
    if (this.arrival) {
      this.classList.add('cl-arrive');
    }
    setAppBar({ hidden: true });
    this.home.bind(this, {});
    this.top.bind(this, { query: { status: 'can_make', sort: 'rating', order: 'desc', pageSize: HERO_POOL } });
    this.anyRecipes.bind(this, { query: { sort: 'rating', order: 'desc', pageSize: HERO_POOL } });
    this.bottles.bind(this, {
      query: { status: ['sealed', 'open'], sort: 'added', order: 'desc', pageSize: SHELF_STRIP_SIZE },
    });
    this.shopping.bind(this, {});
    if (this.owner) {
      this.notifications.bind(this, {});
    }
  }

  private async addToList(item: BuyNextItem): Promise<void> {
    try {
      await call('addToShoppingList', { body: { items: [{ ingredientId: item.ingredient.id }] } });
      dataChanged('shopping');
      if (this.isConnected) {
        this.added.value = new Set(this.added.peek()).add(item.ingredient.id);
      }
    } catch (error) {
      actionFailed(error, () => void this.addToList(item));
    }
  }

  private async checkOff(item: ShoppingListItem): Promise<void> {
    try {
      await call('checkOffShoppingItem', { params: { id: item.id } });
      dataChanged('shopping');
      toast({
        title: text('home.gotIt', { name: item.ingredient.name }),
        action: { label: text('toast.undo'), run: () => void this.undoCheckOff(item) },
      });
    } catch (error) {
      actionFailed(error, () => void this.checkOff(item));
    }
  }

  private async undoCheckOff(item: ShoppingListItem): Promise<void> {
    try {
      await call('addToShoppingList', { body: { items: [{ ingredientId: item.ingredient.id, count: item.count }] } });
      dataChanged('shopping');
      toast({ title: text('toast.undone') });
    } catch (error) {
      actionFailed(error, () => void this.undoCheckOff(item));
    }
  }

  private async loadCatalog(): Promise<void> {
    try {
      const finished = await followJob(
        await call('loadCatalog', {}),
        (job) => {
          if (this.isConnected) {
            this.catalogJob.value = job;
          }
        },
        () => this.isConnected,
      );
      if (this.isConnected) {
        this.catalogJob.value = null;
      }
      if (finished?.state === 'succeeded') {
        await session.refresh();
        dataChanged('recipes', 'ingredients', 'shelf', 'settings');
      } else if (finished !== null) {
        toast({ title: finished.error?.detail ?? text('home.catalogFailed'), variant: 'error' });
      }
    } catch (error) {
      if (this.isConnected) {
        this.catalogJob.value = null;
      }
      actionFailed(error, () => void this.loadCatalog());
    }
  }

  private hero(data: Home, person: SessionPerson, empty: boolean): TemplateResult {
    const recipes = this.top.value.value?.items ?? [];
    const pictured = darkPhotosFirst(recipes.length > 0 ? recipes : (this.anyRecipes.value.value?.items ?? []));
    const missingOne = this.top.value.value?.facets.missing1 ?? 0;
    const catalogMissing = !person.household.catalogLoaded;
    return html`<div class="cl-hero">
      ${collage(pictured, this.arrival)}
      <div class="cl-hero-top">
        <span class="cl-wordmark cl-hero-mark"><span class="cl-mark" aria-hidden="true"></span>${text('app.name')}</span>
        <span class="cl-hero-actions">
          <a class="cl-hero-button" href=${href('/search')} aria-label=${text('nav.search')}
            ><lc-icon name="search" aria-hidden="true"></lc-icon
          ></a>
          <a class="cl-hero-account" href=${href('/settings/profile')}
            ><lc-icon name="user-round" aria-hidden="true"></lc-icon
            ><span class="cl-vh">${text('nav.account', { name: person.person.name })}</span></a
          >
        </span>
      </div>
      <div class="cl-canmake">
        <p class="cl-canmake-greeting">${greeting(person.person.name, new Date())}</p>
        ${
          empty
            ? html`<cl-figure
                size="hero"
                value=${data.canMake.total}
                label=${catalogMissing ? text('home.noCatalogLabel') : text('home.emptyLabel')}
                ?count-up=${this.arrival}
              ></cl-figure>`
            : html`<cl-figure
                size="hero"
                value=${data.canMake.count}
                label=${text('home.canMakeLabel')}
                ?count-up=${this.arrival}
              >
                ${
                  missingOne > 0
                    ? html`<a class="cl-standalone-link" href=${href('/recipes?status=missing-1')}
                        >${text('home.missingOne', { count: formatNumber(missingOne) })}<lc-icon
                          name="chevron-right"
                          aria-hidden="true"
                        ></lc-icon
                      ></a>`
                    : nothing
                }
              </cl-figure>`
        }
      </div>
    </div>`;
  }

  private catalogNotice(): TemplateResult | typeof nothing {
    const update = this.notifications.value.value?.notifications.find(
      (note) => note.kind === 'catalog_update_available',
    );
    if (update === undefined || update.version === null) {
      return nothing;
    }
    return html`<lc-alert class="cl-home-notice" variant="info" title=${text('home.updateTitle')}>
      ${text('home.updateBody', { version: update.version })}
      <div class="cl-banner-actions">
        <lc-button variant="quiet" href=${href('/settings/catalog')}>${text('home.updateSee')}</lc-button>
      </div>
    </lc-alert>`;
  }

  private liveCard(data: Home): TemplateResult | typeof nothing {
    return data.liveMenu === null
      ? nothing
      : html`<cl-live-card
          class="cl-rise"
          style="--i:0"
          name=${data.liveMenu.name}
          drinks=${data.liveMenu.itemCount}
          href=${`/menus/${data.liveMenu.id}`}
        ></cl-live-card>`;
  }

  private buyNext(data: Home): TemplateResult | typeof nothing {
    if (data.buyNext.length === 0) {
      return nothing;
    }
    const added = this.added.value;
    return html`<section class="cl-home-section cl-rise" style="--i:1" aria-labelledby="home-buy-next">
      <div class="cl-section-head">
        <h2 class="cl-section-title" id="home-buy-next">${text('home.buyNext')}</h2>
        <a class="cl-standalone-link" href=${href('/stats')}>${text('home.buyNextAll')}</a>
      </div>
      ${data.buyNext.map((item) => {
        const listed = added.has(item.ingredient.id);
        return html`<div class="cl-buy-row">
          <p class="cl-buy-count">+${formatNumber(item.unlocks)}<small>${text('home.drinks')}</small></p>
          <div class="cl-buy-what">
            <p class="cl-buy-name">${item.ingredient.name}</p>
            <p class="cl-buy-unlocks">${item.recipes.map((recipe) => recipe.name).join(', ')}</p>
          </div>
          <lc-button
            class="cl-buy-add"
            variant="quiet"
            icon-only
            aria-label=${listed ? text('home.onList') : text('home.addToList', { name: item.ingredient.name })}
            ?disabled=${listed}
            @click=${() => void this.addToList(item)}
          >
            <lc-icon name=${listed ? 'check' : 'plus'} aria-hidden="true"></lc-icon>
          </lc-button>
        </div>`;
      })}
    </section>`;
  }

  private shoppingPanel(index: number): TemplateResult {
    const items = this.shopping.value.value?.items ?? [];
    const rest = items.length - SHOPPING_PREVIEW_SIZE;
    return html`<section class="cl-home-section cl-rise" style=${`--i:${index}`} aria-labelledby="home-shopping">
      <div class="cl-section-head">
        <h2 class="cl-section-title" id="home-shopping">${text('nav.shoppingList')}</h2>
        ${
          items.length === 0
            ? nothing
            : html`<span class="cl-section-count"
                >${items.length === 1 ? text('home.itemsOne') : text('home.items', { count: formatNumber(items.length) })}</span
              >`
        }
      </div>
      <div class=${items.length === 0 ? 'cl-home-panel cl-home-panel-empty' : 'cl-home-panel'}>
        ${
          items.length === 0
            ? html`<p class="cl-home-muted">${text('home.listEmpty')}</p>`
            : html`${items.slice(0, SHOPPING_PREVIEW_SIZE).map(
                (item) => html`<div class="cl-list-item">
                  <lc-checkbox
                    shape="round"
                    label=${item.ingredient.name}
                    @change=${(event: Event) => {
                      if (eventChecked(event)) {
                        void this.checkOff(item);
                      }
                    }}
                  ></lc-checkbox>
                  ${item.addedBy === null ? nothing : html`<span class="cl-list-who">${text('home.addedBy', { name: item.addedBy.name })}</span>`}
                  <span class="cl-list-qty">${formatNumber(item.count)}</span>
                </div>`,
              )}
              <a class="cl-standalone-link" href=${href('/list')}
                >${rest > 0 ? text('home.openListMore', { count: formatNumber(rest) }) : text('home.openList')}<lc-icon
                  name="chevron-right"
                  aria-hidden="true"
                ></lc-icon
              ></a>`
        }
      </div>
    </section>`;
  }

  private shelfStrip(): TemplateResult | typeof nothing {
    const page = this.bottles.value.value;
    if (page === undefined || page.items.length === 0) {
      return nothing;
    }
    return html`<section class="cl-home-section cl-rise" style="--i:3" aria-labelledby="home-shelf">
      <div class="cl-section-head">
        <h2 class="cl-section-title" id="home-shelf">${text('home.latest')}</h2>
        <a class="cl-standalone-link" href=${href('/shelf')}>${page.total === 1 ? text('home.bottlesOne') : text('home.bottles', { count: formatNumber(page.total) })}</a>
      </div>
      <lc-scroller class="cl-strip">${page.items.map(bottleTile)}</lc-scroller>
    </section>`;
  }

  private startHere(person: SessionPerson): TemplateResult {
    const catalogMissing = !person.household.catalogLoaded;
    const ownerName = person.person.role === 'owner';
    const job = this.catalogJob.value;
    return html`<section class="cl-home-section" aria-labelledby="home-start">
      <div class="cl-section-head"><h2 class="cl-section-title" id="home-start">${text('home.startHere')}</h2></div>
      <ol class="cl-steps">
        ${
          catalogMissing
            ? html`<li>
                <div>
                  <b>${text('home.stepCatalog')}</b>
                  <p>${text('home.stepCatalogBody')}</p>
                  ${
                    job !== null
                      ? jobProgress(job, text('home.catalogLoading'))
                      : ownerName
                        ? html`<lc-button variant="primary" @click=${() => void this.loadCatalog()}>
                            <lc-icon name="book-open" aria-hidden="true"></lc-icon>${text('home.loadCatalog')}
                          </lc-button>`
                        : html`<p>${text('home.askOwner')}</p>`
                  }
                </div>
              </li>`
            : nothing
        }
        <li>
          <div>
            <b>${text('home.stepBottles')}</b>
            <p>${text('home.stepBottlesBody')}</p>
            <span class="cl-step-actions">
              <lc-button variant="primary" href=${href('/shelf?add=1')}
                ><lc-icon name="plus" aria-hidden="true"></lc-icon>${text('home.addBottles')}</lc-button
              >
              <lc-button variant="quiet" href=${href('/import')}
                ><lc-icon name="file-spreadsheet" aria-hidden="true"></lc-icon>${text('home.importCsv')}</lc-button
              >
            </span>
          </div>
        </li>
        <li>
          <div>
            <b>${text('home.stepFresh')}</b>
            <p>${text('home.stepFreshBody')}</p>
            <lc-button variant="quiet" href=${href('/ingredients')}>${text('home.openIngredients')}</lc-button>
          </div>
        </li>
        <li>
          <div>
            <b>${text('home.stepSee')}</b>
            <p>${text('home.stepSeeBody')}</p>
          </div>
        </li>
      </ol>
    </section>`;
  }

  private ready(data: Home, person: SessionPerson): TemplateResult {
    const empty =
      !person.household.catalogLoaded || (data.canMake.count === 0 && this.bottles.value.value?.total === 0);
    if (empty) {
      return html`${this.hero(data, person, true)}
        <div class="cl-home-grid">
          ${this.startHere(person)}
          <div class="cl-stack">${this.shoppingPanel(2)}</div>
        </div>`;
    }
    return html`${this.hero(data, person, false)} ${this.catalogNotice()}
      <div class="cl-home-grid">
        <div class="cl-stack">${this.liveCard(data)}${this.buyNext(data)}</div>
        <div class="cl-stack">${this.shoppingPanel(2)}${this.shelfStrip()}</div>
      </div>`;
  }

  render() {
    const person = session.current.value;
    const data = this.home.value.value;
    switch (this.state.phase.value) {
      case 'failed':
        return loadFailed(text('title.home'), this.state.retry, 'refresh');
      case 'slow':
        return html`${skeleton('figure', text('title.home'))}${skeleton('rows', text('title.home'))}`;
      case 'ready':
        return person === null || data === undefined ? nothing : this.ready(data, person);
      case 'loading':
        return nothing;
    }
  }
}

View.register(tag, HomeScreen);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: HomeScreen;
  }
}
