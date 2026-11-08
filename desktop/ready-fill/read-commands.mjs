// The read task's answers to the extension's background poll (cloud runner task `readiness`, spec docs/superpowers/specs/2026-11-08-cloud-browser-runner-design.md): the same commands and reports the Mac's hidden browser
// gets from lib/background-apply-controller.js, from the same reader (lib/triage-reader.js), so a form is read the one way the app reads it. A read never fills or presses: only a poll, a read's step and a read's
// answer are answered; every application action (a fill, a press, a hand-off) is refused. Guard: desktop/test/unit/ready-fill/ready-read.test.js.
import {sessionTabUrl} from '../../desktop/lib/session-tab.js';   // in the image: /desktop/lib, reached by the same path from /night

export const NIGHT_OWNER = 'night';   // the read night's backgroundOwner: the extension polls with it, and nothing else is answered

/**
 * Answers one POST /extension/background-apply. `reader` is a createTriageReader(); `body` the extension's JSON. -> the poll's commands (one read at a time, its tab marked with the read's id; reads ended
 * without a report to close), {ok} for a step or an answer, or {ok: false} for any other owner or action.
 */
export function readAnswer(reader, body) {
  if (!reader || body?.owner !== NIGHT_OWNER) return {ok: false};
  if (body.action === 'poll') {
    const next = reader.take();
    return {ok: true, jobs: next ? [{session: next.id, url: sessionTabUrl(next.url, next.id), mode: 'read'}] : [], checks: [], handoffs: [], closes: reader.takeEnded().map(session => ({session}))};
  }
  if (body.action === 'triage-step') return {ok: reader.step(String(body.session || ''), String(body.step || ''))};
  if (body.action === 'triage-read') return {ok: reader.report(String(body.session || ''), body)};
  return {ok: false};
}
