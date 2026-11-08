import type { z } from 'zod';
import type { Endpoint } from './endpoints.ts';

export const menusEndpoints = {
  listMenus: { method: 'GET', path: '/api/v1/menus', access: 'session' },
  createMenu: { method: 'POST', path: '/api/v1/menus', access: 'session' },
  getMenu: { method: 'GET', path: '/api/v1/menus/{id}', access: 'session' },
  replaceMenu: { method: 'PUT', path: '/api/v1/menus/{id}', access: 'session' },
  deleteMenu: { method: 'DELETE', path: '/api/v1/menus/{id}', access: 'session' },
  copyMenu: { method: 'POST', path: '/api/v1/menus/{id}/copy', access: 'session' },
  makeMenuLive: { method: 'POST', path: '/api/v1/menus/{id}/live', access: 'session' },
  endMenu: { method: 'DELETE', path: '/api/v1/menus/{id}/live', access: 'session' },
  rotateMenuLink: { method: 'POST', path: '/api/v1/menus/{id}/link/rotate', access: 'session' },
  addMakeableToMenu: { method: 'POST', path: '/api/v1/menus/{id}/makeable', access: 'session' },
  showMenuDisplay: { method: 'GET', path: '/m/{token}', access: 'public' },
  showMenuRecipe: { method: 'GET', path: '/m/{token}/r/{recipeId}', access: 'public' },
  getMenuDisplayState: { method: 'GET', path: '/m/{token}/state', access: 'public' },
} as const satisfies Readonly<Record<string, Endpoint>>;

export const MENU_TOKEN_PATTERN = /^[0-9a-hjkmnp-tv-z]{26}$/;
const MENU_TOKEN_GROUP = 5;

export type MenuToken = string & z.$brand<'MenuToken'>;

function isMenuToken(value: string): value is MenuToken {
  return MENU_TOKEN_PATTERN.test(value);
}

export function normalizeMenuToken(raw: string): MenuToken | null {
  const folded = raw.toLowerCase().replace(/[\s-]/g, '').replace(/[il]/g, '1').replace(/o/g, '0');
  return isMenuToken(folded) ? folded : null;
}

export function formatMenuTokenForDisplay(token: MenuToken): string {
  const groups: string[] = [];
  for (let start = 0; start < token.length; start += MENU_TOKEN_GROUP) {
    groups.push(token.slice(start, start + MENU_TOKEN_GROUP));
  }
  return groups.join('-');
}
