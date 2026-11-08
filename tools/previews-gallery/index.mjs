// The one command that refreshes the previews gallery: node tools/previews-gallery/index.mjs --out <dir>
//   → <dir>/index.html (static page), <dir>/images/*.jpg, <dir>/rows.json, <dir>/db-ops-N.json (rows for the artifact's database), <dir>/meta-op.json, <dir>/publish.json (files for publish_files).
// Mark a picture: node tools/previews-gallery/index.mjs --approve <png>...   (a person looked: demo data only)   |   --refuse <png>... (a person saw real data: never shown)
// Why (8 Nov 2026, owner: "Yes, one gallery page"; coordinator: make it live, per-picture demo rule, true Waiting on you): the page reads rows from the artifact's database; this only gathers and writes them out.
import fs from 'node:fs';
import path from 'node:path';
import {boardWaiting, demoNote, demoWhy, downloadHosted, fileHash, gh, mark, nameTokens, ownerAnswerAt, parseShotName, prCards, readChecked, readRefused, scratchPngs, shrink, transcriptMarks} from './collect.mjs';
import {renderPage} from './render.mjs';

const args = process.argv.slice(2);
if (args[0] === '--approve' || args[0] === '--refuse') {
  const files = args.slice(1);
  const missing = files.filter(file => !fs.existsSync(file));
  if (!files.length || missing.length) { console.error(`previews-gallery: ${files.length ? `no such file: ${missing.join(', ')}` : 'name at least one picture'}`); process.exit(2); }
  mark(files, args[0] === '--refuse' ? `looked at, holds real data (${new Date().toISOString().slice(0, 10)})` : `looked at, demo data only (${new Date().toISOString().slice(0, 10)})`, {refuse: args[0] === '--refuse'});
  console.log(`previews-gallery: ${files.length} picture(s) marked ${args[0] === '--refuse' ? 'refused' : 'checked'}`);
  process.exit(0);
}
const out = args[args.indexOf('--out') + 1];
const days = Number(args.includes('--days') ? args[args.indexOf('--days') + 1] : 3);
if (args.indexOf('--out') < 0 || !out) { console.error('usage: node tools/previews-gallery/index.mjs --out <dir> [--days 3] | --approve <png>... | --refuse <png>...'); process.exit(2); }

const now = Date.now();
const batch = `b${new Date(now).toISOString().slice(0, 16).replace(/\D/g, '')}`;
const images = path.join(out, 'images');
fs.mkdirSync(images, {recursive: true});
for (const old of fs.readdirSync(images)) fs.rmSync(path.join(images, old));

// Open PRs all stay; answered ones are the 10 newest, each card at most 6 picture rows (the first run pulled 342 images, 90 MB, > 3 min).
const all = prCards(gh, days);
const prs = [...all.filter(c => c.state === 'waiting'), ...all.filter(c => c.state !== 'waiting').slice(0, 10)];
for (const card of prs) card.rows = card.rows.slice(0, 6);
// Pictures a person refused (real data) never show, whichever way they come in; files are named by their bytes, so a batch never reuses a name (review, 8 Nov 2026).
const checked = readChecked(), refused = readRefused();
for (const card of prs) {
  for (const row of card.rows) {
    for (const side of ['before', 'after']) {
      if (!row[side]) continue;
      const raw = path.join(images, `.raw-${card.number}-${side}`);
      if (downloadHosted(row[side], raw)) {
        const hash = fileHash(raw);
        if (refused[hash]) row[side] = null; else { const name = `pr-${hash}.jpg`; shrink(raw, path.join(images, name), 1400); row[side] = `images/${name}`; }
      } else row[side] = null;
      fs.rmSync(raw, {force: true});
    }
  }
}

let board = [];
try { board = JSON.parse(gh(['project', 'item-list', '1', '--owner', 'jobadabra', '--limit', '300', '--format', 'json'])).items; } catch { /* no board access: the section and the board rule are left out */ }
const boards = boardWaiting(board);
const tags = new Set([...prs.flatMap(p => p.tags), ...boards.flatMap(b => b.tags)]);

// Scratchpad pictures: shown only with a reason (checked / a note that names it / PR says demo data / the session's own words naming it), never when refused.
const answers = new Map();
const notShown = [];
const groups = new Map();
const pngs = scratchPngs(undefined, days, now);
const marks = new Map();
for (const png of pngs) {
  const key = `${png.project}/${png.sessionId}`;
  if (!marks.has(key)) marks.set(key, transcriptMarks(png.project, png.sessionId, pngs.filter(p => p.sessionId === png.sessionId).map(p => p.name)));
}
for (const png of pngs) {
  const parsed = parseShotName(png.file);
  if (!parsed) continue;
  const tokens = nameTokens(png.name);
  const session = tokens.find(t => tags.has(t)) || tokens[0] || parsed.workspace;
  const why = demoWhy(png, {checked, refused, notes: demoNote(png.pad, png), prs: all, transcript: marks.get(`${png.project}/${png.sessionId}`).has(png.name)});
  if (!why) { notShown.push(`${png.name} (nothing marks it as demo data)`); continue; }
  const key = `${png.sessionId}/${parsed.stem}`;
  const group = groups.get(key) || {session, stem: parsed.stem, why, mtime: 0, pics: [], png};
  group.mtime = Math.max(group.mtime, png.mtime);
  group.pics.push({label: parsed.theme === 'dark' ? '🌙 Dark' : parsed.theme === 'light' ? '☀️ Light' : '', png});
  groups.set(key, group);
}
// Why (8 Nov 2026, coordinator): waiting = the board says so (its Session field or a [xx] in its title), or an open PR, or the picture is newer than the owner's last answer in its session; a merged/closed PR updated after the picture answers it.
const withState = [...groups.values()].map(group => {
  const mine = prs.filter(p => p.tags.includes(group.session));
  const pr = mine.find(p => p.state === 'waiting') || mine[0] || null;
  const key = `${group.png.project}/${group.png.sessionId}`;
  if (!answers.has(key)) answers.set(key, ownerAnswerAt(group.png.project, group.png.sessionId));
  let state = 'unknown';
  if (boards.some(b => b.tags.includes(group.session)) || (pr && pr.state === 'waiting')) state = 'waiting';
  else if (pr && pr.mtime >= group.mtime) state = pr.state;
  else if (answers.get(key)) state = group.mtime > answers.get(key) ? 'waiting' : 'answered';
  return {group, pr, state};
}).sort((a, b) => b.group.mtime - a.group.mtime);
// Every waiting picture stays (at most 4 a session); answered ones fill up to 30 rows, newest first.
const perSession = new Map();
const room = item => { const c = (perSession.get(item.group.session) || 0) + 1; perSession.set(item.group.session, c); return c <= 4; };
const waitingShots = withState.filter(item => item.state === 'waiting').filter(room);
const keep = [...waitingShots, ...withState.filter(item => item.state !== 'waiting').filter(room)].slice(0, Math.max(30, waitingShots.length)).sort((a, b) => b.group.mtime - a.group.mtime);

const shots = keep.map(({group, pr, state}) => {
  const pics = group.pics.map(p => { const name = `shot-${fileHash(p.png.file)}.jpg`; shrink(p.png.file, path.join(images, name), 1600); return {label: p.label, src: `images/${name}`}; });
  return {kind: 'shot', session: group.session, title: group.stem, sub: pr ? `PR #${pr.number}` : 'no PR yet', url: pr ? pr.url : '', state, mtime: Math.round(group.mtime), why: group.why, pics};
});

const rows = [...prs.map(p => ({kind: 'pr', session: p.tags[0] || '?', title: p.title, sub: p.verdict, url: p.url, state: p.state, mtime: p.mtime, rows: p.rows})), ...shots].map(r => ({...r, batch}));
for (const name of ['index.html']) fs.writeFileSync(path.join(out, name), renderPage());
fs.writeFileSync(path.join(out, 'rows.json'), JSON.stringify(rows));
// db_write takes 1-50 ops a call; the meta document goes last (after the rows are in, the page switches batch).
const ops = rows.map((data, i) => ({op: 'set', path: `previews/${batch}-${i}`, data}));
for (let i = 0; i * 49 < ops.length; i++) fs.writeFileSync(path.join(out, `db-ops-${i + 1}.json`), JSON.stringify(ops.slice(i * 49, (i + 1) * 49)));
fs.writeFileSync(path.join(out, 'meta-op.json'), JSON.stringify({op: 'set', path: 'meta/current', data: {batch, refreshedAt: new Date(now).toISOString(), boards: boards.map(({title, url}) => ({title, url})), notShown: notShown.slice(0, 120)}}));
fs.writeFileSync(path.join(out, 'publish.json'), JSON.stringify(['index.html', ...fs.readdirSync(images).sort().map(name => `images/${name}`)].map(as => ({as, path: path.resolve(out, as)}))));
console.log(`previews-gallery: ${prs.length} PR rows, ${shots.length} picture rows, ${notShown.length} not shown, batch ${batch} → ${out}`);
