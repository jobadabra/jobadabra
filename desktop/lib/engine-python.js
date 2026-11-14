// Which Python runs the engine: the packaged app's own, else the repo's virtualenv, else the system's. Split out of pipeline-env.js (a pure move) so
// lib/keychain.js can start the engine's secret store on Windows without importing pipeline-env.js, which imports keychain.js.
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from './root.js';

// The packaged app's own Python (with the anthropic package), else the repo's virtualenv, else python3.
// Windows keeps them elsewhere: python\python.exe (python-build-standalone) and .venv\Scripts\python.exe.
/** -> the path of the Python to start, for `platform`; `exists` is fs.existsSync (a test passes its own). */
export function python(platform = process.platform, exists = fs.existsSync) {
  const candidates = platform === 'win32'
    ? [path.join(ROOT, 'python', 'python.exe'), path.join(ROOT, '.venv', 'Scripts', 'python.exe')]
    : [path.join(ROOT, 'python', 'bin', 'python3'), path.join(ROOT, '.venv', 'bin', 'python')];
  return candidates.find(candidate => exists(candidate)) || (platform === 'win32' ? 'python' : 'python3');
}
