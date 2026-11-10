import type { LightElements } from '@lightstart/components/elements.js';
import { env } from '@lightstart/light/env';
import { navigation } from '@lightstart/light/navigation';
import { html, nothing, render, type TemplateResult } from '@lightstart/light/html';
import { effect, untracked } from '@lightstart/light/signals';
import { prefersReducedMotion } from '../design-system/motion.ts';
import { type TextKey, text } from '../text/index.ts';
import { type AuthCode, ApiError, call, onAuthProblem, onReachabilityChange } from './api.ts';
import { route } from './controllers/route.ts';
import { session } from './controllers/session.ts';
import { shell } from './controllers/shell.ts';
import { viewport } from './controllers/viewport.ts';
import { createScreen, FALLBACK_PATH, href, navigate, router } from './router.ts';
import { routes } from './routes.ts';
import { loadScreen } from './screens.ts';
import type { SessionPerson } from './types.ts';
import './shell.css';
import '../design-system/cl-bulb.ts';
import '../design-system/lc/app-header.ts';
import '../design-system/lc/app-shell.ts';
import '../design-system/lc/bottom-nav.ts';
import '../design-system/lc/dropdown.ts';
import '../design-system/lc/icon.ts';
import '../design-system/lc/navbar.ts';
import '../design-system/lc/toast.ts';

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

const outlet = document.createElement('div');
outlet.className = 'cl-outlet';
let root: HTMLElement | null = null;
let appBar: AppBarOptions = {};
let started = false;
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

export async function signOut(who: SessionPerson): Promise<void> {
  await call('logout', {});
  await session.refresh();
  navigate(who.requireLogin ? '/login' : '/who', { replace: true });
}

function openDropdown(event: MouseEvent, selector: string): void {
  const trigger = event.currentTarget;
  const menu = root?.querySelector<Dropdown>(selector);
  if (trigger instanceof Element && menu !== undefined && menu !== null) {
    menu.toggle(trigger);
  }
}

function topBar(who: SessionPerson): TemplateResult {
  const accountItems = [
    { label: text('nav.settings'), icon: 'sliders-horizontal', onClick: () => navigate('/settings/profile') },
    {
      label: who.requireLogin ? text('nav.signOut') : text('nav.switchPerson'),
      icon: 'log-out',
      onClick: () => void signOut(who),
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
            link.path === '/menus' && shell.menuLive.value
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
        class="cl-account-button"
        aria-haspopup="menu"
        @click=${(event: MouseEvent) => openDropdown(event, '.cl-account-menu')}
      ><lc-icon name="user-round" aria-hidden="true"></lc-icon><span class="cl-vh">${text('nav.account', { name: who.person.name })}</span></button>
      <lc-dropdown class="cl-account-menu" aria-label=${text('nav.accountMenu')} .items=${accountItems}></lc-dropdown>
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
            tab.path === '/list' && shell.shoppingCount.value > 0
              ? html`<span class="cl-badge" aria-label=${text('nav.shoppingCount', { count: shell.shoppingCount.value })}
                  >${shell.shoppingCount.value}</span
                >`
              : nothing
          }
        </a>`,
      )}
    </lc-bottom-nav>
  `;
}

function chrome(): TemplateResult {
  const def = route.def.peek();
  const who = session.current.value;
  const kind = def?.shell ?? 'bare';
  const page = html`<div class=${kind === 'bare' ? 'cl-page cl-page-bare' : 'cl-page'}>${outlet}</div>`;
  if (kind === 'print') {
    return html`<main class="cl-print">${outlet}</main>`;
  }
  if (who === null || (def?.access === 'public' && def.path !== FALLBACK_PATH)) {
    return html`<main class="cl-bare">${outlet}</main>`;
  }
  if (viewport.wide.value) {
    return html`<lc-app-shell layout="desktop" class="cl-shell">
      <lc-navbar slot="navbar">${topBar(who)}</lc-navbar>
      ${page}
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
    ${page}
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
      <lc-toast position=${viewport.wide.value ? 'bottom-right' : 'bottom-center'}></lc-toast>
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
  const def = route.def.peek();
  if (def === null) {
    pendingAuth = code;
    return;
  }
  const path = appPath();
  const here = `${path}${location.search}`;
  const next = here === '/' ? '' : `?next=${encodeURIComponent(here)}`;
  const leaving = def.access !== 'public' && !SIGN_IN_PATHS.includes(path);
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
  overlay = createScreen(key, module, { screen: text('app.name') });
  draw();
}

async function openSearch(): Promise<void> {
  if (searchDialog !== null || overlay !== null || session.current.peek() === null) {
    return;
  }
  const opener = document.activeElement;
  const module = await loadScreen('search/dialog');
  if (module === null || searchDialog !== null) {
    return;
  }
  const dialog = createScreen('search/dialog', module, {});
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
    await session.refresh();
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

function blurForMenu(event: Event, open: boolean): void {
  if (event.target instanceof Element && event.target.matches('.cl-more-menu, .cl-account-menu')) {
    root?.classList.toggle('cl-menu-open', open);
  }
}

export async function startShell(target: HTMLElement): Promise<void> {
  root = target;
  target.addEventListener('popover-open', (event) => blurForMenu(event, true));
  target.addEventListener('popover-close', (event) => blurForMenu(event, false));
  router.beforeMount(() => {
    appBar = {};
    root?.classList.remove('cl-menu-open');
    closeSearch();
    draw();
  });
  onAuthProblem(redirectFor);
  router.subscribe(draw);
  effect(() => {
    const followed = {
      session: session.current.value,
      wide: viewport.wide.value,
      shopping: shell.shoppingCount.value,
      live: shell.menuLive.value,
    };
    if (followed.session !== null && !countsWatched) {
      countsWatched = true;
      untracked(() => shell.follow());
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
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && session.current.peek() !== null) {
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
  if (await refreshed()) {
    startRouter();
  }
}
