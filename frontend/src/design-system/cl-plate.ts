import View, { type ComponentElement, defineComponent } from '@lightstart/light';
import { html, unsafeHTML } from '@lightstart/light/html';
import { text } from '../text/index.ts';
import { typedDefault } from './typed-default.ts';

export type PlateKind =
  | 'coupe'
  | 'cocktail'
  | 'nick'
  | 'rocks'
  | 'highball'
  | 'flute'
  | 'wine'
  | 'mug'
  | 'shot'
  | 'glass'
  | 'bottle'
  | 'citrus'
  | 'jar';

const drawings = import.meta.glob<string>('./assets/plates/plate-*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const GLASS_PLATES: readonly (readonly [PlateKind, readonly string[]])[] = [
  ['coupe', ['coupe']],
  ['nick', ['nick']],
  ['cocktail', ['martini', 'cocktail glass', 'margarita']],
  ['rocks', ['rocks', 'old fashioned', 'lowball', 'double']],
  ['highball', ['highball', 'collins', 'zombie', 'hurricane', 'pilsner']],
  ['flute', ['flute', 'champagne']],
  ['wine', ['wine', 'goblet', 'snifter', 'tulip']],
  ['mug', ['mug', 'julep', 'tiki', 'cup']],
  ['shot', ['shot']],
];

export function plateForGlass(glassName: string | null): PlateKind {
  const name = glassName?.toLowerCase() ?? '';
  return GLASS_PLATES.find(([, words]) => words.some((word) => name.includes(word)))?.[0] ?? 'glass';
}

export function plateForIngredient(rootCategoryName: string, hasParts: boolean): PlateKind {
  const name = rootCategoryName.toLowerCase();
  if (['juice', 'fruit', 'citrus', 'fresh'].some((word) => name.includes(word))) {
    return 'citrus';
  }
  if (hasParts || ['syrup', 'house', 'bitters', 'cordial'].some((word) => name.includes(word))) {
    return 'jar';
  }
  return 'bottle';
}

const GLASS = typedDefault<PlateKind>('glass');

export const clPlate = defineComponent({
  tag: 'cl-plate',
  style: true,
  props: {
    kind: GLASS,
    name: '',
    small: false,
  },
  render() {
    const drawing = drawings[`./assets/plates/plate-${this.kind}.svg`];
    return html`<span part="cl-plate-art" role="img" aria-label=${text('plate.noPhoto', { name: this.name })}>${unsafeHTML(drawing)}</span>`;
  },
});

View.define(clPlate);

declare global {
  interface HTMLElementTagNameMap {
    'cl-plate': ComponentElement<typeof clPlate>;
  }
}
