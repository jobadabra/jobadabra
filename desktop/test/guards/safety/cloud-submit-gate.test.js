// Guard: safety — without it the cloud browser could press Submit with no confirmation of the person's, with another item's or a saved setting's, on a page that is incomplete, behind a bot check, not eligible, or that refused us.
// The one Submit gate of the cloud runner's `auto` task (desktop/ready-fill/submit-gate.js; spec docs/superpowers/specs/2026-11-08-cloud-browser-runner-design.md, "auto"; owner, 10 Nov 2026: "Build it now (Recommended)").
// Each refusal is tested alone against one item that passes, so a check that goes missing turns exactly one test red.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {gateSubmit, submitVerdict} from '../../../ready-fill/submit-gate.js';

const NOW = Date.parse('2026-11-10T03:00:00Z');
const job = {id: 'j1', url: 'https://jobs.example.com/acme/1', session: 's-1'};
const item = {job: 'j1', url: job.url, session: 's-1', state: 'cloud', manualOverride: false, mode: 'auto', chosenAt: '2026-11-01T10:00:00.000Z', autoConfirmedAt: '2026-11-09T20:00:00.000Z', queuedAt: Date.parse('2026-11-09T20:01:00Z'), allowIneligible: false, waitMin: 0};
const proof = {answer: 'ready', step: 'final', requiredComplete: true, safe: true, submitControl: 'button#send', signature: 'sig-1', botCheck: false};
const good = (change = {}) => ({task: 'auto', job, item, sentAt: '2026-11-09T22:00:00.000Z', proof, readySignature: 'sig-1', readyAt: NOW - 1000, stage: 'Kit ready', kit: {eligible: true}, status: 200, attempted: false, now: NOW, ...change});
const refused = (input, reason) => { const verdict = submitVerdict(input); assert.equal(verdict.submit, false); assert.equal(verdict.reason, reason); return verdict; };

test('the one item that passes every check is pressed', () => {
  assert.deepEqual(submitVerdict(good()), {submit: true});
});

test('only task auto presses: readiness and fill never do', () => {
  for (const task of ['readiness', 'fill', '', undefined, 'AUTO']) assert.equal(refused(good({task}), 'not_auto').final, true, String(task));
});

test('no stamp on the item: refused', () => {
  refused(good({item: {...item, autoConfirmedAt: ''}}), 'not_confirmed');
  refused(good({item: {...item, chosenAt: ''}}), 'not_confirmed');
  refused(good({item: {...item, mode: 'fill'}}), 'not_confirmed');
  refused(good({item: null}), 'not_confirmed');
});

test('a saved setting alone is never a confirmation: the gate does not read settings', () => {
  const unstamped = {...item, autoConfirmedAt: ''};
  refused(good({item: unstamped, settings: {apply: {mode: 'auto', autoConfirmedAt: '2026-11-09T20:00:00.000Z', chosenAt: 'x'}}}), 'not_confirmed');
  refused(good({item: unstamped, autoConfirmedAt: '2026-11-09T20:00:00.000Z'}), 'not_confirmed');
});

test('another item\'s stamp: another job, another address, or an earlier queue of this job', () => {
  refused(good({item: {...item, job: 'j2'}}), 'other_item_stamp');
  refused(good({item: {...item, url: 'https://jobs.example.com/acme/2'}}), 'other_item_stamp');
  refused(good({item: {...item, session: 's-0'}}), 'other_item_stamp');
  refused(good({item: {...item, session: ''}, job: {...job, session: ''}}), 'other_item_stamp');
  refused(good({item: {...item, job: undefined, url: undefined}, job: {session: 's-1'}}), 'other_item_stamp');   // two missing ids are not a match (code review of cs 1/4)
});

test('a stale or made-up stamp: not a time, in the future, written after the queueing, or an item older than its night', () => {
  refused(good({item: {...item, autoConfirmedAt: 'yes'}}), 'stale_stamp');
  refused(good({item: {...item, autoConfirmedAt: new Date(NOW + 10 * 60000).toISOString()}}), 'stale_stamp');
  refused(good({item: {...item, autoConfirmedAt: new Date(item.queuedAt + 5 * 60000).toISOString()}}), 'stale_stamp');
  refused(good({item: {...item, queuedAt: 'never'}}), 'stale_stamp');
  refused(good({item: {...item, queuedAt: NOW + 10 * 60000}}), 'stale_stamp');   // a queueing in the future
  refused(good({item: {...item, queuedAt: NOW + 50000, autoConfirmedAt: new Date(NOW + 90000).toISOString()}}), 'stale_stamp');   // a stamp in the future, even before its queueing's allowance
});

test('the item is good for its batch\'s 24 h on the site\'s clock, counted from when the batch arrived', () => {
  assert.deepEqual(submitVerdict(good({item: {...item, queuedAt: NOW - 30 * 3600000, autoConfirmedAt: new Date(NOW - 31 * 3600000).toISOString()}, sentAt: NOW - 3600000})), {submit: true});
  refused(good({sentAt: NOW - 25 * 3600000}), 'stale_stamp');
  refused(good({sentAt: undefined}), 'stale_stamp');
  refused(good({sentAt: NOW + 10 * 60000}), 'stale_stamp');
});

test('a Stop, Cancel all or hand-off ends the item: it is never pressed', () => {
  refused(good({item: {...item, manualOverride: true}}), 'stopped_or_handed_off');
  for (const state of ['needs_user_handoff', 'manual_submit_required', 'submitting', 'receipt_confirmed', '', undefined]) refused(good({item: {...item, state}}), 'stopped_or_handed_off');
  refused(good({stopped: true}), 'stopped_or_handed_off');
  assert.deepEqual(submitVerdict(good({item: {...item, state: 'queued'}})), {submit: true});
});

test('the page\'s own proof: every required field, a sending control, the same page it judged', () => {
  refused(good({proof: {...proof, requiredComplete: false}}), 'page_changed_or_incomplete');
  refused(good({proof: {...proof, submitControl: ' '}}), 'page_changed_or_incomplete');
  refused(good({proof: {...proof, step: 'middle'}}), 'page_changed_or_incomplete');
  refused(good({proof: {...proof, answer: 'unsure'}}), 'page_changed_or_incomplete');
  refused(good({proof: {...proof, safe: false}}), 'page_changed_or_incomplete');
  refused(good({readySignature: 'sig-0'}), 'page_changed_or_incomplete');
  refused(good({proof: null}), 'page_changed_or_incomplete');
  refused(good({proof: {...proof, signature: ''}, readySignature: ''}), 'page_changed_or_incomplete');
  refused(good({proof: {...proof, submitControl: {selector: 'button'}}}), 'page_changed_or_incomplete');
  refused(good({readyAt: undefined}), 'page_changed_or_incomplete');   // never judged ready: not a wait
  refused(good({readyAt: '1'}), 'page_changed_or_incomplete');
});

test('a bot check, or no word about one, is the person\'s', () => {
  refused(good({proof: {...proof, botCheck: true}}), 'bot_check_unknown');
  refused(good({proof: {...proof, botCheck: undefined}}), 'bot_check_unknown');
});

test('kit eligibility holds unless the item opted in, and only for an explicit not eligible', () => {
  refused(good({kit: {eligible: false}}), 'not_eligible');
  refused(good({kit: {}}), 'not_eligible');
  refused(good({kit: null, item: {...item, allowIneligible: true}}), 'not_eligible');   // unknown is not an explicit ineligible verdict
  refused(good({stage: 'Applied'}), 'not_eligible');
  assert.deepEqual(submitVerdict(good({kit: {eligible: false}, item: {...item, allowIneligible: true}})), {submit: true});
});

test('401, 403 and 429 end the job: final, never a retry', () => {
  for (const status of [401, 403, 429]) assert.equal(refused(good({status}), 'blocked_status').final, true);
});

test('a job already pressed is never pressed again', () => {
  refused(good({attempted: true}), 'attempt_already_reserved');
});

// Why (13 Nov 2026, owner, LinkedIn Easy Apply: "4a fill, 4b send (Recommended)", asked via AskUserQuestion): nothing sends on LinkedIn until its own sending PR (plan 4b).
test('a LinkedIn job is never pressed, nor an address that cannot be read', () => {
  for (const url of ['https://www.linkedin.com/jobs/view/1', 'https://linkedin.com/jobs/view/1', 'https://ch.linkedin.com/jobs/view/1', 'not an address']) {
    refused(good({job: {...job, url}, item: {...item, url}}), 'send_not_allowed_here');
  }
  assert.equal(submitVerdict(good({job: {...job, url: 'https://notlinkedin.com/jobs/1'}, item: {...item, url: 'https://notlinkedin.com/jobs/1'}})).submit, true, 'a host that only ends in the word is another site');
});

// Gitar on #4054: a short link or a redirect queued under another address that lands on LinkedIn is judged by the page the judge saw.
test('a job queued elsewhere whose page is on LinkedIn is never pressed', () => {
  refused(good({proof: {...proof, page: 'https://www.linkedin.com/jobs/view/1'}}), 'send_not_allowed_here');
  assert.equal(submitVerdict(good({proof: {...proof, page: job.url}})).submit, true, 'the page on the queued site presses as before');
});

test('the item\'s own wait holds the press and is the only refusal that is not final', () => {
  const verdict = refused(good({item: {...item, waitMin: 5}}), 'waiting');
  assert.equal(verdict.final, false);
  assert.equal(verdict.dueAt, NOW - 1000 + 5 * 60000);
});

test('an item without its own wait is refused, never pressed at once on a default', () => {
  for (const waitMin of [undefined, null, '5', -1, NaN]) refused(good({item: {...item, waitMin}}), 'item_incomplete');
});

test('the press waits for the site to reserve its one attempt; a refused or failed reservation never presses', async () => {
  const asked = [];
  assert.deepEqual(await gateSubmit(good(), {reserve: async id => { asked.push(id); return {ok: true, attempt: 'a-1'}; }}), {submit: true, attempt: 'a-1', control: 'button#send', signature: 'sig-1'});
  assert.deepEqual(asked, ['j1']);
  assert.equal((await gateSubmit(good(), {reserve: async () => ({ok: false, error: 'ceiling'})})).reason, 'ceiling');
  assert.equal((await gateSubmit(good(), {reserve: async () => ({ok: false, error: 'already'})})).reason, 'attempt_already_reserved');
  assert.equal((await gateSubmit(good(), {reserve: async () => { throw new Error('network'); }})).reason, 'reserve_failed');
  assert.equal((await gateSubmit(good(), {reserve: async () => ({ok: true})})).reason, 'reserve_failed');
  let reserved = 0;
  assert.equal((await gateSubmit(good({proof: {...proof, botCheck: true}}), {reserve: async () => { reserved++; return {ok: true, attempt: 'a'}; }})).submit, false);
  assert.equal(reserved, 0, 'a refused verdict never takes an attempt of the ceiling');
});

test('the Mac\'s Full automation and the cloud gate share one proof and eligibility check', () => {
  const lib = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../lib');
  const store = fs.readFileSync(path.join(lib, 'background-apply-store.js'), 'utf8');
  assert.match(store, /import \{kitAllows, linkedinAddress, proofOk, readableAddress, sendAllowedAt\} from '\.\/submit-proof\.js'/);
  assert.match(store, /if \(!readableAddress\(url\) \|\| \(proof\?\.page && !readableAddress\(proof\.page\)\)\) return stop\('send_not_allowed_here'\);\n(?:.*\n)?\s+if \(!onLinkedin && !sendAllowedAt\(url, proof\?\.page\)\) return stop\('send_not_allowed_here'\)/,
    'an unreadable address is refused first, LinkedIn or not (Gitar on #4240), then the cloud\'s rule');
  // Plan 4b-1 (owner, 14 Nov 2026): on LinkedIn the Mac asks LinkedIn's own turn (the item's stamp, 15 a day, 2 min apart); the cloud keeps refusing it (sendAllowedAt above).
  assert.match(store, /const linkedin = onLinkedin \? sendTurn\(storage, state, new Date\(now\(\)\)\) : \{go: true\};\n\s+if \(linkedin\.stop\) return stop\(linkedin\.stop\);/, 'a LinkedIn press goes through its own turn');
  assert.doesNotMatch(store, /const proofOk\s*=/, 'a second copy of the proof check drifts');
});

test('readiness and fill never reach the gate: the auto night\'s line is its one caller, and only it presses', () => {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../ready-fill');
  const read = name => fs.readFileSync(path.join(dir, name), 'utf8');
  const callers = fs.readdirSync(dir).filter(name => /\.m?js$/.test(name) && name !== 'submit-gate.js' && /\bgateSubmit\b|\bsubmitVerdict\b/.test(read(name)));
  // Why (10 Nov 2026, cs 3/4): auto-commands.mjs answers the extension's `ready` through gateSubmit; a second caller is a second way to press, and changing this list is a reviewed change.
  assert.deepEqual(callers, ['auto-commands.mjs']);
  assert.match(read('night.mjs'), /if \(task === 'auto'\) return \{held, \.\.\.await autoNight\(/, 'the night reaches the line only for task auto');
  assert.doesNotMatch(read('read-night.mjs') + read('fill-job.mjs'), /auto-commands|auto-night/, 'the read and the fill never load the auto line');
  // Why (10 Nov 2026, cs 3/4 review): the fill's net is in night.mjs (fillAll), not fill-job.mjs; every net( call but the auto night's is the bare full net.
  const nets = fs.readdirSync(dir).filter(name => /\.m?js$/.test(name) && name !== 'no-submit.mjs').flatMap(name => [...read(name).matchAll(/\bnet\(context([^)]*)\)/g)].map(match => [name, match[1]]));
  assert.deepEqual(nets.filter(([, args]) => args).map(([name]) => name), ['auto-night.mjs'], 'only the auto night opens the net');
  assert.ok(nets.filter(([, args]) => !args).length >= 2, 'the fill and the read still call the full net');
});
