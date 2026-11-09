import { call } from '../../app/api.ts';
import { resourceFor } from '../../app/resources.ts';
import type { ScreenContext } from '../../app/types.ts';
import { text } from '../../text/index.ts';
import { settingsPage } from './parts/frame.ts';
import { taxonLists } from './parts/taxon-list.ts';

export function screen(ctx: ScreenContext): HTMLElement {
  return settingsPage(ctx, 'taste-words', (main) => {
    const descriptors = resourceFor('listDescriptors', {}, { tags: ['settings', 'notes'] });
    taxonLists(main, text('settings.tasteWords'), [
      {
        key: 'descriptor',
        heading: text('settings.tasteWords'),
        noun: text('settings.taxonomy.word'),
        source: descriptors,
        create: (name) => call('createDescriptor', { body: { name } }),
        rename: (row, name) => call('updateDescriptor', { params: { id: row.id }, body: { name } }),
        remove: (row) => call('deleteDescriptor', { params: { id: row.id } }),
      },
    ]);
  });
}
