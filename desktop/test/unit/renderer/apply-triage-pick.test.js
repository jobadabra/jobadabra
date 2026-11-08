// The popup picks the best N jobs by fit that were not checked before (owner, 30 Oct 2026), and each read's chip says its mode, never a guess (lib/apply-triage-pick.js).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chipOf, estimateOf, pickForTriage, pickWhenFresh} from '../../../renderer/apply-triage-pick.js';
import {listReady, startListRead} from '../../../renderer/pages/jobs-state.js';

const jobs = [
  {url: 'https://a.example/1', fit: 66}, {url: 'https://a.example/2', fit: 88}, {url: 'https://a.example/3', fit: 79},
  {url: 'https://a.example/4'}, {title: 'no url'},
];

test('the default picks the best matches by fit, capped at n, and skips jobs without a link', () => {
  assert.deepEqual(pickForTriage(jobs, {n: 2}).map(job => job.fit), [88, 79]);
});

test('jobs that were checked before are left out, so the next N are the best new ones', () => {
  const checked = new Set(['https://a.example/2']);
  assert.deepEqual(pickForTriage(jobs, {n: 2, isChecked: job => checked.has(job.url)}).map(job => job.fit), [79, 66]);
  assert.deepEqual(pickForTriage(jobs, {n: 10, isChecked: () => true}), [], 'all checked: nothing to pick');
});

test('the input is not changed, and a missing fit ranks last', () => {
  const before = jobs.map(job => job.url);
  pickForTriage(jobs, {n: 10});
  assert.deepEqual(jobs.map(job => job.url), before);
  assert.equal(pickForTriage(jobs, {n: 10}).at(-1).url, 'https://a.example/4');
});

test('a job with no read is Not checked, and each read says its mode and reason', () => {
  assert.deepEqual(chipOf(null), {label: 'Not checked', tone: 'neutral', detail: ''});
  const clean = {eligible: true, captcha: false, login: false, accountCreation: false, allFactsSaved: true};
  assert.equal(chipOf(clean).label, 'Simple form');
  assert.equal(chipOf({...clean, allFactsSaved: false}).label, 'Simple form');
  assert.equal(chipOf({...clean, captcha: true}).detail, 'a check that you are human');   // was the raw id 'captcha' (#3548 review)
  assert.equal(chipOf({...clean, eligible: false}).label, 'Skipped');
});

test('before any read the estimate is a first guess of a minute a job, and says so', () => {
  assert.deepEqual(estimateOf(10, []), {seconds: 600, text: 'about 10 minutes', measured: false});
  assert.deepEqual(estimateOf(1, []), {seconds: 60, text: 'about 1 minute', measured: false});
});

test('after reads the estimate is the median of the last ten, so one slow read does not move it', () => {
  const real = estimateOf(10, [40, 42, 44, 46, 48, 50, 52, 54, 56, 400]);
  assert.equal(real.measured, true);
  assert.equal(real.seconds, 490);   // median 49 s a job, ten jobs
  assert.equal(real.text, 'about 8 minutes');
  assert.equal(estimateOf(2, [900, 900, 900, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50]).seconds, 100, 'only the last ten count: three old slow reads are forgotten');
});

test('a short check says seconds, nothing to check says nothing, and bad timings are ignored', () => {
  assert.equal(estimateOf(2, [20, 20]).text, 'about 40 seconds');
  assert.equal(estimateOf(0, [50]).text, '');
  assert.equal(estimateOf(1, [2]).text, 'about 5 seconds', 'a very fast read never says about 0 seconds');
  assert.equal(estimateOf(5, [NaN, -3, 0, Infinity]).measured, false, 'no usable timing is a first guess');
});

// Apply e2e runs 41412195017 and 41447682988 (2 Nov 2026): Start was pressed on the kept copy of the list, 0.67 s before the fresh read landed. There the job just
// saved at fit 90 was still applied at 80, tied with the real-form jobs, so the first of those was read and the saved job's chip never changed.
test('Start picks from the fresh list, never from the kept copy painted before the fresh read landed', async () => {
  const saved = 'https://e2e.recruitee.com/o/submit-form', other = 'https://e2e.recruitee.com/real/other-9b0bc5b0';
  const kept = [{url: other, fit: 80}, {url: 'https://e2e.recruitee.com/real/greenhouse-e36f249d', fit: 80}, {url: saved, fit: 80, status: 'applied'}];
  const fresh = [kept[0], kept[1], {url: saved, fit: 90, status: 'saved'}];
  assert.equal(pickForTriage(kept, {n: 1})[0].url, other, 'a pick from the kept copy reads the wrong job');
  let shown = kept, settled = false;
  const landed = startListRead();
  const picking = pickWhenFresh(() => shown, listReady, {n: 1});
  picking.then(() => { settled = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false, 'Start waits while the fresh read is under way');
  shown = fresh;
  landed();
  assert.deepEqual((await picking).map(job => job.url), [saved]);
});

test('with no read under way Start picks at once; a later read makes the next Start wait again', async () => {
  const jobs = [{url: 'https://a.example/1', fit: 70}, {url: 'https://a.example/2', fit: 95}];
  const landed = startListRead();
  landed();
  assert.deepEqual((await pickWhenFresh(() => jobs, listReady, {n: 1})).map(job => job.fit), [95]);
  const again = startListRead();
  let settled = false;
  pickWhenFresh(() => jobs, listReady, {n: 1}).then(() => { settled = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  again();
});

// Review of #3548: a reason without a translation key showed as its raw id ("check", "no form") in the chip's detail.
test('every reason the mode table gives is shown translated, never as its raw id', () => {
  const look = {eligible: true, captcha: false, login: false, accountCreation: false, allFactsSaved: null};
  for (const read of [{...look, simple: true, why: ''}, {...look, simple: false, why: 'no form'}, {...look, captcha: true, simple: false, why: 'captcha'}, {...look, captcha: true, simple: false, why: 'check'},
    {...look, login: true, simple: false, why: 'login'}, {...look, accountCreation: true, simple: false, why: 'account'}, {...look, simple: false, why: ''}, {...look, allFactsSaved: true}, {...look, allFactsSaved: false}, {...look, eligible: false}]) {
    const {detail} = chipOf(read);
    assert.ok(detail && !['check', 'no form', 'captcha'].includes(detail), `raw reason shown for ${JSON.stringify(read)}: "${detail}"`);
  }
  assert.equal(chipOf({eligible: true, captcha: true, login: false, accountCreation: false, simple: false, why: 'check'}).detail, 'a check may be in the form');
});

// L2a (owner 7 Nov 2026, "3 general ones, and have substatus"): three statuses, the sub-status is the chip's detail.
test('three statuses: Simple form, Needs you, Couldn\'t read, each with a sub-status in words', () => {
  const look = {eligible: true, captcha: false, login: false, accountCreation: false, allFactsSaved: null};
  assert.deepEqual(chipOf({...look, simple: true, why: ''}), {label: 'Simple form', tone: 'good', detail: 'can apply automatically'});
  assert.deepEqual(chipOf({...look, captcha: true, simple: false, why: 'captcha'}), {label: 'Needs you', tone: 'warn', detail: 'a check that you are human'});
  assert.deepEqual(chipOf({unreadable: true, why: 'timeout'}), {label: "Couldn't read", tone: 'neutral', detail: 'took too long'});
  assert.deepEqual(chipOf({unreadable: true, why: 'frame'}).detail, 'the form is in a frame');
  assert.equal(chipOf({unreadable: true, why: 'afterApply'}).detail, "the page Apply opened didn't answer", 'a read that went quiet after its Apply press says so (8 Nov 2026)');
  assert.equal(chipOf({unreadable: true, why: 'something new'}).detail, "the page didn't load or couldn't be read", 'an unknown reason never shows its raw id');
  assert.equal(chipOf(null).label, 'Not checked', 'positive control: no read is still Not checked');
});

test('a simple form that lacks saved details says which, three at most and the rest as a count', () => {
  const look = {eligible: true, captcha: false, login: false, accountCreation: false, allFactsSaved: null, simple: true, why: ''};
  const some = labels => ({...look, match: {missing: labels.map(label => ({kind: 'detail', label})), unjudged: 0}});
  assert.deepEqual(chipOf(some(['Notice period'])), {label: 'Simple form', tone: 'info', detail: 'needs your details: Notice period'});
  assert.equal(chipOf(some(['Phone', 'Street', 'Notice period', 'Postal code', 'City'])).detail, 'needs your details: Phone, Street, Notice period +2');
  assert.equal(chipOf(some(['Phone', 'Phone'])).detail, 'needs your details: Phone', 'the same detail asked twice is said once');
  assert.equal(chipOf({...look, match: {missing: [], unjudged: 0}}).detail, 'can apply automatically');
});

test('a question no saved answer covers says "needs your answer", never "your details"; details come first; unjudged answers say so', () => {
  const look = {eligible: true, captcha: false, login: false, accountCreation: false, allFactsSaved: null, simple: true, why: ''};
  assert.equal(chipOf({...look, match: {missing: [{kind: 'answer', label: 'Do you speak French?'}], unjudged: 0}}).detail, 'needs your answer: Do you speak French?');
  assert.equal(chipOf({...look, match: {missing: [{kind: 'answer', label: 'Do you speak French?'}, {kind: 'detail', label: 'Phone'}], unjudged: 0}}).detail, 'needs your details: Phone, Do you speak French?');
  assert.deepEqual(chipOf({...look, questions: ['Notice period']}), {label: 'Simple form', tone: 'info', detail: 'answers not checked'});
  assert.equal(chipOf({...look, questions: null}).detail, 'answers not checked');
});

test('a box with no question text says so in words, never a raw id', () => {
  const look = {eligible: true, captcha: false, login: false, accountCreation: false, allFactsSaved: null, simple: true, why: '', questions: ['field_1'], match: {missing: [], unjudged: 0, unnamed: 1}};
  assert.equal(chipOf(look).detail, 'a required box has no question text');
});
