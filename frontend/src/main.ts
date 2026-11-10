import './app/boot.ts';
import 'virtual:cellar-light.css';
import { configureTheme } from '@lightstart/light/theme';
import './design-system/styles.ts';
import { startShell } from './app/shell.ts';

configureTheme({ requestFont: () => undefined });

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
