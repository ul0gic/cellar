import { defineComponent } from '@lightstart/light';
import { html } from '@lightstart/light/html';
import { navigation } from '@lightstart/light/navigation';
import { text } from '../text/index.ts';
import './cl-live-card.css';

export const clLiveCard = defineComponent({
  tag: 'cl-live-card',
  style: true,
  props: {
    name: '',
    drinks: 0,
    href: '',
  },
  render() {
    return html`
      <cl-bulb size="live" status="on" flicker></cl-bulb>
      <span part="cl-live-card-meta">
        <span part="cl-live-card-kicker">${text('live.onTv')}</span>
        <span part="cl-live-card-name">${this.name}</span>
      </span>
      <lc-button part="cl-live-card-open" variant="quiet" href=${navigation.href(this.href)}>
        <lc-icon name="tv" aria-hidden="true"></lc-icon>
        ${this.drinks === 1 ? text('live.drink') : text('live.drinks', { count: this.drinks })}
      </lc-button>
    `;
  },
});
