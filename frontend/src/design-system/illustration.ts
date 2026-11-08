import { html, type TemplateResult, unsafeHTML } from '@lightstart/light/html';

export type IllustrationName =
  | 'empty-shelf'
  | 'empty-glass'
  | 'empty-list'
  | 'empty-menu'
  | 'empty-gift'
  | 'empty-lost';

const drawings = import.meta.glob<string>('./assets/illustrations/empty-*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
});

export function illustration(name: IllustrationName): TemplateResult {
  return html`<span slot="art" class="cl-art" aria-hidden="true"
    >${unsafeHTML(drawings[`./assets/illustrations/${name}.svg`])}</span
  >`;
}
