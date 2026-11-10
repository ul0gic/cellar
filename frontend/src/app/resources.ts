import type { OperationId } from '@cellar/contract';
import type { KeyedResource, Resource, ResourceHandle } from '@lightstart/light/controller';
import { keyedResource } from '@lightstart/light/controller/resource';
import { batch, type Computed, computed, effect, signal, untracked } from '@lightstart/light/signals';
import { type ApiInput, type ApiOutput, ApiError, call } from './api.ts';
import { bus } from './bus.ts';
import type { Owner } from './types.ts';

// D-1 §8.26: skeletons appear only when a response takes longer than 300 ms.
export const SKELETON_DELAY_MS = 300;

export type DataDomain =
  | 'shelf'
  | 'recipes'
  | 'ingredients'
  | 'shopping'
  | 'menus'
  | 'wishlists'
  | 'collections'
  | 'notes'
  | 'settings'
  | 'stats';

export type ResourceTag = DataDomain;

export const DATA_CHANGED = 'data:changed';

export interface ApiResource<Op extends OperationId> {
  readonly value: Computed<ApiOutput<Op> | undefined>;
  readonly pending: Computed<boolean>;
  readonly error: Computed<ApiError | null>;
  readonly slow: Computed<boolean>;
  bind(host: Owner, input: ApiInput<Op> | (() => ApiInput<Op>)): void;
  refresh(): Promise<void>;
}

interface LayerControl {
  follows(domains: unknown): boolean;
  dropUnheld(): void;
  dropAll(): void;
}

interface Rebindable {
  reset(reload: boolean): void;
}

const watchers = new WeakMap<ResourceHandle, number>();
const layers = new Map<OperationId, unknown>();
const controls = new Set<LayerControl>();
const bound = new Set<Rebindable>();

export function hold(handle: ResourceHandle): () => void {
  watchers.set(handle, (watchers.get(handle) ?? 0) + 1);
  return () => {
    watchers.set(handle, (watchers.get(handle) ?? 0) - 1);
  };
}

export function resourceFor<Op extends OperationId>(
  op: Op,
  input: ApiInput<Op>,
  opts: { readonly tags?: readonly ResourceTag[] } = {},
): Resource<ApiOutput<Op>> {
  const layer = layerFor(op);
  for (const tag of opts.tags ?? []) {
    layer.domains.add(tag);
  }
  return layer.entry(input).resource;
}

class Layer<Op extends OperationId> implements LayerControl {
  readonly domains = new Set<DataDomain>();
  readonly held = new Map<string, number>();
  readonly keyed: KeyedResource<ApiOutput<Op>>;
  private readonly inputs = new Map<string, ApiInput<Op>>();

  constructor(op: Op) {
    this.keyed = keyedResource(
      (key) => {
        const input = this.inputs.get(key);
        if (input === undefined) {
          throw new Error(`No input recorded for ${op} ${key}`);
        }
        return call(op, input);
      },
      {
        name: op,
        ready: false,
        invalidateOn: DATA_CHANGED,
        filter: (payload, key) => this.follows(payload) && this.isHeld(key),
      },
    );
  }

  follows(domains: unknown): boolean {
    return Array.isArray(domains) && domains.some((domain) => this.domains.has(domain));
  }

  isHeld(key: string): boolean {
    return (this.held.get(key) ?? 0) > 0 || (watchers.get(this.keyed.get(key)) ?? 0) > 0;
  }

  entry(input: ApiInput<Op>): { readonly key: string; readonly resource: Resource<ApiOutput<Op>> } {
    const key = JSON.stringify(input);
    this.inputs.set(key, input);
    return { key, resource: this.keyed.get(key) };
  }

  hold(key: string): () => void {
    this.held.set(key, (this.held.get(key) ?? 0) + 1);
    let released = false;
    return () => {
      if (!released) {
        released = true;
        const left = (this.held.get(key) ?? 1) - 1;
        if (left > 0) {
          this.held.set(key, left);
        } else {
          this.held.delete(key);
        }
      }
    };
  }

  dropAll(): void {
    this.keyed.invalidateAll();
    this.inputs.clear();
  }

  dropUnheld(): void {
    for (const key of this.keyed.keys()) {
      if (!this.isHeld(key)) {
        this.keyed.invalidate(key);
        this.inputs.delete(key);
      }
    }
  }
}

function layerFor<Op extends OperationId>(op: Op): Layer<Op> {
  const existing = layers.get(op);
  if (existing !== undefined) {
    // biome-ignore lint/nursery/noUnsafeTypeAssertion: the layer under op was made for op by the constructor below
    return existing as Layer<Op>;
  }
  const created = new Layer(op);
  layers.set(op, created);
  controls.add(created);
  return created;
}

function rethrowUnlessApiError(error: unknown): void {
  if (!(error instanceof ApiError)) {
    throw error;
  }
}

function isThunk<T>(input: T | (() => T)): input is () => T {
  return typeof input === 'function';
}

class Handle<Op extends OperationId> implements ApiResource<Op>, Rebindable {
  private readonly answer = signal<ApiOutput<Op> | undefined>(undefined);
  private readonly loading = signal(false);
  private readonly failure = signal<unknown>(null);
  private readonly clock = signal(false);
  private current: Resource<ApiOutput<Op>> | null = null;
  private following: readonly (() => void)[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private input: ApiInput<Op> | undefined;
  private release: (() => void) | null = null;
  private suspended = false;

  readonly value = computed(() => this.answer.value);
  readonly pending = computed(() => this.loading.value);
  readonly error = computed<ApiError | null>(() => {
    const failed = this.failure.value;
    return !this.loading.value && failed instanceof ApiError ? failed : null;
  });
  readonly slow = computed(() => this.clock.value && this.answer.value === undefined);

  constructor(private readonly layer: Layer<Op>) {}

  bind(host: Owner, input: ApiInput<Op> | (() => ApiInput<Op>)): void {
    const read = isThunk(input) ? input : () => input;
    const watcher = effect(() => {
      const next = read();
      untracked(() => this.move(next));
    });
    bound.add(this);
    host.$own(() => {
      watcher.dispose();
      this.unfollow();
      this.drop();
      this.stopClock();
      this.clear();
      this.suspended = false;
      bound.delete(this);
    });
  }

  async refresh(): Promise<void> {
    const entry = this.current;
    if (entry === null) {
      return;
    }
    if (entry.peek() === undefined) {
      this.startClock();
    }
    try {
      await entry.refresh();
    } catch (error) {
      rethrowUnlessApiError(error);
    }
  }

  reset(reload: boolean): void {
    this.unfollow();
    this.drop();
    this.stopClock();
    this.clear();
    this.suspended = !reload;
    if (reload && this.input !== undefined) {
      this.acquire(this.input);
    }
  }

  private clear(): void {
    this.current = null;
    batch(() => {
      this.answer.value = undefined;
      this.loading.value = false;
      this.failure.value = null;
    });
  }

  private move(next: ApiInput<Op>): void {
    this.input = next;
    if (this.suspended) {
      return;
    }
    this.unfollow();
    this.drop();
    this.acquire(next);
  }

  private acquire(input: ApiInput<Op>): void {
    const { key, resource: entry } = this.layer.entry(input);
    this.release = this.layer.hold(key);
    this.current = entry;
    this.following = [
      entry.value.subscribe((next) => {
        this.answer.value = next;
      }),
      entry.pending.subscribe((next) => {
        this.loading.value = next;
      }),
      entry.error.subscribe((next) => {
        this.failure.value = next;
      }),
    ];
    if (entry.peek() !== undefined) {
      this.stopClock();
      return;
    }
    this.startClock();
    entry.ensure().catch(rethrowUnlessApiError);
  }

  private unfollow(): void {
    for (const stop of this.following) {
      stop();
    }
    this.following = [];
  }

  private drop(): void {
    this.release?.();
    this.release = null;
  }

  private startClock(): void {
    this.stopClock();
    this.timer = setTimeout(() => {
      this.clock.value = true;
    }, SKELETON_DELAY_MS);
  }

  private stopClock(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.clock.value = false;
  }
}

export function apiResource<Op extends OperationId>(op: Op, domains: readonly DataDomain[]): ApiResource<Op> {
  const layer = layerFor(op);
  for (const domain of domains) {
    layer.domains.add(domain);
  }
  return new Handle(layer);
}

export function dataChanged(...domains: readonly DataDomain[]): void {
  bus.emit(DATA_CHANGED, domains);
  for (const control of controls) {
    if (control.follows(domains)) {
      control.dropUnheld();
    }
  }
}

export const invalidate = dataChanged;

export function resetReads(reload: boolean): void {
  for (const control of controls) {
    control.dropAll();
  }
  for (const handle of bound) {
    handle.reset(reload);
  }
}
