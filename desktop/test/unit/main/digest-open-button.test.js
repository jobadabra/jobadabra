// A digest answer of `open` that names a BUTTON (#3425): the same press as `press`, with the same floors (lib/ladder/rung3-digest.js validateDigest, rung2-sketch.js digestKind).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {pageKind, pageKindCache} from '../../../lib/page-kind.js';

const seq = answers => ({messages: {create: async () => ({stop_reason: 'end_turn', usage: {input_tokens: 700, output_tokens: 30}, content: [{type: 'text', text: JSON.stringify(answers[0])}]})}});
const cacheIn = () => pageKindCache(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-kind-')), 'page-kinds.json'));
const posting = {url: 'https://board.example.test/jobs/officer-1', title: 'A321 First Officer', headings: ['A321 First Officer'], controls: [], buttons: []};

// #3425 (7 Nov 2026): a posting's only way to the employer is a button (no href: a script opens the employer's site). The digest named it with `open` (it leads to another site) and the
// validator dropped the answer ("open needs a link"), so the page ended as "no form". `open` and `press` are one press downstream, so a button named with open is the same press, same floors.
test('a digest "open" naming a button is the same press as "press": the Apply button only when the AI judges it apply, the shared floor still holds', async () => {
  const page = {...posting, candidates: [{n: 1, kind: 'sentence', position: 'main', text: 'Bewerben Sie sich auf der Seite des Arbeitgebers'}, {n: 2, kind: 'button', position: 'main', text: 'Visit employer website'},
    {n: 3, kind: 'button', position: 'main', text: 'Sign in with LinkedIn'}, {n: 4, kind: 'button', position: 'main', text: 'Se connecter'}]};
  const open = (number, press_kind) => seq([{outcome: 'form', verb: 'open', numbers: [number], confidence: 0.85, ...(press_kind === undefined ? {} : {press_kind})}]);
  const got = await pageKind(open(2, 'apply'), page, cacheIn(), {digest: true});
  assert.deepEqual([got.by, got.rung, got.dropped, got.applyButton], ['digest', 3, undefined, 'visit employer website'], 'the button the digest opened is the Apply button to press');
  for (const [number, kind] of [[3, 'third_party'], [4, 'sign_in'], [2, 'sign_up']]) assert.equal((await pageKind(open(number, kind), page, cacheIn(), {digest: true})).applyButton, '', `a ${kind} button is never pressed`);
  for (const kind of [undefined, '', 'other']) assert.equal((await pageKind(open(2, kind), page, cacheIn(), {digest: true})).applyButton, '', `press_kind ${JSON.stringify(kind)} judges nothing`);
  assert.equal((await pageKind(open(3, 'apply'), page, cacheIn(), {digest: true})).applyButton, '', 'the AI saying apply does not lift the shared floor');
  assert.equal((await pageKind(open(1, 'apply'), page, cacheIn(), {digest: true})).applyButton || '', '', 'a sentence is never a control to press, whatever the verb');
});
