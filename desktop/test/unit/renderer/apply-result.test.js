// The Apply to jobs dialog's result ([ad] try 3, owner 8 Nov 2026: "bad Looking UI" on the real app): one row per job with its one chip, counts instead of a repeated sentence, each reason once.
// The owner's scenario: 3 jobs, one already open and two started, long titles.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {STATES, resultView} from '../../../renderer/apply-result-model.js';
import {messages} from '../../../i18n/catalogs/pages/apply-result.js';
import {SUPPORTED_LOCALES} from '../../../i18n/index.js';

const job = (n, status, reason = '') => ({url: `https://x.test/${n}`, title: `Title ${n}`, company: `Co ${n}`, status, reason});
const OPEN = 'This job already has an application session open.';

test('the owner\'s batch (one already open, two started): three rows, "2 started · 1 skipped", no sentence that repeats the chip', () => {
  const view = resultView({ok: true, message: `2 applications queued. 1 job was skipped: ${OPEN}`, outcomes: [job(1, 'busy', OPEN), job(2, 'started'), job(3, 'started')]});
  assert.deepEqual(view.rows.map(row => row.label), ['Already open', 'Started', 'Started']);
  assert.equal(view.counts.map(item => item.text).join(' · '), '2 started · 1 skipped');
  assert.deepEqual(view.rows.map(row => row.reason), ['', '', ''], 'the chip says it; the engine sentence is only its tooltip');
  assert.equal(view.rows[0].detail, OPEN);
  assert.equal(view.note, null, 'the batch\'s own message is not repeated above the rows');
  assert.equal(view.hint, 'Follow them in Sessions.');
});

test('every status is one row with a tone and an icon; the counts add up to the rows; an unknown status is "Skipped"', () => {
  const outcomes = [...Object.keys(STATES), 'something-new'].map((status, n) => job(n, status, ['ineligible', 'failed', 'not-started', 'already-queued'].includes(status) ? `why ${status}` : ''));
  const view = resultView({ok: true, outcomes});
  assert.equal(view.rows.length, outcomes.length);
  assert.equal(view.counts.reduce((sum, item) => sum + item.count, 0), outcomes.length);
  assert.equal(view.rows.at(-1).label, 'Skipped');
  for (const row of view.rows) assert.ok(row.tone && row.icon && row.label, row.label);
  assert.equal(view.rows.find(row => row.label === 'Could not prepare').tone, 'bad', 'only a failure is red');
  for (const status of ['ineligible', 'not-started', 'already-queued']) assert.equal(view.rows.find(row => row.url === outcomes.find(o => o.status === status).url).tone, 'warn', status);
});

test('a row keeps its own reason when it adds something (not eligible, could not prepare), once', () => {
  const view = resultView({ok: true, outcomes: [job(1, 'started'), job(2, 'ineligible', 'Needs a work permit.'), job(3, 'failed', 'The form did not load.')]});
  assert.deepEqual(view.rows.map(row => row.reason), ['', 'Needs a work permit.', 'The form did not load.']);
  assert.equal(view.note, null);
});

test('a refused batch says its reason once, not once per row and again above them', () => {
  const error = 'Download the browser first.';
  const view = resultView({ok: false, error, outcomes: [job(1, 'not-started', error), job(2, 'not-started', error), job(3, 'not-started', error)]});
  assert.deepEqual(view.note, {text: error, tone: 'error'});
  assert.deepEqual(view.rows.map(row => row.reason), ['', '', '']);
  assert.equal(view.hint, '', 'nothing started, so no "follow them in Sessions"');
});

test('a reason shared by several rows of a batch that went on is said once, muted; a single row keeps its own', () => {
  const shared = resultView({ok: true, outcomes: [job(1, 'started'), job(2, 'ineligible', 'Needs a work permit.'), job(3, 'ineligible', 'Needs a work permit.')]});
  assert.deepEqual(shared.note, {text: 'Needs a work permit.', tone: 'muted'});
  assert.deepEqual(shared.rows.map(row => row.reason), ['', '', '']);
});

test('a refusal with no words of its own still says something (the old dialog\'s fallback)', () => {
  const view = resultView({ok: false, outcomes: [job(1, 'not-started')]});
  assert.equal(view.note.tone, 'error');
  assert.ok(view.note.text && !view.note.text.includes('helperFlow'), view.note.text);
});

test('every reason shared by several rows is said once, not only the first one', () => {
  const view = resultView({ok: true, outcomes: [job(1, 'ineligible', 'X.'), job(2, 'ineligible', 'X.'), job(3, 'failed', 'Y.'), job(4, 'failed', 'Y.')]});
  assert.deepEqual(view.rows.map(row => row.reason), ['', '', '', '']);
  assert.deepEqual(view.note, {text: 'X. Y.', tone: 'muted'});
});

test('a batch opened in Chrome tabs keeps the app\'s "submit yourself" sentence, not "Follow them in Sessions"', () => {
  const message = 'Opened 2 job(s) in Chrome; each fills itself in a few seconds. Review every tab and submit yourself.';
  const view = resultView({ok: true, jobs: ['a', 'b'], message, outcomes: [job(1, 'started'), job(2, 'started'), job(3, 'ineligible', 'Needs a work permit.')]});
  assert.equal(view.hint, message);
});

test('a job with no title shows its company, then "Job"; the title is never empty', () => {
  const view = resultView({ok: true, outcomes: [{url: 'u1', company: 'Acme', status: 'started'}, {url: 'u2', status: 'started'}]});
  assert.deepEqual(view.rows.map(row => [row.title, row.company]), [['Acme', ''], ['Job', '']]);
});

test('a click opens the job as the engine named it: the company is never passed as the title', () => {
  const view = resultView({ok: true, outcomes: [{url: 'u1', company: 'Acme', status: 'started'}, {url: 'u2', title: 'Pilot', company: 'Example Air', status: 'started'}]});
  assert.deepEqual(view.rows.map(row => row.job), [{url: 'u1', title: '', company: 'Acme'}, {url: 'u2', title: 'Pilot', company: 'Example Air'}]);
});

test('no outcomes: nothing to show', () => {
  assert.deepEqual(resultView(null), {rows: [], counts: [], hint: '', note: null});
});

test('the result words exist in all seven languages, with the same keys and the count kept', () => {
  assert.deepEqual(Object.keys(messages).sort(), [...SUPPORTED_LOCALES].sort());
  const keys = Object.keys(messages.en);
  for (const locale of SUPPORTED_LOCALES) {
    assert.deepEqual(Object.keys(messages[locale]), keys, locale);
    for (const [key, value] of Object.entries(messages[locale])) {
      const forms = typeof value === 'string' ? [value] : Object.values(value);
      assert.ok(forms.length && forms.every(form => form.trim()), `${locale}.${key}`);
      if (key.endsWith('Count')) assert.ok(forms.every(form => form.includes('{count}')), `${locale}.${key} keeps {count}`);
    }
  }
});
