// Spacing comes from the scale (owner, 7 Nov 2026: "It should check design system compliance. Spacing/margins, colors, buttons, cards"; chosen "Measured check (Recommended)"):
// every margin, padding and gap in desktop/renderer/*.css is var(--sp-1..6) (4, 8, 12, 16, 24, 32 px), 0, auto or a percentage. The raw pixel values already there stay;
// the count may only shrink. Colours, radii and fonts are held to zero by desktop/test/guards/rules/design.test.js; this is its spacing half, as a ratchet from the base commit
// (never a committed number: a counter every PR rewrites conflicted six PRs in one day, 30 Oct 2026). Run by the push hook (tools/pre-push-check.sh), like tools/arch-check.py.
//   node tools/spacing-scale.mjs [--base origin/main] [--report]   exit 1 with the lines a change adds; --report prints the two counts as JSON
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const DIR = 'desktop/renderer/';
// margin / padding in any side or logical form, and the three gaps; the value is checked for a raw length.
const PROPERTY = /(?:^|[;{\s])((?:margin|padding)(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?|(?:row-|column-)?gap)\s*:\s*([^;}]*)/g;
const UNITS = 'px|rem|em|ex|ch|vh|vw|vmin|vmax|pt|pc|cm|mm|in|q';   // every unit but % is raw
const RAW_LENGTH = new RegExp(`-?\\d*\\.?\\d+(?:${UNITS})\\b`, 'gi');

/**
 * The raw spacing declarations of one stylesheet: [{line, text}], text as `padding: 7px 6px`.
 * Comments and selectors never count; a zero length, auto, a percentage and var(--sp-*) are on the scale. A declaration with any other length is raw, whatever else it holds.
 * @param {string} css the stylesheet's text
 * @returns {{line: number, text: string}[]}
 */
export function rawSpacing(css) {
  const blank = text => text.replace(/[^\n]/g, ' ');
  const code = css.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/[^{};]*\{/g, blank);   // lines stay, comments and selectors go
  const found = [];
  for (const match of code.matchAll(PROPERTY)) {
    const raw = (match[2].match(RAW_LENGTH) || []).filter(length => !new RegExp(`^-?0*\\.?0+(?:${UNITS})$`, 'i').test(length));
    if (raw.length) found.push({line: code.slice(0, match.index + match[0].indexOf(match[1])).split('\n').length, text: `${match[1]}: ${match[2].trim().replace(/\s+/g, ' ')}`});
  }
  return found;
}

const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
const sheetsAt = (repo, ref) => git(repo, 'ls-tree', '-r', '--name-only', ref, '--', DIR).split('\n')
  .filter(file => file.startsWith(DIR) && file.endsWith('.css') && !file.endsWith('/tokens.css') && !file.slice(DIR.length).includes('/'));
const readAt = (repo, ref, file) => { try { return git(repo, 'show', `${ref}:${file}`); } catch { return ''; } };

/**
 * The raw spacing declarations of every renderer stylesheet at a commit: {file: [{line, text}]}.
 * @param {string} repo the repository folder
 * @param {string} ref a commit-ish
 * @returns {Object<string, {line: number, text: string}[]>}
 */
export const snapshot = (repo, ref) => Object.fromEntries(sheetsAt(repo, ref).map(file => [file, rawSpacing(readAt(repo, ref, file))]));
const total = shot => Object.values(shot).reduce((sum, rows) => sum + rows.length, 0);

/**
 * What a change adds: the head's raw declarations the base does not have, matched by text across all files (a moved or renamed file lists nothing), each copy counted once.
 * @param {Object<string, {line: number, text: string}[]>} base the base snapshot
 * @param {Object<string, {line: number, text: string}[]>} head the head snapshot
 * @returns {string[]} `file:line text` for each added declaration
 */
export function added(base, head) {
  const left = new Map();
  for (const rows of Object.values(base)) for (const row of rows) left.set(row.text, (left.get(row.text) || 0) + 1);
  const lines = [];
  for (const [file, rows] of Object.entries(head)) {
    for (const row of rows) {
      if (left.get(row.text) > 0) left.set(row.text, left.get(row.text) - 1);
      else lines.push(`${file}:${row.line} ${row.text}`);
    }
  }
  return lines;
}

function main() {
  const args = process.argv.slice(2);
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const baseRef = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'origin/main';
  let ref;
  try { ref = git(repo, 'merge-base', baseRef, 'HEAD').trim(); }   // main moving on never counts as this change shrinking or growing it
  catch { console.error(`design system: no common commit with ${baseRef} (shallow clone?); spacing not checked`); return; }
  const base = snapshot(repo, ref), head = snapshot(repo, 'HEAD');
  if (args.includes('--report')) { console.log(JSON.stringify({base: total(base), head: total(head)})); return; }
  if (total(head) <= total(base)) return;
  const lines = added(base, head);
  console.error(`design system: raw spacing in desktop/renderer/*.css went from ${total(base)} to ${total(head)} (+${total(head) - total(base)}); margin, padding and gap take var(--sp-1..6) (4, 8, 12, 16, 24, 32 px), 0, auto or a percentage (docs/rules/desktop-ui.md "Spacing from the scale"):`);
  for (const line of lines.slice(0, 12)) console.error(`  ${line}`);
  if (lines.length > 12) console.error(`  … and ${lines.length - 12} more`);
  process.exit(1);
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) main();
