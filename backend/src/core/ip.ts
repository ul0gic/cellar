import { isIPv4, isIPv6 } from 'node:net';

export interface IpAddress {
  readonly family: 4 | 6;
  readonly bytes: Uint8Array;
}

export interface IpRange {
  readonly family: 4 | 6;
  readonly address: Uint8Array;
  readonly prefix: number;
  contains(ip: string): boolean;
}

function parseIpv4(text: string): Uint8Array {
  return Uint8Array.from(text.split('.'), (part) => Number.parseInt(part, 10));
}

function parseIpv6(text: string): Uint8Array {
  const bytes = new Uint8Array(16);
  let body = text;
  let tail: Uint8Array = new Uint8Array(0);
  const lastColon = body.lastIndexOf(':');
  if (body.slice(lastColon + 1).includes('.')) {
    tail = parseIpv4(body.slice(lastColon + 1));
    body = `${body.slice(0, lastColon + 1)}0:0`;
  }
  const [head, rest] = body.includes('::') ? body.split('::') : [body, undefined];
  const headGroups = head === '' ? [] : head.split(':');
  const restGroups = rest === undefined || rest === '' ? [] : rest.split(':');
  const groups = [...headGroups, ...Array<string>(8 - headGroups.length - restGroups.length).fill('0'), ...restGroups];
  for (const [index, group] of groups.entries()) {
    const value = Number.parseInt(group, 16);
    bytes[index * 2] = value >> 8;
    bytes[index * 2 + 1] = value & 0xff;
  }
  if (tail.length === 4) {
    bytes.set(tail, 12);
  }
  return bytes;
}

function isMappedIpv4(bytes: Uint8Array): boolean {
  return bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
}

export function parseIp(text: string): IpAddress | null {
  const bare = text.startsWith('[') && text.endsWith(']') ? text.slice(1, -1) : text;
  if (isIPv4(bare)) {
    return { family: 4, bytes: parseIpv4(bare) };
  }
  const withoutZone = bare.split('%')[0];
  if (isIPv6(withoutZone)) {
    const bytes = parseIpv6(withoutZone);
    return isMappedIpv4(bytes) ? { family: 4, bytes: bytes.slice(12) } : { family: 6, bytes };
  }
  return null;
}

function prefixMatches(range: Uint8Array, prefix: number, candidate: Uint8Array): boolean {
  const fullBytes = Math.floor(prefix / 8);
  for (let index = 0; index < fullBytes; index += 1) {
    if (range[index] !== candidate[index]) {
      return false;
    }
  }
  const remainingBits = prefix % 8;
  if (remainingBits === 0) {
    return true;
  }
  const mask = (0xff << (8 - remainingBits)) & 0xff;
  return (range[fullBytes] & mask) === (candidate[fullBytes] & mask);
}

function makeRange(family: 4 | 6, address: Uint8Array, prefix: number): IpRange {
  return {
    family,
    address,
    prefix,
    contains(ip: string): boolean {
      const parsed = parseIp(ip);
      return parsed !== null && parsed.family === family && prefixMatches(address, prefix, parsed.bytes);
    },
  };
}

export function parseIpRange(text: string): IpRange | null {
  const slash = text.indexOf('/');
  const addressText = slash === -1 ? text : text.slice(0, slash);
  const parsed = parseIp(addressText);
  if (parsed === null) {
    return null;
  }
  const maxPrefix = parsed.family === 4 ? 32 : 128;
  if (slash === -1) {
    return makeRange(parsed.family, parsed.bytes, maxPrefix);
  }
  const prefixText = text.slice(slash + 1);
  if (!/^[0-9]{1,3}$/.test(prefixText)) {
    return null;
  }
  const prefix = Number.parseInt(prefixText, 10);
  return prefix > maxPrefix ? null : makeRange(parsed.family, parsed.bytes, prefix);
}

function rangeOf(text: string): IpRange {
  const range = parseIpRange(text);
  if (range === null) {
    throw new Error(`invalid built-in range ${text}`);
  }
  return range;
}

export function rangesOf(texts: readonly string[]): readonly IpRange[] {
  return texts.map(rangeOf);
}

export const PRIVATE_RANGES: readonly IpRange[] = rangesOf([
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  'fc00::/7',
  '127.0.0.0/8',
  '::1/128',
]);
