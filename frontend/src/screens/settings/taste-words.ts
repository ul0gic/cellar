import View from '@lightstart/light';
import { call } from '../../app/api.ts';
import { settingsTaxonLists } from '../../app/controllers/settings-taxon-lists.ts';
import { loadState } from '../../app/load.ts';
import { apiResource } from '../../app/resources.ts';
import { setAppBar } from '../../app/shell.ts';
import { text } from '../../text/index.ts';
import { settingsFrame, settingsLoad, settingsReadable } from './parts/frame.ts';
import { type TaxonKind, taxonSections } from './parts/taxon-list.ts';

export const tag = 'cl-screen-settings-taste-words';

class SettingsTasteWords extends View {
  readonly descriptors = apiResource('listDescriptors', ['settings', 'notes']);
  readonly state = loadState([this.descriptors]);
  readonly kinds: readonly TaxonKind[] = [
    {
      key: 'descriptor',
      heading: text('settings.tasteWords'),
      noun: text('settings.taxonomy.word'),
      source: this.descriptors,
      create: (name) => call('createDescriptor', { body: { name } }),
      rename: (row, name) => call('updateDescriptor', { params: { id: row.id }, body: { name } }),
      remove: (row) => call('deleteDescriptor', { params: { id: row.id } }),
    },
  ];

  constructor() {
    super();
    settingsTaxonLists.reset();
  }

  connected(): void {
    this.classList.add('cl-settings');
    setAppBar({ back: '/more' });
    if (settingsReadable('taste-words')) {
      this.descriptors.bind(this, {});
    }
  }

  render() {
    return settingsFrame(
      'taste-words',
      () => settingsLoad(this.state, text('settings.tasteWords'), 'rows') ?? taxonSections(this, this.kinds),
    );
  }
}

View.register(tag, SettingsTasteWords);

declare global {
  interface HTMLElementTagNameMap {
    [tag]: SettingsTasteWords;
  }
}
