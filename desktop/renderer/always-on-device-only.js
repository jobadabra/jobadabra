// What Always on never does, shown on its card as disabled rows: your LinkedIn sign-in and Gmail & Calendar stay on this computer (spec docs/superpowers/specs/2026-11-13-linkedin-guest-search-design.md, [lg] 3/4).
// Why (owner, 13 Nov 2026, relayed by the coordinator: "lets' keep Linkedin and Google sessions/credentials windows/mac only" · "show them as disabled on the Always-on... saying that for
// security/protection reasons, we don't do this as for now"): the same rows under both ways (our servers, your own accounts), since neither ever holds a sign-in. Guard: test/unit/renderer/always-on-device-only.test.js.
import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
import {el, pill, tile} from './components.js';
import {ROWS} from './always-on-device-only-words.js';

/** One disabled row like the card's Notion / API key rows: a neutral tile, the name, a "This computer only" pill and why. */
function row([id, glyph, title, line]) {
  const node = el('div', 'aon-row aon-stack is-device-only');
  node.dataset.deviceOnly = id;
  const text = el('div', 'aon-text'), head = el('div', 'aon-title');
  head.append(el('b', '', t(`helperMore.${title}`)), pill(t('helperMore.deviceOnlyPill'), 'neutral'));
  text.append(head, el('p', 'muted small', t(`helperMore.${line}`)));
  node.append(tile(glyph, 'neutral'), text);
  return node;
}

/** The block: a lead line, then the rows. A new node each call (one per way card). */
export function deviceOnlyBlock() {
  const block = el('div', 'aon-device-only');
  block.append(el('p', 'muted small aon-device-only-lead', t('helperMore.deviceOnlyLead')), ...ROWS.map(row));
  return block;
}

/** Adds the block to each Always on way card present (ids: setting-cloud, setting-hosted), once. */
export function mountDeviceOnly(doc = document) {
  for (const id of ['setting-cloud', 'setting-hosted']) {
    const card = doc.getElementById(id);
    if (card && !card.querySelector('.aon-device-only')) card.append(deviceOnlyBlock());
  }
}
