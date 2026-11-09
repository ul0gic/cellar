import { call } from '../../app/api.ts';
import { resourceFor } from '../../app/resources.ts';
import type { ScreenContext } from '../../app/types.ts';
import { text } from '../../text/index.ts';
import { settingsPage } from './parts/frame.ts';
import { taxonLists } from './parts/taxon-list.ts';

export function screen(ctx: ScreenContext): HTMLElement {
  return settingsPage(ctx, 'taxonomy', (main) => {
    const glasses = resourceFor('listGlasses', {}, { tags: ['settings'] });
    const methods = resourceFor('listMethods', {}, { tags: ['settings'] });
    const utensils = resourceFor('listUtensils', {}, { tags: ['settings'] });
    const tags = resourceFor('listTags', {}, { tags: ['settings'] });
    taxonLists(main, text('settings.taxonomy'), [
      {
        key: 'glass',
        heading: text('settings.taxonomy.glasses'),
        noun: text('settings.taxonomy.glass'),
        source: glasses,
        create: (name) => call('createGlass', { body: { name, description: '', volumeMl: null } }),
        rename: (row, name) => call('updateGlass', { params: { id: row.id }, body: { name } }),
        remove: (row) => call('deleteGlass', { params: { id: row.id } }),
      },
      {
        key: 'method',
        heading: text('settings.taxonomy.methods'),
        noun: text('settings.taxonomy.method'),
        source: methods,
        dilution: true,
        describe: (row) => {
          const method = methods.peek()?.items.find((item) => item.id === row.id);
          return method === undefined ? '' : text('settings.taxonomy.dilutionOf', { percent: method.dilutionPercent });
        },
        create: (name, dilutionPercent) => call('createMethod', { body: { name, dilutionPercent } }),
        rename: (row, name) => call('updateMethod', { params: { id: row.id }, body: { name } }),
        remove: (row) => call('deleteMethod', { params: { id: row.id } }),
      },
      {
        key: 'utensil',
        heading: text('settings.taxonomy.utensils'),
        noun: text('settings.taxonomy.utensil'),
        source: utensils,
        create: (name) => call('createUtensil', { body: { name, description: '' } }),
        rename: (row, name) => call('updateUtensil', { params: { id: row.id }, body: { name } }),
        remove: (row) => call('deleteUtensil', { params: { id: row.id } }),
      },
      {
        key: 'tag',
        heading: text('settings.taxonomy.tags'),
        noun: text('settings.taxonomy.tag'),
        source: tags,
        create: (name) => call('createTag', { body: { name } }),
        rename: (row, name) => call('updateTag', { params: { id: row.id }, body: { name } }),
        remove: (row) => call('deleteTag', { params: { id: row.id } }),
      },
    ]);
  });
}
