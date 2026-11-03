// What the AI user agent knows when a session starts: how the app should behave (docs/app-expectations), what it saw before (field notes) and what changed since its last session. Pure: text in, text out.
// Job: report health
// Why (3 Nov 2026, AI user agents 4/7; owner: "every time the agent starts, he already knows how the app should function … each time he can improve his knowledge … he also must be up-to-date with our changes"):
// three layers with one writer each, so memory cannot drift and cannot fill the prompt: expectations (people, markdown in the repo), field notes (the agent, a data branch), what changed (computed from git + PR verdict lines).
// A file maps to an area by its path (AREAS); a file no area claims is reported as unmapped, never dropped, so the table cannot silently miss a new folder.

/** Area -> the ⌘K group the planner uses, and the path patterns of the code that area owns. Order matters: the first match wins. */
export const AREAS = [
  {area: 'Focus', paths: [/focus/, /suggestion/, /insight/, /check-rows/]},
  {area: 'Jobs', paths: [/jobs?[-_/.]/, /job-panel/, /job-drawer/, /inbound/, /kit/, /tailor/, /pipeline/]},
  {area: 'Profile', paths: [/profile/, /about-you/, /\bcv\b/, /learned/, /portrait/, /answers/]},
  {area: 'Strategy', paths: [/strategy/, /tune/, /scout/, /sources/]},
  {area: 'Settings', paths: [/settings/, /connections?/, /license|plan-|pro-gate/, /keychain/, /credit/]},
  {area: 'Actions', paths: [/actions?[-_/.]/, /runs?[-_.]/, /activity/, /queue/, /palette/, /nav\.js/]},
];
/** The area a changed file belongs to, or null (the caller reports it as unmapped). Tests and docs are not code the agent re-tests. */
export function areaOf(file) {
  if (/(^|\/)(test|tests|e2e|integration|docs)\//.test(file)) return null;
  return AREAS.find(entry => entry.paths.some(pattern => pattern.test(file)))?.area || null;
}

const LINE = /^- \[([a-z]+-\d+)\]\s+(.+?)\s+\|\s+source:\s+(.+?)\s+\|\s+code:\s*(.*)$/;
/** The rules of one area file: [{id, area, rule, source, code: [paths]}]. A line that is not a rule (a heading, a blank) is skipped; a malformed rule line is an error, never a silent skip. */
export function parseExpectations(markdown, area) {
  const out = [];
  for (const line of String(markdown).split('\n')) {
    if (!line.startsWith('- [')) continue;
    const m = LINE.exec(line);
    if (!m) throw new Error(`app-expectations (${area}): "${line.slice(0, 80)}" is not "- [id] rule | source: … | code: …"`);
    out.push({id: m[1], area, rule: m[2], source: m[3], code: m[4].trim() === '-' || !m[4].trim() ? [] : m[4].split(',').map(item => item.trim())});
  }
  return out;
}

/** Marks a rule stale when a file it cites changed since the last session. -> a copy with `stale: [files]` (empty = fresh). */
export const markStale = (entries, changedFiles) => entries.map(entry => ({...entry, stale: entry.code.filter(file => changedFiles.includes(file))}));

/** The first heading line of a PR body (its verdict, "## 🟢 what changed for the user") without the markdown. '' when there is none. */
export function verdictLine(body) {
  const line = String(body || '').split('\n').find(each => /^#{1,3}\s/.test(each));
  return line ? line.replace(/^#{1,3}\s+/, '').replace(/\*\*/g, '').trim() : '';
}

/**
 * What changed since the last session. `log`: `git log --format=@@%H%x09%s --name-only <sha>..main`; `verdicts`: {<sha>: verdict line} (from the PR bodies; a commit with none uses its subject).
 * -> {changes: [{sha, subject, verdict, files, areas}], areas: [group, ...], unmapped: [file, ...]}; `areas` feeds planSession({changed}).
 */
export function changedSince(log, verdicts = {}) {
  const changes = [];
  for (const block of String(log).split('@@').slice(1)) {
    const [head, ...files] = block.split('\n');
    const [sha, subject = ''] = head.split('\t');
    const list = files.map(file => file.trim()).filter(Boolean);
    changes.push({sha, subject, verdict: verdicts[sha] || subject, files: list, areas: [...new Set(list.map(areaOf).filter(Boolean))]});
  }
  const unmapped = [...new Set(changes.flatMap(change => change.files).filter(file => /^(desktop|extension|src|app-core)\//.test(file) && !/\/(test|tests|e2e|integration)\//.test(file) && !areaOf(file)))];
  return {changes, areas: [...new Set(changes.flatMap(change => change.areas))], unmapped};
}

/** The "changed since your last session" lines for the prompt: newest first, one line each, at most `max`. */
export const changedLines = (changed, max = 40) => changed.changes.slice(0, max).map(change => `- ${change.sha.slice(0, 8)} ${change.verdict}${change.areas.length ? ` [${change.areas.join(', ')}]` : ''}`);

const normalise = text => String(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** The field-notes file of one area: `- text | seen N× | first YYYY-MM-DD | last YYYY-MM-DD | commit abc1234 | session <id>`. */
export function parseNotes(markdown) {
  return String(markdown).split('\n').filter(line => line.startsWith('- ')).map(line => {
    const [text, seen, first, last, commit, session] = line.slice(2).split(' | ');
    return {text, seen: Number(/(\d+)/.exec(seen || '')?.[1] || 1), first: (first || '').replace('first ', ''), last: (last || '').replace('last ', ''), commit: (commit || '').replace('commit ', ''), session: (session || '').replace('session ', '')};
  });
}
export const renderNotes = (area, notes) => `# Field notes: ${area}\n\n${notes.map(note => `- ${note.text} | seen ${note.seen}× | first ${note.first} | last ${note.last} | commit ${note.commit} | session ${note.session}`).join('\n')}\n`;

/**
 * The write-back: merges what a session observed into the area's notes. The same observation (case and punctuation aside) is one note, `seen` goes up and `last`/`commit` move;
 * a note not seen for `keepDays` days is dropped (it stays in git history). `observed`: [text]; `today`: YYYY-MM-DD.
 */
export function mergeNotes(existing, observed, {today, commit = '', session = '', keepDays = 30} = {}) {
  const byKey = new Map(existing.map(note => [normalise(note.text), {...note}]));
  for (const text of observed) {
    const key = normalise(text);
    if (!key) continue;
    const note = byKey.get(key);
    if (note) Object.assign(note, {seen: note.seen + 1, last: today, commit, session});
    else byKey.set(key, {text: text.trim(), seen: 1, first: today, last: today, commit, session});
  }
  const age = note => (Date.parse(today) - Date.parse(note.last)) / 86400000;
  return [...byKey.values()].filter(note => !(age(note) > keepDays));
}

/** About 4 characters a token, the harness's own estimate (lib/agent-observe.mjs approxTokens). */
const tokens = text => Math.ceil(text.length / 4);
/**
 * The knowledge text for a session's areas: each area's rules first (a stale one says why), then its notes, capped at `maxTokens` (the oldest notes go first, rules never).
 * `expectations`: {area: [entry]}, `notes`: {area: [note]}.
 */
export function knowledgeFor(areas, {expectations = {}, notes = {}, maxTokens = 3000} = {}) {
  const parts = areas.map(area => {
    const rules = (expectations[area] || []).map(entry => `- ${entry.id} ${entry.rule}${entry.stale?.length ? ` (stale: re-verify, ${entry.stale.join(', ')} changed)` : ''}`);
    return {area, rules, notes: [...(notes[area] || [])].sort((a, b) => String(b.last).localeCompare(String(a.last)))};
  });
  const render = () => parts.map(part => [`## ${part.area}`, ...part.rules, ...part.notes.map(note => `- note: ${note.text} (seen ${note.seen}×)`)].join('\n')).join('\n\n');
  let text = render();
  while (tokens(text) > maxTokens && parts.some(part => part.notes.length)) {
    const holder = parts.filter(part => part.notes.length).sort((a, b) => String(a.notes.at(-1).last).localeCompare(String(b.notes.at(-1).last)))[0];
    holder.notes.pop();
    text = render();
  }
  return text;
}
