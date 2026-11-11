// The IPC of the one LinkedIn cloud read (spec docs/superpowers/specs/2026-11-11-always-on-parity-design.md, 1/6): `linkedinCloudProbe` runs lib/linkedin-cloud-probe.js once and answers what LinkedIn answered the cloud.
// No button and no ⌘K row (owner, 11 Nov 2026: a measurement, not a feature): the owner calls it from the window's developer console, `await window.pilot.linkedinCloudProbe()`, on a beta or dev build; the site accepts it
// only from the owner's install (api/ready-linkedin.js). Demo mode and test runs reach nothing. The answer never holds the session. Guard: test/unit/main/linkedin-cloud-probe.test.js and test/guards/rules/ipc.test.js.
import {tryCloudRead} from './linkedin-cloud-probe.js';

/** Registers `linkedinCloudProbe`. One read at a time: a second press while one is running gets the same promise, never a second send. */
export function registerLinkedinCloudHandlers({DEMO, ipcMain, storage, probe = tryCloudRead}) {
  let running = null;
  ipcMain.handle('linkedinCloudProbe', () => {
    if (DEMO) return {ok: false, error: 'Not available in demo mode.'};
    running ||= probe(storage).catch(() => ({ok: false, error: 'The cloud read failed before LinkedIn answered. Nothing is tried again.'})).finally(() => { running = null; });
    return running;
  });
}
