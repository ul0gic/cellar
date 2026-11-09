import { formatMoney, type IsoDate } from '@cellar/contract';
import type { ResourceHandle } from '@lightstart/light/controller';
import { html, nothing, type TemplateResult } from '@lightstart/light/html';
import { ApiError, call } from '../../../app/api.ts';
import { invalidate } from '../../../app/resources.ts';
import type { PersonSignal } from '../../../app/types.ts';
import { illustration } from '../../../design-system/illustration.ts';
import { type SkeletonShape, skeleton } from '../../../design-system/skeleton.ts';
import { toast } from '../../../design-system/toast.ts';
import { text } from '../../../text/index.ts';
import './kit.css';

// D-1 §8.26: skeletons appear only when a load takes longer than 300 ms.
const SKELETON_DELAY_MS = 300;

export const wide = matchMedia('(min-width: 1024px)');

export interface LoadState {
  readonly slow: boolean;
  failed(resource: ResourceHandle): boolean;
  retry(): void;
}

export function watch(
  element: HTMLElement,
  resources: readonly ResourceHandle[],
  draw: (state: LoadState) => void,
): () => void {
  const failures = new Set<ResourceHandle>();
  const stops: (() => void)[] = [];
  let slow = false;
  let mounted = false;
  let stopped = false;
  const stopAll = (): void => {
    stopped = true;
    for (const stop of stops) {
      stop();
    }
    wide.removeEventListener('change', onWidth);
  };
  const alive = (): boolean => {
    if (stopped) {
      return false;
    }
    if (element.isConnected) {
      mounted = true;
      return true;
    }
    if (!mounted) {
      return true;
    }
    stopAll();
    return false;
  };
  const load = (resource: ResourceHandle): void => {
    failures.delete(resource);
    resource.ensure().then(redraw, (error: unknown) => {
      if (!(error instanceof ApiError)) {
        throw error;
      }
      failures.add(resource);
      redraw();
    });
  };
  const state: LoadState = {
    get slow() {
      return slow;
    },
    failed: (resource) => failures.has(resource),
    retry: () => {
      for (const resource of [...failures]) {
        load(resource);
      }
      redraw();
    },
  };
  function redraw(): void {
    if (alive()) {
      draw(state);
    }
  }
  function onWidth(): void {
    redraw();
  }
  wide.addEventListener('change', onWidth);
  for (const resource of resources) {
    stops.push(resource.value.subscribe(redraw));
    load(resource);
  }
  setTimeout(() => {
    slow = true;
    redraw();
  }, SKELETON_DELAY_MS);
  return stopAll;
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
  if (state.failed(resource)) {
    return failedState(screen, state.retry);
  }
  return state.slow ? skeleton(shape, screen) : nothing;
}

export function actionFailed(error: unknown, retry: () => void): void {
  if (!(error instanceof ApiError)) {
    throw error;
  }
  if (error.code === 'network_error') {
    toast({
      title: text('saveFailed.title'),
      variant: 'error',
      action: { label: text('saveFailed.retry'), run: retry },
    });
    return;
  }
  toast({ title: error.detail, variant: 'error' });
}

export function attempt(action: () => Promise<void>): Promise<void> {
  return action().catch((error: unknown) => actionFailed(error, () => void attempt(action)));
}

function eventDetail(event: Event): unknown {
  return event instanceof CustomEvent ? event.detail : undefined;
}

export function eventValue(event: Event): unknown {
  const detail = eventDetail(event);
  return typeof detail === 'object' && detail !== null && 'value' in detail ? detail.value : undefined;
}

export function eventText(event: Event): string {
  const value = eventValue(event);
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  return '';
}

export function eventChecked(event: Event): boolean {
  const detail = eventDetail(event);
  return typeof detail === 'object' && detail !== null && 'checked' in detail && detail.checked === true;
}

export function eventNumber(event: Event): number | null {
  const value = eventValue(event);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function eventPage(event: Event): number | null {
  const detail = eventDetail(event);
  return typeof detail === 'object' && detail !== null && 'page' in detail && typeof detail.page === 'number'
    ? detail.page
    : null;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function today(): IsoDate {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
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
