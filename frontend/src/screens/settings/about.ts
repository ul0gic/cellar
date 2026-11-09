import { type About, buildPath } from '@cellar/contract';
import { html, render, type TemplateResult } from '@lightstart/light/html';
import { resourceFor } from '../../app/resources.ts';
import { href } from '../../app/router.ts';
import type { ScreenContext } from '../../app/types.ts';
import { skeleton } from '../../design-system/skeleton.ts';
import { text } from '../../text/index.ts';
import { settingsPage } from './parts/frame.ts';
import { loadFailed, watch } from './parts/watch.ts';

export function screen(ctx: ScreenContext): HTMLElement {
  return settingsPage(ctx, 'about', (main) => {
    const about = resourceFor('getAbout', {}, { tags: ['settings'] });
    const openApi = buildPath('getOpenApiDocument');

    const view = (current: About): TemplateResult => html`<section class="cl-sgroup" aria-labelledby="settings-about">
      <h2 id="settings-about">${text('settings.about.title')}</h2>
      <div class="cl-panel">
        <div class="cl-srow">
          <span class="cl-srow-text"
            ><b>${text('app.name')}</b
            ><span>${text('settings.about.version', { version: current.version, schema: current.schemaVersion })}</span></span
          >
        </div>
        <div class="cl-srow">
          <span class="cl-srow-text"
            ><b>${text('settings.catalog')}</b
            ><span>${current.catalogVersion ?? text('settings.catalog.notLoaded')}</span></span
          >
        </div>
        <a class="cl-srow cl-srow-link" href=${href('/settings/about/licenses')}>
          <span class="cl-srow-text"
            ><b>${text('settings.licenses')}</b><span>${text('settings.about.licensesBody')}</span></span
          >
          <lc-icon name="chevron-right" aria-hidden="true"></lc-icon>
        </a>
        <a class="cl-srow cl-srow-link" href=${href(openApi)} target="_blank" rel="noopener">
          <span class="cl-srow-text"
            ><b>${text('settings.about.api')}</b><span>${text('settings.about.apiBody', { path: openApi })}</span></span
          >
          <lc-icon name="external-link" aria-hidden="true"></lc-icon>
        </a>
      </div>
    </section>`;

    watch(main, [about], ({ state, retry }) => {
      const current = about.peek();
      if (state === 'failed') {
        render(loadFailed(text('settings.about'), retry), main);
      } else if (state === 'slow') {
        render(skeleton('lines', text('settings.about')), main);
      } else if (state === 'ready' && current !== undefined) {
        render(view(current), main);
      }
    });
  });
}
