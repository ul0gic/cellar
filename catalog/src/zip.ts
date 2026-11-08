import { crc32 } from 'node:zlib';

const UTF8_NAMES = 0x0800;
const VERSION = 20;
const DOS_TIME = 0;
// 1980-01-01 in MS-DOS date form: (year - 1980) << 9 | month << 5 | day.
const DOS_DATE = (1 << 5) | 1;
const MAX_U16 = 0xffff;
const MAX_U32 = 0xffffffff;

export function storedZip(entries: { name: string; data: Buffer }[]): Buffer {
  if (entries.length > MAX_U16) {
    throw new Error(`a stored zip without zip64 holds at most ${MAX_U16} entries`);
  }
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const crc = crc32(entry.data);
    if (offset > MAX_U32 || entry.data.length > MAX_U32) {
      throw new Error('the release is too large for a zip without zip64');
    }
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(VERSION, 4);
    local.writeUInt16LE(UTF8_NAMES, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(VERSION, 4);
    header.writeUInt16LE(VERSION, 6);
    header.writeUInt16LE(UTF8_NAMES, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(DOS_TIME, 12);
    header.writeUInt16LE(DOS_DATE, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(entry.data.length, 20);
    header.writeUInt32LE(entry.data.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(offset, 42);

    chunks.push(local, name, entry.data);
    central.push(header, name);
    offset += local.length + name.length + entry.data.length;
  }
  const centralSize = central.reduce((sum, chunk) => sum + chunk.length, 0);
  if (offset > MAX_U32 || centralSize > MAX_U32) {
    throw new Error('the release is too large for a zip without zip64');
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, ...central, end]);
}
