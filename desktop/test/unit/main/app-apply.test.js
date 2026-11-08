// Apply from the app: choosing jobs and kits, Chrome and Claude sessions, tickets, the extension's base CV.
// Split from app.test.js (8 Oct 2026) without changing any test.
import {readScreenSource} from '../../static-screen-source.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import * as apply from '../../../lib/apply.js';

// The launcher reads the browser's last-used profile from HOME / LOCALAPPDATA: point both at an empty folder so no test reads the owner's real browser.
const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-home-'));
process.env.HOME = emptyHome;
process.env.LOCALAPPDATA = emptyHome;
import * as strategy from '../../../lib/strategy.js';
import {createStorage} from '../../../lib/storage.js';

// Stand-in for safeStorage: reversible, and obviously not plain text on disk.
const fakeCrypto = {encrypt: v => Buffer.from(v).reverse().toString('base64'), decrypt: s => Buffer.from(s, 'base64').reverse().toString()};
const tempStorage = () => createStorage(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-')), fakeCrypto);

test('apply picks saved jobs first, then the best fit, only with a kit, never applied or dismissed ones', () => {
  const jobs = [
    {url: 'a', status: 'unreviewed', fit: 60, kit: true}, {url: 'b', status: 'applied', fit: 95, kit: true},
    {url: 'c', status: 'saved', fit: 40, kit: true}, {url: 'd', status: 'unreviewed', fit: 88, kit: true},
    {url: 'e', status: 'dismissed', fit: 99, kit: true}, {url: 'f', status: 'unreviewed', fit: null, kit: true},
    {url: 'g', status: 'unreviewed', fit: 97},
  ];
  assert.deepEqual(apply.pick(jobs, 3).map(j => j.url), ['c', 'd', 'a']);  // g: best fit, but no kit yet
});

test('agent sessions need Notion; Chrome opens the chosen jobs', async () => {
  const storage = tempStorage();
  const spawned = [];
  const fakeSpawn = (cmd, args) => { spawned.push([cmd, ...args]); return {unref() {}}; };
  const blocked = await apply.start(storage, {n: 2, mode: 'agents'}, fakeSpawn);
  assert.equal(blocked.ok, false);
  assert.equal(spawned.length, 0);
});

test('the background runner queues the chosen jobs for the hidden browser and never opens the person\'s Chrome', async () => {
  const jobs = [{url: 'https://jobs.example.test/background', status: 'saved', fit: 90, title: 'Nurse', company: 'Fictional', kit: true}];
  const launched = [], queued = [];
  const result = await apply.start(tempStorage(), {n: 1, mode: 'background', applyMode: 'fill'}, (...args) => { launched.push(args); return {unref() {}}; }, async () => ({jobs}),
    undefined, undefined, null, undefined, {enqueue: async (selected, applyMode) => { queued.push({selected, applyMode}); return {ok: true}; }});
  assert.equal(result.ok, true);
  assert.deepEqual(queued.map(row => [row.selected.map(job => job.url), row.applyMode]), [[[jobs[0].url], 'fill']]);
  assert.deepEqual(launched, []);
  const unwired = await apply.start(tempStorage(), {n: 1, mode: 'background', applyMode: 'fill'}, (...args) => { launched.push(args); return {unref() {}}; }, async () => ({jobs}));
  assert.equal(unwired.ok, false);   // no queue handed in: refuse, never fall through to the visible Chrome launcher
  assert.deepEqual(launched, []);
});

test('Chrome mode marks each job link so the extension fills every tab by itself', {skip: process.platform === 'win32' && 'Mac launcher (open -a, Terminal); Windows is covered below'}, async () => {
  const storage = tempStorage();
  const spawned = [];
  const fakeSpawn = (cmd, args) => { spawned.push([cmd, ...args]); return {unref() {}}; };
  const fakeList = async () => ({jobs: [
    {url: 'https://job-boards.greenhouse.io/a/jobs/1#top', status: 'unreviewed', fit: 80, title: 'SRE', company: 'A', kit: true},
    {url: 'https://jobs.lever.co/b/2', status: 'saved', fit: 60, title: 'DevOps', company: 'B', kit: true}]});
  const result = await apply.start(storage, {n: 2, mode: 'chrome'}, fakeSpawn, fakeList);
  assert.equal(result.ok, true);
  const ids = spawned[0].slice(3).map(address => address.split('#jobpilotto-fill=')[1]);   // each tab carries the form session made for its job
  assert.deepEqual(spawned[0].slice(0, 3), ['open', '-a', 'Google Chrome']);
  assert.deepEqual(spawned[0].slice(3).map(address => address.split('#')[0]), ['https://jobs.lever.co/b/2', 'https://job-boards.greenhouse.io/a/jobs/1']);
  assert.ok(ids.every(Boolean) && new Set(ids).size === 2, ids.join());
});

test('Apply with no job at all says to find jobs, not that preparing failed', async () => {
  const result = await apply.start(tempStorage(), {n: 2, mode: 'chrome'}, () => ({unref() {}}), async () => ({jobs: []}), undefined, undefined, async () => ({ok: false}));
  assert.deepEqual(result, {ok: false, error: 'No job to apply to yet. Press Find jobs first.'});
});

test('an Apply batch drafts the missing kits for the best jobs first, quietly, and says so', {skip: process.platform === 'win32' && 'Mac launcher'}, async () => {
  const storage = tempStorage();
  const spawned = [];
  const fakeSpawn = (cmd, args) => { spawned.push([cmd, ...args]); return {unref() {}}; };
  const jobs = [{code: 'a', url: 'https://a/1', status: 'unreviewed', fit: 90, title: 'SRE', company: 'A', kit: true},
    {code: 'b', url: 'https://b/2', status: 'unreviewed', fit: 85, title: 'Ops', company: 'B'},
    {code: 'c', url: 'https://c/3', status: 'unreviewed', fit: 70, title: 'Dev', company: 'C'}];
  const prepared = [];
  const prepare = async code => { prepared.push(code); jobs.find(job => job.code === code).kit = true; return {ok: true}; };
  const result = await apply.start(storage, {n: 2, mode: 'chrome'}, fakeSpawn, async () => ({jobs}), undefined, undefined, prepare);
  assert.deepEqual(prepared, ['b']);  // only the shortfall, best fit first
  assert.match(result.message, /^Prepared 1 application first\. Opened 2 job/);
  assert.deepEqual(result.outcomes, [{url: jobs[1].url, title: jobs[1].title, company: jobs[1].company, status: 'started', reason: ''}], 'a successfully opened Chrome batch reports the drafted kit as started');
  assert.equal(spawned[0].length, 3 + 2);
});

test('a background batch keeps mixed eligibility and preparation failures beside the eligible job it queued', async () => {
  const jobs = [1, 2, 3, 4].map((number, index) => ({code: String(number), url: `https://jobs.example.test/${number}`, title: `Fictional role ${number}`, company: 'Example Air', status: 'saved', stage: 'Saved', fit: 90 - index}));
  const prepared = [], enqueued = [];
  const result = await apply.start(tempStorage(), {n: 3, mode: 'background', applyMode: 'fill'}, undefined, async () => ({jobs}), undefined, undefined,
    async code => {
      prepared.push(code);
      const job = jobs.find(row => row.code === code);
      if (code === '2') { job.kit = true; job.ineligible = 'Required aviation credential missing.'; return {ok: true, ineligible: job.ineligible}; }
      if (code === '3') return {ok: false, error: 'The application kit could not be saved.'};
      job.kit = true;
      return {ok: true};
    }, undefined, {enqueue: async selected => {
      enqueued.push(...selected.map(job => job.url));
      return {ok: true, sessions: ['fictional-session'], outcomes: selected.map(({url, title, company}) => ({url, title, company, status: 'started', reason: ''}))};
    }});
  assert.deepEqual(prepared, ['1', '2', '3', '4'], 'the not-eligible kit used no slot: job 4 was drafted to fill it');
  assert.deepEqual(enqueued, ['https://jobs.example.test/1', 'https://jobs.example.test/4'], 'the ineligible job and failed preparation never reach the queue');
  assert.equal(result.ok, true, 'the eligible job still starts');
  assert.deepEqual(result.outcomes, [
    {url: jobs[0].url, title: jobs[0].title, company: jobs[0].company, status: 'started', reason: ''},
    {url: jobs[3].url, title: jobs[3].title, company: jobs[3].company, status: 'started', reason: ''},
    {url: jobs[1].url, title: jobs[1].title, company: jobs[1].company, status: 'ineligible', reason: 'Required aviation credential missing.'},
    {url: jobs[2].url, title: jobs[2].title, company: jobs[2].company, status: 'failed', reason: 'The application kit could not be saved.'},
  ]);
});

// Why (8 Nov 2026, owner screenshot): Background with 3 jobs whose kits are drafted ended "No applications were started" and three "Kit prepared" rows. The drafted kits were marked not eligible in the store; the prepare answer carried no verdict, so each row said "prepared" while the re-read dropped it. The store is the truth: a row that cannot start says why.
test('a drafted job the store then holds back says why, never "Kit prepared" as the end of the story', async () => {
  const jobs = [1, 2, 3].map(number => ({code: String(number), url: `https://jobs.example.test/${number}`, title: `Fictional role ${number}`, company: 'Example Air', status: 'saved', stage: 'Saved', fit: 90 - number}));
  const queued = [];
  const result = await apply.start(tempStorage(), {n: 3, mode: 'background', applyMode: 'fill'}, undefined, async () => ({jobs}), undefined, undefined,
    async code => { const job = jobs.find(row => row.code === code); job.kit = code !== '3'; if (code === '1') job.ineligible = 'Required aviation credential missing.'; if (code === '2') job.stage = 'Recruiter lead'; return {ok: true}; },
    undefined, {enqueue: async selected => { queued.push(...selected); return {ok: true, outcomes: []}; }});
  assert.deepEqual(queued, [], 'nothing reaches the queue');
  assert.equal(result.ok, false);
  assert.deepEqual(result.outcomes.map(item => [item.url.slice(-1), item.status]), [['1', 'ineligible'], ['2', 'not-started'], ['3', 'not-started']]);
  assert.equal(result.outcomes[0].reason, 'Required aviation credential missing.');
  assert.ok(result.outcomes.every(item => item.reason), 'every row carries its real reason');
});

test('a kit verdict from the engine shows its reason once, under the Not eligible pill', async () => {
  const job = {code: '1', url: 'https://jobs.example.test/1', title: 'Fictional role', company: 'Example Air', status: 'saved', stage: 'Saved', fit: 80};
  const result = await apply.start(tempStorage(), {n: 1, mode: 'background', applyMode: 'fill'}, undefined, async () => ({jobs: [job]}), undefined, undefined,
    async () => { job.kit = true; job.ineligible = 'Needs an EU work permit.'; return {ok: true, ineligible: 'Not eligible: Needs an EU work permit.'}; }, undefined, {enqueue: async () => ({ok: true})});
  assert.deepEqual(result.outcomes.map(item => [item.status, item.reason]), [['ineligible', 'Needs an EU work permit.']]);
});

// Why (8 Nov 2026, owner via the coordinator: "A batch should pick only jobs it can start and fill the count from the next eligible ones"): the top 3 matches have no kit yet; their kits come back not eligible; three eligible jobs further down must start.
test('a batch of 3 whose top matches turn out not eligible drafts further down and starts 3 eligible jobs', async () => {
  const verdict = {1: 'Required aviation licence missing.', 2: 'Needs an EU work permit.', 3: 'Needs a security clearance.'};
  const jobs = [1, 2, 3, 4, 5, 6, 7].map((number, index) => ({code: String(number), url: `https://jobs.example.test/${number}`, title: `Role ${number}`, company: 'Example Air', status: 'saved', stage: 'Saved', fit: 95 - index}));
  const prepared = [], queued = [];
  const result = await apply.start(tempStorage(), {n: 3, mode: 'background', applyMode: 'fill'}, undefined, async () => ({jobs}), undefined, undefined,
    async code => { prepared.push(code); const job = jobs.find(row => row.code === code); job.kit = true; if (verdict[code]) job.ineligible = verdict[code]; return {ok: true, ...(verdict[code] ? {ineligible: `Not eligible: ${verdict[code]}`} : {})}; },
    undefined, {enqueue: async selected => { queued.push(...selected.map(job => job.code)); return {ok: true, outcomes: selected.map(({url, title, company}) => ({url, title, company, status: 'started', reason: ''}))}; }});
  assert.deepEqual(queued, ['4', '5', '6'], 'the three eligible jobs start');
  assert.deepEqual(prepared, ['1', '2', '3', '4', '5', '6'], 'seven was never drafted: no more than needed');
  assert.equal(result.ok, true);
  assert.deepEqual(result.outcomes.map(item => item.status), ['started', 'started', 'started', 'ineligible', 'ineligible', 'ineligible']);
});

test('when the engine\'s verdict is not in the prepare answer, the re-read list still sends the batch on to the next jobs', async () => {
  const jobs = [1, 2, 3, 4].map((number, index) => ({code: String(number), url: `https://jobs.example.test/${number}`, title: `Role ${number}`, company: 'Example Air', status: 'saved', stage: 'Saved', fit: 95 - index}));
  const queued = [];
  const result = await apply.start(tempStorage(), {n: 2, mode: 'background', applyMode: 'fill'}, undefined, async () => ({jobs}), undefined, undefined,
    async code => { const job = jobs.find(row => row.code === code); job.kit = true; if (code <= '2') job.ineligible = 'Needs a work permit.'; return {ok: true}; },
    undefined, {enqueue: async selected => { queued.push(...selected.map(job => job.code)); return {ok: true, outcomes: selected.map(({url, title, company}) => ({url, title, company, status: 'started', reason: ''}))}; }});
  assert.deepEqual(queued, ['3', '4']);
  assert.deepEqual(result.outcomes.filter(item => item.status === 'ineligible').map(item => item.reason), ['Needs a work permit.', 'Needs a work permit.']);
});

test('drafting stops at the extra-attempt cap when every job is not eligible, and says so row by row', async () => {
  const jobs = Array.from({length: 20}, (_, index) => ({code: `c${index}`, url: `https://jobs.example.test/${index}`, title: `Role ${index}`, company: 'Example Air', status: 'saved', stage: 'Saved', fit: 90 - index}));
  const prepared = [];
  const result = await apply.start(tempStorage(), {n: 2, mode: 'background', applyMode: 'fill'}, undefined, async () => ({jobs}), undefined, undefined,
    async code => { prepared.push(code); const job = jobs.find(row => row.code === code); job.kit = true; job.ineligible = 'Needs a work permit.'; return {ok: true, ineligible: 'Not eligible: Needs a work permit.'}; },
    undefined, {enqueue: async () => ({ok: true})});
  assert.equal(prepared.length, 8, 'N + 6 drafts at most');
  assert.equal(result.ok, false);
  assert.ok(result.outcomes.every(item => item.status === 'ineligible' && item.reason));
});

test('with the opt-in on, a drafted not-eligible kit is picked and reported as started, not as not eligible', async () => {
  for (const mode of ['chrome', 'background']) {
    const storage = tempStorage();
    storage.saveSettings({apply: {allowIneligible: true}});
    const job = {code: 'x', url: 'https://jobs.example.test/x', title: 'Fictional role', company: 'Example Air', status: 'saved', stage: 'Saved', fit: 80};
    const result = await apply.start(storage, {n: 1, mode, applyMode: 'fill'}, () => ({unref() {}}), async () => ({jobs: [job]}), undefined, undefined,
      async () => { job.kit = true; job.ineligible = 'Needs a work permit.'; return {ok: true, ineligible: 'Not eligible: Needs a work permit.'}; }, undefined,
      {enqueue: async selected => ({ok: true, outcomes: selected.map(({url, title, company}) => ({url, title, company, status: 'started', reason: ''}))})});
    assert.equal(result.ok, true, mode);
    assert.deepEqual(result.outcomes.map(item => item.status), ['started'], mode);
  }
});

test('a re-read list that spells a job\'s link differently still matches its row, once', async () => {
  const before = [{code: 'x', url: 'https://Jobs.example.test/x/?utm=1', title: 'Fictional role', company: 'Example Air', status: 'saved', stage: 'Saved', fit: 80}];
  const after = [{...before[0], url: 'https://jobs.example.test/x', kit: true}];
  let reads = 0;
  const result = await apply.start(tempStorage(), {n: 1, mode: 'background', applyMode: 'fill'}, undefined, async () => ({jobs: reads++ ? after : before}), undefined, undefined,
    async () => ({ok: true}), undefined, {enqueue: async selected => ({ok: true, outcomes: selected.map(({url, title, company}) => ({url, title, company, status: 'started', reason: ''}))})});
  assert.deepEqual(result.outcomes.map(item => [item.url, item.status]), [['https://jobs.example.test/x', 'started']], 'one row, no false "no longer in your list"');
});

test('the words for a batch that finds nothing say what is true of the jobs listed', async () => {
  const stage = {status: 'saved', stage: 'Saved', url: 'https://jobs.example.test/x', kit: true};
  const say = async (jobs, settings) => {
    const storage = tempStorage();
    if (settings) storage.saveSettings(settings);
    return (await apply.start(storage, {n: 3, mode: 'background', applyMode: 'auto'}, undefined, async () => ({jobs}), undefined, undefined, undefined, undefined, {enqueue: async () => ({ok: true})})).error;
  };
  assert.equal(await say([]), 'No job to apply to yet. Press Find jobs first.');
  const notEligible = await say([{...stage, ineligible: 'needs a work permit'}, {...stage, ineligible: 'no licence'}]);
  assert.match(notEligible, /2 .*not eligible/i);
  assert.match(notEligible, /Settings → Apply → "Apply to jobs marked not eligible"/);
  assert.doesNotMatch(notEligible, /Find jobs/);
  assert.doesNotMatch(await say([{...stage, status: 'applied'}]), /Press Find jobs first/);
});

test('the opt-in stays consistent through missing-kit drafting, reread and background enqueue', async () => {
  const storage = tempStorage();
  storage.saveSettings({apply: {allowIneligible: true}});
  const job = {code: 'not-eligible', url: 'https://jobs.example.test/ineligible', status: 'saved', stage: 'Kit ready', fit: 90, ineligible: 'needs a work permit'};
  const queued = [], prepared = [], policies = [];
  const result = await apply.start(storage, {n: 1, mode: 'background', applyMode: 'fill'}, undefined, async () => ({jobs: [job]}), undefined, undefined,
    async code => { prepared.push(code); job.kit = true; storage.saveSettings({apply: {allowIneligible: false}}); return {ok: true}; }, undefined,
    {enqueue: async (chosen, mode, policy) => { queued.push(...chosen); policies.push([mode, policy]); return {ok: true}; }});
  assert.equal(result.ok, true);
  assert.deepEqual(prepared, ['not-eligible']);
  assert.deepEqual(queued.map(item => item.url), [job.url]);
  assert.deepEqual(policies, [['fill', {allowIneligible: true}]], 'enqueue uses the same normalized setting captured before drafting');
});

test('missing kits are picked saved first, then by fit, open jobs only', () => {
  const jobs = [{code: 'a', url: 'u', status: 'unreviewed', fit: 90}, {code: 'b', url: 'u', status: 'saved', fit: 50}, {code: 'c', url: 'u', status: 'applied', fit: 99},
    {code: 'd', url: 'u', status: 'unreviewed', fit: 95, kit: true}];
  assert.deepEqual(apply.pickMissing(jobs, 5).map(job => job.code), ['b', 'a']);
});

test('Tailor CVs for top matches: open jobs without a tailored CV, saved first, then by fit, capped', () => {
  const jobs = [{code: 'a', url: 'u', status: 'unreviewed', fit: 90}, {code: 'b', url: 'u', status: 'saved', fit: 50, tailored: true}, {code: 'c', url: 'u', status: 'saved', fit: 40},
    {code: 'd', url: 'u', status: 'dismissed', fit: 99}, {code: 'e', url: 'u', status: 'unreviewed', fit: 95}];
  assert.deepEqual(apply.pickUntailored(jobs, 5).map(job => job.code), ['c', 'e', 'a']);
  assert.deepEqual(apply.pickUntailored(jobs, 2).map(job => job.code), ['c', 'e']);
});

test('Tailor CVs for top matches: with nothing to tailor it says why, and never claims CVs are ready when there are no jobs (issue #347)', () => {
  const tailored = [{code: 'a', url: 'u', status: 'unreviewed', fit: 90, tailored: true}];
  assert.match(apply.nothingToTailor(tailored), /already has a tailored CV/);
  for (const jobs of [[], [{code: 'd', url: 'u', status: 'dismissed', fit: 99}], [{code: 'x', status: 'unreviewed'}]]) {
    const said = apply.nothingToTailor(jobs);
    assert.match(said, /no jobs/i);
    assert.doesNotMatch(said, /already has a tailored CV/);
  }
});

test('Apply on one job opens it in Chrome with the fill marker; no link, no Chrome', {skip: process.platform === 'win32' && 'Mac launcher (open -a, Terminal); Windows is covered below'}, () => {
  const calls = [];
  const open = (...args) => { calls.push(args); return {unref() {}}; };
  assert.deepEqual(apply.openOne('https://jobs.lever.co/acme/1#top', {session: 's1', open}), {ok: true});
  assert.deepEqual(calls[0].slice(0, 2), ['open', ['-a', 'Google Chrome', 'https://jobs.lever.co/acme/1#jobpilotto-fill=s1']]);
  assert.equal(apply.openOne('', {session: 's1', open}).ok, false);
  assert.equal(calls.length, 1);
});

test('the extension gets the base CV from the app; contact details and notes need Notion', async () => {
  const storage = tempStorage();
  storage.writeText('cv.pdf', '%PDF-1.4 fake');
  storage.saveSettings({cvName: 'CV_Ada.pdf'});
  const server = await import('../../../lib/server.js');
  const me = await server.me(storage);
  assert.deepEqual(me.contact, {});  // without Notion there is nowhere to read them from
  assert.match(me.contactError, /Notion/);  // and it says why, instead of an empty answer that looks like "no details"
  assert.equal(me.contactSource, 'none');
  assert.equal(me.resume.name, 'CV_Ada.pdf');
  assert.equal(Buffer.from(me.resume.data, 'base64').toString(), '%PDF-1.4 fake');
  assert.ok(strategy.DRAFT_SCHEMA.required.includes('contact'));
});

test('Apply with Claude needs Claude Code, Notion and the job\'s kit, then starts one session for the job', async () => {
  const storage = tempStorage();
  const launched = [];
  const launch = async (_, urls, options) => { launched.push([urls, options]); return urls.length; };
  const found = () => '/usr/local/bin/claude';
  const kit = async () => ({ok: true});
  const url = 'https://www.jobs.ch/en/vacancies/detail/1/';
  assert.match((await apply.claudeOne(storage, url, launch, () => '', kit)).error, /Claude Code/);
  assert.match((await apply.claudeOne(storage, url, launch, found, kit)).error, /Notion/);
  storage.setSecret('NOTION_TOKEN', 'ntn_test');
  assert.equal((await apply.claudeOne(storage, '', launch, found, kit)).ok, false);
  assert.match((await apply.claudeOne(storage, url, launch, found, async () => ({ok: false, error: 'No application kit'}))).error, /kit/);
  assert.equal(launched.length, 0);
  assert.deepEqual(await apply.claudeOne(storage, `${url}#top`, launch, found, kit), {ok: true});
  assert.deepEqual(launched[0][0], [url]);
  assert.equal(launched[0][1].claude, '/usr/local/bin/claude');
  assert.equal(typeof launched[0][1].open, 'function');  // the form tab opens (with the fill mark) before Claude starts
  assert.match(apply.claudeReady(storage, found, 'win32', () => '').error, /Git for Windows/);
  assert.equal(apply.claudeReady(storage, found, 'win32', () => 'C:\\Git\\bin\\bash.exe').ok, true);
});

test('Apply to N with Claude: the best N jobs with a kit, one session each; none says so', async () => {
  const storage = tempStorage();
  storage.setSecret('NOTION_TOKEN', 'ntn_test');
  const launched = [];
  const launch = async (_, urls) => { launched.push(urls); };
  const two = async () => ['https://a/1', 'https://b/2'];
  const binary = apply.claudeBinary() ? null : 'skip';
  if (binary) return;  // no Claude Code on this machine: claudeReady stops first
  const result = await apply.start(storage, {n: 3, mode: 'agents'}, null, null, launch, two);
  assert.equal(result.ok, true);
  assert.deepEqual(launched[0], ['https://a/1', 'https://b/2']);
  assert.match(result.message, /Starting 2 Claude/);
  const listed = jobs => async () => ({jobs});
  assert.match((await apply.start(storage, {n: 3, mode: 'agents'}, null, listed([{url: 'https://a/1', status: 'saved', stage: 'Saved'}]), launch, async () => [])).error, /Could not prepare any applications/);
  assert.match((await apply.start(storage, {n: 3, mode: 'agents'}, null, listed([]), launch, async () => [])).error, /Press Find jobs first/);
});

test('the next jobs with a kit come from apply_batch --next, links only', async () => {
  const run = async (_, args) => ({code: 0, stdout: `Loading…\r\n{"url": "https://a/1", "title": "SRE", "company": "Acme"}\r\nhttps://b/2\n`, args});
  const urls = await apply.nextWithKits({}, 2, run);
  assert.deepEqual([...urls], ['https://a/1', 'https://b/2']);
  assert.deepEqual(urls.details['https://a/1'], {title: 'SRE', company: 'Acme'});  // for the session card and notification
  assert.deepEqual([...await apply.nextWithKits({}, 2, async () => ({code: 1, stdout: 'https://a/1'}))], []);
  let args;
  await apply.nextWithKits({settings: () => ({apply: {allowIneligible: true}})}, 2, async (_, seen) => { args = seen; return {code: 0, stdout: ''}; });
  assert.deepEqual(args, ['src.ai.apply_batch', '--next', '2', '--details', '--allow-ineligible']);
  await apply.nextWithKits({settings: () => ({apply: {allowIneligible: true}})}, 2, async (_, seen) => { args = seen; return {code: 0, stdout: ''}; }, {allowIneligible: false});
  assert.deepEqual(args, ['src.ai.apply_batch', '--next', '2', '--details'], 'a batch uses its captured setting even if Settings changes before its next read');
});

test('the kit check asks Notion through apply_batch --has-kit and says how to draft one when there is none', async () => {
  const seen = [];
  const run = async (_, args, onLine) => { seen.push(args); onLine('No Applications row for x — prepare a kit first (📝 Prepare).'); return {code: 1}; };
  const result = await apply.hasKit({}, 'https://x', run);
  assert.deepEqual(seen[0], ['src.ai.apply_batch', '--has-kit', 'https://x']);
  assert.equal(result.ok, false);
  assert.match(result.error, /Press Apply to try again/);
  assert.deepEqual(await apply.hasKit({}, 'https://x', async () => ({code: 0})), {ok: true});
});

test('claude is found outside the shell PATH, where the installer puts it', () => {
  const found = apply.claudeBinary({PATH: '/usr/bin'}, file => file === '/opt/homebrew/bin/claude', 'darwin');
  assert.equal(found, '/opt/homebrew/bin/claude');
  assert.equal(apply.claudeBinary({PATH: ''}, () => false, 'darwin'), '');
});

test('Apply with Claude tickets: one job, three hours, unknown ones refused', async () => {
  const server = await import('../../../lib/server.js');
  const now = Date.parse('2026-09-28T10:00:00Z');
  const ticket = server.issueTicket('https://boards.greenhouse.io/acme/jobs/1#jobpilotto-fill', now);
  assert.match(ticket, /^[0-9a-f]{32}$/);
  assert.equal(server.checkTicket(ticket, 'https://boards.greenhouse.io/acme/jobs/1/', now + 1000), true);
  assert.equal(server.checkTicket(ticket, 'https://boards.greenhouse.io/acme/jobs/2', now), false);
  assert.equal(server.checkTicket(ticket, 'https://boards.greenhouse.io/acme/jobs/1', now + 3 * 3600 * 1000 + 1), false);
  assert.equal(server.checkTicket('guess', 'https://boards.greenhouse.io/acme/jobs/1', now), false);
});

test('Apply with Claude checklist: Claude Code found and signed in, Git for Windows only on Windows', () => {
  const signedIn = apply.claudeSignedIn('/home/x', () => JSON.stringify({oauthAccount: {emailAddress: 'a@b.c'}}));
  assert.equal(signedIn, true);
  assert.equal(apply.claudeSignedIn('/home/x', () => { throw new Error('no file'); }), false);
  assert.deepEqual(apply.claudePrereqs('darwin', {binary: () => '/usr/local/bin/claude', signedIn: () => false, bash: () => '', chrome: () => true}),
    {claude: true, signedIn: false, git: null, windows: false, chrome: true});
  assert.equal(apply.claudePrereqs('win32', {binary: () => '', signedIn: () => true, bash: () => 'C:\\Program Files\\Git\\bin\\bash.exe'}).git, true);
  const bash = 'C:\\Program Files\\Git\\bin\\bash.exe';
  assert.equal(apply.gitBash({ProgramFiles: 'C:\\Program Files'}, file => file === bash), bash);
  assert.equal(apply.gitBash({}, () => true), '');
});

test('Claude in Chrome: found in any Chrome profile, false when Chrome or the extension is missing', async () => {
  const {claudeInChrome, CLAUDE_IN_CHROME} = await import('../../../lib/apply.js');
  const {join} = await import('node:path');  // the platform's separators (the Windows run uses backslashes)
  const fsTree = {'/c': ['Default', 'Profile 1', 'Local State'], [join('/c', 'Default', 'Extensions')]: ['abc'], [join('/c', 'Profile 1', 'Extensions')]: [CLAUDE_IN_CHROME]};
  const list = dir => { if (!fsTree[dir]) throw new Error('ENOENT'); return fsTree[dir]; };
  assert.equal(claudeInChrome('/c', list), true);
  assert.equal(claudeInChrome('/c', dir => (dir === '/c' ? ['Default'] : list(dir))), false);
  assert.equal(claudeInChrome('/missing', list), false);
});

test('Application sessions start collapsed: the pills say what needs you, and the head expands them', async () => {
  const html = readScreenSource(new URL('../../../renderer/index.html', import.meta.url), 'utf8');
  const toggle = /id="sd-toggle"[^>]*aria-expanded="(\w+)"/.exec(html);
  assert.equal(toggle?.[1], 'false');  // what the window paints before any session exists (1 Oct 2026: the dock covered a third of the screen by default)
  const shared = readScreenSource(new URL('../../../renderer/pages/shared.js', import.meta.url), 'utf8');
  assert.match(shared, /dockOpen:\s*false/);  // and the state renderDock reads, so a reload doesn't open it again
});

// Owner's scenario (28 Oct 2026, screenshot: "Apply to 1 job" with Background automation -> "This job is not eligible to start another application"; a Recruiter lead row behind the dialog).
// Rows are the ones src/desktop_jobs.py can produce: stage_status() makes Recruiter lead "saved" (a pitch not answered yet), so it sorts first, and only Saved / Kit ready / Applying may start.
// The picker went by job status alone, so the lead with the top fit and a kit was picked and Background refused it. (Cause is the best-evidenced one; the owner's own row was not read.)
test('apply picks the best job that may start: a Recruiter lead with the top fit is skipped, never picked and refused', () => {
  const jobs = [
    {url: 'lead', status: 'saved', stage: 'Recruiter lead', fit: 99, kit: true},
    {url: 'ready', status: 'unreviewed', stage: 'Kit ready', fit: 70, kit: true},
    {url: 'saved', status: 'saved', stage: 'Saved', fit: 50, kit: true},
    {url: 'unstaged', status: 'unreviewed', stage: '', fit: 40, kit: true},
  ];
  assert.deepEqual(apply.pick(jobs, 1).map(j => j.url), ['saved'], 'saved first, then the best fit among jobs that may start');
  assert.deepEqual(apply.pick(jobs, 4).map(j => j.url), ['saved', 'ready', 'unstaged']);
  assert.deepEqual(apply.pick(jobs.slice(0, 1), 1), [], 'nothing eligible: nothing is picked');
});

// Why (7 Nov 2026, owner screenshot: after Cancel all, Apply took a job the kit had marked "Not eligible"): default skips explicit kit ineligibility; the shared Settings opt-in can include it, while stage proof remains required.
test('the picker defaults to skipping a kit marked not eligible; opt-in includes only that verdict, never a blocked stage', () => {
  const jobs = [
    {url: 'cessna', status: 'saved', stage: 'Saved', fit: 95, kit: true, ineligible: 'needs a work permit'},
    {url: 'fine', status: 'saved', stage: 'Saved', fit: 60, kit: true},
    {url: 'unknown', status: 'saved', stage: 'Saved', fit: 50, kit: true},
    {url: 'started', status: 'saved', stage: 'Applying', fit: 40, kit: true, ineligible: 'needs a work permit'},
    {url: 'blocked', status: 'saved', stage: 'Recruiter lead', fit: 30, kit: true, ineligible: 'needs a work permit'},
  ];
  assert.deepEqual(apply.pick(jobs, 5).map(j => j.url), ['fine', 'unknown']);
  assert.deepEqual(apply.pick(jobs, 5, {allowIneligible: true}).map(j => j.url), ['cessna', 'fine', 'unknown', 'started']);
  const missing = [{url: 'x', status: 'saved', stage: 'Saved', code: 'c', ineligible: 'no'}, {url: 'y', status: 'saved', stage: 'Saved', code: 'd'}];
  assert.deepEqual(apply.pickMissing(missing, 2).map(j => j.url), ['y']);
  assert.deepEqual(apply.pickMissing(missing, 2, {allowIneligible: true}).map(j => j.url), ['x', 'y']);
});

test('a saved opt-in is threaded through Chrome and Background batch picks', async () => {
  for (const mode of ['chrome', 'background']) {
    const storage = tempStorage();
    storage.saveSettings({apply: {allowIneligible: true}});
    const jobs = [{url: `https://jobs.example.test/${mode}`, status: 'saved', stage: 'Kit ready', fit: 90, kit: true, ineligible: 'needs a work permit'}];
    const queued = [];
    const result = await apply.start(storage, {n: 1, mode, applyMode: 'fill'}, () => ({unref() {}}), async () => ({jobs}), undefined, undefined, undefined, undefined,
      {enqueue: async selected => { queued.push(...selected); return {ok: true}; }});
    assert.equal(result.ok, true, mode);
    if (mode === 'background') assert.deepEqual(queued.map(job => job.url), [jobs[0].url]);
  }
});

test('the picker and Background automation share one eligibility rule', async () => {
  const {canStart, STARTABLE_STAGES} = await import('../../../lib/apply-eligibility.js');
  for (const stage of ['', 'Saved', 'Kit ready', 'Applying', 'Recruiter lead', 'Screening', 'Applied', 'Closed', 'Dismissed']) {
    assert.equal(apply.pick([{url: 'x', status: 'saved', stage, kit: true}], 1).length === 1, canStart(stage), `stage "${stage}"`);
  }
  assert.deepEqual(STARTABLE_STAGES, ['Saved', 'Kit ready', 'Applying']);
});

test('Apply with Claude\'s "signed in" follows the CLI\'s own answer, so it agrees with the AI chooser (a Windows tester: `claude -p` said "Not logged in" while ~/.claude.json still held an oauthAccount, 2 Nov 2026)', () => {
  const noFile = () => { throw new Error('no file'); }, withAccount = () => JSON.stringify({oauthAccount: {emailAddress: 'a@b.c'}});
  assert.equal(apply.claudeSignedIn('C:\\Users\\Ann', noFile, true), true, 'the CLI said signed in, no account file');
  assert.equal(apply.claudeSignedIn('C:\\Users\\Ann', withAccount, false), false, 'the CLI said signed out, an old account file does not overrule it');
  assert.equal(apply.claudeSignedIn('C:\\Users\\Ann', withAccount, null), true, 'never asked: the file, as before');
});
