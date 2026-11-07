// The practice app's start gate: where it may keep its data, and what it must never be.
// Why (7 Nov 2026, pj 2/4): practice runs the real Full automation, Submit included, so its folder must be a throwaway one that can never be the person's own data.
import os from 'node:os';
import path from 'node:path';
import {everyRealDataFolder} from '../lib/app-identity.js';

/** The folder name practice uses inside the temp folder. */
export const FOLDER = 'jobadabra-practice';

/**
 * -> '' when practice may start on `folder`, else why not. The folder must sit directly in the temp folder under the practice name, and must not be, or lie inside,
 * any folder the app keeps a person's data in (either name, either OS).
 */
export function practiceRefusal(folder, {tmp = os.tmpdir(), real = everyRealDataFolder()} = {}) {
  if (!folder || !path.isAbsolute(folder)) return 'no folder';
  const here = path.resolve(folder);
  for (const dir of real) {
    const other = path.resolve(dir);
    if (here === other || here.startsWith(other + path.sep)) return 'the practice folder is a real data folder';
  }
  if (path.dirname(here) !== path.resolve(tmp) || path.basename(here) !== FOLDER) return `the practice folder must be ${path.join(tmp, FOLDER)}`;
  return '';
}
