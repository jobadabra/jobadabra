// The previews gallery reads PR body tables and scratchpad file names offline; recorded inputs, no gh, no disk (tools/previews-gallery/).
// Guard: privacy — a picture with real applicant data must never reach the shared page; a wrong parse would also show the wrong picture next to "your yes".
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {boardWaiting, demoNote, demoWhy, downloadHosted, prCards} from '../../../tools/previews-gallery/collect.mjs';
import {demoClaims, hostedImage, lastOwnerAnswer, nameTokens, parsePrBody, parseShotName, saysDemo, titleTags, verdictLine} from '../../../tools/previews-gallery/parse.mjs';
import {renderPage, STATES} from '../../../tools/previews-gallery/render.mjs';

const BODY = `## 🟢 Batch result says why a job did not start

### 🔍 Before → After

| 📏 What | 🔴 Before | 🟢 After |
|:---|:---:|:---:|
| **Count** | 3 | 2 |

| What changed | Before | After |
|---|---|---|
| Batch result, light: one state | ![before](https://github.com/jobadabra/jobadabra/raw/pr-assets-bs-batch-starts-2/bs-before-light.png) | ![after](https://github.com/jobadabra/jobadabra/raw/pr-assets-bs-batch-starts-2/bs-after-light.png) |
| Narrow window (dark); no narrow shot before | — | ![after](https://github.com/jobadabra/jobadabra/raw/pr-assets-bs-batch-starts-2/bs-after-narrow.png) |
| No pictures here | — | — |

after the table`;

test('a PR body table becomes picture rows; rows without an image and other tables are skipped', () => {
  const rows = parsePrBody(BODY);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].what, 'Batch result, light: one state');
  assert.match(rows[0].before, /bs-before-light\.png$/);
  assert.equal(rows[1].before, null);
  assert.match(rows[1].after, /bs-after-narrow\.png$/);
});

test('a body without the What changed table gives no rows', () => {
  assert.deepEqual(parsePrBody('| 📏 What | 🔴 Before | 🟢 After |\n|---|---|---|\n| a | ![x](https://e.x/a.png) | b |'), []);
  assert.deepEqual(parsePrBody(''), []);
});

test('title tags are the 1-3 character short names; the verdict is the first heading', () => {
  assert.deepEqual(titleTags('[27-pane-8f] [ps] 5/6 Every Find jobs order'), ['ps']);
  assert.deepEqual(titleTags('[bs] [28] Apply to jobs'), ['bs', '28']);
  assert.equal(verdictLine(BODY), '🟢 Batch result says why a job did not start');
});

test('a hosted image URL splits into repo, tag (may hold slashes) and file', () => {
  assert.deepEqual(hostedImage('https://github.com/jobadabra/jobadabra-web/raw/pr-assets-a/b/x%20y.png'), {repo: 'jobadabra/jobadabra-web', ref: 'pr-assets-a/b', file: 'x y.png'});
  assert.equal(hostedImage('https://example.com/a.png'), null);
});

test('a scratchpad name gives workspace, stem and theme; light and dark share one stem', () => {
  const base = '/private/tmp/claude-502/-Users-mac-jobadabra--claude-worktrees-news-card/abc/scratchpad/';
  const light = parseShotName(`${base}news-card-c1-news-card-side-light.png`);
  const dark = parseShotName(`${base}news-card-c1-news-card-side-dark.png`);
  assert.equal(light.workspace, 'news-card');
  assert.equal(light.theme, 'light');
  assert.equal(light.stem, dark.stem);
  assert.equal(parseShotName('/private/tmp/claude-502/-Users-mac-jobadabra/s/scratchpad/shot-boot.png'), null);
  assert.deepEqual(nameTokens('92-bs-apply-x.png'), ['92', 'bs']);
  assert.deepEqual(nameTokens('sc-schedules-b4.png'), ['sc']);
});

test('PR lists: open PRs come with no date cut, merged and closed ones with it (review: a 100-cap on one query dropped waiting PRs)', () => {
  const calls = [];
  const run = args => { calls.push(args.join(' ')); const open = args.includes('open'); return JSON.stringify([{number: open ? 1 : 2, title: '[xx] a', url: 'u', state: open ? 'OPEN' : 'MERGED', body: BODY, author: {login: 'GarryOne'}, updatedAt: '2026-11-08T00:00:00Z', mergedAt: open ? null : '2026-11-08T00:00:00Z'}]); };
  const cards = prCards(run, 3, Date.parse('2026-11-08T10:00:00Z'));
  assert.ok(calls.some(c => c.includes('--state open') && !c.includes('--search')));
  assert.ok(calls.some(c => c.includes('--state merged') && c.includes('merged:>=2026-11-05')));
  assert.deepEqual([...new Set(cards.map(c => c.state))].sort(), ['approved', 'waiting']);
});

test('the board cards kept are those waiting on the owner, tagged by their Session field and by [xx] in the title', () => {
  const items = [{status: 'Waiting on you', session: 'pz', title: '[sc] Schedules preview', content: {url: 'https://x/1'}}, {status: 'Waiting on you', title: 'Telegram bots'}, {status: 'Done', session: 'xx', title: '[xx] old'}];
  assert.deepEqual(boardWaiting(items).map(card => card.tags), [['pz', 'sc'], []]);
});

test('the session\'s own words decide a picture: demo words, a person\'s approval, a refusal that always wins', () => {
  assert.ok(saysDemo('Our render (demo data)') && saysDemo('a fictional candidate') && !saysDemo("the owner's screenshot"));
  const png = {file: new URL(import.meta.url).pathname};
  const ctx = {checked: {}, refused: {}, notes: '', prs: [{number: 7, demo: true, tags: ['sc']}], tokens: ['sc']};
  assert.equal(demoWhy(png, ctx), 'PR #7 says demo data');
  assert.equal(demoWhy(png, {...ctx, prs: [], tokens: ['zz']}), '');
  assert.match(demoWhy(png, {...ctx, notes: 'brief.md'}), /brief\.md/);
  assert.equal(demoWhy(png, {...ctx, refused: new Proxy({}, {get: () => 'real'})}), '');
});

test('the owner\'s last answer: typed words and AskUserQuestion answers count; task notifications and hand-backs do not', () => {
  const line = (type, at, content) => JSON.stringify({type, timestamp: at, message: {content}});
  const log = [
    line('user', '2026-11-08T06:00:00Z', 'looks good, ship'),
    line('user', '2026-11-08T07:00:00Z', [{type: 'tool_result', content: 'Your questions have been answered: "x"="Ship it"'}]),
    line('user', '2026-11-08T08:00:00Z', '<task-notification>done</task-notification>'),
    line('assistant', '2026-11-08T09:00:00Z', 'hi'),
  ].join('\n');
  assert.equal(lastOwnerAnswer(log), Date.parse('2026-11-08T07:00:00Z'));
  assert.equal(lastOwnerAnswer(''), 0);
});

test('the page code reads rows live and never writes rows into itself; every state has a chip word', () => {
  const html = renderPage();
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(html.includes("claude.use('db')") && html.includes("collection('previews')") && html.includes("doc('meta/current')"));
  for (const state of Object.values(STATES)) assert.ok(html.includes(state.word), state.word);
  assert.ok(!html.includes('innerHTML'), 'rows come from a shared store: textContent only');
});

test('"not demo data" and "real, not fictional" do not unlock a picture', () => {
  assert.ok(!saysDemo('this is not demo data') && !saysDemo('real screenshot, not fictional') && !saysDemo('no fake data here'));
  assert.ok(saysDemo('Our render (demo data)') && saysDemo('not a bug. The candidate is fictional'));
});

test('a transcript calls a picture demo only in the session\'s own message that names it, never from system text or a listing', () => {
  const line = (type, content) => JSON.stringify({type, message: {content}});
  const log = [
    line('user', [{type: 'text', text: '<system-reminder>fictional demo data skills</system-reminder>'}]),
    line('assistant', [{type: 'tool_use', input: {command: 'ls scratchpad: real-one.png'}}]),
    line('user', [{type: 'tool_result', content: 'real-one.png demo data'}]),
    line('assistant', [{type: 'text', text: 'Here is shown.png, rendered with fictional demo data.'}]),
    line('assistant', [{type: 'tool_use', input: {command: 'npm run shot --demo -- --out viewed.png'}}]),
  ].join('\n');
  assert.deepEqual([...demoClaims(log, ['real-one.png', 'shown.png', 'viewed.png'])].sort(), ['shown.png', 'viewed.png']);
});

test('a table row with a backtick in a cell keeps its pictures', () => {
  const rows = parsePrBody('| What changed | Before | After |\n|---|---|---|\n| Dialog | ![x](https://github.com/jobadabra/jobadabra/raw/pr-assets-a/a.png) | ![y](https://github.com/jobadabra/jobadabra/raw/pr-assets-a/b.png) (`dark`) |');
  assert.equal(rows.length, 1);
  assert.match(rows[0].after, /b\.png$/);
});

test('a teammate message, a cross-session message or an interrupt is not the owner answering', () => {
  const line = (at, text) => JSON.stringify({type: 'user', timestamp: at, message: {content: text}});
  const log = [line('2026-11-08T06:00:00Z', 'ok ship'), line('2026-11-08T07:00:00Z', '<teammate-message from main>ok</teammate-message>'), line('2026-11-08T08:00:00Z', '<cross-session-message from="x">ok</cross-session-message>'), line('2026-11-08T09:00:00Z', '[Request interrupted by user]')].join('\n');
  assert.equal(lastOwnerAnswer(log), Date.parse('2026-11-08T06:00:00Z'));
});

test('only the owner\'s own PRs are read, and only our repos\' pr-assets tags are fetched with the owner\'s login', () => {
  const run = () => JSON.stringify([{number: 1, title: '[xx] a', url: 'u', state: 'OPEN', body: BODY, author: {login: 'someone-else'}, updatedAt: '2026-11-08T00:00:00Z'}, {number: 2, title: '[xx] b', url: 'u', state: 'OPEN', body: BODY, updatedAt: '2026-11-08T00:00:00Z'}]);
  assert.equal(prCards(run, 3, Date.parse('2026-11-08T10:00:00Z')).length, 0);
  const dest = path.join(os.tmpdir(), `pg-${process.pid}.bin`);
  assert.equal(downloadHosted('https://github.com/jobadabra/other-private/raw/pr-assets-a/x.png', dest), false);
  assert.equal(downloadHosted('https://github.com/jobadabra/jobadabra/raw/main/secret.png', dest), false);
  assert.ok(!fs.existsSync(dest));
});

test('a scratchpad note unlocks only the pictures it names', () => {
  const pad = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-pad-'));
  fs.writeFileSync(path.join(pad, 'body.md'), 'Shots use fictional data: shown-after.png');
  assert.equal(demoNote(pad, {name: 'shown-after.png'}), 'body.md');
  assert.equal(demoNote(pad, {name: 'real-job-list.png'}), '');
  fs.rmSync(pad, {recursive: true});
});

test('the page survives a malformed row and only loads own pictures or https ones', () => {
  const html = renderPage();
  assert.ok(html.includes('Array.isArray(r.rows)') && html.includes('A row could not be shown'));
  assert.ok(html.includes("typeof meta.refreshedAt === 'string'") && html.includes('Array.isArray(meta.boards)'));
});
