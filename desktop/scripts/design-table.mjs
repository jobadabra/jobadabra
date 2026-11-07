// The PR's "Design system" block: pure functions from measured hits to the owner-approved report (owner, 7 Nov 2026, "Measured check (Recommended)").
// A problem is counted only for a violation (rule + selector) that the BASE render of the same screen, width and theme does not have, so the existing ones can only shrink
// (coordinator 27, 7 Nov 2026: "❌ only for a violation the base render of that screen does not have, like the spacing ratchet the owner merged").

export const RULES = [
  ['spacing', 'Spacing scale'],
  ['primary', '1 primary / card'],
  ['ghost', 'No ghost button'],
  ['nested', 'No card in card'],
  ['clipped', 'Nothing clipped'],
  ['contrast', 'Contrast AA (L/D)'],
];

const keyOf = hit => `${hit.rule}|${hit.at}`;

/**
 * What a render has that the base render does not: per rule + selector, the head's hits beyond the base's count (a selector is short: tag#id or tag.class.class, so
 * a second clipped `span.tile` on a screen that had one is a new hit, never hidden by the old one).
 * @param {{rule: string, at: string, note: string}[]} base hits of the base render
 * @param {{rule: string, at: string, note: string}[]} head hits of the head render
 * @returns {{rule: string, at: string, note: string}[]} the new hits (the head's last ones for a key that grew)
 */
export function newHits(base, head) {
  const left = new Map();
  for (const hit of base) left.set(keyOf(hit), (left.get(keyOf(hit)) || 0) + 1);
  const fresh = [];
  for (const hit of head) {
    const key = keyOf(hit);
    if (left.get(key) > 0) left.set(key, left.get(key) - 1);
    else fresh.push(hit);
  }
  return fresh;
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** One table cell's text: the hits' selector and note (short), light/dark noted only for a hit one theme has; `|` would split the row. */
function whatOf(hits) {
  const seen = new Map();
  for (const hit of hits) {
    const label = `\`${hit.at}\`${hit.note ? ` ${hit.note.slice(0, 40)}` : ''}`;
    seen.set(label, [...(seen.get(label) || []), hit.theme]);
  }
  const labels = [...seen].map(([label, themes]) => (new Set(themes).size === 2 ? label : `${label} (${themes[0]})`));
  return (labels.slice(0, 3).join('; ') + (labels.length > 3 ? ` +${labels.length - 3}` : '')).replaceAll('|', '/');
}

/** The rule's column name for a hit: a primary-button finding inside a list row (#3500: one per row of peer rows) is "1 primary / row", else the rule's own name. */
const nameOf = (hit, name) => (hit.rule === 'primary' && /^li(?![\w-])/.test(hit.at) ? '1 primary / row' : name);

/**
 * The report, one verdict for the whole PR (owner, 7 Nov 2026: "In the PR body, let's make it one green per column. I don't want to see 100 checkboxes"; chosen "Verdict + only what fails"):
 * all passing is one line, plus "vs main:" for the rules whose count changed; a failure is a table of only the failing rule x screen cells, each with its count and what it is.
 * `runs` is a list of {screen, width, theme, base, head}; light and dark of one screen and width share a cell. A cell's count is its worst theme's new hits (the same hit in both themes counts once,
 * two new hits on one selector count twice), and the verdict counts failing cells: the owner's preview read "2 new problems" over a table of 2 rows.
 * Why (7 Nov 2026): tools/design-table-check.py reads the first line (the sha, then ✅ or ⛔); keep the two in step.
 * @param {{screen: string, width: number, theme: string, base: object[], head: object[]}[]} runs every measured render
 * @param {string} sha the head commit the report was measured on
 * @returns {{report: string, failed: boolean}} the markdown block, and whether any rule has a new problem
 */
export function renderReport(runs, sha) {
  const columns = [...new Set(runs.map(run => `${run.screen} ${run.width}`))];
  const rows = [];
  for (const [rule, ruleName] of RULES) {
    for (const column of columns) {
      const fresh = runs.filter(run => `${run.screen} ${run.width}` === column)
        .map(run => newHits(run.base, run.head).filter(hit => hit.rule === rule).map(hit => ({...hit, theme: run.theme})));
      for (const name of new Set(fresh.flat().map(hit => nameOf(hit, ruleName)))) {
        const mine = fresh.map(hits => hits.filter(hit => nameOf(hit, ruleName) === name));
        rows.push({name, column, count: Math.max(...mine.map(hits => hits.length)), what: whatOf(mine.flat())});
      }
    }
  }
  const count = (side, rule) => runs.reduce((sum, run) => sum + run[side].filter(hit => hit.rule === rule).length, 0);
  const moved = RULES.map(([rule]) => [rule, count('base', rule), count('head', rule)]).filter(([, before, after]) => before !== after)
    .map(([rule, before, after]) => `${rule} ${before} → ${after} ${after < before ? '▼' : '▲'}${Math.abs(after - before)}`);
  const title = `**Design system (measured on ${sha})**`;
  const verdict = rows.length ? `⛔ ${plural(rows.length, 'new problem')}` : `✅ all ${RULES.length} rules pass on ${plural(columns.length, 'screen')}`;
  const lines = [`${title} ${verdict}`];
  if (moved.length) lines.push(`vs main: ${moved.join(' · ')}`);
  if (rows.length) lines.push('', '| Rule | Screen | New | What |', '|---|---|---|---|', ...rows.map(row => `| ${row.name} | ${row.column} | +${row.count} | ${row.what} |`));
  return {report: lines.join('\n'), failed: rows.length > 0};
}
