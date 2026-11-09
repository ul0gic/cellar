import { formatMoney } from '@cellar/contract';
import type { ResourceHandle } from '@lightstart/light/controller';
import { html, nothing, type TemplateResult } from '@lightstart/light/html';
import { call } from '../../../app/api.ts';
import { eventChecked } from '../../../app/events.ts';
import { type LoadState, onLeave } from '../../../app/load.ts';
import { actionFailed } from '../../../app/problems.ts';
import { invalidate } from '../../../app/resources.ts';
import type { PersonSignal } from '../../../app/types.ts';
import { illustration } from '../../../design-system/illustration.ts';
import { type SkeletonShape, skeleton } from '../../../design-system/skeleton.ts';
import { text } from '../../../text/index.ts';
import './kit.css';

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
  state: LoadState,
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

export function money(minor: number, person: PersonSignal): string {
  const session = person.current();
  if (session === null) {
    throw new Error('Prices need a signed-in person');
  }
  return formatMoney(minor, session.household.currency);
}

export async function setShowPrices(person: PersonSignal, showPrices: boolean): Promise<void> {
  await call('updateMe', { body: { showPrices } });
  await person.refresh();
  invalidate('shelf', 'stats');
}

export function pricesSwitch(person: PersonSignal): TemplateResult {
  const on = person.current()?.person.showPrices === true;
  return html`<lc-switch
    class="cl-kit-prices"
    label=${text('shelf.kit.prices')}
    ?checked=${on}
    @change=${(event: Event) => void attempt(() => setShowPrices(person, eventChecked(event)))}
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
