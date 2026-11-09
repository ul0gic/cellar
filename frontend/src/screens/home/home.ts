import type { BottleSummary, BuyNextItem, Home, Job, RecipeSummary, ShoppingListItem } from '@cellar/contract';
import { html, nothing, render, type TemplateResult } from '@lightstart/light/html';
import { call } from '../../app/api.ts';
import { eventChecked } from '../../app/events.ts';
import { watch } from '../../app/load.ts';
import { actionFailed } from '../../app/problems.ts';
import { invalidate, resourceFor } from '../../app/resources.ts';
import { href } from '../../app/router.ts';
import { setAppBar } from '../../app/shell.ts';
import type { ScreenContext, SessionPerson } from '../../app/types.ts';
import { plateForGlass } from '../../design-system/cl-plate.ts';
import { takeFirstArrival } from '../../design-system/motion.ts';
import { skeleton } from '../../design-system/skeleton.ts';
import { thumbHashDataUrl } from '../../design-system/thumbhash.ts';
import { toast } from '../../design-system/toast.ts';
import { formatNumber } from '../../text/format.ts';
import { text } from '../../text/index.ts';
import { followJob, jobProgress } from '../settings/parts/job.ts';
import { loadFailed } from '../settings/parts/load-failed.ts';
import './home.css';

const COLLAGE_SIZE = 3;
const SHELF_STRIP_SIZE = 8;
const SHOPPING_PREVIEW_SIZE = 3;
const EMPTY_PLATES = ['coupe', 'rocks', 'highball'] as const;

function collage(recipes: readonly RecipeSummary[], settle: boolean): TemplateResult {
  const tiles =
    recipes.length === 0
      ? EMPTY_PLATES.map((kind) => html`<div><cl-plate kind=${kind} name=${text('app.name')}></cl-plate></div>`)
      : recipes.slice(0, COLLAGE_SIZE).map(
          (recipe) =>
            html`<div>
              ${
                recipe.image === null
                  ? html`<cl-plate kind=${plateForGlass(recipe.glass?.name ?? null)} name=${recipe.name}></cl-plate>`
                  : html`<lc-image
                      src=${recipe.image.url}
                      alt=${text('photo.of', { name: recipe.name })}
                      placeholder=${recipe.image.thumbhash === null ? nothing : thumbHashDataUrl(recipe.image.thumbhash)}
                    ></lc-image>`
              }
            </div>`,
        );
  return html`<div class=${settle ? 'cl-collage cl-settle' : 'cl-collage'}>${tiles}</div>`;
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

export function screen(ctx: ScreenContext): HTMLElement {
  const element = document.createElement('section');
  element.className = 'cl-home';
  const arrival = takeFirstArrival();
  if (arrival) {
    element.classList.add('cl-arrive');
  }
  const home = resourceFor('getHome', {}, { tags: ['shelf', 'recipes', 'shopping', 'menus', 'wishlists'] });
  const top = resourceFor(
    'listRecipes',
    { query: { status: 'can_make', sort: 'rating', order: 'desc', pageSize: COLLAGE_SIZE } },
    { tags: ['recipes', 'shelf'] },
  );
  const anyRecipes = resourceFor(
    'listRecipes',
    { query: { sort: 'rating', order: 'desc', pageSize: COLLAGE_SIZE } },
    { tags: ['recipes'] },
  );
  const bottles = resourceFor(
    'listBottles',
    { query: { status: ['sealed', 'open'], sort: 'added', order: 'desc', pageSize: SHELF_STRIP_SIZE } },
    { tags: ['shelf'] },
  );
  const shopping = resourceFor('getShoppingList', {}, { tags: ['shopping'] });
  const owner = ctx.person.current()?.person.role === 'owner';
  const notifications = owner ? resourceFor('listNotifications', {}, { tags: ['settings'] }) : null;
  const added = new Set<number>();
  let catalogJob: Job | null = null;

  const addToList = async (item: BuyNextItem): Promise<void> => {
    try {
      await call('addToShoppingList', { body: { items: [{ ingredientId: item.ingredient.id }] } });
      added.add(item.ingredient.id);
      invalidate('shopping');
      redraw();
    } catch (error) {
      actionFailed(error, () => void addToList(item));
    }
  };

  const checkOff = async (item: ShoppingListItem): Promise<void> => {
    try {
      await call('checkOffShoppingItem', { params: { id: item.id } });
      invalidate('shopping');
      toast({
        title: text('home.gotIt', { name: item.ingredient.name }),
        action: { label: text('toast.undo'), run: () => void undoCheckOff(item) },
      });
    } catch (error) {
      actionFailed(error, () => void checkOff(item));
    }
  };

  const undoCheckOff = async (item: ShoppingListItem): Promise<void> => {
    try {
      await call('addToShoppingList', { body: { items: [{ ingredientId: item.ingredient.id, count: item.count }] } });
      invalidate('shopping');
      toast({ title: text('toast.undone') });
    } catch (error) {
      actionFailed(error, () => void undoCheckOff(item));
    }
  };

  const loadCatalog = async (): Promise<void> => {
    try {
      const finished = await followJob(
        await call('loadCatalog', {}),
        (job) => {
          catalogJob = job;
          redraw();
        },
        () => element.isConnected,
      );
      catalogJob = null;
      if (finished?.state === 'succeeded') {
        await ctx.person.refresh();
        invalidate('recipes', 'ingredients', 'shelf', 'settings');
      } else if (finished !== null) {
        toast({ title: finished.error?.detail ?? text('home.catalogFailed'), variant: 'error' });
      }
    } catch (error) {
      catalogJob = null;
      actionFailed(error, () => void loadCatalog());
    }
    redraw();
  };

  const hero = (data: Home, session: SessionPerson, empty: boolean): TemplateResult => {
    const recipes = top.peek()?.items ?? [];
    const pictured = recipes.length > 0 ? recipes : (anyRecipes.peek()?.items ?? []);
    const missingOne = top.peek()?.facets.missing1 ?? 0;
    const catalogMissing = !session.household.catalogLoaded;
    return html`<div class="cl-hero">
      ${collage(pictured, arrival)}
      <div class="cl-hero-top">
        <span class="cl-wordmark cl-hero-mark"><span class="cl-mark" aria-hidden="true"></span>${text('app.name')}</span>
        <span class="cl-hero-actions">
          <a class="cl-hero-button" href=${href('/search')} aria-label=${text('nav.search')}
            ><lc-icon name="search" aria-hidden="true"></lc-icon
          ></a>
          <a class="cl-hero-avatar" href=${href('/settings/profile')}
            ><lc-avatar name=${session.person.name} src=${session.person.avatar?.url ?? nothing}></lc-avatar
            ><span class="cl-vh">${text('nav.account', { name: session.person.name })}</span></a
          >
        </span>
      </div>
      <div class="cl-canmake">
        ${
          empty
            ? html`<cl-figure
                size="hero"
                value=${data.canMake.total}
                label=${catalogMissing ? text('home.noCatalogLabel') : text('home.emptyLabel')}
                .countUp=${arrival}
              ></cl-figure>`
            : html`<cl-figure
                size="hero"
                value=${data.canMake.count}
                label=${text('home.canMakeLabel')}
                .countUp=${arrival}
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
  };

  const catalogNotice = (): TemplateResult | typeof nothing => {
    const update = notifications?.peek()?.notifications.find((note) => note.kind === 'catalog_update_available');
    if (update === undefined || update.version === null) {
      return nothing;
    }
    return html`<lc-alert class="cl-home-notice" variant="info" title=${text('home.updateTitle')}>
      ${text('home.updateBody', { version: update.version })}
      <div class="cl-banner-actions">
        <lc-button variant="quiet" href=${href('/settings/catalog')}>${text('home.updateSee')}</lc-button>
      </div>
    </lc-alert>`;
  };

  const liveCard = (data: Home): TemplateResult | typeof nothing =>
    data.liveMenu === null
      ? nothing
      : html`<cl-live-card
          class="cl-rise"
          style="--i:0"
          name=${data.liveMenu.name}
          drinks=${data.liveMenu.itemCount}
          href=${`/menus/${data.liveMenu.id}`}
        ></cl-live-card>`;

  const buyNext = (data: Home): TemplateResult | typeof nothing =>
    data.buyNext.length === 0
      ? nothing
      : html`<section class="cl-home-section cl-rise" style="--i:1" aria-labelledby="home-buy-next">
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
                @click=${() => void addToList(item)}
              >
                <lc-icon name=${listed ? 'check' : 'plus'} aria-hidden="true"></lc-icon>
              </lc-button>
            </div>`;
          })}
        </section>`;

  const shoppingPanel = (index: number): TemplateResult => {
    const items = shopping.peek()?.items ?? [];
    const rest = items.length - SHOPPING_PREVIEW_SIZE;
    return html`<section class="cl-home-section cl-rise" style=${`--i:${index}`} aria-labelledby="home-shopping">
      <div class="cl-section-head">
        <h2 class="cl-section-title" id="home-shopping">${text('nav.shoppingList')}</h2>
        ${items.length > 0 ? html`<span class="cl-section-count">${text('home.items', { count: formatNumber(items.length) })}</span>` : nothing}
      </div>
      <div class="cl-home-panel">
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
                        void checkOff(item);
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
  };

  const shelfStrip = (): TemplateResult | typeof nothing => {
    const page = bottles.peek();
    if (page === undefined || page.items.length === 0) {
      return nothing;
    }
    return html`<section class="cl-home-section cl-rise" style="--i:3" aria-labelledby="home-shelf">
      <div class="cl-section-head">
        <h2 class="cl-section-title" id="home-shelf">${text('home.latest')}</h2>
        <a class="cl-standalone-link" href=${href('/shelf')}>${text('home.bottles', { count: formatNumber(page.total) })}</a>
      </div>
      <lc-scroller class="cl-strip">${page.items.map(bottleTile)}</lc-scroller>
    </section>`;
  };

  const startHere = (session: SessionPerson): TemplateResult => {
    const catalogMissing = !session.household.catalogLoaded;
    const ownerName = session.person.role === 'owner';
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
                    catalogJob !== null
                      ? jobProgress(catalogJob, text('home.catalogLoading'))
                      : ownerName
                        ? html`<lc-button variant="primary" @click=${() => void loadCatalog()}>
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
  };

  const ready = (data: Home, session: SessionPerson): TemplateResult => {
    const empty = !session.household.catalogLoaded || (data.canMake.count === 0 && bottles.peek()?.total === 0);
    if (empty) {
      return html`${hero(data, session, true)}
        <div class="cl-home-grid">
          ${startHere(session)}
          <div class="cl-stack">${shoppingPanel(2)}</div>
        </div>`;
    }
    return html`${hero(data, session, false)} ${catalogNotice()}
      <div class="cl-home-grid">
        <div class="cl-stack">${liveCard(data)}${buyNext(data)}</div>
        <div class="cl-stack">${shoppingPanel(2)}${shelfStrip()}</div>
      </div>`;
  };

  const resources = [home, top, anyRecipes, bottles, shopping, ...(notifications === null ? [] : [notifications])];
  const { redraw } = watch(element, resources, ({ phase, retry }) => {
    const session = ctx.person.current();
    const data = home.peek();
    if (phase === 'failed') {
      render(loadFailed(text('title.home'), retry), element);
      return;
    }
    if (phase === 'slow') {
      render(html`${skeleton('figure', text('title.home'))}${skeleton('rows', text('title.home'))}`, element);
      return;
    }
    if (phase !== 'ready' || session === null || data === undefined) {
      return;
    }
    render(ready(data, session), element);
  });
  setAppBar({ hidden: true });
  return element;
}
