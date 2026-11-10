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

function fill(template: string, vars: Readonly<Record<string, unknown>> | undefined): string {
  if (vars === undefined) {
    return template;
  }
  return template.replace(PLACEHOLDER, (placeholder, name: string) => {
    const value = vars[name];
    return typeof value === 'string' || typeof value === 'number' ? String(value) : placeholder;
  });
}

export function lookupText(key: string, vars?: Readonly<Record<string, unknown>>): string | undefined {
  const template = strings.get(key);
  return template === undefined ? undefined : fill(template, vars);
}

export function text(key: TextKey, vars?: TextVars): string {
  const found = lookupText(key, vars);
  if (found === undefined) {
    throw new Error(`No string for text key ${key}`);
  }
  return found;
}
