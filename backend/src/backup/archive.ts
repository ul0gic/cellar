import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import { type FileHandle, open } from 'node:fs/promises';
import { Readable, Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { crc32, createDeflateRaw, createInflateRaw } from 'node:zlib';
import { ProblemError, problem } from '../core/problems.ts';

// ZIP file format (PKWARE APPNOTE 6.3.10): signatures and fixed header sizes, section 4.3.
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const DESCRIPTOR_SIGNATURE = 0x08074b50;
const EOCD_BYTES = 22;
const CENTRAL_BYTES = 46;
const LOCAL_BYTES = 30;
const DESCRIPTOR_BYTES = 16;
const MAX_COMMENT = 0xffff;
const MAX_U16 = 0xffff;
const MAX_U32 = 0xffffffff;
const FLAG_ENCRYPTED = 0x0001;
const FLAG_DESCRIPTOR = 0x0008;
const FLAG_UTF8 = 0x0800;
const STORED = 0;
const DEFLATED = 8;
const VERSION_NEEDED = 20;
const MADE_BY_UNIX = (3 << 8) | VERSION_NEEDED;
const FILE_MODE = 0o100644;
const TYPE_MASK = 0o170000;
const SYMLINK = 0o120000;
// One event-loop turn per MiB, not per 16 or 64 KiB, keeps an archive moving while other requests share the loop.
const STREAM_CHUNK_BYTES = 1 << 20;

export type ArchiveRefusal = 'unreadable' | 'entries' | 'expanded' | 'path';

export class ArchiveError extends ProblemError {
  readonly reason: ArchiveRefusal;

  constructor(reason: ArchiveRefusal, cause: string) {
    const base = reason === 'unreadable' ? problem('backup_invalid') : problem('archive_too_large');
    super(base.code, base.detail);
    this.reason = reason;
    this.message = cause;
  }
}

export interface ZipEntry {
  readonly path: string;
  readonly size: number;
  readonly compressedSize: number;
  readonly method: typeof STORED | typeof DEFLATED;
  open(): Promise<Readable>;
}

export interface ZipBounds {
  readonly entries: number;
  readonly expandedBytes: number;
  readonly allowPath: (path: string) => boolean;
}

interface CentralRecord {
  readonly path: string;
  readonly size: number;
  readonly compressedSize: number;
  readonly method: typeof STORED | typeof DEFLATED;
  readonly crc: number;
  readonly localOffset: number;
}

async function readAt(handle: FileHandle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  if (bytesRead !== length) {
    throw new ArchiveError('unreadable', `short read at ${position}`);
  }
  return buffer;
}

function isSafePath(path: string): boolean {
  if (path === '' || path.startsWith('/') || path.includes('\\') || path.includes('\0') || /^[A-Za-z]:/.test(path)) {
    return false;
  }
  const segments = path.endsWith('/') ? path.slice(0, -1).split('/') : path.split('/');
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

async function findEnd(handle: FileHandle, fileBytes: number): Promise<Buffer> {
  const tailBytes = Math.min(fileBytes, EOCD_BYTES + MAX_COMMENT);
  if (tailBytes < EOCD_BYTES) {
    throw new ArchiveError('unreadable', 'file is shorter than a zip end record');
  }
  const tail = await readAt(handle, fileBytes - tailBytes, tailBytes);
  for (let at = tail.length - EOCD_BYTES; at >= 0; at -= 1) {
    if (tail.readUInt32LE(at) === EOCD_SIGNATURE && at + EOCD_BYTES + tail.readUInt16LE(at + 20) === tail.length) {
      return tail.subarray(at, at + EOCD_BYTES);
    }
  }
  throw new ArchiveError('unreadable', 'no zip end record');
}

async function readCentral(handle: FileHandle, bounds: ZipBounds): Promise<CentralRecord[]> {
  const fileBytes = (await handle.stat()).size;
  const end = await findEnd(handle, fileBytes);
  const count = end.readUInt16LE(10);
  const centralBytes = end.readUInt32LE(12);
  const centralOffset = end.readUInt32LE(16);
  if (end.readUInt16LE(4) !== 0 || end.readUInt16LE(6) !== 0 || end.readUInt16LE(8) !== count) {
    throw new ArchiveError('unreadable', 'multi-disk zip');
  }
  if (count === MAX_U16 || centralBytes === MAX_U32 || centralOffset === MAX_U32) {
    throw new ArchiveError('expanded', 'zip64 archive');
  }
  if (count > bounds.entries) {
    throw new ArchiveError('entries', `${count} entries, over ${bounds.entries}`);
  }
  if (centralOffset + centralBytes > fileBytes) {
    throw new ArchiveError('unreadable', 'central directory past the end of the file');
  }
  const central = await readAt(handle, centralOffset, centralBytes);
  const records: CentralRecord[] = [];
  const seen = new Set<string>();
  let expanded = 0;
  let at = 0;
  for (let index = 0; index < count; index += 1) {
    if (at + CENTRAL_BYTES > central.length || central.readUInt32LE(at) !== CENTRAL_SIGNATURE) {
      throw new ArchiveError('unreadable', `central record ${index} is damaged`);
    }
    const flags = central.readUInt16LE(at + 8);
    const method = central.readUInt16LE(at + 10);
    const compressedSize = central.readUInt32LE(at + 20);
    const size = central.readUInt32LE(at + 24);
    const nameBytes = central.readUInt16LE(at + 28);
    const recordBytes = CENTRAL_BYTES + nameBytes + central.readUInt16LE(at + 30) + central.readUInt16LE(at + 32);
    const mode = central.readUInt32LE(at + 38) >>> 16;
    const localOffset = central.readUInt32LE(at + 42);
    if (at + recordBytes > central.length) {
      throw new ArchiveError('unreadable', `central record ${index} runs past the directory`);
    }
    const path = central.toString('utf8', at + CENTRAL_BYTES, at + CENTRAL_BYTES + nameBytes);
    if (compressedSize === MAX_U32 || size === MAX_U32 || localOffset === MAX_U32) {
      throw new ArchiveError('expanded', `${path} needs zip64`);
    }
    if ((flags & FLAG_ENCRYPTED) !== 0 || (method !== STORED && method !== DEFLATED)) {
      throw new ArchiveError('unreadable', `${path} is encrypted or uses compression method ${method}`);
    }
    if ((mode & TYPE_MASK) === SYMLINK || !isSafePath(path) || seen.has(path) || !bounds.allowPath(path)) {
      throw new ArchiveError('path', `entry ${JSON.stringify(path)} is not allowed`);
    }
    expanded += size;
    if (expanded > bounds.expandedBytes) {
      throw new ArchiveError('expanded', `expands past ${bounds.expandedBytes} bytes`);
    }
    if (method === STORED && compressedSize !== size) {
      throw new ArchiveError('unreadable', `${path} is stored with mismatched sizes`);
    }
    seen.add(path);
    records.push({ path, size, compressedSize, method, crc: central.readUInt32LE(at + 16), localOffset });
    at += recordBytes;
  }
  return records;
}

class BoundedCheck extends Transform {
  private received = 0;
  private crc = 0;
  private readonly record: CentralRecord;

  constructor(record: CentralRecord) {
    super();
    this.record = record;
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, done: TransformCallback): void {
    this.received += chunk.length;
    if (this.received > this.record.size) {
      done(new ArchiveError('expanded', `${this.record.path} expands past its declared ${this.record.size} bytes`));
      return;
    }
    this.crc = crc32(chunk, this.crc);
    done(null, chunk);
  }

  override _flush(done: TransformCallback): void {
    if (this.received !== this.record.size || this.crc !== this.record.crc) {
      done(new ArchiveError('unreadable', `${this.record.path} is damaged`));
      return;
    }
    done();
  }
}

async function readLocalHeader(path: string, offset: number): Promise<Buffer> {
  const handle = await open(path, 'r');
  try {
    return await readAt(handle, offset, LOCAL_BYTES);
  } finally {
    await handle.close();
  }
}

function entryOf(path: string, record: CentralRecord): ZipEntry {
  return {
    path: record.path,
    size: record.size,
    compressedSize: record.compressedSize,
    method: record.method,
    async open() {
      const local = await readLocalHeader(path, record.localOffset);
      if (local.readUInt32LE(0) !== LOCAL_SIGNATURE) {
        throw new ArchiveError('unreadable', `${record.path} has no local header`);
      }
      const dataStart = record.localOffset + LOCAL_BYTES + local.readUInt16LE(26) + local.readUInt16LE(28);
      const check = new BoundedCheck(record);
      if (record.compressedSize === 0) {
        check.end();
        return check;
      }
      const raw = createReadStream(path, { start: dataStart, end: dataStart + record.compressedSize - 1 });
      const source = record.method === DEFLATED ? raw.pipe(createInflateRaw()) : raw;
      source.on('error', (error) => check.destroy(error));
      return source.pipe(check);
    },
  };
}

export async function* readBoundedZip(path: string, bounds: ZipBounds): AsyncIterable<ZipEntry> {
  let handle: FileHandle;
  try {
    handle = await open(path, 'r');
  } catch (error) {
    throw new ArchiveError('unreadable', error instanceof Error ? error.message : 'cannot open');
  }
  try {
    const records = await readCentral(handle, bounds);
    for (const record of records) {
      yield entryOf(path, record);
    }
  } finally {
    await handle.close();
  }
}

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getUTCFullYear());
  return {
    time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  };
}

export type ZipMethod = 'stored' | 'deflated';

export interface ZipWriter {
  addFile(name: string, source: string, method: ZipMethod): Promise<void>;
  addBuffer(name: string, data: Buffer, method: ZipMethod): Promise<void>;
  finish(): Promise<number>;
}

export function createZipWriter(out: NodeJS.WritableStream, modified: Date): ZipWriter {
  const stamp = dosDateTime(modified);
  const central: Buffer[] = [];
  let offset = 0;
  let count = 0;
  const closed = new AbortController();
  out.once('close', () => closed.abort(new Error('the archive destination closed')));

  const write = async (chunk: Buffer): Promise<void> => {
    closed.signal.throwIfAborted();
    offset += chunk.length;
    if (offset > MAX_U32) {
      throw new Error('archive passed 4 GiB, the limit without zip64');
    }
    if (!out.write(chunk)) {
      await once(out, 'drain', { signal: closed.signal });
    }
  };

  const addStream = async (name: string, source: Readable, method: ZipMethod): Promise<void> => {
    if (count === MAX_U16) {
      throw new Error(`archive passed ${MAX_U16} entries, the limit without zip64`);
    }
    const nameBytes = Buffer.from(name, 'utf8');
    const methodId = method === 'deflated' ? DEFLATED : STORED;
    const flags = FLAG_DESCRIPTOR | FLAG_UTF8;
    const localOffset = offset;
    const local = Buffer.alloc(LOCAL_BYTES);
    local.writeUInt32LE(LOCAL_SIGNATURE, 0);
    local.writeUInt16LE(VERSION_NEEDED, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(methodId, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt16LE(nameBytes.length, 26);
    await write(Buffer.concat([local, nameBytes]));

    let crc = 0;
    let size = 0;
    let compressedSize = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        crc = crc32(chunk, crc);
        size += chunk.length;
        done(null, chunk);
      },
    });
    const drain = async (compressed: AsyncIterable<Buffer>) => {
      for await (const chunk of compressed) {
        compressedSize += chunk.length;
        await write(chunk);
      }
    };
    if (method === 'deflated') {
      await pipeline(source, counter, createDeflateRaw({ chunkSize: STREAM_CHUNK_BYTES }), drain);
    } else {
      await pipeline(source, counter, drain);
    }

    const descriptor = Buffer.alloc(DESCRIPTOR_BYTES);
    descriptor.writeUInt32LE(DESCRIPTOR_SIGNATURE, 0);
    descriptor.writeUInt32LE(crc, 4);
    descriptor.writeUInt32LE(compressedSize, 8);
    descriptor.writeUInt32LE(size, 12);
    await write(descriptor);

    const header = Buffer.alloc(CENTRAL_BYTES);
    header.writeUInt32LE(CENTRAL_SIGNATURE, 0);
    header.writeUInt16LE(MADE_BY_UNIX, 4);
    header.writeUInt16LE(VERSION_NEEDED, 6);
    header.writeUInt16LE(flags, 8);
    header.writeUInt16LE(methodId, 10);
    header.writeUInt16LE(stamp.time, 12);
    header.writeUInt16LE(stamp.date, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(compressedSize, 20);
    header.writeUInt32LE(size, 24);
    header.writeUInt16LE(nameBytes.length, 28);
    header.writeUInt32LE((FILE_MODE << 16) >>> 0, 38);
    header.writeUInt32LE(localOffset, 42);
    central.push(header, nameBytes);
    count += 1;
  };

  return {
    addFile(name, source, method) {
      return addStream(name, createReadStream(source, { highWaterMark: STREAM_CHUNK_BYTES }), method);
    },
    addBuffer(name, data, method) {
      return addStream(name, Readable.from([data]), method);
    },
    async finish() {
      const centralOffset = offset;
      const directory = Buffer.concat(central);
      await write(directory);
      const end = Buffer.alloc(EOCD_BYTES);
      end.writeUInt32LE(EOCD_SIGNATURE, 0);
      end.writeUInt16LE(count, 8);
      end.writeUInt16LE(count, 10);
      end.writeUInt32LE(directory.length, 12);
      end.writeUInt32LE(centralOffset, 16);
      await write(end);
      return offset;
    },
  };
}
