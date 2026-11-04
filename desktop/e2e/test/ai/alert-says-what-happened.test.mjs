// Guard: money — an alert may say credit or a limit ran out only when the broker said capped; without this a dropped connection sends the owner to top up a balance that is fine.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {outcomeOf} from '../../broker-relay-run.mjs';
import {alertCappedSteps} from '../../credit-alert.mjs';
import {noteSkipped} from '../../lib/broker-job.mjs';
import {AiRefused, describe, kindOf} from '../../../../tools/ci-intel/lib/ai-refusal.mjs';

const env = {CI_ALERTS_TELEGRAM_BOT_TOKEN: 't', CI_ALERTS_TELEGRAM_CHAT_ID: 'c', GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: '1', GITHUB_WORKFLOW: 'Central scout'};
const REFUSED = 'Codex refused the AI jobs of this run; they are skipped (grey), nothing is paid';

// One note through the real writer, then the real alert; returns the Telegram text and the log lines.
async function alertOf(note) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alert-')), lines = [], sent = [], print = console.log;
  console.log = () => {};
  try { noteSkipped({job: 'central-scout', ...note, dir, env: {}}); } finally { console.log = print; }
  await alertCappedSteps({artifacts: dir, verdict: REFUSED, env, log: line => lines.push(line), fetcher: async (url, init) => { sent.push(String(init.body)); return new Response('{"ok":true}'); }});
  fs.rmSync(dir, {recursive: true, force: true});
  return {text: sent.join(''), lines};
}

test('one failed call of forty is told as what it was, with the count, never as credit or a refusal', async () => {
  const stats = {calls: 40, ok: 39, refused: 1, capHit: 0, latched: '', reasons: ['no answer from the broker: fetch failed (UND_ERR_SOCKET: other side closed) after 63 s']};
  const {why} = outcomeOf(stats, 'central-scout');
  assert.match(why, /^1 of 40 AI calls failed \(no answer from the broker: fetch failed \(UND_ERR_SOCKET/);
  const {text, lines} = await alertOf({why});
  assert.match(text, /AI calls failed/);
  assert.match(text, /1 of 40 AI calls failed/);
  assert.doesNotMatch(text, /ran out|refused the AI/i);
  assert.ok(lines.every(line => line.startsWith('::warning title=AI calls failed::')), lines.join());
});

test('the broker\'s budget reason and the neuron cap are still told as credit', async () => {
  const stats = {calls: 12, ok: 11, refused: 3, capHit: 0, latched: 'the AI broker said no (broker: budget:own-share 66.0% of 60%)', reasons: []};
  for (const why of [outcomeOf(stats, 'central-scout').why, '100400 of 100000 neurons; 2 skipped step(s)']) {
    const {text} = await alertOf({why});
    assert.match(text, /AI credit ran out/);
    assert.match(text, /Codex refused the AI jobs/);
  }
});

test('a 503 about one bad reply, a lost login or a 401 is no credit, though the client files them under capped', async () => {
  for (const why of ['AI skipped/failed: 3 AI calls were refused (the AI broker said no (broker: fallback:reply-refused))', 'broker: login-lost', 'mail reading: 401: invalid x-api-key']) {
    const {text} = await alertOf({why});
    assert.doesNotMatch(text, /ran out|refused the AI/i, why);
  }
  assert.equal(kindOf('capped', 'broker: fallback:reply-refused'), 'overloaded');
  assert.equal(kindOf('capped', 'broker: login-lost'), 'limit');
  assert.equal(kindOf('capped', 'broker: budget:week 100% of 100% (scheduled)'), 'limit');
});

test('a failed connection is its own kind and its words name no limit; a broker 5xx is not called unreachable', () => {
  assert.equal(kindOf('unreachable', 'no answer from the broker: fetch failed'), 'connection');
  const said = describe(new AiRefused('unreachable', 'no answer from the broker: fetch failed (ECONNRESET: read ECONNRESET) after 63 s'));
  assert.match(said, /^AI skipped \(connection\): no answer came back/);
  assert.doesNotMatch(said, /overloaded/);
  assert.doesNotMatch(describe(new AiRefused(500, 'broker: 500')), /unreachable/);
});
