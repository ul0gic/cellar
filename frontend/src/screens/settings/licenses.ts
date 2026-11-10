import type { About } from '@cellar/contract';
import View from '@lightstart/light';
import { html, nothing, type TemplateResult } from '@lightstart/light/html';
import { loadState } from '../../app/load.ts';
import { apiResource } from '../../app/resources.ts';
import { setAppBar } from '../../app/shell.ts';
import { text } from '../../text/index.ts';
import { settingsFrame, settingsLoad } from './parts/frame.ts';

export const tag = 'cl-screen-settings-licenses';

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

const FONT_NOTICES: readonly Notice[] = FONTS.map((font) => ({
  name: font.name,
  version: text('settings.licenses.font'),
  license: 'OFL-1.1',
  url: null,
  text: fontLicenses[font.file] ?? null,
}));

function notice(entry: Notice): TemplateResult {
  const meta = [entry.version, entry.license ?? text('settings.licenses.none')].join(', ');
  return html`<details class="cl-license">
    <summary><b>${entry.name}</b> <span class="cl-muted">${meta}</span></summary>
    ${entry.url === null ? nothing : html`<p class="cl-muted">${entry.url}</p>`}
    ${entry.text === null ? html`<p class="cl-muted">${text('settings.licenses.noText')}</p>` : html`<pre>${entry.text}</pre>`}
  </details>`;
}

class SettingsLicenses extends View {
  readonly about = apiResource('getAbout', ['settings']);
  readonly state = loadState([this.about]);

  connected(): void {
    this.classList.add('cl-settings');
    setAppBar({ back: '/settings/about' });
    this.about.bind(this, {});
  }

  render() {
    return settingsFrame('about', () => {
      const current = this.about.value.value;
      return (
        settingsLoad(this.state, text('settings.licenses'), 'rows') ??
        (current === undefined
          ? nothing
          : html`<section class="cl-sgroup" aria-labelledby="settings-licenses">
              <h2 id="settings-licenses">${text('settings.licenses')}</h2>
              <p>${text('settings.licenses.lead')}</p>
              <div class="cl-panel">${[...FONT_NOTICES, ...current.licenses].map(notice)}</div>
            </section>`)
      );
    });
  }
}

View.register(tag, SettingsLicenses);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: SettingsLicenses;
  }
}
