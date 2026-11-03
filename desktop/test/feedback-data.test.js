// "Send feedback → Include this screen's data" (renderer/feedback-data.js): one registry, a page with no entry (or a broken one) falls back to its visible text, and the rows carry ids, titles,
// companies, fit and status but never a posting's text. Fake documents only; the pages themselves are registered in renderer/pages/feedback-screens.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import {registerScreenData, readScreenData, screenKey, jobsData, answersData, questionsData, focusData, MAX_ROWS} from '../renderer/feedback-data.js';

const doc = ({view = 'jobs', settings = '', tab = '', text = ''} = {}) => ({
  querySelector: selector => {
    if (selector === '.nav.active') return {dataset: {view, ...(settings ? {settings} : {})}};
    if (selector === '[data-profile-tab].is-active') return tab ? {dataset: {profileTab: tab}} : null;
    return selector.startsWith('.view[data-view=') ? {innerText: text} : null;
  }});

test('the screen key is the sidebar view, and for Profile its open tab', () => {
  assert.equal(screenKey(doc({view: 'jobs'})), 'jobs');
  assert.equal(screenKey(doc({view: 'settings', settings: 'profile', tab: 'answers'})), 'profile:answers');
  assert.equal(screenKey(doc({view: 'settings'})), 'settings');
});

test('a registered page sends its data; no entry, an empty one or one that throws sends the visible text', () => {
  registerScreenData('focus', () => ({cards: [1]}));
  registerScreenData('strategy', () => null);
  registerScreenData('actions', () => { throw new Error('page not ready'); });
  registerScreenData('circular', () => { const a = {}; a.self = a; return a; });
  assert.deepEqual(readScreenData('focus', doc()), {screen: 'focus', source: 'registry', data: {cards: [1]}});
  const text = '  Reports  \n\n\n\nNothing yet   \n';
  for (const key of ['strategy', 'actions', 'circular', 'calendar']) {
    const read = readScreenData(key, doc({text}));
    assert.equal(read.source, 'visible text'); assert.equal(read.data.text, 'Reports\n\nNothing yet');
  }
});

test('Settings and the Profile tabs never fall back to their visible text (the Profile goes only through the opt-in snapshot)', () => {
  for (const key of ['settings', 'profile:cv', 'profile:details', 'profile:letter']) {
    assert.deepEqual(readScreenData(key, doc({text: 'Ana Fake, +351 900 000 000, 1 Fake Street'})), {screen: key, source: 'none', data: null});
  }
  registerScreenData('profile:answers', () => ({questions: []}));
  assert.equal(readScreenData('profile:answers', doc()).source, 'registry');
});

test('the Jobs data names how the list is narrowed and each row by id, title, company, source, fit and status; never a posting text, a long text is cut', () => {
  const rows = [{code: 'JB-1', url: 'https://boards.example.com/jobs/1', title: 'Product Designer', company: 'Acme', source: 'Gmail', status: 'unreviewed', fit: 82, description: 'FULL POSTING TEXT', notes: 'x'.repeat(5000), place_unclear: false},
    {code: 'JB-2', title: 'T'.repeat(400), company: 'Beta', source: 'LinkedIn', status: 'applied', fit: null}];
  const data = jobsData({rows, total: 40, filters: ['inbound'], statFilter: null, text: 'design', sort: 'best', mode: 'list', origin: job => (job.source === 'Gmail' ? 'inbound' : 'outbound'), searching: false, lastSearchAt: ''});
  assert.deepEqual(data.view, {filters: ['inbound'], counter: '', search: 'design', sort: 'best', mode: 'list', shown: 2, ofAll: 40});
  assert.deepEqual(data.refresh, {running: false, lastSearchAt: ''});
  assert.deepEqual(data.jobs[0], {code: 'JB-1', url: 'https://boards.example.com/jobs/1', title: 'Product Designer', company: 'Acme', source: 'Gmail', status: 'unreviewed', fit: 82, place_unclear: false, origin: 'inbound'});
  assert.ok(!JSON.stringify(data).includes('FULL POSTING TEXT') && !('notes' in data.jobs[0]));
  assert.equal(data.jobs[1].title.length, 200); assert.ok(!('fit' in data.jobs[1]));
  const many = jobsData({rows: Array.from({length: MAX_ROWS + 5}, (_, i) => ({code: `J${i}`}))});
  assert.equal(many.jobs.length, MAX_ROWS); assert.match(many.cut, /5 more rows/);
});

test('What we learned sends each question with its id, wording, field, saved value and verdict, then the ones still to check', () => {
  const sections = [{title: 'Skills', items: [{id: 'q1', kind: 'cell', question: 'Summary', value: 'Summary', state: '', guess: false, open: false}, {id: 'q2', kind: 'note', question: 'a note', value: ''},
    {id: 'q3', kind: 'line', question: 'Notice period', value: '', state: 'new', open: true}]}];
  const data = answersData({sections, learned: [{key: 'k1', question: 'Visa?', company: 'Acme', details: {kind: 'conflict'}}], view: 'all', query: '', kindOf: item => (item.id === 'q1' ? 'long_text' : '')});
  assert.deepEqual(data.questions.map(row => [row.id, row.question, row.field, row.value, row.verdict]), [['q1', 'Summary', 'long_text', 'Summary', 'confirmed'], ['q3', 'Notice period', '', '', 'new']]);
  assert.deepEqual(data.toCheck, [{key: 'k1', question: 'Visa?', company: 'Acme', state: 'conflict'}]);
  assert.equal(data.view.tab, 'all');
});

test('Focus sends each card as its short fields', () => {
  const data = focusData([{job: 'Designer', company: 'Acme', step: 'prepare', job_url: 'https://x.example/j/1', detail: 'y'.repeat(900), nested: {a: 1}}]);
  assert.deepEqual(Object.keys(data.cards[0]), ['job', 'company', 'step', 'job_url', 'detail']);
  assert.equal(data.cards[0].detail.length, 200);
});

test('The open questions send both lists with the drawer\'s own keys, the kind, the options and what is asked to check; never a hidden or dismissed one', () => {
  const details = [{key: 'details:open:{"label":"Notice"}', question: 'Notice period', format: {kind: 'duration', options: []}, value: '', hint: 'how long', details: {kind: 'open'}},
    {key: 'details:check:{"label":"Salary"}', question: 'Salary: make it exact', format: {kind: 'salary'}, value: '100k', details: {kind: 'check'}}];
  const learned = [{id: 'row7', question: 'Do you need a visa?', format: {kind: 'single', options: ['Yes', 'No', ...Array.from({length: 40}, (_, i) => `x${i}`)]}, value: '', state: 'new'}];
  const data = questionsData({details, learned, dismissed: {details: [{key: 'gone'}], learned: []}, hidden: [{key: 'secret'}]});
  assert.deepEqual(data.questions.map(row => [row.list, row.key, row.review, row.kind, row.value]), [['details', 'details:open:{"label":"Notice"}', 'open', 'duration', ''], ['details', 'details:check:{"label":"Salary"}', 'check', 'salary', '100k'], ['learned', 'row7', '', 'single', '']]);
  assert.equal(data.questions[2].options.length, 20, 'a long option list is cut');
  assert.deepEqual(data.dismissed, 1);
  assert.ok(!JSON.stringify(data).includes('secret'));
  assert.deepEqual(questionsData({}), {questions: [], dismissed: 0});
});
