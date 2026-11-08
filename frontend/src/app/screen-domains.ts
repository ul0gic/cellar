export const SCREEN_DOMAINS = [
  'setup',
  'login',
  'home',
  'recipes',
  'ingredients',
  'shelf',
  'history',
  'shopping',
  'wishlists',
  'collections',
  'party',
  'calculators',
  'menus',
  'search',
  'stats',
  'import-export',
  'settings',
  'print',
  'launch',
] as const;

export type ScreenDomain = (typeof SCREEN_DOMAINS)[number];
