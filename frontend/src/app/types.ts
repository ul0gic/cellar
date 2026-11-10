import type { Session } from '@cellar/contract';
import type { ScreenDomain } from './screen-domains.ts';

export type ScreenKey = `${ScreenDomain}/${string}`;
export type RouteParams = Readonly<Record<string, string>>;
export type ShellKind = 'tabs' | 'bare' | 'print';

export interface RouteDef {
  readonly path: string;
  readonly screen: ScreenKey;
  readonly title: string | ((params: RouteParams) => string);
  readonly shell: ShellKind;
  readonly access: 'public' | 'session';
}

export type QueryPatch = Readonly<Record<string, string | readonly string[] | null>>;

export interface QuerySignal {
  get(key: string): string | null;
  getAll(key: string): string[];
  set(patch: QueryPatch, mode: 'replace' | 'push'): void;
  subscribe(fn: () => void): () => void;
}

export interface NavigateOptions {
  readonly replace?: boolean;
  readonly state?: Readonly<Record<string, unknown>>;
}

export type Navigate = (to: string, opts?: NavigateOptions) => void;

export type SessionPerson = Session;

export interface PersonSignal {
  current(): SessionPerson | null;
  subscribe(fn: (person: SessionPerson | null) => void): () => void;
  refresh(): Promise<void>;
}

export interface ScreenContext {
  readonly params: RouteParams;
  readonly query: QuerySignal;
  readonly navigate: Navigate;
  readonly person: PersonSignal;
}

export interface LegacyScreenModule {
  readonly screen: (ctx: ScreenContext) => HTMLElement;
  readonly title?: string | ((params: RouteParams) => string);
}

export interface ScreenModule {
  readonly tag: string;
  readonly title?: string | ((params: RouteParams) => string);
}

export interface ScreenElement extends HTMLElement {
  params: RouteParams;
}

export interface Owner {
  $own(teardown: () => void): unknown;
}

export interface OverlayHost extends Owner {
  readonly isConnected: boolean;
}
