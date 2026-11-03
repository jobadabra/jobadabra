// What the AI user agent could see of a screen, measured two ways (AI user agents 2/7, "tree or text"): the explorer's own text view and Playwright's accessibility snapshot. Pure: rows in, numbers out.
// Job: report health
// Why (3 Nov 2026, owner: which technique senses the most): the spec picks the view that names more controls per token; an unnamed control is itself a finding, so both counts are kept.

const ROLES = ['button', 'link', 'textbox', 'combobox', 'checkbox', 'radio', 'tab', 'switch', 'menuitem', 'searchbox', 'spinbutton', 'slider', 'option'];
const TREE_CONTROL = new RegExp(`^\\s*- (${ROLES.join('|')})\\b(?: "((?:[^"\\\\]|\\\\.)*)")?`);
const TEXT_CONTROL = /^\d+ · \w+ · (.*)$/;

/** A rough token count (4 characters a token): only for comparing two views of one screen; the real tokens of a session come from the broker's answers. */
export const approxTokens = text => Math.ceil(String(text || '').length / 4);

/** Controls of a Playwright ariaSnapshot (YAML-like lines): {named, unnamed}. A control with no accessible name is listed without one. */
export function treeControls(snapshot) {
  let named = 0, unnamed = 0;
  for (const line of String(snapshot || '').split('\n')) {
    const match = TREE_CONTROL.exec(line);
    if (match) (match[2] ? named++ : unnamed++);
  }
  return {named, unnamed};
}

/** Controls of the explorer's text view (formatObservation lines "index · kind · label"): {named, unnamed}. */
export function textControls(text) {
  let named = 0, unnamed = 0;
  for (const line of String(text || '').split('\n')) {
    const match = TEXT_CONTROL.exec(line);
    if (match) (match[1].startsWith('(no label)') ? unnamed++ : named++);
  }
  return {named, unnamed};
}

const side = (text, ms, controls) => ({tokens: approxTokens(text), ms, ...controls, namedPer1kTokens: Number(((controls.named * 1000) / Math.max(1, approxTokens(text))).toFixed(1))});

/** rows: [{view, text, tree, textMs, treeMs}] -> {views: [{view, text: side, tree: side}], totals: {text: side, tree: side}} (a side: tokens, ms, named, unnamed, namedPer1kTokens). */
export function compareViews(rows) {
  const views = rows.map(row => ({view: row.view, text: side(row.text, row.textMs, textControls(row.text)), tree: side(row.tree, row.treeMs, treeControls(row.tree))}));
  const total = key => {
    const sum = field => views.reduce((all, item) => all + item[key][field], 0);
    const tokens = sum('tokens'), named = sum('named');
    return {tokens, ms: sum('ms'), named, unnamed: sum('unnamed'), namedPer1kTokens: Number(((named * 1000) / Math.max(1, tokens)).toFixed(1))};
  };
  return {views, totals: {text: total('text'), tree: total('tree')}};
}

/** The comparison as a table for the job log. */
export function formatComparison({views, totals}) {
  const cell = item => `${String(item.tokens).padStart(6)} tok ${String(item.ms).padStart(5)} ms ${String(item.named).padStart(3)} named ${String(item.unnamed).padStart(3)} unnamed ${String(item.namedPer1kTokens).padStart(6)} named/1k tok`;
  return ['view · explorer text | accessibility snapshot', ...views.map(item => `${item.view.padEnd(12)} ${cell(item.text)} | ${cell(item.tree)}`), `${'ALL'.padEnd(12)} ${cell(totals.text)} | ${cell(totals.tree)}`].join('\n');
}

/** The tier probe as a table for the job log. rows: [{tier, engine, ms, input, output, action}], the same screen asked a few times per tier. */
export function formatTierProbe(rows) {
  const tiers = [...new Set(rows.map(row => row.tier))];
  return ['tier probe (the same screen, asked on each tier)', ...tiers.map(tier => {
    const own = rows.filter(row => row.tier === tier), mean = field => own.reduce((all, row) => all + (row[field] || 0), 0) / own.length;
    const engines = [...new Set(own.map(row => row.engine).filter(Boolean))].join('/') || '?', actions = own.map(row => row.action).join(', ');
    return `${tier.padEnd(6)} ${own.length} calls  ${Math.round(mean('input') + mean('output'))} tokens  ${(mean('ms') / 1000).toFixed(1)} s per call  answered by ${engines}  actions: ${actions}`;
  })].join('\n');
}

/** One line for a finished session: calls, tokens, minutes, engines and what each tier cost per call. result: explore()'s {spent, trace}; ms: wall clock. */
export function sessionLine({spent, trace}, ms) {
  const engines = {};
  for (const row of trace) if (row.engine) engines[row.engine] = (engines[row.engine] || 0) + 1;
  const mix = Object.entries(engines).sort((a, b) => b[1] - a[1]).map(([name, count]) => `${name} ${Math.round((count * 100) / trace.length)}%`).join(' · ');
  const tiers = Object.entries(spent.tiers).map(([tier, row]) => `${tier}: ${row.calls} calls, ${Math.round((row.input + row.output) / Math.max(1, row.calls))} tokens and ${(row.ms / Math.max(1, row.calls) / 1000).toFixed(1)} s per call`).join('; ');
  return `this session: ${spent.calls} calls, ${spent.input + spent.output} tokens, ${(ms / 60000).toFixed(1)} min${mix ? `, engines ${mix}` : ''}${tiers ? ` (${tiers})` : ''}`;
}
