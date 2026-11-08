import type { ThemeChoice } from '@cellar/contract';
import { configureTheme } from '@lightstart/light/theme';
import { colorScheme } from '@lightstart/light/theme/color-scheme.js';

export function applyCellarTheme(): void {
  configureTheme({ requestFont: () => undefined });
  const served = document.documentElement.dataset.colorScheme;
  if (served === 'light' || served === 'dark') {
    colorScheme.choose(served === 'dark');
    return;
  }
  colorScheme.start('system');
}

export function chooseTheme(choice: ThemeChoice): void {
  switch (choice) {
    case 'light':
      colorScheme.choose(false);
      return;
    case 'dark':
      colorScheme.choose(true);
      return;
    case 'system':
      colorScheme.follow();
      return;
  }
}
