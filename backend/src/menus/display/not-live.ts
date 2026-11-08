import { renderDocument } from './html.ts';

export function renderNotLivePage(assetBase: string, version: string): string {
  return renderDocument({
    title: 'Cellar',
    assetBase,
    version,
    refresh: false,
    bodyAttributes: '',
    main: '<div class="gone"><h1>This menu is not live</h1><div class="orn"><i></i></div><p>Ask the host for the new link.</p></div>',
    script: false,
  });
}
