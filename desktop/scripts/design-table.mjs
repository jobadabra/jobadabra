// The PR's "Design system" table: pure functions from measured hits to the owner-approved table (owner, 7 Nov 2026, "Measured check (Recommended)").
// A cell is ❌ only for a violation (rule + selector) that the BASE render of the same screen, width and theme does not have, so the existing ones can only shrink
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
 * What a render has that the base render does not: per hit, one entry for each rule + selector (a selector repeated in one render counts once).
 * @param {{rule: string, at: string, note: string}[]} base hits of the base render
 * @param {{rule: string, at: string, note: string}[]} head hits of the head render
 * @returns {{rule: string, at: string, note: string}[]} the new hits
 */
export function newHits(base, head) {
  const known = new Set(base.map(keyOf)), seen = new Set(), fresh = [];
  for (const hit of head) {
    const key = keyOf(hit);
    if (known.has(key) || seen.has(key)) continue;
    seen.add(key);
    fresh.push(hit);
  }
  return fresh;
}

/**
 * The table. `runs` is a list of {screen, width, theme, base, head}; light and dark of one screen and width share a cell.
 * @param {{screen: string, width: number, theme: string, base: object[], head: object[]}[]} runs every measured render
 * @param {string} sha the head commit the table was measured on
 * @returns {{table: string, failed: boolean, baseline: Object<string, {hits: number, distinct: number}>}} the markdown, whether any cell is ❌, the base counts per rule
 */
export function renderTable(runs, sha) {
  const columns = [...new Set(runs.map(run => `${run.screen} ${run.width}`))];
  const cell = (rule, column) => {
    const mine = runs.filter(run => `${run.screen} ${run.width}` === column);
    const fresh = mine.flatMap(run => newHits(run.base, run.head).filter(hit => hit.rule === rule).map(hit => ({...hit, theme: run.theme})));
    if (!fresh.length) return '✅';
    return `❌ ${fresh.slice(0, 3).map(hit => `\`${hit.at}\` ${hit.note ? hit.note.slice(0, 40) : ''} (${hit.theme})`.replace('  ', ' ')).join('; ')}${fresh.length > 3 ? ` +${fresh.length - 3}` : ''}`;
  };
  const rows = RULES.map(([rule, name]) => `| ${name} | ${columns.map(column => cell(rule, column)).join(' | ')} |`);
  const failed = rows.some(row => row.includes('❌'));
  const baseline = Object.fromEntries(RULES.map(([rule]) => {
    const hits = runs.flatMap(run => run.base.filter(hit => hit.rule === rule));
    return [rule, {hits: hits.length, distinct: new Set(hits.map(hit => hit.at)).size}];
  }));
  const table = [`### 🎨 Design system (measured on ${sha})`, '',
    `| Rule | ${columns.join(' | ')} |`, `|---|${columns.map(() => '---').join('|')}|`, ...rows].join('\n');
  return {table, failed, baseline};
}
