import type { Readable } from 'node:stream';
import { type Endpoint, endpoints, type OperationId } from '@cellar/contract';
import { type ResponseBody, type RouteSchema, routes, type Schema } from '@cellar/contract/schemas';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { AppContext } from './context.ts';
import { type MultipartBody, multipartReader, removeUploads } from './multipart.ts';

type RouteOf<Op extends OperationId> = (typeof routes)[Op];
type OutputOf<S> = S extends z.ZodType ? z.output<S> : undefined;
type ParamsOf<Op extends OperationId> = RouteOf<Op> extends { readonly params: infer S } ? OutputOf<S> : undefined;
type QueryOf<Op extends OperationId> = RouteOf<Op> extends { readonly query: infer S } ? OutputOf<S> : undefined;
type BodyOf<Op extends OperationId> =
  RouteOf<Op> extends { readonly body: infer S }
    ? S extends { readonly multipart: infer M }
      ? MultipartBody<M>
      : OutputOf<S>
    : undefined;
type ResponseValue<R> = R extends z.ZodType
  ? z.output<R>
  : R extends 'empty'
    ? undefined
    : R extends 'zip' | 'image'
      ? Readable | Buffer
      : string | Readable;

export type ApiOutput<Op extends OperationId> = ResponseValue<RouteOf<Op>['responses'][keyof RouteOf<Op>['responses']]>;

export type TypedRequest<Op extends OperationId> = Omit<FastifyRequest, 'params' | 'query' | 'body'> & {
  readonly params: ParamsOf<Op>;
  readonly query: QueryOf<Op>;
  readonly body: BodyOf<Op>;
};

export type RouteHandler<Op extends OperationId> = (
  request: TypedRequest<Op>,
  reply: FastifyReply,
) => Promise<ApiOutput<Op>>;

export interface RouteModule {
  register(app: FastifyInstance, ctx: AppContext): void;
}

const CONTENT_TYPES = {
  csv: 'text/csv; charset=utf-8',
  zip: 'application/zip',
  html: 'text/html; charset=utf-8',
} as const;

const REST_PARAM = /\{([^}]+)\*\}/;

function toFastifyPath(path: string): string {
  return path.replace(REST_PARAM, '*').replace(/\{([^}]+)\}/g, ':$1');
}

function renameWildcard(params: unknown, name: string): Record<string, unknown> {
  const renamed: Record<string, unknown> = {};
  if (typeof params === 'object' && params !== null) {
    for (const [key, value] of Object.entries(params)) {
      renamed[key === '*' ? name : key] = value;
    }
  }
  return renamed;
}

function isSchema(body: ResponseBody): body is Schema {
  return typeof body !== 'string';
}

export function route<Op extends OperationId>(app: FastifyInstance, op: Op, handler: RouteHandler<Op>): void {
  const endpoint: Endpoint = endpoints[op];
  const def: RouteSchema = routes[op];
  const successes = Object.entries(def.responses).flatMap(([status, body]) =>
    body === undefined ? [] : [{ status: Number.parseInt(status, 10), body }],
  );
  const response: Record<number, Schema> = {};
  let contentType: string | undefined;
  for (const { status, body } of successes) {
    if (isSchema(body)) {
      response[status] = body;
    } else if (body !== 'empty' && body !== 'image') {
      contentType = CONTENT_TYPES[body];
    }
  }
  const defaultStatus = successes.length === 1 ? successes[0].status : undefined;
  const requestBody = def.body === undefined || 'multipart' in def.body ? undefined : def.body;
  const readMultipart =
    def.body !== undefined && 'multipart' in def.body ? multipartReader(op, def.body.multipart) : undefined;
  const restParam = REST_PARAM.exec(endpoint.path)?.[1];
  app.route({
    method: endpoint.method,
    url: toFastifyPath(endpoint.path),
    ...(restParam === undefined
      ? {}
      : {
          preValidation: (request: FastifyRequest, _reply: FastifyReply, done: () => void) => {
            request.params = renameWildcard(request.params, restParam);
            done();
          },
        }),
    schema: {
      ...(def.params === undefined ? {} : { params: def.params }),
      ...(def.query === undefined ? {} : { querystring: def.query }),
      ...(requestBody === undefined ? {} : { body: requestBody }),
      response,
    },
    config: { access: endpoint.access, op },
    ...(readMultipart === undefined ? {} : { onResponse: removeUploads }),
    handler: async (request, reply) => {
      if (readMultipart !== undefined) {
        request.body = await readMultipart(request);
      }
      if (defaultStatus !== undefined) {
        reply.code(defaultStatus);
      }
      if (contentType !== undefined) {
        reply.type(contentType);
      }
      // biome-ignore lint/nursery/noUnsafeTypeAssertion: the validator compiler has already replaced params, query and body with routes[op]'s parsed output, which Fastify's route types cannot carry for a generic op
      return handler(request as TypedRequest<Op>, reply);
    },
  });
}
