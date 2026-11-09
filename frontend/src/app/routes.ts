import { type TextKey, text } from '../text/index.ts';
import { FALLBACK_PATH, LOST_PATH } from './router.ts';
import type { RouteDef, RouteParams, ScreenKey, ShellKind } from './types.ts';

function page(
  path: string,
  screen: ScreenKey,
  title: TextKey | ((params: RouteParams) => string),
  shell: ShellKind = 'tabs',
  access: RouteDef['access'] = 'session',
): RouteDef {
  return { path, screen, title: typeof title === 'string' ? text(title) : title, shell, access };
}

export interface SettingsPage {
  readonly slug: string;
  readonly label: TextKey;
  readonly group: 'you' | 'household' | 'install';
  readonly ownerOnly: boolean;
}

export const SETTINGS_PAGES: readonly SettingsPage[] = [
  { slug: 'profile', label: 'settings.profile', group: 'you', ownerOnly: false },
  { slug: 'tokens', label: 'settings.tokens', group: 'you', ownerOnly: false },
  { slug: 'members', label: 'settings.members', group: 'household', ownerOnly: false },
  { slug: 'signin', label: 'settings.signin', group: 'household', ownerOnly: true },
  { slug: 'substitutions', label: 'settings.substitutions', group: 'household', ownerOnly: false },
  { slug: 'taste-words', label: 'settings.tasteWords', group: 'household', ownerOnly: true },
  { slug: 'taxonomy', label: 'settings.taxonomy', group: 'household', ownerOnly: true },
  { slug: 'catalog', label: 'settings.catalog', group: 'install', ownerOnly: true },
  { slug: 'ai', label: 'settings.ai', group: 'install', ownerOnly: true },
  { slug: 'backup', label: 'settings.backup', group: 'install', ownerOnly: true },
  { slug: 'about', label: 'settings.about', group: 'install', ownerOnly: false },
];

export const settingsPath = (slug: string): string => `/settings/${slug}`;

export const routes: readonly RouteDef[] = [
  page('/setup', 'setup/setup', 'title.setup', 'bare', 'public'),
  page('/who', 'login/who', 'title.who', 'bare', 'public'),
  page('/login', 'login/login', 'title.login', 'bare', 'public'),
  page('/login/new-password', 'login/new-password', 'title.newPassword', 'bare', 'public'),
  page('/', 'home/home', 'title.home'),
  page('/recipes', 'recipes/list', 'nav.recipes'),
  page('/recipes/new', 'recipes/form', 'title.newRecipe', 'bare'),
  page('/recipes/:id', 'recipes/recipe', 'title.recipe', 'bare'),
  page('/recipes/:id/edit', 'recipes/form', 'title.editRecipe', 'bare'),
  page('/recipes/:id/print', 'print/recipe', 'title.print', 'print'),
  page('/ingredients', 'ingredients/tree', 'nav.ingredients'),
  page('/ingredients/new', 'ingredients/form', 'title.newIngredient'),
  page('/ingredients/:id', 'ingredients/ingredient', 'title.ingredient'),
  page('/ingredients/:id/edit', 'ingredients/form', 'title.editIngredient'),
  page('/shelf', 'shelf/shelf', 'nav.shelf'),
  page('/shelf/history', 'history/history', 'nav.history'),
  page('/list', 'shopping/list', 'nav.shoppingList'),
  page('/list/print', 'print/shopping', 'title.print', 'print'),
  page('/wishlists', 'wishlists/wishlists', 'nav.wishlists'),
  page('/collections', 'collections/list', 'nav.collections'),
  page('/collections/:id', 'collections/collection', 'title.collection'),
  page('/party', 'party/party', 'nav.party'),
  page('/party/print', 'print/party', 'title.print', 'print'),
  page('/calculators', 'calculators/list', 'nav.calculators'),
  page('/calculators/:id', 'calculators/calculator', 'title.calculator'),
  page('/menus', 'menus/list', 'nav.menus'),
  page('/menus/:id', 'menus/editor', 'title.menu'),
  page('/stats', 'stats/stats', 'nav.stats'),
  page('/import', 'import-export/index', 'nav.importExport'),
  page('/import/:tab', 'import-export/index', 'nav.importExport'),
  page('/more', 'settings/compact', 'nav.more'),
  ...SETTINGS_PAGES.map((settings) => page(settingsPath(settings.slug), `settings/${settings.slug}`, settings.label)),
  page('/settings/about/licenses', 'settings/licenses', 'settings.licenses'),
  page(LOST_PATH, 'launch/lost', (params) => params.screen ?? text('app.name')),
  page(FALLBACK_PATH, 'launch/not-found', 'notFound.screen', 'tabs', 'public'),
];
