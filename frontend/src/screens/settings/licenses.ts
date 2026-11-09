import type { About } from '@cellar/contract';
import { html, nothing, render, type TemplateResult } from '@lightstart/light/html';
import { resourceFor } from '../../app/resources.ts';
import { setAppBar } from '../../app/shell.ts';
import type { ScreenContext } from '../../app/types.ts';
import { skeleton } from '../../design-system/skeleton.ts';
import { text } from '../../text/index.ts';
import { settingsPage } from './parts/frame.ts';
import { loadFailed, watch } from './parts/watch.ts';

const fontLicenses = import.meta.glob<string>('../../design-system/assets/fonts/OFL-*.txt', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const FONTS: readonly { readonly name: string; readonly file: string }[] = [
  { name: 'Gloock', file: '../../design-system/assets/fonts/OFL-Gloock.txt' },
  { name: 'Hanken Grotesk', file: '../../design-system/assets/fonts/OFL-HankenGrotesk.txt' },
];

type Notice = About['licenses'][number];

function notice(entry: Notice): TemplateResult {
  const meta = [entry.version, entry.license ?? text('settings.licenses.none')].join(', ');
  return html`<details class="cl-license">
    <summary><b>${entry.name}</b> <span class="cl-muted">${meta}</span></summary>
    ${entry.url === null ? nothing : html`<p class="cl-muted">${entry.url}</p>`}
    ${entry.text === null ? html`<p class="cl-muted">${text('settings.licenses.noText')}</p>` : html`<pre>${entry.text}</pre>`}
  </details>`;
}

export function screen(ctx: ScreenContext): HTMLElement {
  return settingsPage(ctx, 'about', (main) => {
    const about = resourceFor('getAbout', {}, { tags: ['settings'] });
    const fonts: Notice[] = FONTS.map((font) => ({
      name: font.name,
      version: text('settings.licenses.font'),
      license: 'OFL-1.1',
      url: null,
      text: fontLicenses[font.file] ?? null,
    }));

    watch(main, [about], ({ state, retry }) => {
      const current = about.peek();
      if (state === 'failed') {
        render(loadFailed(text('settings.licenses'), retry), main);
      } else if (state === 'slow') {
        render(skeleton('rows', text('settings.licenses')), main);
      } else if (state === 'ready' && current !== undefined) {
        render(
          html`<section class="cl-sgroup" aria-labelledby="settings-licenses">
            <h2 id="settings-licenses">${text('settings.licenses')}</h2>
            <p>${text('settings.licenses.lead')}</p>
            <div class="cl-panel">${[...fonts, ...current.licenses].map(notice)}</div>
          </section>`,
          main,
        );
      }
    });
    setAppBar({ back: '/settings/about' });
  });
}
