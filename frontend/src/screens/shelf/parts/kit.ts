import { formatMoney } from '@cellar/contract';
import type { ResourceHandle } from '@lightstart/light/controller';
import { html, nothing, type TemplateResult } from '@lightstart/light/html';
import { effect, type Signal } from '@lightstart/light/signals';
import { call } from '../../../app/api.ts';
import { eventChecked } from '../../../app/events.ts';
import { type WatchState, onLeave } from '../../../app/load.ts';
import { actionFailed } from '../../../app/problems.ts';
import { route } from '../../../app/controllers/route.ts';
import { session } from '../../../app/controllers/session.ts';
import { dataChanged } from '../../../app/resources.ts';
import { setQuery } from '../../../app/router.ts';
import type { Owner } from '../../../app/types.ts';
import { illustration } from '../../../design-system/illustration.ts';
import { type SkeletonShape, skeleton } from '../../../design-system/skeleton.ts';
import { text } from '../../../text/index.ts';
import '../../../design-system/lc/button.ts';
import '../../../design-system/lc/empty-state.ts';
import '../../../design-system/lc/modal.ts';
import '../../../design-system/lc/switch.ts';
import './kit.css';

const TYPE_SETTLE_MS = 250;

export const wide = matchMedia('(min-width: 1024px)');

export function onWidth(element: HTMLElement, fn: () => void): void {
  wide.addEventListener('change', fn);
  onLeave(element, () => wide.removeEventListener('change', fn));
}

export function follow(element: HTMLElement, subscribe: (fn: () => void) => () => void, fn: () => void): void {
  let mounted = false;
  const stop = subscribe(() => {
    if (element.isConnected) {
      mounted = true;
    } else if (mounted) {
      stop();
      return;
    }
    fn();
  });
}

export function failedState(screen: string, retry: () => void): TemplateResult {
  return html`<lc-empty-state title=${text('loadFailed.title', { screen })} description=${text('loadFailed.body')}>
    ${illustration('empty-lost')}
    <lc-button variant="primary" @click=${retry}>${text('loadFailed.retry')}</lc-button>
  </lc-empty-state>`;
}

export function waiting(
  state: WatchState,
  resource: ResourceHandle,
  screen: string,
  shape: SkeletonShape,
): TemplateResult | typeof nothing | HTMLElement | null {
  if (resource.peek() !== undefined) {
    return null;
  }
  if (state.error(resource) !== null) {
    return failedState(screen, state.retry);
  }
  return state.slow ? skeleton(shape, screen) : nothing;
}

export function attempt(action: () => Promise<void>): Promise<void> {
  return action().catch((error: unknown) => actionFailed(error, () => void attempt(action)));
}

export function money(minor: number): string {
  const current = session.current.value;
  if (current === null) {
    throw new Error('Prices need a signed-in person');
  }
  return formatMoney(minor, current.household.currency);
}

export async function setShowPrices(showPrices: boolean): Promise<void> {
  await call('updateMe', { body: { showPrices } });
  await session.refresh();
  dataChanged('shelf', 'stats');
}

export function pricesSwitch(): TemplateResult {
  const on = session.current.value?.person.showPrices === true;
  return html`<lc-switch
    class="cl-kit-prices"
    label=${text('shelf.kit.prices')}
    ?checked=${on}
    @change=${(event: Event) => void attempt(() => setShowPrices(eventChecked(event)))}
  ></lc-switch>`;
}

export interface SheetOptions {
  readonly open: boolean;
  readonly title: string;
  readonly onClose: () => void;
  readonly body: TemplateResult;
  readonly footer: TemplateResult;
}

export function sheet(opts: SheetOptions): TemplateResult {
  return html`<lc-modal variant="sheet" class="cl-kit-sheet" ?open=${opts.open} @modal-close=${opts.onClose}>
    <h2 slot="header" class="cl-kit-sheet-title">${opts.title}</h2>
    <div class="cl-kit-sheet-body">${opts.body}</div>
    <div slot="footer" class="cl-kit-sheet-footer">${opts.footer}</div>
  </lc-modal>`;
}

export function fieldError(
  errors: readonly { readonly path: string; readonly message: string }[],
  path: string,
): string {
  return errors.find((error) => error.path === path)?.message ?? '';
}

export function followTyping(host: Owner, typed: Signal<string>): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let seen = route.query.peek().get('q') ?? '';
  const fromRoute = effect(() => {
    const q = route.query.value.get('q') ?? '';
    if (q === seen) {
      return;
    }
    seen = q;
    if (timer === undefined) {
      typed.value = q;
    }
  });
  const toRoute = effect(() => {
    const value = typed.value;
    clearTimeout(timer);
    timer = undefined;
    const wanted = value.trim() === '' ? '' : value;
    if (wanted === (route.query.peek().get('q') ?? '')) {
      return;
    }
    timer = setTimeout(() => {
      timer = undefined;
      setQuery({ q: wanted === '' ? null : wanted, page: null }, 'replace');
    }, TYPE_SETTLE_MS);
  });
  host.$own(() => {
    fromRoute.dispose();
    toRoute.dispose();
    clearTimeout(timer);
  });
}
