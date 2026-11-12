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
  notify: () => notifyEntries({state: {reached: true, by: ['app'], chosen: null, email: '', confirmed: false, serviceOff: false, unconfirmedStopped: false}}),
};

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
