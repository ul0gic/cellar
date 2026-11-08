import 'virtual:cellar-light.css';
import { applyCellarTheme } from './app/theme.ts';
import { defineCompositions } from './design-system/compositions.ts';
import { defineLightComponents } from './design-system/light-components.ts';
import './design-system/light.css';
import { startShell } from './app/shell.ts';

applyCellarTheme();
defineLightComponents();
defineCompositions();

const app = document.getElementById('app');
if (app === null) {
  throw new Error('index.html has no #app element');
}
if (import.meta.env.DEV && location.pathname.endsWith('/_demo')) {
  const { mountDemo } = await import('./demo/demo.ts');
  mountDemo(app);
} else {
  await startShell(app);
}
