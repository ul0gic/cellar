export type MediaType = 'image/webp' | 'image/jpeg' | 'image/png';

export interface ImageHeader {
  mediaType: MediaType;
  extension: 'webp' | 'jpg' | 'png';
  size: { width: number; height: number } | null;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function inspectImage(bytes: Buffer): ImageHeader | null {
  if (bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') {
    return { mediaType: 'image/webp', extension: 'webp', size: webpSize(bytes) };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mediaType: 'image/jpeg', extension: 'jpg', size: jpegSize(bytes) };
  }
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { mediaType: 'image/png', extension: 'png', size: pngSize(bytes) };
  }
  return null;
}

function webpSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 30) {
    return null;
  }
  const chunk = bytes.toString('latin1', 12, 16);
  if (chunk === 'VP8 ') {
    // VP8 key frame: start code 9d 01 2a at offset 23, then 14-bit width and height (RFC 6386 §9.1).
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) {
      return null;
    }
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    // VP8L: signature 0x2f at offset 20, then width-1 and height-1 as 14-bit fields (WebP lossless bitstream, header).
    if (bytes[20] !== 0x2f) {
      return null;
    }
    const bits = bytes.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    // VP8X: canvas width-1 and height-1 as 24-bit little-endian at offsets 24 and 27 (WebP container spec).
    return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
  }
  return null;
}

function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function jpegSize(bytes: Buffer): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      return null;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) {
      return null;
    }
    const length = bytes.readUInt16BE(offset + 2);
    if (isStartOfFrame(marker)) {
      if (offset + 9 > bytes.length) {
        return null;
      }
      return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
    }
    offset += 2 + length;
  }
  return null;
}

function pngSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 24 || bytes.toString('latin1', 12, 16) !== 'IHDR') {
    return null;
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}
