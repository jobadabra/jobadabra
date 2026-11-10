// Persona evidence uses the app's tester handlers: capture at observation, upload after judgment; replays never publish.
// Job: report health
/* global window */

/** Trusted suite launch settings. Only a night/lane receives the narrow publisher credential; missing configuration fails before AI work. */
export function personaTesterEnv(env = process.env) {
  if (!['night', 'lane'].includes(env.AGENT_KIND)) return {};
  if (!env.JOBADABRA_TESTER_KEY) throw new Error('The persona bundle publisher key is missing; no AI work started.');
  return {JOBADABRA_TESTER: 'persona', JOBADABRA_TESTER_KEY: env.JOBADABRA_TESTER_KEY};
}

/** Capture the note's app evidence in the main process, returning only an opaque ticket, never applicant data or a key. */
export async function captureNote(page, view) {
  const answer = await page.evaluate(screen => window.pilot.feedbackPrepare(screen), view);
  if (answer?.tester !== 'persona' || !answer.captureId) throw new Error('The persona app did not retain an evidence capture.');
  return answer.captureId;
}

/** Send only ranked notes through tester IPC. A failed send stays on the note and is reported; no real-feedback fallback exists. */
export async function publishNotes(page, notes, log = console.log) {
  for (const note of notes) {
    try {
      if (!note.captureId) throw new Error(note.captureError || 'No evidence capture was retained for this note.');
      const input = {captureId: note.captureId, title: note.title, journey: 'none', expected: note.expected, seen: note.observed, severity: note.severity, steps: note.trail || []};
      const answer = await page.evaluate(report => window.pilot.sendTesterBug(report), input);
      if (!answer?.ok || !/^[0-9a-f]{16}$/.test(answer.id || '')) throw new Error(answer?.error || 'The store returned no bundle id.');
      note.bundle = {id: answer.id, url: `https://www.jobadabra.top/admin/bug-bundle/${answer.id}`};
      log(`  bug bundle ${answer.id}: ${note.title}`);
    } catch (error) {
      note.bundleError = String(error.message).slice(0, 200);
      log(`  BUG BUNDLE FAILED: ${note.title}: ${note.bundleError}`);
    }
  }
}
