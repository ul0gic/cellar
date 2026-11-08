import { z } from 'zod';
import { type Access, endpoints, type OperationId } from './endpoints.ts';
import { ERROR_STATUS, type ErrorCode, type ProblemCode } from './errors.ts';
import { ProblemSchema } from './problem.ts';
import { IMAGE_TYPES } from './images.ts';
import { type ResponseBody, type RouteSchema, routes, type Schema, type SuccessStatus } from './routes.ts';
import type { OpenApiDocument } from './system.ts';

interface JsonObject {
  [key: string]: unknown;
}

const COMPONENTS = '#/components/schemas/';
const LOCAL_DEFS = '#/$defs/';
const PROBLEM_MEDIA_TYPE = 'application/problem+json';
const PRICE_KEYS: ReadonlySet<string> = new Set([
  'pricePaidMinor',
  'valueMinor',
  'barValueMinor',
  'spentMinor',
  'prices',
]);
const PRICE_DESCRIPTION = 'Present only when the requesting person has Show prices on.';
const UNAUTHENTICATED: ReadonlySet<Access> = new Set(['public', 'setup', 'profile-picker']);
const API_PREFIX = '/api/v1/';
const API_CHECK_ERRORS: readonly ProblemCode[] = [
  'restoring',
  'setup_required',
  'invalid_token',
  'login_required',
  'profile_required',
  'origin_mismatch',
  'password_change_required',
  'owner_only',
  'not_owner',
  'bad_request',
  'validation_failed',
  'internal_error',
];
const SUCCESS_DESCRIPTIONS: Readonly<Record<SuccessStatus, string>> = {
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
};
const FILE_RESPONSES: Readonly<Record<Exclude<ResponseBody, Schema | 'empty'>, readonly string[]>> = {
  csv: ['text/csv; charset=utf-8'],
  zip: ['application/zip'],
  html: ['text/html; charset=utf-8'],
  image: IMAGE_TYPES,
};

const conversion = {
  target: 'draft-2020-12',
  io: 'input',
  override: ({ zodSchema, jsonSchema }) => {
    const def = zodSchema._zod.def;
    if (def.type === 'union' && 'discriminator' in def && def.discriminator === 'kind') {
      jsonSchema.discriminator = { propertyName: 'kind' };
    }
  },
} as const satisfies z.core.ToJSONSchemaParams;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mapJson(value: unknown, visit: (node: JsonObject) => JsonObject): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => mapJson(item, visit));
  }
  if (!isObject(value)) {
    return value;
  }
  const mapped: JsonObject = {};
  for (const [key, child] of Object.entries(value)) {
    mapped[key] = mapJson(child, visit);
  }
  return visit(mapped);
}

function collapseNullable(node: JsonObject): JsonObject {
  const options = node.anyOf;
  if (!Array.isArray(options) || options.length !== 2) {
    return node;
  }
  const nullIndex = options.findIndex(
    (option) => isObject(option) && option.type === 'null' && Object.keys(option).length === 1,
  );
  const other: unknown = options[1 - nullIndex];
  if (nullIndex === -1 || !isObject(other) || typeof other.type !== 'string' || 'const' in other) {
    return node;
  }
  const { anyOf: _anyOf, ...rest } = node;
  const merged: JsonObject = { ...rest, ...other, type: [other.type, 'null'] };
  if (Array.isArray(other.enum)) {
    merged.enum = [...other.enum, null];
  }
  return merged;
}

function markPrices(node: JsonObject): JsonObject {
  const properties = node.properties;
  if (!isObject(properties) || !Object.keys(properties).some((key) => PRICE_KEYS.has(key))) {
    return node;
  }
  const marked: JsonObject = {};
  for (const [key, property] of Object.entries(properties)) {
    marked[key] =
      PRICE_KEYS.has(key) && isObject(property) ? { ...property, description: PRICE_DESCRIPTION } : property;
  }
  const result: JsonObject = { ...node, properties: marked };
  if (Array.isArray(node.required)) {
    result.required = node.required.filter((key) => typeof key !== 'string' || !PRICE_KEYS.has(key));
  }
  return result;
}

function pointRefsAtComponents(node: JsonObject): JsonObject {
  if (typeof node.$ref === 'string' && node.$ref.startsWith(LOCAL_DEFS)) {
    return { ...node, $ref: COMPONENTS + node.$ref.slice(LOCAL_DEFS.length) };
  }
  return node;
}

function finish(value: unknown): JsonObject {
  const finished = mapJson(value, (node) => markPrices(collapseNullable(pointRefsAtComponents(node))));
  if (!isObject(finished)) {
    throw new Error('OpenAPI: a schema converted to something other than an object');
  }
  const { $schema: _schema, $id: _id, id: _metaId, $defs: _defs, ...schema } = finished;
  return schema;
}

function buildComponents(): JsonObject {
  const { schemas } = z.toJSONSchema(z.globalRegistry, { ...conversion, uri: (id) => COMPONENTS + id });
  const components: JsonObject = {};
  for (const [id, schema] of Object.entries(schemas)) {
    if (id === '__shared') {
      throw new Error('OpenAPI: a schema is reused or recursive without a registry id; give it one');
    }
    components[id] = finish(schema);
  }
  return components;
}

function registryId(schema: Schema, op: OperationId, part: string): string {
  const id = z.globalRegistry.get(schema)?.id;
  if (id === undefined) {
    throw new Error(`OpenAPI: ${op} ${part} schema has no registry id`);
  }
  return id;
}

function refTo(id: string): JsonObject {
  return { $ref: COMPONENTS + id };
}

function standalone(schema: Schema, components: JsonObject, op: OperationId, part: string): JsonObject {
  const converted = z.toJSONSchema(schema, conversion);
  const defs = converted.$defs;
  if (isObject(defs)) {
    for (const id of Object.keys(defs)) {
      if (!(id in components)) {
        throw new Error(`OpenAPI: ${op} ${part} uses a reused schema "${id}" with no registry id`);
      }
    }
  }
  return finish(converted);
}

function objectProperties(json: JsonObject, op: OperationId, part: string): [string, JsonObject, boolean][] {
  const properties = json.properties;
  if (json.type !== 'object' || !isObject(properties)) {
    throw new Error(`OpenAPI: ${op} ${part} must be an object schema`);
  }
  const required = Array.isArray(json.required) ? json.required : [];
  return Object.entries(properties).map(([name, property]) => {
    if (!isObject(property)) {
      throw new Error(`OpenAPI: ${op} ${part}.${name} is not a schema object`);
    }
    return [name, property, required.includes(name)];
  });
}

function parameters(route: RouteSchema, components: JsonObject, op: OperationId): JsonObject[] {
  const result: JsonObject[] = [];
  if (route.params !== undefined) {
    for (const [name, schema] of objectProperties(standalone(route.params, components, op, 'params'), op, 'params')) {
      result.push({ name, in: 'path', required: true, schema });
    }
  }
  if (route.query !== undefined) {
    for (const [name, schema, required] of objectProperties(
      standalone(route.query, components, op, 'query'),
      op,
      'query',
    )) {
      const array = schema.type === 'array' || (Array.isArray(schema.type) && schema.type.includes('array'));
      result.push({ name, in: 'query', required, schema, ...(array ? { style: 'form', explode: true } : {}) });
    }
  }
  return result;
}

function isFilePart(schema: JsonObject): boolean {
  return schema.type === 'string' && schema.format === 'binary';
}

function fileMediaTypes(schema: JsonObject): string[] {
  if (typeof schema.contentMediaType === 'string') {
    return [schema.contentMediaType];
  }
  if (!Array.isArray(schema.anyOf)) {
    return [];
  }
  return schema.anyOf.flatMap((option) =>
    isObject(option) && typeof option.contentMediaType === 'string' ? [option.contentMediaType] : [],
  );
}

function multipartBody(schema: Schema, components: JsonObject, op: OperationId): JsonObject {
  const json = standalone(schema, components, op, 'multipart body');
  const properties: JsonObject = {};
  const encoding: JsonObject = {};
  for (const [name, part] of objectProperties(json, op, 'multipart body')) {
    if (!isFilePart(part)) {
      properties[name] = part;
      continue;
    }
    properties[name] = { type: 'string', contentMediaType: 'application/octet-stream' };
    const types = fileMediaTypes(part);
    if (types.length > 0) {
      encoding[name] = { contentType: types.join(', ') };
    }
  }
  return {
    required: true,
    content: { 'multipart/form-data': { schema: { ...json, properties }, encoding } },
  };
}

function requestBody(route: RouteSchema, components: JsonObject, op: OperationId): JsonObject | null {
  if (route.body === undefined) {
    return null;
  }
  if ('multipart' in route.body) {
    return multipartBody(route.body.multipart, components, op);
  }
  return {
    required: true,
    content: { 'application/json': { schema: refTo(registryId(route.body, op, 'body')) } },
  };
}

function successResponse(body: ResponseBody, status: SuccessStatus, op: OperationId): JsonObject {
  const description = SUCCESS_DESCRIPTIONS[status];
  if (body === 'empty') {
    return { description };
  }
  if (typeof body === 'string') {
    const content = Object.fromEntries(
      FILE_RESPONSES[body].map((mediaType) => [mediaType, { schema: { type: 'string' } }]),
    );
    return { description, content };
  }
  return {
    description,
    content: { 'application/json': { schema: refTo(registryId(body, op, `${status} response`)) } },
  };
}

function problemCode(code: ErrorCode, op: OperationId): ProblemCode {
  if (code === 'network_error' || code === 'catalog_up_to_date') {
    throw new Error(`OpenAPI: ${op} lists ${code}, which is never a problem response`);
  }
  return code;
}

function errorResponses(route: RouteSchema, path: string, op: OperationId): JsonObject {
  const codes: ProblemCode[] = route.errors.map((code) => problemCode(code, op));
  if (path.startsWith(API_PREFIX)) {
    codes.push(...API_CHECK_ERRORS);
  } else {
    codes.push('internal_error');
  }
  const byStatus = new Map<number, Set<ProblemCode>>();
  for (const code of codes) {
    const status = ERROR_STATUS[code];
    const group = byStatus.get(status) ?? new Set<ProblemCode>();
    group.add(code);
    byStatus.set(status, group);
  }
  const responses: JsonObject = {};
  for (const [status, group] of [...byStatus.entries()].sort(([a], [b]) => a - b)) {
    responses[String(status)] = {
      description: `Problem: ${[...group].join(', ')}`,
      content: { [PROBLEM_MEDIA_TYPE]: { schema: refTo(registryId(ProblemSchema, op, 'problem')) } },
    };
  }
  return responses;
}

function operation(op: OperationId, components: JsonObject): JsonObject {
  const endpoint = endpoints[op];
  const route: RouteSchema = routes[op];
  const responses: JsonObject = {};
  for (const status of [200, 201, 202, 204] as const) {
    const body = route.responses[status];
    if (body !== undefined) {
      responses[String(status)] = successResponse(body, status, op);
    }
  }
  if (Object.keys(responses).length === 0) {
    throw new Error(`OpenAPI: ${op} has no success response`);
  }
  const body = requestBody(route, components, op);
  const params = parameters(route, components, op);
  return {
    operationId: op,
    summary: route.summary,
    tags: [route.tag],
    ...(params.length > 0 ? { parameters: params } : {}),
    ...(body === null ? {} : { requestBody: body }),
    responses: { ...responses, ...errorResponses(route, endpoint.path, op) },
    ...(UNAUTHENTICATED.has(endpoint.access) ? { security: [] } : {}),
    'x-cellar-access': endpoint.access,
  };
}

function isOperationId(key: string): key is OperationId {
  return key in endpoints && key in routes;
}

export function buildOpenApiDocument(options: { version: string; basePath: string }): OpenApiDocument {
  const components = buildComponents();
  const paths: JsonObject = {};
  for (const op of Object.keys(endpoints).filter(isOperationId)) {
    const path = endpoints[op].path.replace(/\{([^}*]+)\*\}/g, '{$1}');
    const item = paths[path];
    const pathItem: JsonObject = isObject(item) ? item : {};
    pathItem[endpoints[op].method.toLowerCase()] = operation(op, components);
    paths[path] = pathItem;
  }
  return {
    openapi: '3.1.1',
    info: {
      title: 'Cellar API',
      version: options.version,
      description:
        'The HTTP API of one Cellar household. Browsers authenticate with the cellar_session cookie set by setup, ' +
        'login or choosing a profile; scripts and apps send a personal API token as Authorization: Bearer clr_…, ' +
        'created in Settings.',
    },
    servers: [{ url: options.basePath === '' ? '/' : options.basePath }],
    security: [{ cookieAuth: [] }, { bearerAuth: [] }],
    paths,
    components: {
      schemas: components,
      securitySchemes: {
        cookieAuth: { type: 'apiKey', in: 'cookie', name: 'cellar_session' },
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'clr_ token' },
      },
    },
  };
}
