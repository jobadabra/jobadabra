// The words of Connect Claude (renderer/desktop-ai-words.js connectWords, instruction v2): no question marks, the privacy note names the AI and its company and keeps its promises (no secrets, no
// posting texts, no submit, listed and undoable), and both AIs get the same checks.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {NAMES, connectWords, instruction, whenText} from '../renderer/desktop-ai-words.js';

test('every AI gets the same words: no question mark, its own name and company in the privacy note', () => {
  for (const family of Object.keys(NAMES)) {
    const say = connectWords(family);
    assert.doesNotMatch(JSON.stringify(say), /\?/, `${family}: no question mark in the interface words`);
    assert.ok(say.privacy.text.includes(NAMES[family]), `${family}: the note names the AI`);
    assert.match(say.privacy.text, family === 'openai' ? /OpenAI/ : /Anthropic/);
    assert.match(say.privacy.text, /never sees your passwords, keys or your LinkedIn session/);
    assert.match(say.privacy.text, /never reads job posting texts, and never submits anything/);
    assert.match(say.privacy.text, /listed under Changes by .* can be undone\. Disconnect any time/);
    assert.equal(say.privacy.cancel, 'Not now');
  }
});

test('the connected line says when it was last used, or that it was not used yet', () => {
  const say = connectWords('claude');
  assert.equal(say.connected('14:02'), 'Claude is connected · Last used 14:02');
  assert.equal(say.connected(''), 'Claude is connected · Not used yet');
  assert.equal(say.changes.arrow('', '3 months'), 'open → 3 months');
});

test('instruction v2 is the short one once connected and keeps the safety sentence; the old one stays for the copy press', () => {
  assert.match(instruction(true), /^Use the Jobadabra tools to answer my open questions\./);
  assert.match(instruction(true), /Never press Submit on any job\. Do not change Settings\./);
  assert.match(instruction(), /go to Profile → What we learned/);
  assert.match(instruction(), /Never press Submit on any job\. Do not change Settings\./);
});

test('the time of a use: today shows the clock, another day shows the date too, nothing shows nothing', () => {
  const now = new Date(2026, 10, 3, 18, 0);
  assert.equal(whenText(new Date(2026, 10, 3, 14, 2).toISOString(), now), '14:02');
  assert.equal(whenText(new Date(2026, 10, 2, 9, 5).toISOString(), now), '2 Nov, 09:05');
  assert.equal(whenText('', now), '');
  assert.equal(whenText('not a date', now), '');
});
