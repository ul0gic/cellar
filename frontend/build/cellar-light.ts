import { iconMaskCSS } from '@lightstart/components/display/icon-mask.js';
import { themeCSS } from '@lightstart/light/theme';
import { icon } from '@lightstart/light/theme/icons.js';
import { icons as lucide } from '@iconify-json/lucide';
import type { Plugin } from 'vite';
import { cellarTheme } from '../src/design-system/cellar-theme.ts';
import { ICON_NAMES } from '../src/design-system/icon-names.ts';

const LIGHT_CSS_ID = 'virtual:cellar-light.css';
const RESOLVED_LIGHT_CSS_ID = `\0${LIGHT_CSS_ID}`;

function lightStylesheet(): string {
  const entries = ICON_NAMES.map((name) => {
    const entry = icon(lucide, name);
    if (!entry) {
      throw new Error(`Lucide has no icon named ${name}`);
    }
    return { name, entry };
  });
  return `${themeCSS(cellarTheme)}\n${iconMaskCSS(entries, { solid: new Set(['star', 'heart']) })}`;
}

export function cellarLight(): Plugin {
  return {
    name: 'cellar-light',
    resolveId(id) {
      return id === LIGHT_CSS_ID ? RESOLVED_LIGHT_CSS_ID : null;
    },
    load(id) {
      return id === RESOLVED_LIGHT_CSS_ID ? lightStylesheet() : null;
    },
  };
}
