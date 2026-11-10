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

export interface NavigateOptions {
  readonly replace?: boolean;
  readonly state?: Readonly<Record<string, unknown>>;
}

export type Navigate = (to: string, opts?: NavigateOptions) => void;

export type SessionPerson = Session;

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
