// The fixer's walls: which paths a change may never touch, how many files and bytes it may have, and the daily caps (moved out of tools/feedback-ai.mjs, 4 Nov 2026, [hm] 2/6).
import {TESTS} from './proof.mjs';
// Walls are CODE, never AI judgment: a refused change is final. Runs from the workflow's trusted copy (the AI may not edit tools/).

/** The most files a draft fix may change (MAX_FILES) and the largest patch, in bytes, it may be (MAX_PATCH_BYTES). */
export const MAX_FILES = 8, MAX_PATCH_BYTES = 60000;
// What no fix may touch, even inside an allowed folder: workflows, tools and gates, hooks, the agents' instruction files, package files, secrets and config.
const DENIED = /^(?:\.github|\.claude|\.githooks|\.husky|tools|config|scripts)\/|(?:^|\/)(?:CLAUDE|AGENTS)\.md$|(?:^|\/)\.?(?:git)?hooks\/|(?:^|\/)package(?:-lock)?\.json$|(?:^|\/)\.env|secret|credential|\.(?:pem|key|p12)$/i;
/** Why a change may not become a pull request, or '' when it may (the allowed folders are check-change.mjs's job; this is the second wall): a denied path, more than MAX_FILES files, or a patch over MAX_PATCH_BYTES. */
export function gateChange(files, bytes) {
  const list = files.map(file => String(file).trim()).filter(Boolean), denied = list.filter(file => DENIED.test(file) || file.includes('..') || file.startsWith('/'));
  if (denied.length) return `the change touches ${denied.length} file(s) a fix may never touch (workflows, tools, hooks, agent instructions, package files, secrets or config)`;
  if (list.length > MAX_FILES) return `the change touches ${list.length} files; a draft fix may touch at most ${MAX_FILES}`;
  if (bytes > MAX_PATCH_BYTES) return `the patch is ${bytes} bytes; a draft fix may be at most ${MAX_PATCH_BYTES}`;
  return '';
}

/** How many Send to AI runs may start per UTC day. */
// Why (5 Nov 2026, owner): raise the daily limit to 10 after the fourth attempt was refused in run 41955735940.
export const DAILY_RUNS = 10;
/**
 * The CI side of the caps (the site enforces them too; mac-07 on #3086: not only there). `runs` = this workflow's workflow_dispatch runs created today (GitHub's list); `selfId` = this run.
 * -> {ok: true} | {ok: false, why}: refused when another run has not finished (queued, waiting or running: two clicks at once refuse each other, the safe side), or when this would be the 11th of the UTC day.
 */
export function capVerdict(runs, selfId, now = new Date(), daily = DAILY_RUNS) {
  const day = now.toISOString().slice(0, 10), others = (runs || []).filter(run => String(run.id) !== String(selfId) && run.event === 'workflow_dispatch' && String(run.created_at || '').slice(0, 10) === day && run.conclusion !== 'skipped');
  if (others.some(run => run.status !== 'completed')) return {ok: false, word: 'busy', why: 'another Send to AI run is still going (one at a time)'};
  if (others.length + 1 > daily) return {ok: false, word: 'cap', why: `that is more than ${daily} Send to AI runs today (UTC)`};
  return {ok: true};
}

/**
 * The only paths an AI-written change may touch (shared by the loop and ai-fixer.yml): the app and engine code and their tests. A string for `new RegExp`; DENIED above still applies on top.
 * Why (4 Nov 2026, [hm] 3/6): both sources of the loop (a feedback card, a Linear issue) fix the same code, so the loop and ai-fixer.yml read this one list; a text in an item cannot widen it.
 */
export const EDITABLE = `^(?:desktop/(?:renderer|lib)/|src/|${TESTS.source.slice(1, -1)})`;   // the test shapes are TESTS's (proof.mjs): one list, so the loop never accepts a test the proof refuses
