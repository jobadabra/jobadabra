// CI's side of the shared mark of refusing-board reads (the AI broker's POST /board-read, jobadabra-web workers/ai-broker/lib/board-reads.mjs): before a CI search
// opens a refusing board's page in its honest browser it asks whether it may; after the read it says how it ended. Owner, 14 Nov 2026 (AskUserQuestion, session rb):
// "Once per host per day, all CI (Recommended)", "AI broker's store (Recommended)", "For good (Recommended)", "Once per search page (Recommended)".
// The app never loads this file: its own limits are src/sources/refused_reads.py. No answer from the broker is a skip: CI never reads a refusing page on a guess.
import {BROKER_URL, runToken} from '../../desktop/e2e/lib/broker-client.mjs';

/** One call to the mark, through the relay (its own 30 s) or straight: past this the call fails and the page is skipped (Gitar on #4344: never a hung search). */
export const MARK_CALL_MS = 35_000;
const SKIP = {
  stopped: 'turned CI\'s browser away before, so no CI search opens it again',
  waiting: 'asked CI to slow down today; not opened again until tomorrow (UTC)',
  'host-full': 'this site\'s daily reads are used: nothing more is sent to it today',
  // Why (owner, 14 Nov 2026, asked via AskUserQuestion after Gitar's 3rd round: "No wait, skip (Recommended)"): no wait for another search's read, so the press's 3 minutes hold
  reading: 'another CI search is reading this page right now; not opened twice, not waited for',
};

/** A kept job ({title, url, company, place, date}) as a card the engine reads (src/sources/visits_read.py _from_cards: title, url, its named place, company and date). */
export const toCard = job => ({title: job.title, url: job.url, place: job.place || '', company: job.company || '', date: job.date || ''});

/**
 * The broker's answer for one call: (body) -> {status, json}. `post` is injected by tests; the default signs in with this job's GitHub run token.
 * Under codex.mjs (JOBADABRA_BOARD_MARK_URL) its relay signs the call. -> null outside a GitHub Actions job with `id-token: write` and outside the relay: the caller then skips every refusing page.
 */
export async function brokerPost(env = process.env, fetchImpl = fetch) {
  // Why (14 Nov 2026, rb): CI's searches run under tools/persona-search/codex.mjs, which keeps the run token and signs the mark's calls (boardForward); no token here
  if (env.JOBADABRA_BOARD_MARK_URL) return async body => {
    const answer = await fetchImpl(env.JOBADABRA_BOARD_MARK_URL, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body), signal: AbortSignal.timeout(MARK_CALL_MS)});
    return {status: answer.status, json: await answer.json().catch(() => ({}))};
  };
  const token = await runToken(env, fetchImpl).catch(() => null);
  if (!token) return null;
  return async body => {
    const answer = await fetchImpl(`${BROKER_URL(env)}/board-read`, {method: 'POST', headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json', 'user-agent': 'jobadabra-ci'}, body: JSON.stringify(body), signal: AbortSignal.timeout(MARK_CALL_MS)});
    return {status: answer.status, json: await answer.json().catch(() => ({}))};
  };
}

/**
 * The boards step's CI seams (desktop/lib/headless-boards.js ask/told). post: brokerPost's function, or null: in CI (`ci`) every refusing page is then skipped;
 * outside CI (a run on the owner's Mac, one install) the app's own per-install limits apply, as in the app ({go: true}, nothing reported).
 * ask(item, signal) -> {go: true} | {go: false, cards} (another CI search read this page today: its jobs, nothing sent) | {go: false, why}.
 * told(item, answer): the engine's answer after a read (refused_reads.outcome) -> the mark: read/empty = opened with its listing, stopped, waiting; else nothing (the page stays
 * reading for the day: nobody asks again).
 */
export function markSeams(post, {ci = true} = {}) {
  const ask = async (item, signal) => {
    if (!post) return ci ? {go: false, why: 'no shared CI mark in this run (no GitHub run token): not opened'} : {go: true};
    if (signal?.aborted) return {go: false, why: 'stopped before the shared CI mark was asked: not opened'};
    const {status, json} = await post({op: 'reserve', page: item.url}).catch(() => ({status: 0, json: {}}));
    if (status !== 200) return {go: false, why: `the shared CI mark did not answer (HTTP ${status}): not opened`};
    if (json.go === true) return {go: true};
    if (json.state === 'opened') return {go: false, cards: (json.jobs || []).map(toCard), from: json.read_by};
    return {go: false, why: SKIP[json.state] || `not opened (${json.state || 'no state'})`};
  };
  const told = async (item, answer) => {
    if (!post) return;
    const outcome = ['read', 'empty'].includes(answer?.state) ? 'opened' : ['stopped', 'waiting'].includes(answer?.state) ? answer.state : null;
    if (!outcome) return;
    await post({op: 'report', page: item.url, outcome, ...(outcome === 'opened' ? {jobs: answer.listing || [], count: answer.jobs} : {why: String(answer.why || '').slice(0, 80)})}).catch(() => null);
  };
  return {ask, told};
}
