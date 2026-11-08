import type { FastifyReply, FastifyRequest } from 'fastify';

const PRICE_KEYS: ReadonlySet<string> = new Set([
  'pricePaidMinor',
  'valueMinor',
  'barValueMinor',
  'spentMinor',
  'prices',
]);

function withoutPrices(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(withoutPrices);
  }
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      if (!PRICE_KEYS.has(key)) {
        out[key] = withoutPrices(inner);
      }
    }
    return out;
  }
  return value;
}

export function hidePrices(
  request: FastifyRequest,
  _reply: FastifyReply,
  payload: unknown,
  done: (error: null, payload: unknown) => void,
): void {
  done(null, request.person?.showPrices === false ? withoutPrices(payload) : payload);
}
