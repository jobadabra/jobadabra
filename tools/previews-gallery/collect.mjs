// Gathers the preview sources (read only, nothing written outside --out): PRs with a "What changed" table, scratchpad pictures, board cards waiting on the owner, the owner's last answer per session.
// Why (8 Nov 2026, owner: "Yes, one gallery page"): one gatherer so the page rows and their tests share one shape; every external read is injectable, so the parsing tests run offline.
import {execFileSync} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {demoClaims, hostedImage, lastOwnerAnswer, nameTokens, parsePrBody, parseShotName, saysDemo, titleTags, verdictLine} from './parse.mjs';

export const REPOS = ['jobadabra/jobadabra', 'jobadabra/jobadabra-web'];
export const OWNER = 'GarryOne';
export const SCRATCH_ROOT = '/private/tmp/claude-502';
const DAY = 86400000;
const HERE = path.dirname(new URL(import.meta.url).pathname);
const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

/** One authenticated `gh` call (stdout as text). */
export function gh(args) {
  return execFileSync('gh', args, {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
}

/**
 * PR cards: every open PR (no date cut: all of them wait on the owner) plus merged / closed ones of the last `days`, whose body has the table.
 * Why (review, 8 Nov 2026): one `--state all --search updated:` query hit the 100 cap first and dropped open PRs that nobody touched for 3 days.
 */
export function prCards(run = gh, days = 3, now = Date.now()) {
  const since = new Date(now - days * DAY).toISOString().slice(0, 10);
  const fields = 'number,title,url,state,body,updatedAt,mergedAt,author';
  const queries = [['--state', 'open', '--limit', '300'], ['--state', 'merged', '--search', `merged:>=${since}`, '--limit', '100'], ['--state', 'closed', '--search', `closed:>=${since}`, '--limit', '100']];
  const cards = [];
  for (const repo of REPOS) {
    for (const query of queries) {
      for (const pr of JSON.parse(run(['pr', 'list', '-R', repo, ...query, '--json', fields]) || '[]')) {
        // Why (review, 8 Nov 2026): a PR body's image URLs are fetched with the owner's gh login; only the owner's own PRs (every local session posts as the owner) are read, never a fork's.
        if (!pr.author || pr.author.login !== OWNER) continue;
        const rows = parsePrBody(pr.body);
        if (!rows.length) continue;
        const state = pr.state === 'OPEN' ? 'waiting' : pr.mergedAt ? 'approved' : 'changes';
        cards.push({kind: 'pr', repo, number: pr.number, title: pr.title, url: pr.url, tags: titleTags(pr.title), verdict: verdictLine(pr.body), demo: saysDemo(pr.body), state, mtime: Date.parse(pr.updatedAt), rows});
      }
    }
  }
  // `--state closed` also lists merged PRs: one card per PR (seen on the first live run: every merged PR twice).
  const seen = new Set();
  return cards.filter(c => !seen.has(`${c.repo}#${c.number}`) && seen.add(`${c.repo}#${c.number}`)).sort((a, b) => b.mtime - a.mtime);
}

/** Every PNG (over 6 KB) in <root>/<project>/<session>/scratchpad newer than `days`: {file, name, pad, sessionId, project, mtime}. */
export function scratchPngs(root = SCRATCH_ROOT, days = 3, now = Date.now()) {
  const found = [];
  if (!isDir(root)) return found;
  for (const project of fs.readdirSync(root).filter(name => isDir(path.join(root, name)))) {
    for (const sessionId of fs.readdirSync(path.join(root, project)).filter(name => isDir(path.join(root, project, name)))) {
      const pad = path.join(root, project, sessionId, 'scratchpad');
      if (!isDir(pad)) continue;
      for (const name of fs.readdirSync(pad)) {
        const file = path.join(pad, name);
        const stat = fs.statSync(file);
        if (stat.isFile() && /\.png$/i.test(name) && stat.size > 6000 && now - stat.mtimeMs <= days * DAY) found.push({file, name, pad, sessionId, project, mtime: stat.mtimeMs});
      }
    }
  }
  return found.sort((a, b) => b.mtime - a.mtime);
}

/**
 * First note (.md / .txt) in a scratchpad that calls the picture demo / fictional data AND names it (its file name or its stem): the note's name, or ''.
 * Why (review, 8 Nov 2026): one note saying "fictional" anywhere in a pad unlocked every picture there, real-data ones too.
 */
export function demoNote(pad, png) {
  const stem = png.name.replace(/\.png$/i, '');
  for (const name of fs.readdirSync(pad)) {
    if (!/\.(md|txt)$/i.test(name)) continue;
    try {
      const text = fs.readFileSync(path.join(pad, name), 'utf8').slice(0, 400000);
      if (saysDemo(text) && (text.includes(png.name) || text.includes(stem))) return name;
    } catch { /* unreadable note: no mark */ }
  }
  return '';
}

/** The owner's newest answer in a session's transcript (~/.claude/projects/<project>/<session>.jsonl), read from its last 4 MB; 0 when unknown. */
export function ownerAnswerAt(project, sessionId, home = os.homedir()) {
  const file = path.join(home, '.claude', 'projects', project, `${sessionId}.jsonl`);
  if (!fs.existsSync(file)) return 0;
  const size = fs.statSync(file).size, length = Math.min(size, 4 * 1024 * 1024), buffer = Buffer.alloc(length);
  const fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, buffer, 0, length, size - length); } finally { fs.closeSync(fd); }
  return lastOwnerAnswer(buffer.toString('utf8'));
}

/** Names (of `names`) the session's own transcript calls demo, see `demoClaims`; an empty set when there is no log. */
export function transcriptMarks(project, sessionId, names, home = os.homedir()) {
  const file = path.join(home, '.claude', 'projects', project, `${sessionId}.jsonl`);
  if (!fs.existsSync(file) || fs.statSync(file).size > 200 * 1024 * 1024) return new Set();
  return demoClaims(fs.readFileSync(file, 'utf8'), names);
}

/**
 * Board cards "Waiting on you" as {title, url, tags}: `gh project item-list --format json` items (fields status, session, title, content.url); tags = the card's Session field plus the [xx] tags of its title.
 * Why (8 Nov 2026, coordinator): "Waiting on you" must come from the Work board, and the board's Session field names the session, not only the title.
 */
export function boardWaiting(items) {
  return (items || []).filter(item => item.status === 'Waiting on you')
    .map(item => ({title: item.title || '', url: item.content && /^https?:/.test(item.content.url || '') ? item.content.url : '', tags: [...new Set([...(item.session ? [String(item.session)] : []), ...titleTags(item.title)])]}));
}

/**
 * Downloads a hosted PR image (private repos need `gh`'s login) into `dest`; false when it cannot be read.
 * Why (review, 8 Nov 2026): only our two repos and their `pr-assets-*` tags are read; a PR body pointing at another private file must not be fetched with the owner's login.
 */
export function downloadHosted(url, dest) {
  try {
    const hosted = hostedImage(url);
    if (!hosted || !REPOS.includes(hosted.repo) || !/^pr-assets-/.test(hosted.ref)) return false;
    const bytes = execFileSync('gh', ['api', '-H', 'Accept: application/vnd.github.raw', `repos/${hosted.repo}/contents/${hosted.file.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(hosted.ref)}`], {maxBuffer: 64 * 1024 * 1024});
    fs.writeFileSync(dest, bytes);
    return true;
  } catch { return false; }
}

/** Writes `src` as a JPEG of at most `max` px on its long side (macOS sips: 342 PNGs were 90 MB, the page must stay under the 64 MiB publish limit); elsewhere the PNG bytes are copied under the same name. */
export function shrink(src, dest, max = 1600) {
  try { execFileSync('sips', ['-Z', String(max), '-s', 'format', 'jpeg', '-s', 'formatOptions', '80', src, '--out', dest], {stdio: 'ignore'}); } catch { fs.copyFileSync(src, dest); }
}

/** First 16 hex of the file's sha256: the identity of one picture's bytes. */
export function fileHash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16);
}

const readJson = file => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {});

/** {hash: note}: pictures a person looked at and found free of real data (`--approve`). */
export const readChecked = (file = path.join(HERE, 'checked.json')) => readJson(file);

/** {hash: why}: pictures a person looked at and found to hold real data (never shown, whatever a note says). */
export const readRefused = (file = path.join(HERE, 'refused.json')) => readJson(file);

/** Marks pictures as looked at: into `checked.json`, or with `refuse` into `refused.json`. */
export function mark(files, note, {refuse = false, file} = {}) {
  const target = file || path.join(HERE, refuse ? 'refused.json' : 'checked.json');
  const known = readJson(target);
  for (const picture of files) known[fileHash(picture)] = `${path.basename(picture)}: ${note}`;
  fs.writeFileSync(target, `${JSON.stringify(known, null, 1)}\n`);
}

/**
 * Why a scratchpad picture may be shown, or '' (kept out). Order: refused (never) → a person approved it → the session's own notes say demo data → a PR tagged with the session says demo data.
 * Why (8 Nov 2026, coordinator): hiding everything not hand-approved hid 211 pictures, many from demo fixtures; the session's words decide, the refused list is the person's veto.
 */
export function demoWhy(png, {checked, refused, notes, prs, tokens, transcript = false}) {
  const hash = fileHash(png.file);
  if (refused[hash]) return '';
  if (checked[hash]) return 'a person looked at it';
  if (notes) return `session notes (${notes}) say demo data`;
  const pr = prs.find(p => p.demo && p.tags.some(tag => tokens.includes(tag)));
  if (pr) return `PR #${pr.number} says demo data`;
  return transcript ? 'the session\'s log says demo data and names this picture' : '';
}

export {nameTokens, parseShotName};
