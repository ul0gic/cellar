import type { ScreenKey, ScreenModule } from './types.ts';

const modules = import.meta.glob<ScreenModule>(['../screens/*/*.ts', '!../screens/*/text.ts']);

export class ScreenLoadError extends Error {}

export async function loadScreen(key: ScreenKey): Promise<ScreenModule | null> {
  const load = modules[`../screens/${key}.ts`];
  if (load === undefined) {
    return null;
  }
  try {
    return await load();
  } catch (error) {
    if (error instanceof TypeError) {
      throw new ScreenLoadError(`The ${key} screen didn't load`, { cause: error });
    }
    throw error;
  }
}
