// The light triage read (extension/triage-look.js): it counts the page's controls, asks the page kind once, and reports a verdict; it never presses, fills or watches.
import assert from 'node:assert/strict';
import {test} from 'node:test';

globalThis.chrome ||= {runtime: {onMessage: {addListener() {}}}, storage: {local: {get: async () => ({}), set: async () => {}}, session: {get: async () => ({}), set: async () => {}}}};
const {lookAtForm} = await import('../../../../extension/triage-look.js');

const FORM = {fields: 4, textareas: 1, files: 1, anyFiles: 1, passwords: 0, choices: 0, nodes: 90, frames: 0, status: 200};
const EMPTY = {fields: 0, textareas: 0, files: 0, anyFiles: 0, passwords: 0, choices: 0, nodes: 40, frames: 0, status: 200};

// A read whose page shows `shapes` one after the other and whose page-kind answer is `kind`; every call is written down.
function run({shapes, kind, kinds = [kind], ms = 0, pressed = true, navigates = false, lateAt = 0, controls = [], sketch = null}) {
  const calls = [];
  let at = 0, shown = 0, asked = 0, lates = 0;
  const step = {tab: {id: 7, url: 'https://jobs.example.test/apply'}, gen: 3, flow: {askKind: async () => { calls.push('askKind'); return kinds[Math.min(asked++, kinds.length - 1)]; }, late: () => ++lates === lateAt}};
  const parts = {prepare: async () => { calls.push('prepare'); }, shape: async () => { calls.push('shape'); return shapes[Math.min(shown++, shapes.length - 1)]; },
    still: async (_tab, {maxMs}) => { calls.push(`still ${maxMs}`); at += ms; }, now: () => at, wait: async () => { calls.push('wait'); },
    press: async s => { calls.push('press'); s.pressed = pressed; return !navigates; }, told: step => calls.push(`told ${step}`), labels: async () => {}, sketch: sketch || (async () => ({controls}))};
  return lookAtForm(step, parts).then(report => ({report, calls}));
}

test('a form page is read once, asked once and reported simple, with nothing pressed or watched', async () => {
  const {report, calls} = await run({shapes: [FORM], kind: {role: 'form', botCheck: false}});
  assert.deepEqual(report, {look: {role: 'form', fields: 5, files: 1, frames: 0}, simple: true, why: '', questions: []});
  assert.deepEqual(calls, ['prepare', 'shape', 'askKind']);
});

test('a page with no control yet is looked at again while it grows, for at most 3 s, then asked (no 20 s watch)', async () => {
  const growing = (n) => ({...EMPTY, nodes: 40 + n});
  const {report, calls} = await run({shapes: [growing(0), growing(10), growing(20), growing(30), growing(40), growing(50)], kind: {role: 'posting'}, ms: 1000});
  assert.equal(report.why, 'no form');
  assert.equal(calls.filter(call => call.startsWith('still')).length, 3, 'three looks of 1 s and the clock stops it');
  assert.equal(calls.at(-1), 'askKind');
});

test('a page that is still empty and not growing is asked at once after one look', async () => {
  const {calls} = await run({shapes: [EMPTY], kind: {role: 'posting'}});
  assert.deepEqual(calls, ['prepare', 'shape', 'still 1000', 'shape', 'askKind']);
});

test('a form that draws late is found by the second look', async () => {
  const {report} = await run({shapes: [EMPTY, {...FORM, nodes: 90}], kind: {role: 'form', botCheck: false}});
  assert.equal(report.simple, true);
});

test('the AI\'s captcha and login answers outrank a page full of fields', async () => {
  assert.equal((await run({shapes: [FORM], kind: {role: 'form', botCheck: true}})).report.why, 'captcha');
  assert.equal((await run({shapes: [FORM], kind: {role: 'account', accountStep: 'sign_in'}})).report.why, 'login');
});

test('a page that cannot be read, has no page-kind answer or hides its form in a frame is reported unreadable, never guessed', async () => {
  assert.deepEqual((await run({shapes: [null], kind: {role: 'form'}})).report, {unreadable: true, why: 'unreadable'});
  assert.equal((await run({shapes: [FORM], kind: null})).report.unreadable, true);
  const framed = (await run({shapes: [{...EMPTY, frames: 1}], kind: {role: 'form', botCheck: false}})).report;
  assert.deepEqual([framed.unreadable, framed.why], [true, 'frame']);
  assert.equal((await run({shapes: [{...EMPTY, status: 404}], kind: {role: 'form'}})).report.unreadable, true, 'a gone posting is not a form');
});

// Review of #3519 and the owner's answer "Press Apply once, then read": most of his jobs open a posting first.
const POSTING = {role: 'no-form', kind: 'posting', applyBy: 'form', applyButton: 'Easy apply'};

test('a posting gets its Apply pressed once, then the form that came is read and asked: a simple form behind Apply', async () => {
  const {report, calls} = await run({shapes: [EMPTY, FORM], kinds: [POSTING, {role: 'form', botCheck: false}], pressed: true});
  assert.deepEqual(report, {look: {role: 'form', fields: 5, files: 1, frames: 0}, simple: true, why: '', questions: []});
  assert.equal(calls.filter(call => call === 'press').length, 1);
  assert.equal(calls.filter(call => call === 'askKind').length, 2);
  assert.equal(calls[calls.indexOf('press') - 1], 'told pressing', 'the app hears the press before it happens (8 Nov 2026: a read that went quiet after Apply named no step)');
});

test('a posting is not pressed when its answer is an e-mail application, and a form is never pressed', async () => {
  assert.equal((await run({shapes: [EMPTY], kind: {role: 'no-form', kind: 'posting', applyBy: 'email'}})).calls.includes('press'), false);
  assert.equal((await run({shapes: [FORM], kind: {role: 'form', botCheck: false}})).calls.includes('press'), false);
});

test('a posting whose Apply press brought no form, or that had no Apply to press, is no form here', async () => {
  assert.equal((await run({shapes: [EMPTY], kinds: [POSTING, POSTING], pressed: true})).report.why, 'no form');
  const none = await run({shapes: [EMPTY], kinds: [POSTING], pressed: false});
  assert.equal(none.report.why, 'no form');
  assert.equal(none.calls.filter(call => call === 'askKind').length, 1, 'nothing was pressed: no second ask');
});

test('a press that moved the tab to another page, or a tab that moved on during the ask, reports nothing: the new page has its own look', async () => {
  assert.equal((await run({shapes: [EMPTY], kinds: [POSTING], navigates: true})).report, null);
  assert.equal((await run({shapes: [FORM], kind: {role: 'form', botCheck: false}, lateAt: 1})).report, null);
  assert.equal((await run({shapes: [EMPTY, FORM], kinds: [POSTING, {role: 'form'}], lateAt: 2})).report, null);
});

test('a form with a captcha frame among its fields is not simple even though the AI said no bot check (the prompt says so for that shape)', async () => {
  const {report} = await run({shapes: [{...FORM, frames: 1}], kind: {role: 'form', botCheck: false}});
  assert.deepEqual([report.simple, report.why], [false, 'check']);
});

test('a page that refuses its first read is looked at again before it is called unreadable', async () => {
  const {report, calls} = await run({shapes: [null, null, FORM], kind: {role: 'form', botCheck: false}});
  assert.equal(report.simple, true);
  assert.equal(calls.filter(call => call === 'shape').length, 3);
});

// L2b (owner 7 Nov 2026): a simple form also reports the words of its required typed questions, for the app's one match against saved details.
test('a simple form reports its required typed questions: not optional ones, not radio or checkbox options, not files, each once', async () => {
  const controls = [{type: 'text', label: 'First name', required: true}, {type: 'text', label: 'Nickname', required: false}, {type: 'radio', label: 'Yes', required: true}, {type: 'checkbox', label: 'I agree', required: true},
    {type: 'file', label: 'CV', required: true}, {type: 'select', label: 'Notice period', required: true}, {type: 'text', label: 'First name', required: true}, {type: 'textarea', label: '  ', required: true}];
  const {report} = await run({shapes: [FORM], kind: {role: 'form', botCheck: false}, controls});
  assert.deepEqual(report.questions, ['First name', 'Notice period']);
});

test('a page that refuses the question read is still a simple form, with questions null (its answers are not checked, never an empty list)', async () => {
  const {report} = await run({shapes: [FORM], kind: {role: 'form', botCheck: false}, sketch: async () => { throw new Error('no tab'); }});
  assert.equal(report.simple, true);
  assert.equal(report.questions, null);
});

test('a form that is not simple reports no questions (nothing to match)', async () => {
  const {report} = await run({shapes: [FORM], kind: {role: 'form', botCheck: true}, controls: [{type: 'text', label: 'First name', required: true}]});
  assert.equal(report.simple, false);
  assert.equal('questions' in report, false);
});
