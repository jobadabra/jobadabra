import fs from 'node:fs';
// Main process: reports a crash or a stray rejection to technical reports without changing what Electron does with it. Moved out of main.js; no window needed.
export function installCrashMonitors({getTelemetry, getStorage = () => null}) {
  const crashMark = createCrashMark({getStorage});
  const record = (type, error) => getTelemetry()?.record('crash', {where: 'main', type, message: error?.message || String(error), stack: error?.stack});
  // Electron's desktopCapturer rejects an internal promise ("Failed to get sources") when macOS hasn't allowed
  // screen capture, even though the display-media handler catches it; that one is expected (the recorder shows
  // the permission panel), so it isn't logged. Every other unhandled rejection still is.
  process.on('unhandledRejection', reason => {
    if (String(reason?.message || reason) === 'Failed to get sources.') return;
    console.error('Unhandled rejection:', reason);
    record(reason?.name || 'Rejection', reason);
  });
  // A crash in the main process, reported without changing what Electron does with it (the monitor only watches).
  process.on('uncaughtExceptionMonitor', error => { crashMark.sawUncaught(); record(error?.name || 'Error', error); });
  process.on('exit', code => crashMark.exit(code));
}

const MARK = 'crashed.mark';

/** The mark of a crash, kept apart from the settings (a crash handler must not read-modify-write them). Why (code review of fb 4/7, 5 Nov 2026): "uncaughtExceptionMonitor" also fires when Electron shows its error dialog
 *  and the app keeps running, so an uncaught error alone is no crash: the mark is written only when the process then really exits with a code other than 0. `sawUncaught()` notes the error, `exit(code)` writes the mark. */
export function createCrashMark({getStorage, write = (file, text) => fs.writeFileSync(file, text)}) {
  let uncaught = false;
  return {
    sawUncaught() { uncaught = true; },
    exit(code) {
      if (!uncaught || !code) return;
      try { const storage = getStorage(); if (storage) write(storage.path(MARK), String(Date.now())); } catch { /* the report went; a mark that cannot be written is not worth a second failure */ }
    },
  };
}

/** True once when the last run of the app ended in a crash (the mark exists); removes the mark. Takes the storage (its folder). */
export function takeCrashMark(storage) {
  const file = storage.path(MARK);
  if (!fs.existsSync(file)) return false;
  try { fs.rmSync(file, {force: true}); } catch { /* it comes back next start: one more invitation at most, and the gate allows one a day */ }
  return true;
}
