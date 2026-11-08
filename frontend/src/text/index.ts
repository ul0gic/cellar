import type { ScreenDomain } from '../app/screen-domains.ts';
import { en } from './en.ts';

export type TextKey = keyof typeof en | `${ScreenDomain}.${string}`;
export type TextVars = Readonly<Record<string, string | number>>;

const screenStrings = import.meta.glob<Readonly<Record<string, string>>>('../screens/*/text.ts', {
  eager: true,
  import: 'strings',
});

const strings: ReadonlyMap<string, string> = new Map([
  ...Object.entries(en),
  ...Object.values(screenStrings).flatMap((domain) => Object.entries(domain)),
]);

const PLACEHOLDER = /\{(\w+)\}/g;

export function text(key: TextKey, vars?: TextVars): string {
  const template = strings.get(key);
  if (template === undefined) {
    throw new Error(`No string for text key ${key}`);
  }
  if (vars === undefined) {
    return template;
  }
  return template.replace(PLACEHOLDER, (placeholder, name: string) => {
    const value = vars[name];
    return value === undefined ? placeholder : String(value);
  });
}
