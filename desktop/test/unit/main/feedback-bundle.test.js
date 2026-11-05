// "Send feedback" attachments (lib/feedback-bundle.js): a log full of fake secrets leaves nothing secret, the support state and run lines are there, the cap keeps the newest lines,
// and the screenshot is shrunk under its cap. Fake values only; nothing here reads the owner's logs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {buildLogs, redact, runLines, shotDataUrl, pageText, profileText, MAX_LOGS_BYTES, MAX_DATA_BYTES} from '../../../lib/feedback-bundle.js';

const HOME = '/Users/ana.fake';
const FAKE = {
  anthropic: 'sk-ant-api03-FAKEFAKEFAKEFAKEFAKE1234567890',
  openai: 'sk-proj-FAKEFAKEFAKEFAKEFAKE1234567890',
  notion: 'ntn_FAKE0000111122223333444455556666',
  notionOld: 'secret_FAKEnotionoldtoken1234567890abcdef',
  github: 'ghp_FAKEFAKEFAKEFAKEFAKEFAKEFAKE12345678',
  telegram: '123456789:AAFAKEtelegramtokenFAKEFAKEFAKE_12',
  google: 'GOCSPX-FAKEFAKEFAKEFAKE',
  jwt: 'eyJFAKEheader123.eyJFAKEpayload123.FAKEsignature123',
  liAt: 'AQEDARFAKEliatvalue0000111122223333',
  jsession: 'ajax:FAKE1234567890123',
  password: 'hunter2-fake',
  opaque: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4',
  email: 'someone.else@example.org',
  linkQuery: 'utm_FAKEquerysecret',
};
const noisyLog = [
  '2026-11-02 09:12:03 info  app v0.5.71 win32 10.0.19045',
  `2026-11-02 09:12:04 info  key loaded ANTHROPIC_API_KEY=${FAKE.anthropic} and ${FAKE.openai}`,
  `2026-11-02 09:12:05 warn  notion request failed {"token":"${FAKE.notion}","old":"${FAKE.notionOld}"}`,
  `2026-11-02 09:12:06 info  headers Authorization: Bearer ${FAKE.jwt}`,
  `2026-11-02 09:12:07 info  github ${FAKE.github} telegram ${FAKE.telegram} google ${FAKE.google}`,
  `2026-11-02 09:12:08 info  linkedin session li_at=${FAKE.liAt}; JSESSIONID="${FAKE.jsession}"`,
  `2026-11-02 09:12:09 info  Cookie: li_at=${FAKE.liAt}; foo=bar`,
  `2026-11-02 09:12:10 error login password: ${FAKE.password} for ${FAKE.email}`,
  `2026-11-02 09:12:11 info  opened ${HOME}/Library/Application Support/Jobadabra/data/store.db and C:\\Users\\Ana Fake\\AppData\\Roaming\\Jobadabra\\logs and C:\\\\Users\\\\anafake\\\\x`,
  `2026-11-02 09:12:12 info  fetch https://example.com/jobs?${FAKE.linkQuery}=1#frag`,
  `2026-11-02 09:12:13 info  hash ${FAKE.opaque}`,
  '2026-11-02 09:12:14 warn  setup AI engine: not ready (no key)',
].join('\n');

test('a log full of fake secrets leaves none of them, and keeps what a person reads it by', () => {
  const out = redact(noisyLog, {home: HOME});
  for (const [name, value] of Object.entries(FAKE)) assert.ok(!out.includes(value), `${name} survived`);
  for (const folder of ['ana.fake', 'Ana Fake', 'anafake']) assert.ok(!out.includes(folder), `${folder} survived`);
  assert.match(out, /C:\\Users\\…\\AppData/);
  assert.match(out, /~\/Library\/Application Support/);
  assert.match(out, /2026-11-02 09:12:03 info {2}app v0\.5\.71 win32/);
  assert.match(out, /setup AI engine: not ready \(no key\)/);
  assert.match(out, /https:\/\/example\.com\/jobs\b/);
});

test('a very long line is cut (a copied text would hide there)', () => {
  const out = redact(`x ${'word '.repeat(400)}`);
  assert.ok(out.length < 700);
  assert.match(out, /\(\+\d+ chars\)/);
});

function folderWith(files) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'feedback-bundle-'));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(folder, name), text);
  return folder;
}

test('the bundle holds the state, the last runs (no job text) and the newest log lines, redacted', () => {
  const folder = folderWith({'app.log': noisyLog, 'engine.log': 'engine line 1\nengine line 2'});
  const runs = [{startedAt: '2026-11-02T09:00:00Z', endedAt: '2026-11-02T09:01:30Z', kind: 'search', trigger: 'you', ok: true, summary: 'Tracked Senior Engineer at Acme Corp'},
    {startedAt: '2026-11-01T09:00:00Z', endedAt: '2026-11-01T09:00:10Z', kind: 'kits', trigger: 'schedule', ok: false, summary: 'Notion said 401'}];
  const {text, parts} = buildLogs({folder, runs, home: HOME, state: {version: '0.5.71', os: 'win32 10.0.19045', aiEngine: 'Claude Code', aiReady: false, store: 'this-mac', extensionPaired: false}});
  assert.deepEqual(parts, ['state', 'runs', 'app.log', 'engine.log']);
  assert.match(text, /aiEngine: Claude Code\naiReady: false\nstore: this-mac\nextensionPaired: false/);
  assert.match(text, /search · by you · ok · 90s/);
  assert.match(text, /kits · by schedule · failed · 10s · Notion said 401/);
  assert.ok(!text.includes('Senior Engineer') && !text.includes('Acme'), 'a run that worked says no job title');
  assert.ok(!text.includes(FAKE.anthropic));
  assert.match(text, /engine line 2/);
  assert.equal(runLines([]).length, 0);
});

test('only a day file: the newest day with lines is used; no logs at all still gives the state', () => {
  const folder = folderWith({'app-2026-10-30.log': 'old day line', 'app-2026-11-01.log': 'yesterday line'});
  assert.match(buildLogs({folder}).text, /yesterday line/);
  const empty = buildLogs({folder: path.join(folder, 'missing'), state: {version: '1'}});
  assert.deepEqual(empty.parts, ['state', 'runs']);
  assert.match(empty.text, /version: 1/);
});

test('over the cap the oldest log lines go and the state stays, under 200 KB', () => {
  const lines = Array.from({length: 4000}, (_, i) => `2026-11-02 line ${i} ${'x'.repeat(100)}`).join('\n');
  const folder = folderWith({'app.log': lines});
  const {text, bytes} = buildLogs({folder, state: {version: '9'}, appLines: 4000, max: 20 * 1024});
  assert.ok(bytes <= 20 * 1024, `${bytes} bytes`);
  assert.match(text, /version: 9/);
  assert.match(text, /line 3999 /);
  assert.ok(!text.includes('line 0 '));
  assert.match(text, /older lines cut/);
  assert.ok(MAX_LOGS_BYTES < 200 * 1024);
});

test('the screenshot is shrunk, then its quality lowered, until it fits; an empty window gives nothing', () => {
  const sizes = [];
  const image = {isEmpty: () => false, getSize: () => ({width: 2400, height: 1500}),
    resize({width}) { return {...image, getSize: () => ({width, height: Math.round(width * 0.625)}), toJPEG: quality => { sizes.push([width, quality]); return Buffer.alloc(width * quality * 10); }}; },
    toJPEG: () => Buffer.alloc(0)};
  const shot = shotDataUrl(image, {maxBytes: 300_000});
  assert.match(shot.dataUrl, /^data:image\/jpeg;base64,/);
  assert.ok(shot.bytes <= 300_000);
  assert.ok(sizes.length > 1 && sizes[0][0] === 1600);
  assert.equal(shotDataUrl({isEmpty: () => true}), null);
  assert.equal(shotDataUrl(image, {maxBytes: 10}), null);
});

test('the screen data is redacted like the logs, lists the last runs, and an over-cap list is halved until it fits', () => {
  const data = {jobs: Array.from({length: 4000}, (_, i) => ({id: `j${i}`, title: `Engineer ${i}`, company: 'Acme', note: i === 0 ? `mail ${FAKE.email} key ${FAKE.anthropic}` : ''}))};
  const small = pageText({screen: 'jobs', source: 'registry', data: {jobs: data.jobs.slice(0, 2)}}, {home: HOME, runs: [{startedAt: '2026-11-02T09:00:00Z', endedAt: '2026-11-02T09:00:10Z', kind: 'refresh', trigger: 'you', ok: false, summary: 'never finished'}]});
  assert.ok(!small.text.includes(FAKE.email) && !small.text.includes(FAKE.anthropic));
  assert.match(small.text, /refresh · by you · failed · 10s · never finished/);
  assert.equal(small.cut, false);
  const big = pageText({screen: 'jobs', source: 'registry', data}, {home: HOME, max: 30 * 1024});
  assert.ok(big.bytes <= 30 * 1024 && big.cut, `${big.bytes} bytes`);
  assert.match(big.text, /"id": "j0"/); assert.match(big.text, /the longest list was shortened/);
  assert.ok(MAX_DATA_BYTES < 200 * 1024);
});

test('the Profile snapshot keeps its parts, loses e-mail addresses and secrets, and names what was lacking', () => {
  const out = profileText({reader: 'portrait', parts: {details: [{label: 'E-mail', value: FAKE.email}, {label: 'City', value: 'Porto'}], cv: {summary: `key ${FAKE.anthropic}`}}, lacked: ['voice']}, {home: HOME});
  assert.deepEqual(out.parts, ['details', 'cv']);
  assert.match(out.text, /Porto/); assert.match(out.text, /"voice"/);
  assert.ok(!out.text.includes(FAKE.email) && !out.text.includes(FAKE.anthropic));
  assert.ok(profileText({parts: {cv: Array.from({length: 100}, (_, i) => `a line of the CV, number ${i}`)}}, {max: 1000}).cut);
});

// #3071: a run that ends ok or with warnings still shows its warning lines, as fixed sentences: a count, an error class, an HTTP status, a few fixed words. Never the tail of a line.
const warnRun = (warningLines, extra = {}) => ({startedAt: '2026-11-04T02:06:00Z', endedAt: '2026-11-04T02:09:00Z', kind: 'search', trigger: 'you', ok: true, summary: 'Tracked Senior Engineer at Acme Corp', warningLines, ...extra});
const sentOf = (warningLines, extra) => runLines([warnRun(warningLines, extra)]).slice(1);

test('a run that ended ok shows the tester\'s warnings as fixed sentences', () => {
  const lines = runLines([warnRun([
    'AI limit reached: Claude Code (your Claude plan) cannot go on (status 429), 266 job(s) left for the next check',
    '266 job(s) waiting, none scored this run',
    'cronjob run not logged to Notion: HTTPError: HTTP Error 400',
    'Skipped job 4711: BadRequestError: usage limit',
  ], {warned: true})]).join('\n');
  assert.match(lines, /· warnings · 180s/);
  assert.match(lines, /! AI limit reached: Claude Code, cannot go on, HTTP 429, 266 job\(s\) left for the next check/);
  assert.match(lines, /! 266 job\(s\) waiting, none scored this run/);
  assert.match(lines, /! run not logged to Notion: HTTPError, HTTP 400/);
  assert.match(lines, /! Skipped a job: BadRequestError/);
  assert.ok(!lines.includes('4711') && !lines.includes('Senior Engineer'), 'a job id and the summary of a run that worked stay home');
});

test('a job title or an employer in a warning is not sent: not in a line of no known shape, and not in the tail of a known one', () => {
  const named = [
    'web search for Acme Corp did not answer: TimeoutError',
    'AI stages skipped for https://boards.greenhouse.io/acme/jobs/1: KeyError',
    'Acme Corp 9: description not fetched: HTTPError',
    'Skipped job 7: CliError: Claude Code failed: Senior Engineer at Acme Corp, Zurich: the posting says',
    'AI unavailable (timeout scoring Acme Corp), 3 job(s) left for the next check',
    'cronjob run not logged to Notion: HTTPError: Could not find page "Acme Corp offer"',
    'AI limit reached: Claude Code said "Senior Engineer at Acme Corp", 4 job(s) not scored',
    'AI limit reached: x\nAcme Corp: description not fetched',
    'run not opened in the run history: OSError: /Volumes/Anna Fake Data/jobs.db',
  ];
  const text = sentOf(named).join('\n');
  for (const name of ['Acme', 'Senior Engineer', 'greenhouse', 'Zurich', 'posting', 'Anna Fake', 'jobs.db', 'timeout']) assert.ok(!text.includes(name), `${name} must not leave`);
  assert.match(text, /! Skipped a job: CliError/);
  assert.match(text, /! AI unavailable, 3 job\(s\) left for the next check/);
  assert.match(text, /! run not logged to Notion: HTTPError$/m);
  assert.match(text, /! AI limit reached: Claude Code, 4 job\(s\) not scored/);
  assert.match(text, /\+4 other warnings not sent/, 'the web search, the link, the "<company> <id>" line and the line with a break are only counted');
});

test('warning lines: the newest 3 runs only, 5 per run, once each; the text still passes redact()', () => {
  const many = Array.from({length: 9}, (_, i) => `${i + 1} job(s) not scored`);
  const lines = runLines([warnRun(many), warnRun(['AI limit reached', 'AI limit reached']), warnRun(['AI limit reached: Codex']), warnRun(['AI limit reached: OpenAI']), warnRun(['AI limit reached: OpenAI'])]);
  const marked = lines.filter(line => /^ {3}!/.test(line));
  assert.equal(marked.filter(line => /job\(s\) not scored/.test(line)).length, 5);
  assert.ok(marked.includes('   ! (+4 more)'));
  assert.equal(marked.filter(line => line === '   ! AI limit reached').length, 1, 'a repeated line once');
  assert.ok(!lines.join('\n').includes('OpenAI'), 'the fourth and fifth run send no warning lines');
  const text = buildLogs({folder: path.join(os.tmpdir(), 'no-such-feedback-folder'), runs: [warnRun([`AI limit reached: ${FAKE.anthropic} ${FAKE.email}`])], home: HOME}).text;
  assert.ok(!text.includes(FAKE.anthropic) && !text.includes(FAKE.email));
});

test('a run without warning lines reads as before, and a failed run keeps its summary', () => {
  assert.deepEqual(runLines([warnRun([])]), ['2026-11-04T02:06:00Z · search · by you · ok · 180s']);
  assert.match(runLines([warnRun(['AI limit reached'], {ok: false, summary: 'Notion said 401'})]).join('\n'), /failed · 180s · Notion said 401\n {3}! AI limit reached/);
});

test('the lines come from the run record the app holds: its log and report, read by the Activity page\'s own reader, for the newest 3 runs', async () => {
  const {withWarningLines} = await import('../../../lib/feedback-run-warnings.js');
  const log = ['Found 12 jobs', 'Warning: cronjob run not logged to Notion: HTTPError: HTTP Error 400', 'AI limit reached: Claude Code (your Claude plan) cannot go on, 266 job(s) left for the next check', 'Enriched 1 of 1 job(s); 0 failed'];
  const record = {startedAt: '2026-11-04T02:06:00Z', endedAt: '2026-11-04T02:09:00Z', kind: 'search', trigger: 'you', ok: true, log};
  const read = withWarningLines([record, record, record, record]);
  assert.equal(read.length, 4);
  assert.ok(read[2].warningLines && !read[3].warningLines, 'only the runs the bundle describes with warnings are read');
  const text = runLines(read.slice(0, 1)).join('\n');
  assert.match(text, /ok · 180s\n {3}! run not logged to Notion: HTTPError, HTTP 400\n {3}! AI limit reached: Claude Code, cannot go on, 266 job\(s\) left/);
  assert.ok(!text.includes('Found 12 jobs') && !text.includes('Enriched'), 'only warnings, not the log');
});
