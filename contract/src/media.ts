import { z } from 'zod';
import { IMAGE_PURPOSES, IMAGE_TYPES } from './images.ts';
import { LIMITS } from './limits.ts';
import type { mediaEndpoints } from './media-endpoints.ts';
import { ImageRefSchema, idParams } from './primitives.ts';
import type { RouteSchema } from './routes.ts';

export const ImagePurposeSchema = z.enum(IMAGE_PURPOSES).meta({ id: 'ImagePurpose' });

const dimension = z.coerce.number().int().min(1).max(LIMITS.imageLongSide);

export const ImageUploadPartsSchema = z.strictObject({
  file: z.file().mime([...IMAGE_TYPES]),
  purpose: ImagePurposeSchema,
  width: dimension,
  height: dimension,
  thumbhash: z.string().max(48).optional(),
});
export type ImageUploadParts = z.infer<typeof ImageUploadPartsSchema>;

export const ImageFetchInputSchema = z
  .strictObject({
    url: z.url({ protocol: /^https?$/ }).max(LIMITS.url.max),
    purpose: ImagePurposeSchema,
  })
  .meta({ id: 'ImageFetchInput' });
export type ImageFetchInput = z.infer<typeof ImageFetchInputSchema>;

export const mediaRoutes = {
  uploadImage: {
    body: { multipart: ImageUploadPartsSchema },
    responses: { 201: ImageRefSchema },
    errors: ['payload_too_large', 'unsupported_media_type', 'validation_failed'],
    summary: 'Upload a cropped image',
    tag: 'media',
  },
  fetchImage: {
    body: ImageFetchInputSchema,
    responses: { 201: ImageRefSchema },
    errors: ['url_not_allowed', 'fetch_failed', 'fetch_timeout', 'payload_too_large', 'unsupported_media_type'],
    summary: 'Fetch an image from a web address',
    tag: 'media',
  },
  deleteImage: {
    params: idParams,
    responses: { 204: 'empty' },
    errors: ['not_found', 'image_in_use'],
    summary: 'Delete an image nothing uses',
    tag: 'media',
  },
  getMedia: {
    params: z.object({ file: z.string().min(1) }),
    responses: { 200: 'image' },
    errors: [],
    summary: 'Get a stored image',
    tag: 'media',
  },
} as const satisfies Record<keyof typeof mediaEndpoints, RouteSchema>;
