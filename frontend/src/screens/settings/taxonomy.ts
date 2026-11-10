import View from '@lightstart/light';
import { call } from '../../app/api.ts';
import { settingsTaxonLists } from '../../app/controllers/settings-taxon-lists.ts';
import { loadState } from '../../app/load.ts';
import { apiResource } from '../../app/resources.ts';
import { setAppBar } from '../../app/shell.ts';
import { text } from '../../text/index.ts';
import { settingsFrame, settingsLoad, settingsReadable } from './parts/frame.ts';
import { type TaxonKind, taxonSections } from './parts/taxon-list.ts';

export const tag = 'cl-screen-settings-taxonomy';

class SettingsTaxonomy extends View {
  readonly glasses = apiResource('listGlasses', ['settings']);
  readonly methods = apiResource('listMethods', ['settings']);
  readonly utensils = apiResource('listUtensils', ['settings']);
  readonly tags = apiResource('listTags', ['settings']);
  readonly state = loadState([this.glasses, this.methods, this.utensils, this.tags]);
  readonly kinds: readonly TaxonKind[] = [
    {
      key: 'glass',
      heading: text('settings.taxonomy.glasses'),
      noun: text('settings.taxonomy.glass'),
      source: this.glasses,
      create: (name) => call('createGlass', { body: { name, description: '', volumeMl: null } }),
      rename: (row, name) => call('updateGlass', { params: { id: row.id }, body: { name } }),
      remove: (row) => call('deleteGlass', { params: { id: row.id } }),
    },
    {
      key: 'method',
      heading: text('settings.taxonomy.methods'),
      noun: text('settings.taxonomy.method'),
      source: this.methods,
      dilution: true,
      describe: (row) => {
        const method = this.methods.value.value?.items.find((item) => item.id === row.id);
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
      source: this.utensils,
      create: (name) => call('createUtensil', { body: { name, description: '' } }),
      rename: (row, name) => call('updateUtensil', { params: { id: row.id }, body: { name } }),
      remove: (row) => call('deleteUtensil', { params: { id: row.id } }),
    },
    {
      key: 'tag',
      heading: text('settings.taxonomy.tags'),
      noun: text('settings.taxonomy.tag'),
      source: this.tags,
      create: (name) => call('createTag', { body: { name } }),
      rename: (row, name) => call('updateTag', { params: { id: row.id }, body: { name } }),
      remove: (row) => call('deleteTag', { params: { id: row.id } }),
    },
  ];

  constructor() {
    super();
    settingsTaxonLists.reset();
  }

  connected(): void {
    this.classList.add('cl-settings');
    setAppBar({ back: '/more' });
    if (settingsReadable('taxonomy')) {
      this.glasses.bind(this, {});
      this.methods.bind(this, {});
      this.utensils.bind(this, {});
      this.tags.bind(this, {});
    }
  }

  render() {
    return settingsFrame(
      'taxonomy',
      () => settingsLoad(this.state, text('settings.taxonomy'), 'rows') ?? taxonSections(this, this.kinds),
    );
  }
}

View.register(tag, SettingsTaxonomy);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: SettingsTaxonomy;
  }
}
