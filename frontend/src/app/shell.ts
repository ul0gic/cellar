import type { LightElements } from '@lightstart/light/components/elements.js';
import { env } from '@lightstart/light/env';
import { navigation } from '@lightstart/light/navigation';
import { html, nothing, render, type TemplateResult } from '@lightstart/light/html';
import { prefersReducedMotion } from '../design-system/motion.ts';
import { type TextKey, text } from '../text/index.ts';
import { type AuthCode, ApiError, call, onAuthProblem, onReachabilityChange } from './api.ts';
import { person } from './person.ts';
import { hold, resourceFor } from './resources.ts';
import { FALLBACK_PATH, href, navigate, query, router } from './router.ts';
import { routes } from './routes.ts';
import { loadScreen } from './screens.ts';
import { chooseTheme } from './theme.ts';
import type { SessionPerson } from './types.ts';
import './shell.css';

type Dropdown = LightElements['lc-dropdown'];

export interface AppBarOptions {
  readonly back?: string;
  readonly hidden?: boolean;
  readonly actions?: readonly HTMLElement[];
}

interface NavLink {
  readonly path: string;
  readonly label: TextKey;
  readonly icon: string;
}

const WIDE_QUERY = '(min-width: 1024px)';

const TABS: readonly NavLink[] = [
  { path: '/', label: 'nav.home', icon: 'house' },
  { path: '/recipes', label: 'nav.recipes', icon: 'martini' },
  { path: '/shelf', label: 'nav.shelf', icon: 'wine' },
  { path: '/list', label: 'nav.list', icon: 'list-checks' },
  { path: '/more', label: 'nav.more', icon: 'ellipsis' },
];

const TOP_NAV: readonly NavLink[] = [
  { path: '/', label: 'nav.home', icon: 'house' },
  { path: '/recipes', label: 'nav.recipes', icon: 'martini' },
  { path: '/ingredients', label: 'nav.ingredients', icon: 'citrus' },
  { path: '/shelf', label: 'nav.shelf', icon: 'wine' },
  { path: '/list', label: 'nav.shoppingList', icon: 'list-checks' },
  { path: '/menus', label: 'nav.menus', icon: 'tv' },
  { path: '/wishlists', label: 'nav.wishlists', icon: 'gift' },
];

export const MORE_PAGES: readonly NavLink[] = [
  { path: '/collections', label: 'nav.collections', icon: 'folder-heart' },
  { path: '/party', label: 'nav.party', icon: 'scale' },
  { path: '/calculators', label: 'nav.calculators', icon: 'calculator' },
  { path: '/stats', label: 'nav.stats', icon: 'chart-column' },
  { path: '/shelf/history', label: 'nav.history', icon: 'history' },
  { path: '/import', label: 'nav.importExport', icon: 'upload' },
];

const wide = matchMedia(WIDE_QUERY);
const outlet = document.createElement('div');
outlet.className = 'cl-outlet';
let root: HTMLElement | null = null;
let appBar: AppBarOptions = {};
let started = false;
let shoppingCount = 0;
let menuLive = false;
let overlay: HTMLElement | null = null;
let searchDialog: HTMLElement | null = null;
let searchOpener: Element | null = null;
let pendingAuth: AuthCode | null = null;
const SIGN_IN_PATHS: readonly string[] = ['/setup', '/who', '/login', '/login/new-password'];
let countsWatched = false;

function appPath(): string {
  return navigation.path();
}

function isCurrent(path: string): boolean {
  const current = appPath();
  if (path === '/') {
    return current === '/';
  }
  if (path === '/shelf') {
    return current === '/shelf';
  }
  return current === path || current.startsWith(`${path}/`);
}

function tabIsCurrent(path: string): boolean {
  if (path !== '/more') {
    return isCurrent(path);
  }
  return !TABS.some((tab) => tab.path !== '/more' && isCurrent(tab.path));
}

export function setAppBar(options: AppBarOptions): void {
  appBar = options;
  draw();
}

function keycap(): string {
  return env.os === 'macos' || env.os === 'ios' ? '⌘ K' : 'Ctrl K';
}

export async function signOut(session: SessionPerson): Promise<void> {
  await call('logout', {});
  await person.refresh();
  navigate(session.requireLogin ? '/login' : '/who', { replace: true });
}

function openDropdown(event: MouseEvent, selector: string): void {
  const trigger = event.currentTarget;
  const menu = root?.querySelector<Dropdown>(selector);
  if (trigger instanceof Element && menu !== undefined && menu !== null) {
    menu.toggle(trigger);
  }
}

function topBar(session: SessionPerson): TemplateResult {
  const accountItems = [
    { label: text('nav.settings'), icon: 'sliders-horizontal', onClick: () => navigate('/settings/profile') },
    {
      label: session.requireLogin ? text('nav.signOut') : text('nav.switchPerson'),
      icon: 'log-out',
      onClick: () => void signOut(session),
    },
  ];
  const moreItems = MORE_PAGES.map((page) => ({
    label: text(page.label),
    icon: page.icon,
    onClick: () => navigate(page.path),
  }));
  return html`
    <a slot="brand" class="cl-wordmark" href=${href('/')}><span class="cl-mark" aria-hidden="true"></span>${text('app.name')}</a>
    <nav slot="start" class="cl-topnav" aria-label=${text('nav.main')}>
      ${TOP_NAV.map(
        (link) => html`<a href=${href(link.path)} aria-current=${isCurrent(link.path) ? 'page' : nothing}
          >${text(link.label)}${
            link.path === '/menus' && menuLive
              ? html`<cl-bulb size="dot" status="on" label=${text('nav.menuLive')}></cl-bulb>`
              : nothing
          }</a
        >`,
      )}
      <button
        type="button"
        class="cl-topnav-more"
        aria-haspopup="menu"
        aria-current=${MORE_PAGES.some((page) => isCurrent(page.path)) ? 'page' : nothing}
        @click=${(event: MouseEvent) => openDropdown(event, '.cl-more-menu')}
      >${text('nav.more')}<lc-icon name="chevron-down" aria-hidden="true"></lc-icon></button>
      <lc-dropdown class="cl-more-menu" aria-label=${text('nav.moreMenu')} .items=${moreItems}></lc-dropdown>
    </nav>
    <div slot="end" class="cl-topbar-end">
      <button type="button" class="cl-searchbox" @click=${() => void openSearch()}>
        <lc-icon name="search" aria-hidden="true"></lc-icon>
        <span>${text('nav.searchBox')}</span>
        <kbd>${keycap()}</kbd>
      </button>
      <button
        type="button"
        class="cl-avatar-button"
        aria-haspopup="menu"
        @click=${(event: MouseEvent) => openDropdown(event, '.cl-account-menu')}
      ><lc-avatar name=${session.person.name} src=${session.person.avatar?.url ?? nothing}></lc-avatar><span class="cl-vh">${text('nav.account', { name: session.person.name })}</span></button>
      <lc-dropdown class="cl-account-menu" .items=${accountItems}></lc-dropdown>
    </div>
  `;
}

function compactAppBar(title: string): TemplateResult {
  return html`
    <lc-app-header slot="header" class="cl-appbar" title=${title}>
      ${
        appBar.back === undefined
          ? nothing
          : html`<a slot="start" class="cl-icon-button" href=${href(appBar.back)} aria-label=${text('action.back')}
              ><lc-icon name="chevron-left" aria-hidden="true"></lc-icon
            ></a>`
      }
      <span slot="end" class="cl-appbar-actions">${appBar.actions ?? nothing}</span>
    </lc-app-header>
  `;
}

function tabBar(): TemplateResult {
  return html`
    <lc-bottom-nav slot="bottom-nav" class="cl-tabbar" fixed aria-label=${text('nav.main')}>
      ${TABS.map(
        (
          tab,
        ) => html`<a class="cl-tab" href=${href(tab.path)} aria-current=${tabIsCurrent(tab.path) ? 'page' : nothing}>
          <lc-icon name=${tab.icon} aria-hidden="true"></lc-icon>
          <span>${text(tab.label)}</span>
          ${
            tab.path === '/list' && shoppingCount > 0
              ? html`<span class="cl-badge" aria-label=${text('nav.shoppingCount', { count: shoppingCount })}
                  >${shoppingCount}</span
                >`
              : nothing
          }
        </a>`,
      )}
    </lc-bottom-nav>
  `;
}

function chrome(): TemplateResult {
  const route = router.current();
  const session = person.current();
  const kind = route?.def.shell ?? 'bare';
  const page = html`<div class=${kind === 'bare' ? 'cl-page cl-page-bare' : 'cl-page'}>${outlet}</div>`;
  if (kind === 'print') {
    return html`<main class="cl-print">${outlet}</main>`;
  }
  if (session === null || (route?.def.access === 'public' && route.def.path !== FALLBACK_PATH)) {
    return html`<main class="cl-bare">${outlet}</main>`;
  }
  if (wide.matches) {
    return html`<lc-app-shell layout="desktop" class="cl-shell">
      <lc-navbar slot="navbar" class="cl-topbar">${topBar(session)}</lc-navbar>
      <main>${page}</main>
    </lc-app-shell>`;
  }
  if (kind === 'bare') {
    return html`<main class="cl-bare">${outlet}</main>`;
  }
  return html`<lc-app-shell
    layout="mobile"
    class="cl-shell cl-shell-tabs"
    .headerHeight=${appBar.hidden === true ? '0px' : 'var(--appbar-h)'}
  >
    ${appBar.hidden === true ? nothing : compactAppBar(document.title.replace(/ \| .*$/, ''))}
    <main>${page}</main>
    ${tabBar()}
  </lc-app-shell>`;
}

function draw(): void {
  if (root === null) {
    return;
  }
  render(
    html`
      ${chrome()}
      <lc-toast position=${wide.matches ? 'bottom-right' : 'bottom-center'}></lc-toast>
      ${overlay ?? nothing}
      ${searchDialog ?? nothing}
    `,
    root,
  );
}

function hideLaunch(): void {
  const launch = document.getElementById('launch');
  if (launch === null) {
    return;
  }
  if (prefersReducedMotion()) {
    launch.remove();
    return;
  }
  launch.addEventListener('transitionend', () => launch.remove(), { once: true });
  launch.classList.add('is-leaving');
}

function redirectFor(code: AuthCode): void {
  const route = router.current();
  if (route === null) {
    pendingAuth = code;
    return;
  }
  const path = appPath();
  const here = `${path}${location.search}`;
  const next = here === '/' ? '' : `?next=${encodeURIComponent(here)}`;
  const leaving = route.def.access !== 'public' && !SIGN_IN_PATHS.includes(path);
  switch (code) {
    case 'setup_required':
      if (path !== '/setup') {
        navigate('/setup', { replace: true });
      }
      return;
    case 'login_required':
      if (leaving) {
        navigate(`/login${next}`, { replace: true });
      }
      return;
    case 'profile_required':
      if (leaving) {
        navigate(`/who${next}`, { replace: true });
      }
      return;
    case 'password_change_required':
      if (path !== '/login/new-password') {
        navigate('/login/new-password', { replace: true });
      }
      return;
  }
}

function watchCounts(): void {
  const shopping = resourceFor('getShoppingList', {}, { tags: ['shopping'] });
  shopping.subscribe((list) => {
    shoppingCount = list?.items.length ?? 0;
    draw();
  });
  const menus = resourceFor('listMenus', { query: { pageSize: 1 } }, { tags: ['menus'] });
  menus.subscribe((page) => {
    menuLive = page?.items.some((menu) => menu.live) ?? false;
    draw();
  });
  hold(shopping);
  hold(menus);
  void shopping.ensure();
  void menus.ensure();
}

function startRouter(): void {
  if (started) {
    return;
  }
  started = true;
  router.start(routes, outlet);
}

async function showOverlay(key: 'launch/offline' | 'launch/splash' | 'launch/lost'): Promise<void> {
  const module = await loadScreen(key);
  if (module === null) {
    throw new Error(`The ${key} screen is missing`);
  }
  overlay = module.screen({ params: { screen: text('app.name') }, query, navigate, person });
  draw();
}

async function openSearch(): Promise<void> {
  if (searchDialog !== null || overlay !== null || person.current() === null) {
    return;
  }
  const opener = document.activeElement;
  const module = await loadScreen('search/dialog');
  if (module === null || searchDialog !== null) {
    return;
  }
  const dialog = module.screen({ params: {}, query, navigate, person });
  dialog.addEventListener('cl-dismiss', closeSearch);
  searchOpener = opener;
  searchDialog = dialog;
  draw();
}

function closeSearch(): void {
  if (searchDialog === null) {
    return;
  }
  const opener = searchOpener;
  searchDialog = null;
  searchOpener = null;
  draw();
  if (opener instanceof HTMLElement && opener.isConnected) {
    opener.focus();
  }
}

async function refreshed(): Promise<boolean> {
  try {
    await person.refresh();
    return true;
  } catch (error) {
    if (!(error instanceof ApiError)) {
      throw error;
    }
    if (error.code !== 'network_error') {
      hideLaunch();
      await showOverlay('launch/lost');
    }
    return false;
  }
}

async function recover(): Promise<void> {
  await showOverlay('launch/splash');
  if (!(await refreshed())) {
    return;
  }
  overlay = null;
  startRouter();
  draw();
}

export async function startShell(target: HTMLElement): Promise<void> {
  root = target;
  wide.addEventListener('change', draw);
  router.beforeMount(() => {
    appBar = {};
    closeSearch();
  });
  router.subscribe(draw);
  onAuthProblem(redirectFor);
  person.subscribe((session) => {
    if (session !== null) {
      chooseTheme(session.person.theme);
      if (!countsWatched) {
        countsWatched = true;
        watchCounts();
      }
    }
    draw();
  });
  onReachabilityChange((reachable) => {
    if (reachable) {
      void recover();
      return;
    }
    hideLaunch();
    void showOverlay('launch/offline');
  });
  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && person.current() !== null) {
      event.preventDefault();
      void openSearch();
    }
  });
  const firstPaint = router.subscribe(() => {
    firstPaint();
    requestAnimationFrame(hideLaunch);
    const code = pendingAuth;
    pendingAuth = null;
    if (code !== null) {
      redirectFor(code);
    }
  });
  draw();
  if (await refreshed()) {
    startRouter();
  }
}
