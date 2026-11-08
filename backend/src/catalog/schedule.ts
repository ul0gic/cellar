import type { AppContext } from '../core/context.ts';
import { ProblemError } from '../core/problems.ts';
import { readSettings } from '../household/settings.ts';
import { runCheck } from './check.ts';

const TICK_MS = 3_600_000;
const CHECK_EVERY_MS = 30 * 86_400_000;
const RETRY_AFTER_FAILURE_MS = 86_400_000;
const NEXT_CHECK_KEY = 'catalog_next_check_at';

function nextCheckAt(ctx: AppContext): number | null {
  const row = ctx.db.prepare('SELECT value FROM settings WHERE key = ?').get(NEXT_CHECK_KEY);
  if (row === undefined || typeof row.value !== 'string') {
    return null;
  }
  const at = Date.parse(row.value);
  return Number.isFinite(at) ? at : null;
}

function setNextCheck(ctx: AppContext, at: number): void {
  ctx.db
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
    .run(NEXT_CHECK_KEY, new Date(at).toISOString());
}

function notify(
  ctx: AppContext,
  kind: 'catalog_update_available' | 'catalog_check_failed',
  version: string | null,
  message: string | null,
): void {
  if (kind === 'catalog_update_available') {
    const already = ctx.db
      .prepare("SELECT 1 FROM notifications WHERE kind = 'catalog_update_available' AND version = ?")
      .get(version);
    if (already !== undefined) {
      return;
    }
  }
  ctx.db
    .prepare('INSERT INTO notifications (kind, version, message, created_at) VALUES (?, ?, ?, ?)')
    .run(kind, version, message, ctx.now().toISOString());
}

async function tick(ctx: AppContext): Promise<void> {
  const now = ctx.now().getTime();
  const due = nextCheckAt(ctx);
  if (readSettings(ctx.db).catalogSchedule !== 'monthly' || (due !== null && now < due)) {
    return;
  }
  try {
    const offer = await runCheck(ctx);
    setNextCheck(ctx, now + CHECK_EVERY_MS);
    if (offer.update !== null) {
      notify(ctx, 'catalog_update_available', offer.update.version, null);
    }
    ctx.log.info('Scheduled catalog check done.', { result: offer.check.result });
  } catch (error) {
    if (!(error instanceof ProblemError)) {
      throw error;
    }
    setNextCheck(ctx, now + RETRY_AFTER_FAILURE_MS);
    notify(ctx, 'catalog_check_failed', null, error.detail);
    ctx.log.warn('Scheduled catalog check failed.', { code: error.code });
  }
}

export function startCatalogSchedule(ctx: AppContext): () => void {
  const timer = setInterval(() => {
    tick(ctx).catch((error: unknown) => ctx.log.error('The catalog schedule tick failed.', { err: error }));
  }, TICK_MS);
  timer.unref();
  return () => clearInterval(timer);
}
