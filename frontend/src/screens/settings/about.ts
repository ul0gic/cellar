import { type About, buildPath } from '@cellar/contract';
import View from '@lightstart/light';
import { html, nothing, type TemplateResult } from '@lightstart/light/html';
import { loadState } from '../../app/load.ts';
import { apiResource } from '../../app/resources.ts';
import { href } from '../../app/router.ts';
import { setAppBar } from '../../app/shell.ts';
import { text } from '../../text/index.ts';
import { settingsFrame, settingsLoad } from './parts/frame.ts';
import '../../design-system/lc/icon.ts';

export const tag = 'cl-screen-settings-about';

const OPEN_API = buildPath('getOpenApiDocument');

class SettingsAbout extends View {
  readonly about = apiResource('getAbout', ['settings']);
  readonly state = loadState([this.about]);

  connected(): void {
    this.classList.add('cl-settings');
    setAppBar({ back: '/more' });
    this.about.bind(this, {});
  }

  private view(current: About): TemplateResult {
    return html`<section class="cl-sgroup" aria-labelledby="settings-about">
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
        <a class="cl-srow cl-srow-link" href=${href(OPEN_API)} target="_blank" rel="noopener">
          <span class="cl-srow-text"
            ><b>${text('settings.about.api')}</b><span>${text('settings.about.apiBody', { path: OPEN_API })}</span></span
          >
          <lc-icon name="external-link" aria-hidden="true"></lc-icon>
        </a>
      </div>
    </section>`;
  }

  render() {
    return settingsFrame('about', () => {
      const current = this.about.value.value;
      return (
        settingsLoad(this.state, text('settings.about'), 'lines') ??
        (current === undefined ? nothing : this.view(current))
      );
    });
  }
}

View.register(tag, SettingsAbout);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: SettingsAbout;
  }
}
