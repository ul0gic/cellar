import { formatMoney } from '@cellar/contract';
import { html, type TemplateResult } from '@lightstart/light/html';
import { effect, type Signal } from '@lightstart/light/signals';
import { call } from '../../../app/api.ts';
import { eventChecked } from '../../../app/events.ts';
import { actionFailed } from '../../../app/problems.ts';
import { route } from '../../../app/controllers/route.ts';
import { session } from '../../../app/controllers/session.ts';
import { dataChanged } from '../../../app/resources.ts';
import { setQuery } from '../../../app/router.ts';
import type { Owner } from '../../../app/types.ts';
import { text } from '../../../text/index.ts';
import '../../../design-system/lc/modal.ts';
import '../../../design-system/lc/switch.ts';
import './kit.css';

const TYPE_SETTLE_MS = 250;

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
