export const IMAGE_TYPES = ['image/webp', 'image/jpeg', 'image/png'] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

export const IMAGE_PURPOSES = ['recipe', 'ingredient', 'bottle', 'avatar'] as const;
export type ImagePurpose = (typeof IMAGE_PURPOSES)[number];

export const IMAGE_ASPECT: Readonly<Record<ImagePurpose, readonly [number, number]>> = {
  recipe: [4, 5],
  ingredient: [1, 1],
  bottle: [1, 1],
  avatar: [1, 1],
};

export const IMAGE_ASPECT_TOLERANCE = 0.01;

export function aspectMatches(purpose: ImagePurpose, width: number, height: number): boolean {
  const [aspectWidth, aspectHeight] = IMAGE_ASPECT[purpose];
  const expected = aspectWidth / aspectHeight;
  return Math.abs(width / height - expected) / expected <= IMAGE_ASPECT_TOLERANCE;
}
