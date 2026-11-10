type Listener = (payload: unknown) => unknown;

const listeners = new Map<string, Set<Listener>>();

export const bus = {
  on(key: string, cb: Listener): () => void {
    const held = listeners.get(key) ?? new Set<Listener>();
    held.add(cb);
    listeners.set(key, held);
    return () => {
      held.delete(cb);
    };
  },
  emit(key: string, payload: unknown): void {
    const held = listeners.get(key);
    if (held === undefined) {
      return;
    }
    for (const listener of [...held]) {
      if (held.has(listener)) {
        listener(payload);
      }
    }
  },
};
