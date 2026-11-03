// The AI user agent's memory on disk: reads the expectation files of the repo and writes the field notes to the `agent-memory` data branch (no PR noise, never main). git is injected, so the push logic is tested against a real local remote.
// Job: report health
// Why (3 Nov 2026, AI user agents 4/7; spec "Field notes … a data branch `agent-memory` of this repo (like `pr-assets`)"): notes change every night; on main they would be 30 PRs a month. One file per area keeps two areas' notes from conflicting.
import fs from 'node:fs';
import path from 'node:path';
import {parseExpectations, parseNotes, renderNotes} from './agent-knowledge.mjs';

export const BRANCH = 'agent-memory';
const area = file => path.basename(file, '.md').replace(/^./, first => first.toUpperCase());

/** The rules of docs/app-expectations: {Area: [entry]}. README.md is not an area. */
export function readExpectations(dir) {
  const out = {};
  for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.md') && name !== 'README.md')) out[area(file)] = parseExpectations(fs.readFileSync(path.join(dir, file), 'utf8'), area(file));
  return out;
}

/** The field notes of a checkout of the branch: {Area: [note]} from notes/<area>.md. {} when the branch has none yet. */
export function readNotes(dir) {
  const folder = path.join(dir, 'notes');
  if (!fs.existsSync(folder)) return {};
  return Object.fromEntries(fs.readdirSync(folder).filter(name => name.endsWith('.md')).map(name => [area(name), parseNotes(fs.readFileSync(path.join(folder, name), 'utf8'))]));
}

/** The files to write for a night's notes: {'notes/jobs.md': text}. An area with no notes left writes no file (and its old file is removed by pushMemory). */
export const memoryFiles = notesByArea => Object.fromEntries(Object.entries(notesByArea).filter(([, notes]) => notes.length).map(([name, notes]) => [`notes/${name.toLowerCase()}.md`, renderNotes(name, notes)]));

const IDENTITY = ['-c', 'user.name=AI user agent', '-c', 'user.email=ai-user-agent@users.noreply.github.com'];
/**
 * Commits the notes to the data branch and pushes it. `git(args)` runs git in `dir` (a clone) and returns stdout, throwing on a non-zero exit. The branch is created as an orphan
 * the first time. Nothing changed = nothing pushed. A rejected push (another run won) is retried once on top of the remote. -> {pushed: boolean}
 */
export function pushMemory({dir, files, git, message, branch = BRANCH}) {
  // Why: the first night has no branch yet (ls-remote says so); once it exists a failed fetch throws, so a network error is never read as "no branch" and the notes never overwrite the history.
  if (git(['ls-remote', '--heads', 'origin', branch]).trim()) { git(['fetch', 'origin', branch]); git(['checkout', '-B', branch, `origin/${branch}`]); }
  else { git(['checkout', '--orphan', branch]); if (git(['ls-files']).trim()) git(['rm', '-rf', '--quiet', '.']); }
  const folder = path.join(dir, 'notes');
  fs.mkdirSync(folder, {recursive: true});
  for (const old of fs.readdirSync(folder)) if (!files[`notes/${old}`]) fs.rmSync(path.join(folder, old));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  git(['add', '-A']);
  if (!git(['status', '--porcelain']).trim()) return {pushed: false};
  git([...IDENTITY, 'commit', '--quiet', '-m', message]);
  try { git(['push', 'origin', `HEAD:${branch}`]); } catch {
    git(['fetch', 'origin', branch]);
    git([...IDENTITY, 'rebase', `origin/${branch}`]);
    git(['push', 'origin', `HEAD:${branch}`]);
  }
  return {pushed: true};
}
