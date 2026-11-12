// Focus rule focus-1 (docs/app-expectations/focus.md): every suggestion shows its evidence. The setup suggestions (LinkedIn, Gmail, Always on, notifications) are built from app state,
// not from the engine, and shipped with `evidence: []` (#3640, found by the AI persona): the row carried no "why am I seeing this". One loop over every setup producer, in every language.
import assert from 'node:assert/strict';
import {test, afterEach} from 'node:test';
import {install} from '../../tiny-dom.js';
import {setLocale, SUPPORTED_LOCALES} from '../../../i18n/index.js';

install();   // components.js (behind hosted-suggestion.js) needs a document
const {linkedinEntries} = await import('../../../renderer/linkedin-words.js');
const {gmailEntries} = await import('../../../renderer/gmail-offer-words.js');
const {hostedEntries} = await import('../../../renderer/hosted-suggestion.js');
const {notifyEntries} = await import('../../../renderer/notify-suggestion.js');
const {entryParts} = await import('../../../renderer/suggestions.js');

afterEach(() => setLocale('en'));
const PRODUCERS = {
  linkedin: () => linkedinEntries({view: {loaded: true, on: false}}),
  gmail: () => gmailEntries({view: {loaded: true, connected: false}}),
  hosted: () => hostedEntries({hosted: {available: true, on: false, shared: 'alex@example.com'}, jobs: {jobs: [{stage: 'Saved', fit: 81}]}, runs: {lastSearchAt: '2026-10-31T08:00:00Z'}}),
  notify: () => notifyEntries({state: NOTIFY.none}),
};
// The card's four states (renderer/notify-words.js offerCard): the evidence says what prompted THIS one (#3863 review).
const BASE = {reached: true, by: ['app'], chosen: null, email: 'alex@example.com', confirmed: false, serviceOff: false, unconfirmedStopped: false};
const NOTIFY = {none: {...BASE, email: ''}, pending: BASE, stopped: {...BASE, unconfirmedStopped: true}, unsubscribed: {...BASE, serviceOff: true}};

test('every setup suggestion carries evidence the row can show, in every language', () => {
  for (const locale of SUPPORTED_LOCALES) {
    setLocale(locale);
    for (const [name, make] of Object.entries(PRODUCERS)) {
      const [entry] = make();
      assert.ok(entry, `${locale} ${name}: the entry is there`);
      assert.ok(entry.evidence.length > 0 && entry.evidence.every(line => line.trim()), `${locale} ${name}: evidence`);
      assert.ok(entryParts(entry).evidence, `${locale} ${name}: the row shows it`);
    }
  }
});

test('the notification card says what prompted it in each of its four states, in every language', () => {
  for (const locale of SUPPORTED_LOCALES) {
    setLocale(locale);
    const said = Object.entries(NOTIFY).map(([state, given]) => {
      const [entry] = notifyEntries({state: given});
      assert.equal(entry.state, state, `${locale} ${state}`);
      assert.ok(entry.evidence.length === 1 && entry.evidence[0].trim(), `${locale} ${state}: evidence`);
      return entry.evidence[0];
    });
    assert.notEqual(said[2], said[0], `${locale}: stopped differs from none`);
    assert.notEqual(said[3], said[0], `${locale}: unsubscribed differs from none`);
    assert.notEqual(said[3], said[2], `${locale}: unsubscribed differs from stopped`);
  }
});
