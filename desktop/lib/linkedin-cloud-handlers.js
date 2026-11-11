// The IPC of the one LinkedIn cloud read (spec docs/superpowers/specs/2026-11-11-always-on-parity-design.md, 1/6): `linkedinCloudProbe` runs lib/linkedin-cloud-probe.js once and answers what LinkedIn answered the cloud.
// No button and no ⌘K row (owner, 11 Nov 2026: a measurement, not a feature): the owner calls it from the window's developer console, `await window.pilot.linkedinCloudProbe()`, and only on a build from source or with the Beta channel on (`allowed`, below); the site accepts it
// only from the owner's install (api/ready-linkedin.js). Demo mode and test runs reach nothing. The answer never holds the session. Guard: test/unit/main/linkedin-cloud-probe.test.js and test/guards/rules/ipc.test.js.
import {tryCloudRead} from './linkedin-cloud-probe.js';

/** Registers `linkedinCloudProbe`. `allowed()`: the build-channel gate (from source or Beta on); the default refuses, because this call sends a credential off the Mac (code review, 11 Nov 2026: a comment alone was no gate). One read at a time: a second press while one is running gets the same promise, never a second send. */
export function registerLinkedinCloudHandlers({DEMO, ipcMain, storage, probe = tryCloudRead, allowed = () => false}) {
  let running = null;
  ipcMain.handle('linkedinCloudProbe', () => {
    if (DEMO) return {ok: false, error: 'Not available in demo mode.'};
    if (!allowed()) return {ok: false, error: 'Only on a build from source or with the Beta channel on (Settings → Diagnostics → Beta).'};
    running ||= probe(storage).catch(() => ({ok: false, error: 'The cloud read failed before LinkedIn answered. Nothing is tried again.'})).finally(() => { running = null; });
    return running;
  });
}
