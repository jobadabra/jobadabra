// The plain line for an error from the app behind the window: a window newer than the running app gets "Restart it" and a Restart button, never the raw IPC text.
// Guards: test/unit/main/outdated-error.test.js (preload turns "No handler registered" into OUTDATED_LINE for every action; the Ready card shows line + Restart).
import {t} from '../i18n/index.js';
export const OUTDATED_LINE = 'Jobadabra was updated while it was open. Restart it to use this.';   // same words as preload.cjs
export const OUTDATED_LINE_FINISH = 'Jobadabra was updated while it was open. Restart it to finish the update.';   // the Jobs card (pages/jobs-outdated.js); src/paths.py OUTDATED_APP says the same
const unwrapped = error => String(error?.message || error || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '');   // Electron wraps a handler's error on its way to the window
export const isOutdated = error => unwrapped(error) === OUTDATED_LINE || /No handler registered/.test(String(error?.message || error));   // Why (2 Nov 2026, review): the Jobs read's restart line arrived wrapped and showed as a failed read
export const relaunch = () => window.pilot.interviews.relaunch();   // the app's one shared restart path (lib/restart.js)
export function restartButton() {
  const button = Object.assign(document.createElement('button'), {className: 'secondary', textContent: t('helpers.restart')});
  button.addEventListener('click', () => { button.disabled = true; relaunch(); });
  return button;
}
// The words to show for a failed call: the restart line when the app is older than the window, else the error as plain text (no IPC wrapper) or the screen's own wording.
export const errorLine = (error, fallback = t('helpers.somethingWrong')) =>
  isOutdated(error) ? OUTDATED_LINE : unwrapped(error) || fallback;
