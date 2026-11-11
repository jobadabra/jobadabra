// The one LinkedIn read from the cloud (spec docs/superpowers/specs/2026-11-11-always-on-parity-design.md, 1/6; owner, 11 Nov 2026: "Prove one cloud read first", asked via AskUserQuestion: a spare account's session).
// The owner presses it (dev and beta builds only, Settings → Connections → LinkedIn); the session is read from the Keychain HERE, by this code, sent once to the site that seals it with the batch, and read once by the cloud browser
// (desktop/ready-fill/linkedin-probe.mjs). The answer is only {word, status, cards, go}: what LinkedIn answered, never the session.
// Invariants: ONE search, ONE page, no retry and no second try on any answer; the session is only in the one send call, never in a line, a result, an error or a log; a sign-in page, check or 401/403/429/999 is `no`.
// Guard: test/unit/main/linkedin-cloud-probe.test.js.
import * as realSession from './linkedin-session.js';
import * as realSite from './ready-site.js';

export const SEARCH = 'https://www.linkedin.com/jobs/search/?keywords=engineer&location=Switzerland';   // the same address as the night's (ready-fill/linkedin-probe.mjs): the site checks it
export const GIVE_UP_MS = 4 * 60 * 1000;
export const POLL_MS = 4000;
const WORDS = {ok: 'LinkedIn answered the cloud with the signed-in job list: no check.', limited: 'LinkedIn asked us to slow down (401/403/429/999): LinkedIn stays on your computer.', login: 'LinkedIn showed a sign-in page: LinkedIn stays on your computer.',
  check: 'LinkedIn asked for a check: LinkedIn stays on your computer.', guest: 'LinkedIn did not accept the session and showed its public page: LinkedIn stays on your computer.', unclear: 'The page did not look signed in: LinkedIn stays on your computer.',
  nocards: 'LinkedIn answered signed in but without job cards: LinkedIn stays on your computer.', other: 'LinkedIn sent the cloud to another page: LinkedIn stays on your computer.', error: 'The cloud could not read the page (not a LinkedIn answer). Nothing is tried again; ask for a new try.'};

/**
 * Runs the probe once. -> {ok: true, go, word, status, cards, line} when the cloud answered, or {ok: false, error} when it never started or no answer came (nothing is tried again).
 * Seams: `site` (lib/ready-site.js), `session` (lib/linkedin-session.js), `wait`, `now`.
 * Why (code review, 11 Nov 2026): the owner check comes BEFORE the session is read, so a non-owner install never uploads it; the take is shared with the readiness and Full automation polls (lib/ready-site.js onTaken), so
 * the probe listens too and never loses its one read to another poll.
 */
export async function tryCloudRead(storage, {site = realSite, session = realSession, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now} = {}) {
  if (!await site.owner(storage)) return {ok: false, error: 'This install is not the owner\'s: nothing was sent.'};
  const held = session.readSession();
  if (!held?.li_at) return {ok: false, error: 'No LinkedIn session on this computer: sign in to LinkedIn first (Settings → Connections → LinkedIn).'};
  let caught = null;
  const unhook = site.onTaken(got => { caught ||= (got.reads || []).find(each => each.job === 'probe') || null; });
  try {
    const sent = await site.linkedinSend(storage, {url: SEARCH, session: {li_at: held.li_at, ...(held.JSESSIONID ? {JSESSIONID: held.JSESSIONID} : {})}});
    if (!sent.ok) return {ok: false, error: sent.error || 'The site did not take the read.'};
    const started = await site.linkedinRun(storage);
    if (!started.ok) return {ok: false, error: started.error || 'The site did not start the read.'};
    const until = now() + GIVE_UP_MS;
    while (now() < until && !caught) { await wait(POLL_MS); await site.readTake(storage).catch(() => {}); }   // the listener above sees every take, this call's own included
    if (!caught) return {ok: false, error: 'No answer from the cloud in time. Nothing is tried again.'};
    const answer = caught.state === 'read' && caught.read ? caught.read : {word: 'error', status: 0, cards: 0, go: false};
    const word = WORDS[answer.word] ? answer.word : 'error';
    return {ok: true, go: answer.go === true && word === 'ok', word, status: Number(answer.status) || 0, cards: Number(answer.cards) || 0, line: WORDS[word]};
  } finally { unhook(); }
}
