// The owner's scenario for the live step log (5 Nov 2026: "We should have live update log … so that the user gets a good sense even without live preview"): a
// Full automation form fills in the hidden browser and its card says each step, in the app's real order (lib/terminals.js startForm before the controller's
// first state, review of [ap] 5/7), never "in Chrome". The real session list, the real store and controller; fictional job and data only.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as terminals from '../../../lib/terminals.js';
import * as journal from '../../../lib/session-journal.js';
import {watchSessions} from '../../../lib/session-handlers.js';
import {createBackgroundApplyController} from '../../../lib/background-apply-controller.js';
import {createBackgroundApplyStore} from '../../../lib/background-apply-store.js';
import {pageStepHandler} from '../../../lib/page-step.js';
import {createSessionFlow} from '../../../lib/session-flow.js';
import {sessionSteps} from '../../../renderer/session-steps-list.js';

const NOW = Date.parse('2026-11-05T10:00:00Z');
const url = 'https://jobs.example.test/live-log';

function storeCall() {
  const app = {id: 'app', url, stage: 'Kit ready'}, sections = new Map([['📝 Application kit', '```json\n{"eligible":true,"answers":[]}\n```']]);
  return async (_storage, entity, method, args) => {
    if (entity === 'applications' && method === 'get') return app;
    if (entity === 'applications' && method === 'section') return sections.get(args.name) || '';
    if (entity === 'applications' && method === 'set_section') { sections.set(args.name, args.markdown); return null; }
    if (entity === 'events' && method === 'list') return [];
    throw new Error(`unexpected ${entity}.${method}`);
  };
}

test('a hidden Full automation form: started, waiting, opening, Apply pressed, filling 4 then 9 of 9 in one line, handed to you at a bot check; never "in Chrome"', async () => {
  journal._reset();
  const told = [];
  journal.onChange(() => {}, {later: fn => fn()});   // the timer only: watchSessions sets who is told
  terminals.onChange(watchSessions((...args) => told.push(args)));
  const controller = createBackgroundApplyController({}, {store: createBackgroundApplyStore({}, {call: storeCall(), now: () => NOW, realNow: () => NOW, uuid: () => 'attempt'}),
    uuid: () => 'live0001-fictional', config: () => ({mode: 'auto', chosenAt: 'c1', autoConfirmedAt: '2026-11-05T09:00:00Z', auto: {waitMin: 1}}), terminals, started: NOW - 1000,
    stop: () => false, browser: {ready: () => true, start: async () => ({owner: 'o1'}), closeSession: async () => true}, reader: {busy: () => false, take: () => null, takeEnded: () => []},
    port: 1, token: () => 'fictional', notify: () => {}, log: () => {}});
  try {
    assert.equal((await controller.enqueue([{url, company: 'Fictional Air', title: 'Platform Engineer'}], 'auto')).ok, true);
    const id = 'live0001';
    await controller.handle({action: 'poll', owner: 'o1'});
    const pages = new Map();
    pageStepHandler({terminals, review: {notePage: (session, page) => pages.get(session) !== page && !!pages.set(session, page)}, appLog: () => {}})({session: id, page: 'opening'});
    pageStepHandler({terminals, review: {notePage: () => true}, appLog: () => {}})({session: id, page: 'form'});
    const flow = createSessionFlow({terminals, review: {}, apply: {}, appLog: () => {}});
    flow.reported({id, url, total: 9, left: 5});
    flow.reported({id, url, total: 9, left: 0});
    await controller.handle({owner: 'o1', session: id, action: 'manual', reason: 'captcha_runtime'});   // words-ok: our own hand-off reason id

    const item = {...terminals.list().find(entry => entry.id === id), journal: journal.journalOf(id)};
    const texts = sessionSteps(item, null, {clock: () => '10:00'}).map(step => `${step.tone}: ${step.text.replace(/ · 10:00$/, '')}`);
    assert.deepEqual(texts.slice(0, 5), ['done: Started in Jobadabra\'s browser · Full automation', 'done: Waiting for its turn', 'done: Opening the job page',
      'done: Apply button detected. Redirecting…', 'done: All 9 required fields filled']);
    assert.match(texts.at(-1), /^warn: Handed to you: .*CAPTCHA/);
    assert.ok(!texts.some(text => /Chrome|Reading this page/.test(text)), texts.join('\n'));
    assert.ok(told.some(([, event]) => event === 'journal'), 'a new step tells the window');
  } finally {
    terminals.remove('live0001');
    terminals.onChange(() => {});
  }
});

test('a session the log never saw start (a Chrome form, one restored after a restart, one removed) gets no log: the page derives its steps', () => {
  journal._reset();
  journal.note('restored', {text: 'Filling the form: 1 of 3 required fields'});
  journal.observe({id: 'restored', stuck: 'no-form', note: 'No application form found on the page yet'});
  assert.deepEqual(journal.journalOf('restored'), []);
  journal.start('gone', 'auto', NOW);
  journal.observe({id: 'gone', removed: true});
  journal.note('gone', {text: 'Filling the form: 2 of 3 required fields'});   // a late form report after Cancel
  assert.deepEqual(journal.journalOf('gone'), [], 'a late report does not bring a removed log back');
});
