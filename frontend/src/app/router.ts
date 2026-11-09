import { configureNavigation } from '@lightstart/light/navigation';
import { text } from '../text/index.ts';
import { basePath } from './base.ts';
import { person } from './person.ts';
import { loadScreen, ScreenLoadError } from './screens.ts';
import type {
  Navigate,
  NavigateOptions,
  QueryPatch,
  QuerySignal,
  RouteDef,
  RouteParams,
  ScreenContext,
  ScreenModule,
} from './types.ts';

type Blocker = () => boolean | Promise<boolean>;

interface EntryMark {
  readonly cellarKey: string;
  readonly cellarIndex: number;
}

interface CompiledRoute {
  readonly def: RouteDef;
  readonly segments: readonly { readonly param: boolean; readonly name: string }[];
}

interface Match {
  readonly def: RouteDef;
  readonly params: RouteParams;
}

export interface CurrentRoute {
  readonly def: RouteDef;
  readonly params: RouteParams;
  readonly query: QuerySignal;
}

export const FALLBACK_PATH = '*';
export const LOST_PATH = '!lost';
const SCROLL_STORE_KEY = 'cellar.scroll';
const NAVIGATE_START = 'cellar:navigate-start';
const SCREEN_PAINTED = 'cellar:screen-painted';

let compiled: readonly CompiledRoute[] = [];
let fallback: RouteDef | null = null;
let lostRoute: RouteDef | null = null;
let outlet: HTMLElement | null = null;
let current: Match | null = null;
let currentKey = '';
let currentIndex = 0;
let generation = 0;
let keySequence = 0;
let ignoreNextPop = false;
let stopRestore: (() => void) | null = null;
const blockers = new Set<Blocker>();
const routeListeners = new Set<() => void>();
const mountListeners = new Set<() => void>();
const queryListeners = new Set<() => void>();
const scrollPositions = new Map<string, number>();

function newKey(): string {
  keySequence += 1;
  return `${Date.now().toString(36)}-${keySequence}`;
}

function isEntryMark(value: unknown): value is EntryMark {
  return (
    typeof value === 'object' &&
    value !== null &&
    'cellarKey' in value &&
    typeof value.cellarKey === 'string' &&
    'cellarIndex' in value &&
    typeof value.cellarIndex === 'number'
  );
}

function compile(def: RouteDef): CompiledRoute {
  const segments = def.path
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) =>
      segment.startsWith(':') ? { param: true, name: segment.slice(1) } : { param: false, name: segment },
    );
  return { def, segments };
}

function appPathOf(pathname: string): string {
  const base = basePath();
  const inside = pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
  return inside.startsWith('/') ? inside : `/${inside}`;
}

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch (error) {
    if (error instanceof URIError) {
      return null;
    }
    throw error;
  }
}

function matchRoute(route: CompiledRoute, parts: readonly string[]): Match | null {
  if (route.segments.length !== parts.length) {
    return null;
  }
  const params: Record<string, string> = {};
  for (const [index, segment] of route.segments.entries()) {
    const part = parts[index];
    if (part === undefined) {
      return null;
    }
    if (!segment.param) {
      if (segment.name !== part) {
        return null;
      }
      continue;
    }
    const value = decodeSegment(part);
    if (value === null || value.length === 0) {
      return null;
    }
    params[segment.name] = value;
  }
  return { def: route.def, params };
}

function staticWeight(route: CompiledRoute): number {
  return route.segments.reduce((weight, segment, index) => (segment.param ? weight : weight + 2 ** (31 - index)), 0);
}

function resolvePath(appPath: string): Match | null {
  const parts = appPath.split('/').filter((part) => part.length > 0);
  let best: { match: Match; weight: number } | null = null;
  for (const route of compiled) {
    const match = matchRoute(route, parts);
    if (match !== null) {
      const weight = staticWeight(route);
      if (best === null || weight > best.weight) {
        best = { match, weight };
      }
    }
  }
  if (best !== null) {
    return best.match;
  }
  return fallback === null ? null : { def: fallback, params: { path: appPath } };
}

function readQuery(): URLSearchParams {
  return new URLSearchParams(location.search);
}

function notify(listeners: ReadonlySet<() => void>): void {
  for (const listener of listeners) {
    listener();
  }
}

export const query: QuerySignal = {
  get: (key) => readQuery().get(key),
  getAll: (key) => readQuery().getAll(key),
  set(patch: QueryPatch, mode) {
    const next = readQuery();
    for (const [key, value] of Object.entries(patch)) {
      next.delete(key);
      if (value === null) {
        continue;
      }
      for (const item of typeof value === 'string' ? [value] : value) {
        next.append(key, item);
      }
    }
    const search = next.toString();
    const url = `${location.pathname}${search.length > 0 ? `?${search}` : ''}${location.hash}`;
    writeEntry(url, mode === 'replace', {});
    notify(queryListeners);
  },
  subscribe(fn) {
    queryListeners.add(fn);
    return () => {
      queryListeners.delete(fn);
    };
  },
};

function persistScroll(): void {
  try {
    sessionStorage.setItem(SCROLL_STORE_KEY, JSON.stringify([...scrollPositions]));
  } catch (error) {
    if (!(error instanceof DOMException)) {
      throw error;
    }
  }
}

function loadScrollPositions(): void {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(SCROLL_STORE_KEY);
  } catch (error) {
    if (!(error instanceof DOMException)) {
      throw error;
    }
  }
  if (raw === null) {
    return;
  }
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    return;
  }
  for (const entry of parsed) {
    if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'number') {
      scrollPositions.set(entry[0], entry[1]);
    }
  }
}

function saveScroll(): void {
  if (currentKey.length > 0) {
    scrollPositions.set(currentKey, window.scrollY);
  }
}

function restoreScroll(y: number): void {
  stopRestore?.();
  const root = document.documentElement;
  const reached = (): boolean => root.scrollHeight - window.innerHeight >= y;
  if (reached() || outlet === null) {
    window.scrollTo(0, y);
    return;
  }
  const observer = new ResizeObserver(() => {
    if (reached()) {
      window.scrollTo(0, y);
      stop();
    }
  });
  const interrupt = (): void => stop();
  const stop = (): void => {
    observer.disconnect();
    window.removeEventListener('wheel', interrupt);
    window.removeEventListener('touchstart', interrupt);
    window.removeEventListener('keydown', interrupt);
    stopRestore = null;
  };
  observer.observe(outlet);
  window.addEventListener('wheel', interrupt, { passive: true });
  window.addEventListener('touchstart', interrupt, { passive: true });
  window.addEventListener('keydown', interrupt);
  stopRestore = stop;
}

function scrollToHash(hash: string): boolean {
  const id = decodeSegment(hash.slice(1));
  const target = id === null || id.length === 0 ? null : document.getElementById(id);
  target?.scrollIntoView();
  return target !== null;
}

function writeEntry(url: string, replace: boolean, state: Readonly<Record<string, unknown>>): void {
  if (replace) {
    history.replaceState({ ...state, cellarKey: currentKey, cellarIndex: currentIndex }, '', url);
    return;
  }
  saveScroll();
  currentKey = newKey();
  currentIndex += 1;
  history.pushState({ ...state, cellarKey: currentKey, cellarIndex: currentIndex }, '', url);
}

async function allowedToLeave(): Promise<boolean> {
  for (const blocker of blockers) {
    // biome-ignore lint/performance/noAwaitInLoops: blockers ask in turn; the second must not open while the first is answering
    if (!(await blocker())) {
      return false;
    }
  }
  return true;
}

function titleOf(match: Match, module: ScreenModule | null): string {
  const title = module?.title ?? match.def.title;
  return typeof title === 'string' ? title : title(match.params);
}

function samePlace(a: Match | null, b: Match): boolean {
  if (a === null || a.def !== b.def) {
    return false;
  }
  const aKeys = Object.keys(a.params);
  return aKeys.length === Object.keys(b.params).length && aKeys.every((key) => a.params[key] === b.params[key]);
}

function context(match: Match): ScreenContext {
  return { params: match.params, query, navigate, person };
}

async function moduleFor(match: Match): Promise<{ match: Match; module: ScreenModule | null }> {
  try {
    const module = await loadScreen(match.def.screen);
    if (module !== null || fallback === null) {
      return { match, module };
    }
    return {
      match: { def: fallback, params: { path: appPathOf(location.pathname) } },
      module: await loadScreen(fallback.screen),
    };
  } catch (error) {
    if (!(error instanceof ScreenLoadError) || lostRoute === null) {
      throw error;
    }
    const screenName = titleOf(match, null);
    return { match: { def: lostRoute, params: { screen: screenName } }, module: await loadScreen(lostRoute.screen) };
  }
}

async function render(scroll: 'top' | 'restore'): Promise<void> {
  const target = outlet;
  if (target === null) {
    return;
  }
  const appPath = appPathOf(location.pathname);
  if (appPath.length > 1 && appPath.endsWith('/')) {
    const canonical = `${basePath()}${appPath.replace(/\/+$/, '')}${location.search}${location.hash}`;
    history.replaceState(history.state, '', canonical);
    await render(scroll);
    return;
  }
  const resolved = resolvePath(appPath);
  if (resolved === null) {
    return;
  }
  if (samePlace(current, resolved)) {
    notify(queryListeners);
    if (location.hash.length > 1) {
      scrollToHash(location.hash);
    }
    return;
  }
  const run = ++generation;
  stopRestore?.();
  const { match, module } = await moduleFor(resolved);
  if (run !== generation) {
    return;
  }
  current = match;
  setScreenTitle(titleOf(match, module));
  notify(mountListeners);
  target.replaceChildren(module === null ? document.createElement('div') : module.screen(context(match)));
  notify(routeListeners);
  notify(queryListeners);
  const saved = scrollPositions.get(currentKey);
  if (scroll === 'restore' && saved !== undefined) {
    restoreScroll(saved);
  } else if (location.hash.length <= 1 || !scrollToHash(location.hash)) {
    window.scrollTo(0, 0);
  }
  requestAnimationFrame(() => {
    performance.mark(SCREEN_PAINTED, { detail: { path: appPath } });
    performance.measure('cellar:navigation', { start: NAVIGATE_START, end: SCREEN_PAINTED, detail: { path: appPath } });
  });
}

function toUrl(to: string): URL {
  return new URL(`${location.origin}${basePath()}${to.startsWith('/') ? to : `/${to}`}`);
}

export const navigate: Navigate = (to: string, opts: NavigateOptions = {}) => {
  const url = toUrl(to);
  const sameDocument = url.pathname === location.pathname && url.search === location.search;
  if (sameDocument && url.hash !== location.hash && opts.state === undefined) {
    writeEntry(url.href, opts.replace === true, {});
    scrollToHash(url.hash);
    return;
  }
  void (async () => {
    if (!(await allowedToLeave())) {
      return;
    }
    performance.mark(NAVIGATE_START);
    writeEntry(url.href, opts.replace === true, opts.state ?? {});
    await render('top');
  })();
};

async function onPopState(): Promise<void> {
  if (ignoreNextPop) {
    ignoreNextPop = false;
    return;
  }
  const state: unknown = history.state;
  const mark = isEntryMark(state) ? state : null;
  const delta = mark === null ? 1 : mark.cellarIndex - currentIndex;
  if (blockers.size > 0 && !(await allowedToLeave())) {
    if (delta !== 0) {
      ignoreNextPop = true;
      history.go(-delta);
    }
    return;
  }
  performance.mark(NAVIGATE_START);
  saveScroll();
  if (mark === null) {
    currentKey = newKey();
    currentIndex += 1;
    history.replaceState({ cellarKey: currentKey, cellarIndex: currentIndex }, '');
  } else {
    currentKey = mark.cellarKey;
    currentIndex = mark.cellarIndex;
  }
  await render('restore');
}

function anchorOf(event: MouseEvent): HTMLAnchorElement | null {
  for (const node of event.composedPath()) {
    if (node instanceof HTMLAnchorElement && node.hasAttribute('href')) {
      return node;
    }
  }
  return null;
}

function internalPathOf(anchor: HTMLAnchorElement): string | null {
  const target = anchor.getAttribute('target');
  if ((target !== null && target !== '' && target !== '_self') || anchor.hasAttribute('download')) {
    return null;
  }
  const url = new URL(anchor.href);
  const base = basePath();
  if (url.origin !== location.origin || (url.pathname !== base && !url.pathname.startsWith(`${base}/`))) {
    return null;
  }
  return `${appPathOf(url.pathname)}${url.search}${url.hash}`;
}

function takeClick(event: MouseEvent): boolean {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return false;
  }
  const anchor = anchorOf(event);
  const path = anchor === null ? null : internalPathOf(anchor);
  if (path === null) {
    return false;
  }
  event.preventDefault();
  navigate(path);
  return true;
}

function onBeforeUnload(event: BeforeUnloadEvent): void {
  event.preventDefault();
}

export function setScreenTitle(screen: string): void {
  document.title = text('app.title', { screen });
}

export function href(path: string): string {
  return `${basePath()}${path.startsWith('/') ? path : `/${path}`}`;
}

export const router = {
  start(table: readonly RouteDef[], target: HTMLElement): void {
    compiled = table.filter((def) => def.path !== FALLBACK_PATH && def.path !== LOST_PATH).map(compile);
    fallback = table.find((def) => def.path === FALLBACK_PATH) ?? null;
    lostRoute = table.find((def) => def.path === LOST_PATH) ?? null;
    outlet = target;
    history.scrollRestoration = 'manual';
    loadScrollPositions();
    const state: unknown = history.state;
    if (isEntryMark(state)) {
      currentKey = state.cellarKey;
      currentIndex = state.cellarIndex;
    } else {
      currentKey = newKey();
      history.replaceState({ cellarKey: currentKey, cellarIndex: currentIndex }, '');
    }
    window.addEventListener('popstate', () => void onPopState());
    window.addEventListener('pagehide', () => {
      saveScroll();
      persistScroll();
    });
    document.addEventListener('click', (event) => {
      takeClick(event);
    });
    configureNavigation({
      href,
      go: (path) => navigate(path),
      click: (event, options) => options?.external !== true && takeClick(event),
      path: () => appPathOf(location.pathname),
      subscribe(fn) {
        routeListeners.add(fn);
        return () => {
          routeListeners.delete(fn);
        };
      },
    });
    performance.mark(NAVIGATE_START);
    void render('restore');
  },
  block(fn: Blocker): () => void {
    blockers.add(fn);
    if (blockers.size === 1) {
      window.addEventListener('beforeunload', onBeforeUnload);
    }
    return () => {
      blockers.delete(fn);
      if (blockers.size === 0) {
        window.removeEventListener('beforeunload', onBeforeUnload);
      }
    };
  },
  current(): CurrentRoute | null {
    return current === null ? null : { def: current.def, params: current.params, query };
  },
  subscribe(fn: () => void): () => void {
    routeListeners.add(fn);
    return () => {
      routeListeners.delete(fn);
    };
  },
  beforeMount(fn: () => void): () => void {
    mountListeners.add(fn);
    return () => {
      mountListeners.delete(fn);
    };
  },
};
