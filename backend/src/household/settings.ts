import type { CatalogSchedule, HouseholdBrief, HouseholdSettings, PreferredUnit } from '@cellar/contract';
import type { Database } from '../core/db.ts';

export interface StoredSettings {
  readonly requireLogin: boolean;
  readonly currency: string;
  readonly displayUnit: PreferredUnit;
  readonly catalogSchedule: CatalogSchedule;
  readonly aiKey: string | null;
}

export type SettingKey = 'require_login' | 'currency' | 'display_unit' | 'catalog_schedule' | 'ai_key';

const CURRENCY = /^[A-Z]{3}$/;

function stored(db: Database): ReadonlyMap<string, string> {
  const rows = db
    .prepare(
      "SELECT key, value FROM settings WHERE key IN ('require_login', 'currency', 'display_unit', 'catalog_schedule', 'ai_key')",
    )
    .all();
  const values = new Map<string, string>();
  for (const { key, value } of rows) {
    if (typeof key !== 'string' || typeof value !== 'string') {
      throw new Error('settings row has an unexpected shape');
    }
    values.set(key, value);
  }
  return values;
}

export function readSettings(db: Database): StoredSettings {
  const values = stored(db);
  const currency = values.get('currency') ?? 'USD';
  const displayUnit = values.get('display_unit') ?? 'oz';
  const catalogSchedule = values.get('catalog_schedule') ?? 'off';
  if (
    !CURRENCY.test(currency) ||
    (displayUnit !== 'oz' && displayUnit !== 'ml') ||
    (catalogSchedule !== 'off' && catalogSchedule !== 'monthly')
  ) {
    throw new Error('settings table holds a value outside its allowed set');
  }
  return {
    requireLogin: values.get('require_login') !== '0',
    currency,
    displayUnit,
    catalogSchedule,
    aiKey: values.get('ai_key') ?? null,
  };
}

export function writeSetting(db: Database, key: SettingKey, value: string): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}

export function deleteSetting(db: Database, key: SettingKey): void {
  db.prepare('DELETE FROM settings WHERE key = ?').run(key);
}

export function loadedCatalogVersion(db: Database): string | null {
  const row = db.prepare('SELECT version FROM catalog_loads ORDER BY loaded_at DESC LIMIT 1').get();
  return typeof row?.version === 'string' ? row.version : null;
}

export function householdSettings(settings: StoredSettings): HouseholdSettings {
  return {
    requireLogin: settings.requireLogin,
    currency: settings.currency,
    displayUnit: settings.displayUnit,
    catalogSchedule: settings.catalogSchedule,
    ai: { keySet: settings.aiKey !== null, keyLast4: settings.aiKey === null ? null : settings.aiKey.slice(-4) },
  };
}

export function householdBrief(db: Database): HouseholdBrief {
  const settings = readSettings(db);
  return {
    currency: settings.currency,
    displayUnit: settings.displayUnit,
    aiEnabled: settings.aiKey !== null,
    catalogLoaded: loadedCatalogVersion(db) !== null,
  };
}
