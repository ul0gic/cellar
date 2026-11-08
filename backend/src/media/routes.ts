import { open, readFile } from 'node:fs/promises';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { findMember, requirePerson } from '../auth/sessions.ts';
import type { AppContext } from '../core/context.ts';
import { problem } from '../core/problems.ts';
import { route, type TypedRequest } from '../core/route.ts';
import { fetchImage, findImage, mediaTypeOf } from './store.ts';

const SWEEP_INTERVAL_MS = 3_600_000;
function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'EISDIR');
}

export function register(app: FastifyInstance, ctx: AppContext): void {
  const sweep = (): void => {
    ctx.media.sweepOrphans().catch((error: unknown) => {
      ctx.log.error('Orphan sweep failed', { err: error });
    });
  };
  const timer = setInterval(sweep, SWEEP_INTERVAL_MS);
  timer.unref();
  app.addHook('onClose', (_instance, done) => {
    clearInterval(timer);
    done();
  });

  route(app, 'uploadImage', async (request) => {
    const person = requirePerson(ctx, request);
    const { file, purpose, width, height, thumbhash } = request.body;
    await ctx.media.sweepOrphans();
    const bytes = await readFile(file.path);
    const row = await ctx.media.storeUpload(
      bytes,
      { purpose, width, height, ...(thumbhash === undefined ? {} : { thumbhash }) },
      person.id,
    );
    return ctx.media.imageRef(row, ctx.settings.basePath);
  });

  route(app, 'fetchImage', async (request) => {
    const person = requirePerson(ctx, request);
    const { url, purpose } = request.body;
    const body = await fetchImage(ctx.outbound, url);
    const row = await ctx.media.storeFetched(body, purpose, person.id);
    return ctx.media.imageRef(row, ctx.settings.basePath);
  });

  route(app, 'deleteImage', async (request): Promise<undefined> => {
    const person = requirePerson(ctx, request);
    const image = findImage(ctx.db, request.params.id);
    if (image === null) {
      throw problem('not_found');
    }
    if (image.uploadedBy !== person.id) {
      const uploader = image.uploadedBy === null ? null : findMember(ctx.db, image.uploadedBy);
      throw problem('not_owner', {
        detail:
          uploader === null
            ? 'Only the person who added this image can change it.'
            : `Only ${uploader.name} can change this.`,
      });
    }
    await ctx.media.remove(image.id);
  });

  const notFound = (reply: FastifyReply): Buffer => {
    reply.code(404);
    return Buffer.alloc(0);
  };

  route(app, 'getMedia', async (request: TypedRequest<'getMedia'>, reply) => {
    const { file } = request.params;
    const path = ctx.media.resolveServePath(file);
    const mediaType = mediaTypeOf(file);
    if (path === null || mediaType === null) {
      return notFound(reply);
    }
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await open(path, 'r');
    } catch (error) {
      if (isMissing(error)) {
        return notFound(reply);
      }
      throw error;
    }
    const { size } = await handle.stat();
    reply.headers({
      'content-type': mediaType,
      'content-length': String(size),
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      'content-disposition': 'inline',
      'content-security-policy': "default-src 'none'; sandbox",
    });
    return handle.createReadStream();
  });
}
