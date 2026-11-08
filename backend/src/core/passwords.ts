import { argon2, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

const MEMORY_KIB = 19_456;
const PASSES = 2;
const PARALLELISM = 1;
const SALT_BYTES = 16;
const TAG_BYTES = 32;
const ONE_TIME_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const ONE_TIME_LENGTH = 16;
const DUMMY_PHC = '$argon2id$v=19$m=19456,t=2,p=1$XxKymB6lRZOSxxklZ7pG8A$F4XO+GvlB88cW2yWUeHusvJig4m5JYkR3t5dDHrQNVI';
const PHC_PATTERN = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

interface Argon2Cost {
  readonly memory: number;
  readonly passes: number;
  readonly parallelism: number;
}

function derive(plain: string, salt: Buffer, cost: Argon2Cost, tagLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2('argon2id', { message: plain.normalize('NFC'), nonce: salt, tagLength, ...cost }, (error, derived) => {
      if (error === null) {
        resolve(derived);
      } else {
        reject(error);
      }
    });
  });
}

function unpadded(bytes: Buffer): string {
  return bytes.toString('base64').replace(/=+$/, '');
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const tag = await derive(plain, salt, { memory: MEMORY_KIB, passes: PASSES, parallelism: PARALLELISM }, TAG_BYTES);
  return `$argon2id$v=19$m=${MEMORY_KIB},t=${PASSES},p=${PARALLELISM}$${unpadded(salt)}$${unpadded(tag)}`;
}

export async function verifyPassword(plain: string, phc: string | null): Promise<boolean> {
  const match = PHC_PATTERN.exec(phc ?? DUMMY_PHC);
  if (match === null) {
    throw new Error('stored password hash is not an Argon2id PHC string');
  }
  const [, memory, passes, parallelism, salt, hash] = match;
  const expected = Buffer.from(hash, 'base64');
  const actual = await derive(
    plain,
    Buffer.from(salt, 'base64'),
    {
      memory: Number.parseInt(memory, 10),
      passes: Number.parseInt(passes, 10),
      parallelism: Number.parseInt(parallelism, 10),
    },
    expected.length,
  );
  return phc !== null && timingSafeEqual(actual, expected);
}

export function oneTimePassword(): string {
  return Array.from({ length: ONE_TIME_LENGTH }, () => ONE_TIME_ALPHABET[randomInt(ONE_TIME_ALPHABET.length)]).join('');
}
