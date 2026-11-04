// What the fixer would publish: the files it changed and the text of the change (names, added lines, new files) that the leak scan reads (moved out of tools/feedback-ai.mjs, 4 Nov 2026, [hm] 2/6).
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {addedLines} from './proof.mjs';

/** The files the AI changed or added (relative paths), outside the work folder `skip`. */
export const changedFiles = (cwd = '.') => execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {cwd, encoding: 'utf8'}).split('\n').filter(Boolean).map(line => line.slice(3).trim()).filter(file => !/^(\.fb\/|e2e-artifacts\/)/.test(file));

/** Everything the change would publish: the names of the files, the lines it adds to tracked files and the whole of every new file. */
export function changeText(cwd = '.') {
  const git = (...args) => execFileSync('git', args, {cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
  const fresh = git('ls-files', '--others', '--exclude-standard').split('\n').filter(file => file && !/^(\.fb\/|e2e-artifacts\/)/.test(file));
  return [changedFiles(cwd).join('\n'), addedLines(git('diff', 'HEAD')), ...fresh.map(file => fs.readFileSync(path.join(cwd, file), 'utf8'))].join('\n');
}
