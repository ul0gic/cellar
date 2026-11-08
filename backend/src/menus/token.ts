import { randomBytes, timingSafeEqual } from 'node:crypto';
import { type MenuToken, normalizeMenuToken } from '@cellar/contract';

const CROCKFORD = '0123456789abcdefghjkmnpqrstvwxyz';
const TOKEN_LENGTH = 26;
const RANDOM_BYTES = 17;

export function generateMenuToken(): MenuToken {
  const bytes = randomBytes(RANDOM_BYTES);
  let chars = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5 && chars.length < TOKEN_LENGTH) {
      bits -= 5;
      chars += CROCKFORD[(buffer >> bits) & 31];
    }
    buffer &= (1 << bits) - 1;
  }
  const token = normalizeMenuToken(chars);
  if (token === null) {
    throw new Error('generated menu token does not match MENU_TOKEN_PATTERN');
  }
  return token;
}

export function tokensMatch(presented: MenuToken, stored: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(stored);
  return a.length === b.length && timingSafeEqual(a, b);
}
