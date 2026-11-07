// `npm run twin -- --replay <id>`: load one AI tester's reported bug into the twin: fetch its bundle (report, state, versions) from the private store with the Admin key, put its session record(s) in the twin's
// folder (sessions.json, restored at the app's start) and its job row beside them (replay/<id>/job.json), and say what the tester expected and saw. Never the owner's real folder: a folder that is the real one is refused.
// Why (7 Nov 2026, owner: a bug filed by an AI should be replayable by "any agent"; spec 2026-11-07-ai-tester-bug-reports-design.md): the bundle's state.json is the state the bug happened in.
// Not done (parked): putting the job row into the twin's store as a row; it is saved as a file and printed so the replaying agent can add the job from its link in the twin.
// Job: report health
// Guard: desktop/e2e/test/harness/twin-replay.test.mjs (the real folder is refused; the key goes only in the Authorization header).
import fs from 'node:fs';
import path from 'node:path';
import {realDataFolders} from '../../lib/app-identity.js';

export const SITE = 'https://www.jobadabra.top';
/** A bundle id as the site mints it (16 lowercase hex characters), else null: the only shape that is ever put into a URL. */
export const idOf = value => (/^[0-9a-f]{16}$/.test(String(value ?? '')) ? String(value) : null);

/** The bundle's report, state and versions from the store. `key`: the Admin Bearer key (the Keychain item the other Admin tools read), sent only in the Authorization header. -> {report, state, env} or throws in words. */
export async function fetchBundle(id, {key, fetcher = globalThis.fetch, site = SITE} = {}) {
  if (!idOf(id)) throw new Error('--replay needs a bundle id: 16 characters, 0-9 a-f (it is in the bug\'s GitHub issue, "Evidence bundle")');
  if (!key) throw new Error('no Admin key: the replay reads the private bundle with it');
  const read = async name => {
    const response = await fetcher(`${site}/admin/bug-bundle/${id}/${name}`, {headers: {Authorization: `Bearer ${key}`}});
    if (response.status === 404) throw new Error(`bundle ${id} has no ${name}: it is not kept (90 days), or the Admin key is wrong`);
    if (!response.ok) throw new Error(`bundle ${id}: ${name} answered ${response.status}`);
    return JSON.parse(await response.text());
  };
  return {report: await read('report.json'), state: await read('state.json'), env: await read('env.json')};
}

const text = value => (typeof value === 'string' ? value : '');
/**
 * One session record of a bundle as the app's own saved record, built field by field: state.json comes from a tester (redacted but untrusted), and the app throws on a record whose url, title or company is not a string
 * (lib/session-contracts.js), which would fail every Sessions list call. Only the fields a restored, stopped session needs are kept: no transcript path, Claude id or output. -> record, or null without a usable id.
 * Why (7 Nov 2026, review of 5/5): the first version spread the whole record in.
 */
const recordOf = record => {
  if (!record || typeof record !== 'object' || !/^[\w-]{1,64}$/.test(text(record.id))) return null;
  return {id: record.id, kind: ['claude', 'form', 'read'].includes(record.kind) ? record.kind : 'claude', url: text(record.url), title: text(record.title), company: text(record.company), location: text(record.location), workMode: text(record.workMode),
    status: 'ended', note: '', question: '', outcome: text(record.outcome), events: [], output: '', cols: 120, rows: 32, exitCode: null, needsYouSince: null};
};

/**
 * Puts the bundle's session record(s) and job row into the twin's folder `home` (never the real one). The sessions join sessions.json (an array the app restores at start, as stopped sessions); the job row is
 * written to replay/<id>/job.json. -> {sessions: n, job: boolean, file}
 */
export function loadBundle(id, bundle, home, {real = realDataFolders(), now = new Date()} = {}) {
  if (!idOf(id)) throw new Error('loadBundle needs a bundle id (16 characters, 0-9 a-f)');
  const folder = path.resolve(home);
  if ([].concat(real).some(dir => folder === path.resolve(dir))) throw new Error('the replay never writes into the real app folder; start the twin and let it make its own');
  const sessions = (Array.isArray(bundle.state?.sessions) ? bundle.state.sessions : []).map(recordOf).filter(Boolean)
    .map(record => ({...record, note: `Replay of bundle ${id}`, startedAt: now.toISOString(), endedAt: now.toISOString(), savedAt: now.toISOString()}));
  const file = path.join(folder, 'sessions.json');
  let kept = [];
  try { const onDisk = JSON.parse(fs.readFileSync(file, 'utf8')); if (Array.isArray(onDisk)) kept = onDisk.filter(record => !sessions.some(added => added.id === record.id)); } catch (error) { if (error.code !== 'ENOENT') throw new Error(`sessions.json in the twin folder is not readable: ${error.message}`); }   // Why: no file yet is the normal first replay
  fs.mkdirSync(folder, {recursive: true});
  fs.writeFileSync(file, JSON.stringify([...kept, ...sessions]), {mode: 0o600});
  const job = bundle.state?.job && typeof bundle.state.job === 'object' ? bundle.state.job : null;
  if (job) { fs.mkdirSync(path.join(folder, 'replay', id), {recursive: true}); fs.writeFileSync(path.join(folder, 'replay', id, 'job.json'), JSON.stringify(job, null, 2), {mode: 0o600}); }
  return {sessions: sessions.length, job: !!job, file};
}

/** What the replaying agent reads first: the bug in the tester's words, and a warning when the bundle's app version is not this checkout's. */
export function describeReplay(bundle, {version = ''} = {}) {
  const {report = {}, env = {}} = bundle;
  const lines = [`bug: ${report.title || '(no title)'} [${report.severity || '?'}, journey ${report.journey || 'none'}]`, `expected: ${report.expected || '-'}`, `seen: ${report.seen || '-'}`];
  if (env.appVersion && version && env.appVersion !== version) lines.push(`note: the bug was seen on app ${env.appVersion}; this checkout is ${version}`);
  return lines;
}
