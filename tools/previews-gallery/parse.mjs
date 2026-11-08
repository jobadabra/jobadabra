// Pure parsing for the previews gallery (tools/previews-gallery/): a PR body's "What changed | Before | After" table becomes picture rows, a scratchpad PNG name becomes session + stem + theme.
// Why (8 Nov 2026, owner: "Where can I see all the sessions previews?" → "Yes, one gallery page"): previews lived only in PR bodies and scratchpads; this is the one place that reads them all.

const IMAGE = /!\[[^\]]*\]\((https?:\/\/(?:[^()\s]|\([^()\s]*\))+)\)/;
const TAG = /\[([0-9a-z]{1,3})\]/g;

/** Image URL inside one table cell, or null ("—" and plain text have none). */
export function cellImage(cell) {
  const found = IMAGE.exec(cell || '');
  return found ? found[1] : null;
}

/**
 * Splits a markdown table row into trimmed cells; a pipe after `\\` or inside a `code span` does not split.
 * Why (review, 8 Nov 2026): the old lookahead regex refused to split at any pipe with a backtick later on the line, so one backtick in a cell dropped the whole row.
 */
function cells(line) {
  const text = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const out = [];
  let current = '', code = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\' && text[i + 1] === '|') { current += '|'; i++; continue; }
    if (ch === '`') code = !code;
    if (ch === '|' && !code) { out.push(current.trim()); current = ''; continue; }
    current += ch;
  }
  out.push(current.trim());
  return out;
}

/**
 * Rows of the `| What changed | Before | After |` table of a PR body: [{what, before, after}] (before/after are image URLs or null).
 * Only rows with at least one image count; a body without that table gives [].
 */
export function parsePrBody(body) {
  const lines = String(body || '').split(/\r?\n/);
  const start = lines.findIndex(line => /^\s*\|\s*What changed\s*\|\s*Before\s*\|\s*After\s*\|/i.test(line));
  if (start < 0) return [];
  const rows = [];
  for (let i = start + 1; i < lines.length && /^\s*\|/.test(lines[i]); i++) {
    if (/^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) continue;
    const [what = '', before = '', after = ''] = cells(lines[i]);
    const row = {what: what.replace(/\*\*/g, ''), before: cellImage(before), after: cellImage(after)};
    if (row.before || row.after) rows.push(row);
  }
  return rows;
}

/** Short names a PR title is tagged with: "[27-pane-8f] [ps] 5/6 …" gives ["ps"] (only 1-3 character tags are session short names; "[27]" alone is one too). */
export function titleTags(title) {
  return [...String(title || '').matchAll(TAG)].map(match => match[1]);
}

/** The first line of a PR body's verdict (the 🟢/🟡/🔴 line), without markdown heading marks; '' when none. */
export function verdictLine(body) {
  const line = String(body || '').split(/\r?\n/).find(text => /^#{1,3}\s+\S/.test(text));
  return line ? line.replace(/^#+\s*/, '').trim() : '';
}

/** Hosted-image URL `github.com/<repo>/raw/<tag>/<file>` → {repo, ref, file}; null for any other URL. The tag may hold slashes, the file is the last segment. */
export function hostedImage(url) {
  const found = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/raw\/(.+)\/([^/]+)$/.exec(url || '');
  if (!found) return null;
  try { return {repo: found[1], ref: decodeURIComponent(found[2]), file: decodeURIComponent(found[3])}; } catch { return null; } // a bad %-escape in one PR body must not stop the run (review, 8 Nov 2026)
}

/**
 * A scratchpad PNG path → {session, stem, theme, workspace} or null when its name does not say it is a preview.
 * Session: the file name's short-name prefix ("at-methods-side-by-side.png" → "at"), else the worktree folder's name; workspace: that folder's name.
 * Stem: the name without the theme word and extension, so the light and dark runs of one preview share one stem.
 */
export function parseShotName(file) {
  const name = file.split('/').pop();
  if (!/\.png$/i.test(name)) return null;
  // Why (8 Nov 2026): a picture is a preview when its name says so; whether it may be SHOWN is decided elsewhere (collect.mjs demoWhy: the session's own words say demo data, or a person approved it).
  if (!/(side|before|after|dialog|preview|mock|narrow|light|dark|card|menu|state|page|screen)/i.test(name)) return null;
  const folder = /\/-Users-[^/-]+-jobadabra(?:-web)?(?:--claude-worktrees-)?([^/]*)\//.exec(file);
  const workspace = folder && folder[1] ? folder[1] : 'main';
  const prefix = /^([0-9a-z]{1,3})-/.exec(name);
  const theme = /(?:^|[-_])(light|dark)(?=[-_.])/i.exec(name);
  const stem = name.replace(/\.png$/i, '').replace(/(^|[-_])(light|dark)(?=[-_]|$)/ig, '$1').replace(/[-_]{2,}/g, '-').replace(/[-_]$/, '');
  return {session: prefix ? prefix[1] : workspace, stem, theme: theme ? theme[1].toLowerCase() : null, workspace};
}

/** Groups parsed shots by session + stem: one card holds the light and dark pictures of one preview; newest picture decides the time. */
export function groupShots(shots) {
  const byKey = new Map();
  for (const shot of shots) {
    const key = `${shot.workspace}/${shot.stem}`;
    const card = byKey.get(key) || {session: shot.session, workspace: shot.workspace, stem: shot.stem, mtime: 0, pictures: []};
    card.mtime = Math.max(card.mtime, shot.mtime);
    card.pictures.push({theme: shot.theme, file: shot.file, mtime: shot.mtime});
    byKey.set(key, card);
  }
  return [...byKey.values()].sort((a, b) => b.mtime - a.mtime);
}

const DEMO = /demo[- ]data|demo fixture|fictional|fake data|example data|mock data|--demo\b|JOBADABRA_DEMO|demo mode/gi;
const NEGATED = /\b(not|no|never|isn't|aren't|without|non|real)\b[^.\n]{0,24}$/i;

/** Positions of the non-negated demo / fictional-data words in `text` ("not demo data" and "real, not fictional" give none). */
export function demoMatches(text) {
  const t = String(text || '');
  return [...t.matchAll(DEMO)].filter(m => !NEGATED.test(t.slice(Math.max(0, m.index - 40), m.index))).map(m => m.index);
}

/**
 * True when a text says its pictures show demo, fictional or fake data (the session's own words, e.g. "Our render (demo data)"); "not demo data" and "real, not fictional" do not count.
 * Why (review, 8 Nov 2026): "this is not demo data" unlocked a real-data picture.
 */
export function saysDemo(text) {
  return demoMatches(text).length > 0;
}

/** True when `name` appears in `text` as a whole file name (not inside a longer one: "fa-split-light.png" is not in "fa-split-light-narrow.png"). */
export function namesFile(text, name) {
  const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\w.-])${escaped}(?![\\w-])`).test(String(text || ''));
}

/**
 * True when a sentence of `text` has demo words whose NEAREST picture name is `name`: "a.png shows the list, b.png uses fictional data" counts for b.png only, "shown.png, rendered with demo data" for shown.png.
 * Why (review, Gitar 8 Nov 2026): two picture names in one sentence ("a.png is real, b.png is fictional") unlocked the real one; each demo word now belongs to one name.
 */
export function sentenceClaimsDemo(text, name) {
  return String(text || '').split(/\r?\n|;|(?<=[.!?])\s+/).some(part => {
    const names = [...part.matchAll(/[\w.-]+\.png\b/gi)].map(m => ({name: m[0], at: m.index}));
    if (!names.some(n => n.name === name) || !namesFile(part, name)) return false;
    return demoMatches(part).some(at => {
      const nearest = names.reduce((best, n) => (Math.abs(n.at - at) < Math.abs(best.at - at) ? n : best), names[0]);
      return nearest.name === name;
    });
  });
}

/**
 * Names (of `names`) a session's own transcript calls demo: one assistant message, or one command it ran, with a sentence that holds both the file name and demo words (`--demo`, demo mode, fictional data...).
 * Why (review, 8 Nov 2026): the first version took any demo word anywhere in the log (system prompt and skill text included: 40 of 40 logs) plus a name seen in an `ls`; Gitar then showed "a.png is real data; b.png uses fictional data" unlocked both: the words and the name must sit in one sentence the session itself wrote.
 */
export function demoClaims(jsonl, names) {
  const found = new Set();
  const wanted = names.filter(Boolean);
  for (const line of String(jsonl || '').split('\n')) {
    if (!line.includes('"type":"assistant"')) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const content = entry.message && entry.message.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const text = part.type === 'text' ? part.text : part.type === 'tool_use' ? Object.values(part.input || {}).map(String).join('\n') : '';
      if (!text) continue;
      for (const name of wanted) if (sentenceClaimsDemo(text, name)) found.add(name);
    }
  }
  return found;
}

/** Short-name tokens a picture's file name may start with: "sc-schedules-b4.png" → ["sc"], "92-bs-apply-x.png" → ["92", "bs"]. */
export function nameTokens(name) {
  const tokens = [];
  for (const part of name.replace(/\.[a-z]+$/i, '').split('-').slice(0, 2)) if (/^[0-9a-z]{1,3}$/.test(part)) tokens.push(part);
  return tokens;
}

/**
 * Time (ms) of the owner's newest real answer in a session transcript (jsonl text): a typed message, or an AskUserQuestion answer.
 * Task notifications, system reminders and hand-backs are user-typed lines in the log but not the owner; 0 when none.
 */
export function lastOwnerAnswer(jsonl) {
  let newest = 0;
  for (const line of String(jsonl || '').split('\n')) {
    if (!line.includes('"type":"user"')) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const content = entry.message && entry.message.content;
    const parts = typeof content === 'string' ? [{type: 'text', text: content}] : Array.isArray(content) ? content : [];
    const typed = parts.filter(p => p.type === 'text').map(p => p.text).join(' ').trim();
    const asked = parts.some(p => p.type === 'tool_result' && JSON.stringify(p.content || '').includes('questions have been answered'));
    const owner = typed && !/^(<task-notification|<system-reminder|\[SYSTEM|Another Claude session|<command-|<teammate-message|<cross-session-message|\[Request interrupted|Caveat:)/.test(typed);
    const at = Date.parse(entry.timestamp);
    if ((owner || asked) && at > newest) newest = at;
  }
  return newest;
}
