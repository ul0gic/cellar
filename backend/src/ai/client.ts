import { LIMITS } from '@cellar/contract';
import type { AppContext } from '../core/context.ts';
import { OutboundError } from '../core/outbound.ts';
import { problem } from '../core/problems.ts';
import { readSettings } from '../household/settings.ts';
import { AiModels } from './models.ts';

const TIMEOUT_MS = 60_000;
const TEXT_MAX_BYTES = 1_048_576;
const PROVIDER_MESSAGE_MAX = 300;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function requireAiKey(ctx: AppContext): string {
  const key = readSettings(ctx.db).aiKey;
  if (key === null) {
    throw problem('ai_not_configured');
  }
  return key;
}

function providerError(message: string) {
  const providerMessage = message.slice(0, PROVIDER_MESSAGE_MAX);
  return problem('ai_provider_error', { detail: `The AI service said: ${providerMessage}`, providerMessage });
}

function errorMessageOf(body: Uint8Array | null): string {
  if (body === null) {
    return 'no answer';
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.from(body).toString('utf8'));
    if (isRecord(parsed) && isRecord(parsed.error) && typeof parsed.error.message === 'string') {
      return parsed.error.message;
    }
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
  }
  return Buffer.from(body).toString('utf8');
}

async function post(ctx: AppContext, path: string, payload: unknown, maxBytes: number): Promise<unknown> {
  const key = requireAiKey(ctx);
  const base = ctx.settings.aiBaseUrl ?? AiModels.baseUrl;
  const url = new URL(path, base);
  let body: Uint8Array;
  try {
    const response = await ctx.outbound.fetch(url.href, {
      method: 'POST',
      body: Buffer.from(JSON.stringify(payload)),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      maxBytes,
      timeoutMs: TIMEOUT_MS,
      allowOnly: (hop) => hop.host === base.host,
      accept: 'application/json',
    });
    body = response.body;
  } catch (error) {
    if (!(error instanceof OutboundError)) {
      throw providerError(error instanceof Error ? error.message : 'the AI service could not be reached');
    }
    switch (error.case) {
      case 'timed_out':
        throw problem('ai_timeout');
      case 'too_large':
        throw payloadTooLargeFor(maxBytes);
      case 'upstream_status':
        throw providerError(errorMessageOf(error.body));
      default:
        throw providerError(error.message);
    }
  }
  try {
    return JSON.parse(Buffer.from(body).toString('utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw providerError('the answer was not JSON');
    }
    throw error;
  }
}

function payloadTooLargeFor(maxBytes: number) {
  return problem('payload_too_large', {
    detail: `The AI answer was larger than ${Math.round(maxBytes / 2 ** 20)} MB.`,
    limitBytes: maxBytes,
  });
}

function outputText(answer: unknown): string {
  if (!isRecord(answer) || !Array.isArray(answer.output)) {
    throw providerError('the answer had no output');
  }
  const parts: string[] = [];
  for (const item of answer.output) {
    if (isRecord(item) && Array.isArray(item.content)) {
      for (const content of item.content) {
        if (isRecord(content) && content.type === 'output_text' && typeof content.text === 'string') {
          parts.push(content.text);
        }
      }
    }
  }
  if (parts.length === 0) {
    throw providerError('the answer had no text');
  }
  return parts.join('');
}

export async function respondText(ctx: AppContext, instructions: string, input: string): Promise<string> {
  const answer = await post(
    ctx,
    'responses',
    { model: AiModels.text, instructions, input: input.slice(0, LIMITS.aiText.max) },
    TEXT_MAX_BYTES,
  );
  return outputText(answer);
}

export async function respondJson(
  ctx: AppContext,
  instructions: string,
  input: string,
  name: string,
  schema: Record<string, unknown>,
): Promise<unknown> {
  const answer = await post(
    ctx,
    'responses',
    {
      model: AiModels.text,
      instructions,
      input: input.slice(0, LIMITS.aiText.max),
      text: { format: { type: 'json_schema', name, schema, strict: true } },
    },
    TEXT_MAX_BYTES,
  );
  try {
    return JSON.parse(outputText(answer));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw providerError('the answer was not the requested JSON');
    }
    throw error;
  }
}

// Sizes keep D-3 §9's aspects (recipe 4:5, ingredient 1:1); GPT image sizes must be multiples of 16.
const IMAGE_SIZES = { recipe: '1024x1280', ingredient: '1024x1024' } as const;

export async function generateImage(
  ctx: AppContext,
  prompt: string,
  purpose: keyof typeof IMAGE_SIZES,
): Promise<Uint8Array> {
  const base64Bytes = Math.ceil((LIMITS.imageFetchedBytes * 4) / 3) + TEXT_MAX_BYTES;
  const answer = await post(
    ctx,
    'images/generations',
    { model: AiModels.image, prompt, size: IMAGE_SIZES[purpose], n: 1, output_format: 'webp' },
    base64Bytes,
  );
  const first = isRecord(answer) && Array.isArray(answer.data) ? answer.data[0] : undefined;
  if (!isRecord(first) || typeof first.b64_json !== 'string') {
    throw providerError('the answer had no image');
  }
  const bytes = Buffer.from(first.b64_json, 'base64');
  if (bytes.length > LIMITS.imageFetchedBytes) {
    throw payloadTooLargeFor(LIMITS.imageFetchedBytes);
  }
  return bytes;
}
