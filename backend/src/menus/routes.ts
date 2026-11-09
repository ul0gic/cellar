import { type Id, LIMITS } from '@cellar/contract';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AppContext } from '../core/context.ts';
import { problem } from '../core/problems.ts';
import { route } from '../core/route.ts';
import { registerDisplayAssets } from './display/assets.ts';
import { gzipped } from './display/compress.ts';
import { type DisplayItem, type DisplayMenu, renderDisplayPage } from './display/page.ts';
import { renderNotLivePage } from './display/not-live.ts';
import { renderRecipePage } from './display/recipe-page.ts';
import { displayVersion } from './state.ts';
import {
  addMakeable,
  copyMenu,
  createMenu,
  deleteMenu,
  displayRecipe,
  displayUnit,
  endMenu,
  type LiveMenu,
  listMenus,
  loadMenu,
  loadSections,
  liveMenuFor,
  makeMenuLive,
  menuPath,
  replaceMenu,
  rotateMenuLink,
} from './store.ts';

const PAGE_HEADERS = {
  'Content-Security-Policy':
    "default-src 'none'; style-src 'self'; script-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
} as const;

interface DisplayModel {
  readonly menu: DisplayMenu;
  readonly shownItemIds: readonly Id[];
  readonly shownRecipeIds: ReadonlySet<Id>;
}

function displayModel(ctx: AppContext, live: LiveMenu): DisplayModel {
  const shownItemIds: Id[] = [];
  const shownRecipeIds = new Set<Id>();
  const sections = loadSections(ctx, live.id).flatMap((section) => {
    const items: DisplayItem[] = [];
    for (const item of section.items) {
      if (item.hideWhenUnavailable && !item.available) {
        continue;
      }
      shownItemIds.push(item.id);
      if (item.kind === 'recipe') {
        shownRecipeIds.add(item.recipe.id);
        items.push({
          kind: 'recipe',
          recipeId: item.recipe.id,
          name: item.recipe.name,
          hostNote: item.hostNote,
          imageUrl: item.recipe.image?.url ?? null,
        });
      } else {
        items.push({
          kind: 'ingredient',
          name: item.ingredient.name,
          hostNote: item.hostNote,
          imageUrl: item.ingredient.image?.url ?? null,
        });
      }
    }
    return items.length === 0 ? [] : [{ name: section.name, items }];
  });
  return { menu: { name: live.name, date: live.date, sections }, shownItemIds, shownRecipeIds };
}

export function register(app: FastifyInstance, ctx: AppContext): void {
  const assetBase = `${ctx.settings.basePath}/m/_`;
  const assetVersion = registerDisplayAssets(app);
  const pageSize = (requested: number | undefined) => requested ?? LIMITS.pageSize.default;

  const notLive = (reply: FastifyReply): string => {
    reply.code(404);
    return renderNotLivePage(assetBase, assetVersion);
  };

  const showDisplay = (token: string, reply: FastifyReply): string => {
    reply.headers(PAGE_HEADERS);
    const live = liveMenuFor(ctx.db, token);
    if (live === null) {
      return notLive(reply);
    }
    const model = displayModel(ctx, live);
    return renderDisplayPage(model.menu, {
      assetBase,
      assetVersion,
      menuPath: menuPath(ctx, live.token),
      stateVersion: displayVersion(live.id, live.updatedAt, live.token, model.shownItemIds),
      today: ctx.now(),
    });
  };

  const showRecipe = (token: string, recipeId: Id, reply: FastifyReply): string => {
    reply.headers(PAGE_HEADERS);
    const live = liveMenuFor(ctx.db, token);
    if (live === null || !displayModel(ctx, live).shownRecipeIds.has(recipeId)) {
      return notLive(reply);
    }
    const recipe = displayRecipe(ctx, recipeId);
    if (recipe === null) {
      return notLive(reply);
    }
    return renderRecipePage(recipe, {
      assetBase,
      assetVersion,
      menuPath: menuPath(ctx, live.token),
      displayUnit: displayUnit(ctx.db),
    });
  };

  const displayState = (token: string, reply: FastifyReply): { version: string } => {
    reply.headers({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    const live = liveMenuFor(ctx.db, token);
    if (live === null) {
      throw problem('not_found');
    }
    const model = displayModel(ctx, live);
    return { version: displayVersion(live.id, live.updatedAt, live.token, model.shownItemIds) };
  };

  const withMenu = (id: Id, change: (id: Id) => void) => {
    change(id);
    return loadMenu(ctx, id);
  };

  const makeable = (id: Id, sectionIndex: number) => {
    const result = addMakeable(ctx, id, sectionIndex);
    return { ...result, menu: loadMenu(ctx, id) };
  };

  const remove = (id: Id): undefined => {
    deleteMenu(ctx, id);
  };

  route(app, 'listMenus', async (request) => listMenus(ctx, request.query.page ?? 1, pageSize(request.query.pageSize)));
  route(app, 'createMenu', async (request) => loadMenu(ctx, createMenu(ctx, request.body, request.person?.id ?? null)));
  route(app, 'getMenu', async (request) => loadMenu(ctx, request.params.id));
  route(app, 'replaceMenu', async (request) => withMenu(request.params.id, (id) => replaceMenu(ctx, id, request.body)));
  route(app, 'deleteMenu', async (request) => remove(request.params.id));
  route(app, 'copyMenu', async (request) =>
    loadMenu(ctx, copyMenu(ctx, request.params.id, request.body, request.person?.id ?? null)),
  );
  route(app, 'makeMenuLive', async (request) => withMenu(request.params.id, (id) => makeMenuLive(ctx, id)));
  route(app, 'endMenu', async (request) => withMenu(request.params.id, (id) => endMenu(ctx, id)));
  route(app, 'rotateMenuLink', async (request) => withMenu(request.params.id, (id) => rotateMenuLink(ctx, id)));
  route(app, 'addMakeableToMenu', async (request) => makeable(request.params.id, request.body.sectionIndex));
  route(app, 'showMenuDisplay', async (request, reply) =>
    gzipped(request, reply, showDisplay(request.params.token, reply)),
  );
  route(app, 'showMenuRecipe', async (request, reply) =>
    gzipped(request, reply, showRecipe(request.params.token, request.params.recipeId, reply)),
  );
  route(app, 'getMenuDisplayState', async (request, reply) => displayState(request.params.token, reply));
}
