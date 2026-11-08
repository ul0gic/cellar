import type { Problem } from './problem.ts';

export const ERROR_CODES = [
  'bad_request',
  'validation_failed',
  'prices_hidden',
  'login_required',
  'profile_required',
  'invalid_credentials',
  'invalid_token',
  'owner_only',
  'not_owner',
  'origin_mismatch',
  'password_change_required',
  'not_found',
  'setup_required',
  'require_login_blocked',
  'in_use',
  'duplicate_name',
  'invalid_transition',
  'menu_not_live',
  'cannot_remove_owner',
  'token_limit',
  'image_in_use',
  'job_running',
  'catalog_loaded',
  'catalog_update_unavailable',
  'ai_not_configured',
  'payload_too_large',
  'unsupported_media_type',
  'import_has_errors',
  'url_not_allowed',
  'page_too_large',
  'no_recipe_data',
  'backup_invalid',
  'backup_too_new',
  'archive_too_large',
  'catalog_invalid',
  'rate_limited',
  'internal_error',
  'fetch_failed',
  'catalog_unreachable',
  'ai_provider_error',
  'restoring',
  'fetch_timeout',
  'ai_timeout',
  'network_error',
  'catalog_index_invalid',
  'catalog_up_to_date',
  'catalog_needs_newer_app',
  'catalog_url_refused',
  'catalog_no_space',
  'catalog_download_failed',
  'catalog_damaged',
  'catalog_too_large',
  'catalog_busy',
  'catalog_builtin_damaged',
  'insufficient_storage',
  'busy',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export type ProblemCode = Exclude<ErrorCode, 'network_error' | 'catalog_up_to_date'>;

export const ERROR_STATUS: Readonly<Record<ProblemCode, number>> = {
  bad_request: 400,
  validation_failed: 422,
  prices_hidden: 400,
  login_required: 401,
  profile_required: 401,
  invalid_credentials: 401,
  invalid_token: 401,
  owner_only: 403,
  not_owner: 403,
  origin_mismatch: 403,
  password_change_required: 403,
  not_found: 404,
  setup_required: 409,
  require_login_blocked: 409,
  in_use: 409,
  duplicate_name: 409,
  invalid_transition: 409,
  menu_not_live: 409,
  cannot_remove_owner: 409,
  token_limit: 409,
  image_in_use: 409,
  job_running: 409,
  catalog_loaded: 409,
  catalog_update_unavailable: 409,
  ai_not_configured: 409,
  payload_too_large: 413,
  unsupported_media_type: 415,
  import_has_errors: 422,
  url_not_allowed: 422,
  page_too_large: 422,
  no_recipe_data: 422,
  backup_invalid: 422,
  backup_too_new: 422,
  archive_too_large: 422,
  catalog_invalid: 422,
  rate_limited: 429,
  internal_error: 500,
  fetch_failed: 502,
  catalog_unreachable: 502,
  ai_provider_error: 502,
  restoring: 503,
  fetch_timeout: 504,
  ai_timeout: 504,
  catalog_index_invalid: 502,
  catalog_needs_newer_app: 409,
  catalog_url_refused: 502,
  catalog_no_space: 507,
  catalog_download_failed: 502,
  catalog_damaged: 422,
  catalog_too_large: 422,
  catalog_busy: 409,
  catalog_builtin_damaged: 500,
  insufficient_storage: 507,
  busy: 503,
};

export const FIELD_ERROR_CODES = [
  'required',
  'too_short',
  'too_long',
  'out_of_range',
  'too_many',
  'invalid_format',
  'invalid_value',
  'not_found',
  'duplicate',
  'tree_too_deep',
  'tree_cycle',
  'parts_cycle',
  'expression_invalid',
  'wrong_password',
  'aspect_mismatch',
  'verdict_not_allowed',
  'note_empty',
  'order_mismatch',
  'same_ingredient',
] as const;
export type FieldErrorCode = (typeof FIELD_ERROR_CODES)[number];

function isErrorCode(value: unknown): value is ErrorCode {
  return ERROR_CODES.some((code) => code === value);
}

export function isProblem(value: unknown): value is Problem {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return (
    'type' in value &&
    typeof value.type === 'string' &&
    'title' in value &&
    typeof value.title === 'string' &&
    'status' in value &&
    typeof value.status === 'number' &&
    'code' in value &&
    isErrorCode(value.code) &&
    'detail' in value &&
    typeof value.detail === 'string' &&
    'requestId' in value &&
    typeof value.requestId === 'string'
  );
}
