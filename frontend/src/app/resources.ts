import type { OperationId } from '@cellar/contract';
import type { Resource } from '@lightstart/light/controller';
import { resource } from '@lightstart/light/controller/resource';
import { type ApiInput, type ApiOutput, call } from './api.ts';

export type ResourceTag =
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

interface Entry {
  readonly tags: ReadonlySet<ResourceTag>;
  readonly resource: unknown;
  readonly live: () => boolean;
  readonly refresh: () => void;
  readonly dispose: () => void;
}

const entries = new Map<string, Entry>();

export function resourceFor<Op extends OperationId>(
  op: Op,
  input: ApiInput<Op>,
  opts: { readonly tags?: readonly ResourceTag[] } = {},
): Resource<ApiOutput<Op>> {
  const key = `${op} ${JSON.stringify(input)}`;
  const existing = entries.get(key);
  if (existing !== undefined) {
    // biome-ignore lint/nursery/noUnsafeTypeAssertion: the key starts with op, so this entry was built by op's own fetcher below
    return existing.resource as Resource<ApiOutput<Op>>;
  }
  const created = resource(() => call(op, input), { name: op, ready: false });
  entries.set(key, {
    tags: new Set(opts.tags ?? []),
    resource: created,
    live: () => created.value._subscribers.size > 0,
    refresh: () => created.invalidate(),
    dispose: () => created.dispose(),
  });
  return created;
}

export function invalidate(...tags: readonly ResourceTag[]): void {
  for (const [key, entry] of entries) {
    if (!tags.some((tag) => entry.tags.has(tag))) {
      continue;
    }
    if (entry.live()) {
      entry.refresh();
    } else {
      entry.dispose();
      entries.delete(key);
    }
  }
}
