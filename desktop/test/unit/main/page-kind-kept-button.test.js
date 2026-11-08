// A remembered posting answer is per address shape, but its Apply button belongs to one page: a posting of the same shape whose page does not show a kept button is asked again,
// and every confirmed button is kept for the shape, so the next posting with either button is answered for free.
// Why (8 Nov 2026, owner: "please debug all the applying sessions, find the bugs"): the twin's kept answer for every XING job page (shape www.xing.com/jobs/*|0, 27 Oct)
// named "easy apply"; the Lufthansa posting's own button read "Visit employer website", so the extension found no button to press and ended at "can't reach the form".
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {kindKey, pageKind, pageKindCache} from '../../../lib/page-kind.js';

const posting = (slug, buttons) => ({url: `https://jobs.example.test/jobs/${slug}`, title: 'First Officer', headings: ['First Officer'], buttons, controls: []});
const easy = posting('first-officer-1', ['Save job', 'Easy apply', 'Create search alert']);
const external = posting('first-officer-2', ['Save job', 'Visit employer website', 'Create search alert']);
// The AI's answer for a posting: `button` named with what it does (`kind`, the AI's own judgment of the control).
const answering = (button, calls, kind = button ? 'apply' : 'none') => ({messages: {create: async request => { calls.push(request); return {stop_reason: 'end_turn', usage: {input_tokens: 600, output_tokens: 20},
  content: [{type: 'text', text: JSON.stringify({kind: 'posting', confidence: 0.95, apply_button: button, apply_button_kind: kind})}]}; }}});
const cacheIn = () => pageKindCache(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-kept-button-')), 'page-kinds.json'));
const said = answer => [answer.by, answer.applyButton];

test('a posting whose page lacks the remembered Apply button is asked again, and its own button is the one named', async () => {
  assert.equal(kindKey(easy), kindKey(external), 'the two postings share one kept answer');
  const calls = [], cache = cacheIn();
  assert.deepEqual(said(await pageKind(answering('Easy apply', calls), easy, cache)), ['ai', 'easy apply']);
  assert.deepEqual([...said(await pageKind(answering('Easy apply', calls), posting('first-officer-3', ['Easy apply', 'Save job']), cache)), calls.length], ['remembered', 'easy apply', 1],
    'positive control: a page that shows the kept button is answered for free');
  assert.deepEqual([...said(await pageKind(answering('Visit employer website', calls), external, cache)), calls.length], ['ai', 'visit employer website', 2], 'the kept "easy apply" is not on this page: asked, never pressed blind');
});

test('both buttons of a shape are kept: postings that alternate between them cost no more asks', async () => {
  const calls = [], cache = cacheIn();
  await pageKind(answering('Easy apply', calls), easy, cache);
  await pageKind(answering('Visit employer website', calls), external, cache);
  for (const [page, button] of [[easy, 'easy apply'], [external, 'visit employer website'], [posting('first-officer-4', ['Easy apply']), 'easy apply']]) {
    assert.deepEqual(said(await pageKind(answering('', calls), page, cache)), ['remembered', button], page.url);
  }
  assert.equal(calls.length, 2, 'one ask per button, then none (review finding 4: one slot flip-flopped, one ask a page)');
});

test('an ask that names no Apply leaves the kept button: this page gets it as before, and the next Easy-apply posting is still answered for free', async () => {
  const calls = [], cache = cacheIn();
  await pageKind(answering('Easy apply', calls), easy, cache);
  // The AI calls the employer link a third-party control (or the sketch's 20 buttons cut the kept one off, or the page is not drawn yet): no button named.
  assert.deepEqual(said(await pageKind(answering('Visit employer website', calls, 'third_party'), external, cache)), ['remembered', 'easy apply'], 'no worse than before the re-ask: the kept button is still tried');
  assert.deepEqual([...said(await pageKind(answering('', calls), posting('first-officer-5', ['Easy apply']), cache)), calls.length], ['remembered', 'easy apply', 2],
    'review finding 1: a button-less answer never wipes the kept button out');
  assert.deepEqual(said(await pageKind(null, external, cache)), ['remembered', 'easy apply'], 'without AI, the kept answer stands as before');
});

test('a kept button matches the page\'s button cleaned the same way: "Easy apply!" is the kept "easy apply" (Gitar on #3607)', async () => {
  const calls = [], cache = cacheIn();
  assert.deepEqual(said(await pageKind(answering('Easy apply!', calls), posting('first-officer-6', ['Save job', 'Easy apply!']), cache)), ['ai', 'easy apply']);
  assert.deepEqual([...said(await pageKind(answering('', calls), posting('first-officer-7', ['Easy apply!', 'Save job']), cache)), calls.length], ['remembered', 'easy apply', 1]);
});
