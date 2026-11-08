import { createWriteStream } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { crc32, createDeflateRaw, deflateRawSync } from 'node:zlib';

const here = dirname(new URL(import.meta.url).pathname);
const out = process.argv[2] ?? here;
const realDatabase = process.argv[3];

const GIGABYTE = 1024 * 1024 * 1024;
const CHUNK = 1024 * 1024;

type Content = { readonly kind: 'bytes'; readonly bytes: Buffer } | { readonly kind: 'zeros'; readonly size: number };

interface Entry {
  readonly name: string;
  readonly content: Content;
  readonly deflate: boolean;
  readonly mode?: number;
}

interface Written {
  readonly entry: Entry;
  readonly offset: number;
  readonly crc: number;
  readonly size: number;
  readonly compressedSize: number;
}

const manifest = {
  format: 'cellar.backup',
  formatVersion: 1,
  appVersion: '0.1.0',
  schemaVersion: 1,
  createdAt: '2026-11-08T12:00:00.000Z',
  catalogVersion: null,
  counts: {
    members: 1,
    recipes: 0,
    ingredients: 0,
    bottles: 0,
    notes: 0,
    ratings: 0,
    images: 0,
    menus: 0,
    collections: 0,
    calculators: 0,
  },
  files: { database: 'cellar.db', media: 'media/', catalog: null },
};

function bytes(name: string, data: string | Buffer, mode?: number): Entry {
  const buffer = typeof data === 'string' ? Buffer.from(data) : data;
  return mode === undefined
    ? { name, content: { kind: 'bytes', bytes: buffer }, deflate: true }
    : { name, content: { kind: 'bytes', bytes: buffer }, deflate: true, mode };
}

function localHeader(entry: Entry, crc: number, size: number, compressedSize: number): Buffer {
  const name = Buffer.from(entry.name);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(entry.deflate ? 8 : 0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0x21, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(compressedSize, 18);
  header.writeUInt32LE(size, 22);
  header.writeUInt16LE(name.length, 26);
  return Buffer.concat([header, name]);
}

function centralRecord(written: Written): Buffer {
  const { entry } = written;
  const name = Buffer.from(entry.name);
  const record = Buffer.alloc(46);
  record.writeUInt32LE(0x02014b50, 0);
  record.writeUInt16LE((3 << 8) | 20, 4);
  record.writeUInt16LE(20, 6);
  record.writeUInt16LE(0x0800, 8);
  record.writeUInt16LE(entry.deflate ? 8 : 0, 10);
  record.writeUInt16LE(0, 12);
  record.writeUInt16LE(0x21, 14);
  record.writeUInt32LE(written.crc, 16);
  record.writeUInt32LE(written.compressedSize, 20);
  record.writeUInt32LE(written.size, 24);
  record.writeUInt16LE(name.length, 28);
  record.writeUInt32LE(((entry.mode ?? 0o100644) << 16) >>> 0, 38);
  record.writeUInt32LE(written.offset, 42);
  return Buffer.concat([record, name]);
}

function* zeroChunks(size: number): Generator<Buffer> {
  const block = Buffer.alloc(CHUNK);
  for (let left = size; left > 0; left -= CHUNK) {
    yield left >= CHUNK ? block : block.subarray(0, left);
  }
}

async function deflatedZeros(size: number): Promise<{ compressed: Buffer; crc: number }> {
  let crc = 0;
  const pieces: Buffer[] = [];
  const deflate = createDeflateRaw({ level: 1 });
  deflate.on('data', (piece: Buffer) => pieces.push(piece));
  const source = Readable.from(
    (function* checked() {
      for (const chunk of zeroChunks(size)) {
        crc = crc32(chunk, crc);
        yield chunk;
      }
    })(),
  );
  await pipeline(source, deflate);
  return { compressed: Buffer.concat(pieces), crc };
}

async function writeZip(name: string, entries: readonly Entry[]): Promise<void> {
  const target = join(out, name);
  await mkdir(dirname(target), { recursive: true });
  const file = createWriteStream(target);
  const write = (data: Buffer): Promise<void> =>
    new Promise((resolve, reject) => {
      file.write(data, (error) => (error ? reject(error) : resolve()));
    });
  const written: Written[] = [];
  let offset = 0;
  for (const entry of entries) {
    let data: Buffer;
    let crc: number;
    let size: number;
    if (entry.content.kind === 'zeros') {
      ({ compressed: data, crc } = await deflatedZeros(entry.content.size));
      size = entry.content.size;
    } else {
      crc = crc32(entry.content.bytes);
      size = entry.content.bytes.length;
      data = entry.deflate ? deflateRawSync(entry.content.bytes) : entry.content.bytes;
    }
    const header = localHeader(entry, crc, size, data.length);
    await write(header);
    await write(data);
    written.push({ entry, offset, crc, size, compressedSize: data.length });
    offset += header.length + data.length;
  }
  const central = Buffer.concat(written.map(centralRecord));
  await write(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(written.length, 8);
  end.writeUInt16LE(written.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  await write(end);
  await new Promise<void>((resolve) => file.end(resolve));
}

const stubDatabase = Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(4080)]);
const manifestEntry = (value: unknown): Entry => bytes('manifest.json', JSON.stringify(value));
const baseEntries = [manifestEntry(manifest), bytes('cellar.db', stubDatabase)];

const many: Entry[] = [...baseEntries];
for (let index = 0; index < 20_000; index += 1) {
  many.push(bytes(`media/u/${String(index).padStart(5, '0')}.bin`, 'x'));
}
await writeZip('entries-20001.zip', many);

const { counts: _counts, ...manifestWithoutCounts } = manifest;
await writeZip('expanded-over-2gb.zip', [
  ...baseEntries,
  {
    name: 'media/u/zeros.bin',
    content: { kind: 'zeros', size: 2 * GIGABYTE + CHUNK },
    deflate: true,
  },
]);
await writeZip('path-escape.zip', [...baseEntries, bytes('media/../../escape.txt', 'outside')]);
await writeZip('manifest-invalid.zip', [bytes('manifest.json', JSON.stringify(manifestWithoutCounts)), baseEntries[1]]);

await writeZip('extra/path-dotdot-root.zip', [...baseEntries, bytes('../escape.txt', 'outside')]);
await writeZip('extra/path-absolute.zip', [...baseEntries, bytes('/tmp/escape.txt', 'outside')]);
await writeZip('extra/path-backslash.zip', [...baseEntries, bytes('media\\..\\..\\escape.txt', 'outside')]);
await writeZip('extra/path-not-allowed.zip', [...baseEntries, bytes('run/server.json', '{}')]);
await writeZip('extra/path-symlink.zip', [...baseEntries, bytes('media/u/link', '/etc/passwd', 0o120777)]);
await writeZip('extra/manifest-not-json.zip', [bytes('manifest.json', 'not json'), baseEntries[1]]);
await writeZip('extra/manifest-bad-version.zip', [manifestEntry({ ...manifest, formatVersion: 2 }), baseEntries[1]]);
await writeZip('extra/manifest-missing.zip', [baseEntries[1]]);
await writeZip('extra/expanded-two-entries.zip', [
  ...baseEntries,
  { name: 'media/u/a.bin', content: { kind: 'zeros', size: GIGABYTE + CHUNK }, deflate: true },
  { name: 'media/u/b.bin', content: { kind: 'zeros', size: GIGABYTE + CHUNK }, deflate: true },
]);

if (realDatabase !== undefined) {
  await writeZip('control-valid.zip', [manifestEntry(manifest), bytes('cellar.db', await readFile(realDatabase))]);
}
