#!/usr/bin/env node
// The harness map's checker (spec docs/superpowers/specs/2026-11-03-harness-map-design.md): the L0 index and the L1 area hubs in docs/map/ keep their size budgets, every link and `paths:` entry resolves,
// every `ask:` names a known source, nothing private or secret-shaped is in them (the repo is public), and AGENTS.md stays under Codex's 32 KiB cap.
//   node tools/context/check-map.mjs            exit 1 with one line per problem
//   node tools/context/check-map.mjs --stale    report only: hubs whose files moved on since the hub was last touched (the coordinator reads it at each round-up; never a gate)
// Why (3 Nov 2026, owner): one unit test (desktop/test/guards/data/map-check.test.js) runs this; no CI job, no gate. Codex reads at most project_doc_max_bytes = 32768 of AGENTS.md (codex-cli 0.166.0): the tail was cut silently.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {leaks} from '../feedback-ai.mjs';

export const L0_MAX = 3 * 1024;
export const HUB_MAX = 6 * 1024;
export const AGENTS_MAX = 32768;
// TODO(AI): derive from tools/context/sources/*.mjs once the fetchers exist (hm 5/8, 3 Nov 2026); until then this is the list the spec names.
const NO_BRIEF = {text: "", files: {}}; // leaks() also looks for passages copied from a report; the map has none
export const SOURCES = ['linear', 'sentry', 'github', 'git', 'posthog', 'cloudflare', 'notion'];

const rootDefault = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The front matter of a hub as `{area, paths, updated}` (a one-line `paths: [a, b]` list); {} when there is none. */
export function frontMatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split('\n')) {
    const kv = /^(\w+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const list = /^\[(.*)\]$/.exec(kv[2].trim());
    out[kv[1]] = list ? list[1].split(',').map(s => s.trim()).filter(Boolean) : kv[2].trim();
  }
  return out;
}

/** Relative markdown links of `text` as [{file, hash}] (no web links, no bare anchors). */
export function linkTargets(text) {
  const targets = [];
  for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const t = m[1];
    if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(t)) continue;
    const [file, hash = ''] = t.split('#');
    if (file) targets.push({file, hash});
  }
  return targets;
}

/** The anchors a markdown file offers: GitHub heading slugs and explicit `<a id="..">` lines. */
export function anchorsOf(text) {
  const out = new Set();
  for (const m of text.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)) out.add(m[1].toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, '').replace(/ /g, '-'));
  for (const m of text.matchAll(/<a id="([^"]+)"><\/a>/g)) out.add(m[1]);
  return out;
}

/** Every problem with the map under `root`, as short strings ([] = the map holds). */
export function checkMap(root = rootDefault) {
  const problems = [], dir = path.join(root, 'docs', 'map');
  const exists = rel => fs.existsSync(path.join(root, rel));
  if (!fs.existsSync(path.join(dir, 'index.md'))) return ['docs/map/index.md (L0) is missing'];
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort();
  const index = fs.readFileSync(path.join(dir, 'index.md'), 'utf8');
  for (const f of files) {
    const rel = `docs/map/${f}`, text = fs.readFileSync(path.join(dir, f), 'utf8'), bytes = Buffer.byteLength(text);
    const max = f === 'index.md' ? L0_MAX : HUB_MAX;
    if (bytes > max) problems.push(`${rel} is ${bytes} bytes, over its ${max} budget`);
    for (const {file, hash} of linkTargets(text)) {
      const target = path.resolve(dir, file);
      if (!fs.existsSync(target)) { problems.push(`${rel} links to ${file}, which does not exist`); continue; }
      if (hash && target.endsWith('.md') && !anchorsOf(fs.readFileSync(target, 'utf8')).has(hash)) problems.push(`${rel} links to ${file}#${hash}, which has no such heading or anchor`);
    }
    // Why (3 Nov 2026, hm 2/8): the redactor reads a long dated spec file name as a secret; link targets are checked as existing files above, so the scan skips them.
    for (const why of leaks(text.replace(/\]\([^)]*\)/g, '](x)'), NO_BRIEF)) problems.push(`${rel} holds ${why} (the repo is public)`);
    for (const m of text.matchAll(/^ask:\s*(\S+)/gm)) if (!SOURCES.includes(m[1])) problems.push(`${rel} asks unknown source "${m[1]}"`);
    if (f === 'index.md') continue;
    const fm = frontMatter(text);
    if (!fm.area || !Array.isArray(fm.paths) || !fm.paths.length || !fm.updated) problems.push(`${rel} needs front matter: area, paths: [..], updated`);
    for (const p of fm.paths || []) if (!exists(p)) problems.push(`${rel} lists path ${p}, which does not exist`);
    if (!index.includes(`(${f})`)) problems.push(`${rel} is not linked from docs/map/index.md`);
  }
  const agents = path.join(root, 'AGENTS.md');
  if (fs.existsSync(agents) && fs.statSync(agents).size > AGENTS_MAX) problems.push(`AGENTS.md is over ${AGENTS_MAX} bytes: Codex cuts the rest silently`);
  return problems;
}

/** Hubs whose `paths:` changed in more commits than the hub did since the hub was last touched: [{hub, behind}]. Needs git history; [] without it. */
export function staleHubs(root = rootDefault) {
  const dir = path.join(root, 'docs', 'map'), git = args => execFileSync('git', args, {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim();
  const out = [];
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.md') && n !== 'index.md').sort()) {
    const paths = frontMatter(fs.readFileSync(path.join(dir, f), 'utf8')).paths || [];
    try {
      const last = git(['log', '-1', '--format=%H', '--', `docs/map/${f}`]);
      const behind = last ? git(['rev-list', '--count', `${last}..HEAD`, '--', ...paths]) : '0';
      if (Number(behind) > 0) out.push({hub: f, behind: Number(behind)});
    } catch { return []; }
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--stale')) {
    const stale = staleHubs();
    console.log(stale.length ? stale.map(s => `${s.hub}: ${s.behind} commits touched its paths since the hub last changed`).join('\n') : 'no hub is behind its files');
  } else {
    const problems = checkMap();
    console.log(problems.length ? problems.join('\n') : 'the map holds');
    process.exit(problems.length ? 1 : 0);
  }
}
