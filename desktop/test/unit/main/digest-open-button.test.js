// A digest answer of verb open is the same press as press, for a link and for a button, with the same floors (lib/ladder/rung3-digest.js validateDigest, rung2-sketch.js digestKind).
// Swatch, 11 Oct 2026: the real digest answered outcome link, verb open, number 1 (a main-area link to the employer's application system) and the answer was dropped: no form on this page.
// #3425 (7 Nov 2026): the same for a posting whose only way on is a button without href (a script opens the employer's site): the validator dropped open on a button, the page ended as no form.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {pageKind, pageKindCache} from '../../../lib/page-kind.js';

const seq = answers => ({messages: {create: async () => ({stop_reason: 'end_turn', usage: {input_tokens: 700, output_tokens: 30}, content: [{type: 'text', text: JSON.stringify(answers[0])}]})}});
const cacheIn = () => pageKindCache(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jp-kind-')), 'page-kinds.json'));
const posting = {url: 'https://board.example.test/jobs/officer-1', title: 'A321 First Officer', headings: ['A321 First Officer'], controls: [], buttons: []};

for (const [kind, host] of [['link', {host: 'apply5.ats.example'}], ['button', {}]]) {
  test(`a digest "open" naming a ${kind} becomes the Apply button exactly like a press: only when the AI judges it apply, the shared floor accepts it, and nothing else is pressed`, async () => {
    const page = {...posting, candidates: [{n: 1, kind, ...host, position: 'main', text: 'Visit employer website'}, {n: 2, kind, ...(kind === 'link' ? {host: 'sso.example'} : {}), position: 'main', text: 'Sign in with LinkedIn'},
      {n: 3, kind, ...host, position: 'main', text: 'Se connecter'}, {n: 4, kind: 'sentence', position: 'main', text: 'Bewerben Sie sich auf der Seite des Arbeitgebers'}, {n: 5, kind: 'email', position: 'main', text: 'jobs@firma.ch'}]};
    const open = (number, press_kind, outcome = 'form') => seq([{outcome, verb: 'open', numbers: [number], confidence: 0.85, ...(press_kind === undefined ? {} : {press_kind})}]);
    const ask = (number, press_kind, outcome) => pageKind(open(number, press_kind, outcome), page, cacheIn(), {digest: true});
    const got = await ask(1, 'apply');
    assert.deepEqual([got.by, got.rung, got.dropped, got.applyButton], ['digest', 3, undefined, 'visit employer website'], `the ${kind} the digest opened is the Apply button to press`);
    assert.equal((await ask(1, 'apply', 'link')).applyButton, 'visit employer website', 'outcome link with open is the same');
    for (const [number, pressKind] of [[2, 'third_party'], [3, 'sign_in'], [1, 'sign_up']]) assert.equal((await ask(number, pressKind)).applyButton, '', `a ${pressKind} ${kind} is never pressed`);
    for (const pressKind of [undefined, '', 'other', 'APPLY']) assert.equal((await ask(1, pressKind)).applyButton, '', `press_kind ${JSON.stringify(pressKind)} judges nothing`);
    assert.equal((await ask(2, 'apply')).applyButton, '', 'the AI saying apply does not lift the shared floor');
    for (const number of [4, 5, 99]) assert.equal((await ask(number, 'apply')).applyButton || '', '', `open of candidate ${number} (a sentence, an address, none) names no control to press`);
  });
}
