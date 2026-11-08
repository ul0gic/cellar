import { rgbaToThumbHash, thumbHashToDataURL } from 'thumbhash';

// D-3 §9: the placeholder is computed from a copy scaled to at most 100 x 100.
const MAX_SIDE = 100;

export async function thumbHashOf(image: Blob): Promise<string> {
  const full = await createImageBitmap(image);
  const scale = Math.min(1, MAX_SIDE / Math.max(full.width, full.height));
  const width = Math.max(1, Math.round(full.width * scale));
  const height = Math.max(1, Math.round(full.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null) {
    full.close();
    throw new Error('This browser gave no 2D canvas for the photo placeholder');
  }
  context.drawImage(full, 0, 0, width, height);
  full.close();
  const hash = rgbaToThumbHash(width, height, context.getImageData(0, 0, width, height).data);
  return btoa(String.fromCharCode(...hash));
}

export function thumbHashDataUrl(base64: string): string {
  return thumbHashToDataURL(Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)));
}
