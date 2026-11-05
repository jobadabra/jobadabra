// The CI's way to the owner's notification switchboard (jobadabra-web: POST /ops/notify, Admin → Operations → Notifications): the owner's on/off, "when" and bot per alert.
// Job: report health
// Why (5 Nov 2026, owner: "control easily on what I want to get alerted or not"; spec docs/superpowers/specs/2026-11-05-ops-notifications-design.md in jobadabra-web): one door for every sender.
// Fail-open: viaSwitchboard answers null whenever it did not deliver or hold the alert (no key, site down, 400 unknown event, 503 channel not connected), and the caller posts with its old bot.
import {BASE} from './ci-state.mjs';

const post = (body, env, fetcher) => fetcher(`${BASE()}/ops/notify`, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${env.SELFHEAL_PUBLISH_KEY}`},
  body: JSON.stringify(body), signal: AbortSignal.timeout(10000)});

/** Asks the switchboard to send `{event, text, html?, state?, level?}` -> the line to print when it delivered or held the alert on purpose, or null when the caller must send it itself. */
export async function viaSwitchboard({event, text, html = false, state, level}, env = process.env, fetcher = fetch) {
  if (!env.SELFHEAL_PUBLISH_KEY) return null;
  try {
    const answer = await post({event, text, html, ...(state === undefined ? {} : {state}), ...(level === undefined ? {} : {level})}, env, fetcher);
    if (answer.status !== 200) return null;
    const body = await answer.json().catch(() => ({}));
    return body.sent ? 'ci-alert: sent (switchboard)' : `ci-alert: held by the owner's switch (${String(body.why || 'held').slice(0, 40)})`;
  } catch { return null; }
}

/** Tells the switchboard the sender posted with its old bot (Admin shows "sent without switchboard"). Never throws. */
export async function reportFallback(event, env = process.env, fetcher = fetch) {
  if (!env.SELFHEAL_PUBLISH_KEY) return;
  // Why (5 Nov 2026, nt 3/4b): the alert was already delivered by the old bot; a report that fails only leaves Admin's "sent without switchboard" count one short, and must never fail the release.
  try { await post({event, fallback: true}, env, fetcher); } catch { /* see Why above */ }
}
