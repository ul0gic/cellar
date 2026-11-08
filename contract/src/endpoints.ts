import { setupSessionEndpoints } from './setup-session-endpoints.ts';
import { membersEndpoints } from './members-endpoints.ts';
import { settingsEndpoints } from './settings-endpoints.ts';
import { mediaEndpoints } from './media-endpoints.ts';
import { recipesEndpoints } from './recipes-endpoints.ts';
import { notesEndpoints } from './notes-endpoints.ts';
import { ingredientsEndpoints } from './ingredients-endpoints.ts';
import { bottlesEndpoints } from './bottles-endpoints.ts';
import { shoppingEndpoints } from './shopping-endpoints.ts';
import { searchEndpoints } from './search-endpoints.ts';
import { homeStatsEndpoints } from './home-stats-endpoints.ts';
import { menusEndpoints } from './menus-endpoints.ts';
import { wishlistsEndpoints } from './wishlists-endpoints.ts';
import { collectionsEndpoints } from './collections-endpoints.ts';
import { taxonomyEndpoints } from './taxonomy-endpoints.ts';
import { importEndpoints } from './import-endpoints.ts';
import { exportEndpoints } from './export-endpoints.ts';
import { backupEndpoints } from './backup-endpoints.ts';
import { catalogEndpoints } from './catalog-endpoints.ts';
import { aiEndpoints } from './ai-endpoints.ts';
import { systemEndpoints } from './system-endpoints.ts';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type Access = 'public' | 'setup' | 'profile-picker' | 'session' | 'owner' | 'creator';

export interface Endpoint {
  readonly method: HttpMethod;
  readonly path: string;
  readonly access: Access;
}

export const endpoints = {
  ...setupSessionEndpoints,
  ...membersEndpoints,
  ...settingsEndpoints,
  ...mediaEndpoints,
  ...recipesEndpoints,
  ...notesEndpoints,
  ...ingredientsEndpoints,
  ...bottlesEndpoints,
  ...shoppingEndpoints,
  ...searchEndpoints,
  ...homeStatsEndpoints,
  ...menusEndpoints,
  ...wishlistsEndpoints,
  ...collectionsEndpoints,
  ...taxonomyEndpoints,
  ...importEndpoints,
  ...exportEndpoints,
  ...backupEndpoints,
  ...catalogEndpoints,
  ...aiEndpoints,
  ...systemEndpoints,
} as const satisfies Readonly<Record<string, Endpoint>>;

export type OperationId = keyof typeof endpoints;

export function buildPath(op: OperationId, params?: Readonly<Record<string, string | number>>): string {
  return endpoints[op].path.replace(/\{([^}*]+)(\*?)\}/g, (_placeholder, name: string, rest: string) => {
    const value = params?.[name];
    if (value === undefined) {
      throw new Error(`buildPath(${op}) needs a value for {${name}}`);
    }
    const text = String(value);
    return rest === '*' ? text.split('/').map(encodeURIComponent).join('/') : encodeURIComponent(text);
  });
}
