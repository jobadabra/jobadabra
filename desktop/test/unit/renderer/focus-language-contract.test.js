// Guard: data — real Focus/Jobs cards localize app-owned copy while canonical action/stage fields and user values stay unchanged (#3507).
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {install} from '../../tiny-dom.js';
import {setLocale} from '../../../i18n/index.js';
import {createStorage} from '../../../lib/storage.js';
import {letterQuestion} from '../../../lib/letter-availability.js';
import {copyFields, copyMessage} from '../../../i18n/display-copy.js';

const body = install();
const {document, window} = globalThis;
const markup = fs.readFileSync(new URL('../../../renderer/index.html', import.meta.url), 'utf8');
for (const [, tag, id] of markup.matchAll(/<([a-z][\w-]*)\b[^>]*\bid="([^"]+)"/gi)) {
  const node = document.createElement(tag); node.id = id; body.append(node);
}
window.pilot.state = async () => ({settings: {}, secrets: {}, about: {}});
setLocale('de');
const interval = globalThis.setInterval;
globalThis.setInterval = (...args) => { const handle = interval(...args); handle.unref(); return handle; };
const {focusCard} = await import('../../../renderer/pages/focus.js');
const {entryRow} = await import('../../../renderer/pages/focus-suggestions.js');
const {questionEntries} = await import('../../../renderer/question-entries.js');
const {funnelSteps, funnelName} = await import('../../../renderer/funnel-view.js');
const {openPrep} = await import('../../../renderer/pages/prep.js');
globalThis.setInterval = interval;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

test('German Focus/Jobs renders actual engine and main-process cards with no authored English left', t => {
  const python = process.env.JOBADABRA_CHECK_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const generated = spawnSync(python, [path.join(root, 'desktop/test/fixtures/focus_language.py')], {cwd: root, encoding: 'utf8', env: {...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8'}});
  assert.equal(generated.status, 0, generated.stderr);
  const focus = JSON.parse(generated.stdout), before = JSON.stringify(focus);
  const storage = createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'focus-language-')), {encrypt: value => value, decrypt: value => value});
  t.after(() => { fs.rmSync(storage.dir, {recursive: true, force: true}); setLocale('en'); });
  const letter = letterQuestion(storage), letterBefore = JSON.stringify(letter);
  const rows = [...focus.items.map(focusCard), ...questionEntries({letter}).map(entryRow),
    ...funnelSteps(focus.test_funnel.map(step => ({name: funnelName(step), reached: 0, share: 0, title: '', label: '', urls: []})), () => {})];
  const visible = rows.map(row => row.textContent).join('\n');
  assert.doesNotMatch(visible, /Apply to your next role|Human reply|Prepared|No usable cover letter|Create cover letter|Your application is prepared|Next step/);
  assert.equal(JSON.stringify(focus), before, 'display rendering must not rewrite canonical engine fields');
  assert.equal(JSON.stringify(letter), letterBefore, 'letter readiness, approval and action identities stay canonical');
});

test('opening a German preparation card keeps its dialog context and AI-unavailable response localized', async t => {
  setLocale('de');
  t.after(() => setLocale('en'));
  const item = copyFields({kind: 'prepare', page_id: 'fictional', job: 'Raw {job} <title>', badge: 'Interview today'}, {
    badge: copyMessage('focusCards.items.m012', 'Interview today', {value: '7. Nov.'}),
  });
  const failure = copyFields({ok: false, text: 'The prep kit needs AI'}, {
    text: copyMessage('focusCards.mainPrepNeedsAi', 'The prep kit needs AI'),
  });
  const before = JSON.stringify(item);
  window.pilot.interviewPrep = async () => failure;
  document.getElementById('prep-dialog').showModal = () => {};
  openPrep(item);
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(document.getElementById('prep-context').textContent.includes(item.job));
  assert.doesNotMatch(document.getElementById('prep-context').textContent, /Interview today/);
  assert.doesNotMatch(document.getElementById('prep-message').textContent, /The prep kit needs AI/);
  assert.match(document.getElementById('prep-message').textContent, /KI/);
  assert.equal(JSON.stringify(item), before);
});
