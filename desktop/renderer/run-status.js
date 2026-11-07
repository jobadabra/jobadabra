// How a run ended, in one word and a tone: the Actions page and Recent activity both use this, so they cannot disagree.
import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
import {AI_BUSY, isSpendingLimit, runWarningLines, stopCause} from './run-warnings.js';

// A finished run that worked but said something (its row's Status, or a warning line in its log or report).
// A run that made only part of what it set out to (Tailor CVs: "3 of 5 tailored · 2 failed"): its card says which; its pill says With warnings.
// A run that did part of its work: "3 of 5 tailored", "drafted", and a browser run's "Read 2 of 4 sites" (owner, 8 Oct 2026: it read "Completed"
// with two sites failed). Amber "With warnings", not green.
export const partialResult = run => { const m = /(\d+) of (\d+) (?:tailored|drafted|sites?\b)/.exec(String(run?.message || '')); return !!m && Number(m[1]) < Number(m[2]); };
// A Gmail check that read nothing: Gmail not connected (off) or a recorded "not checked: <why>" (a revoked Google sign-in, no AI engine).
// ONE state for the pill, the result card, the Actions card, the toast and the footer (#605, #540, #1661, #541): not a failure, a connection or setting to fix.
export const notChecked = run => !!run && (!!run.off || /^not checked:/i.test(String(run.problem || '')));
export const runWarned = run => !!run && !run.live && !run.waiting && !!run.ok && !run.off && (!!run.warned || runWarningLines(run).length > 0 || !!deliveryHead(run) || partialResult(run));

// A search that ran out of its 3 minutes (the press sets `endedByTime` once: lib/search-steps.js): not failed, not finished. Why (4 Nov 2026, #3108, a tester on 0.9.2: such a run read
// green "Completed, No jobs added to your list" beside a report that said only 2 of 14 employer sites were searched): its own state, amber, "Partial" (owner's pick, 4 Nov 2026).
export const partialSearch = run => !!run && !run.live && !run.waiting && !!run.ok && !run.off && !!run.endedByTime;

// The title of the toast when a run ends: a run that worked but warned is not "done" with a green check, the detail pane says "Completed with warnings" (#276).
export function doneTitle(name, run) {
  if (notChecked(run)) return t('helperState.doneNotChecked', {name});
  if (!run?.ok) return t('helperState.doneProblems', {name});
  if (partialSearch(run)) return t('helperState.doneTimed', {name});
  return runWarned(run) ? t('helperState.doneWarnings', {name}) : t('helperState.doneSuccess', {name});
}

// What a failed run says in the box above its log, in its own words (#290, 5 Oct 2026: a Gmail check whose Google sign-in was revoked was "Failed" in the pill and "Completed with
// warnings" in the box, with no reason and no way out). The reason is the run's `problem`; a fix the app can open is named next to it.
export const PROBLEM_FIXES = [[/Google sign-in/i, t('helperState.reconnectGoogle'), 'settings'], [/Claude Code is not ready/i, t('helperState.openAiSettings'), 'settings'], [/Telegram/i, t('helperState.openTelegram'), 'settings']];
// A run the AI provider stopped (usage/spending limit, or rate-limited) — the engine exits with an error, so the run has no
// problem line and read "Had problems" over a raw log. It says what happened, what it means and the one fix (the owner's
// mockup, 6 Oct 2026): a variant of the failure box beside the others, not a replacement.
const AI_STOPPED_WHAT = {mail: t('helperState.emailProcessing'), search: t('helperState.scoringTask'), insight: t('helperState.insightTask'), weekly: t('helperState.reportTask'), kit: t('helperState.preparationTask'),
  interview: t('helperState.interviewReviewTask'), review: t('helperState.reviewTask')};
// Which limit, from the error itself and who is billed (owner, 6 Oct 2026: credits, a spend limit, a plan's limit and a rate limit all read
// "Increase your limit"): its words and the page that fixes it. A cause not recognised keeps the neutral words.
// The OpenAI family first (its texts are the engine's own: src/ai/providers/openai_api.py, codex_cli.py), so a generic "spend limit" rule
// below never sends an OpenAI user to Anthropic's console.
const OPENAI_LIMITS = 'https://platform.openai.com/settings/organization/limits', CODEX_USAGE = 'https://chatgpt.com/codex/settings/usage';
const LIMIT_KINDS = [
  {test: (line, run) => run.billing === 'ChatGPT plan' || /^Codex:|ChatGPT plan/i.test(line), why: t('helperState.codexLimit'),
    hint: t('helperState.planReset'), fix: {label: t('helperState.codexUsage'), url: CODEX_USAGE}},
  {test: (line, run) => run.billing === 'OpenAI API credits' || /^OpenAI:|platform\.openai\.com/i.test(line), why: t('helperState.openAiLimit'),
    hint: t('helperState.addCreditLimit'), fix: {label: t('helperState.manageOpenAi'), url: OPENAI_LIMITS}},
  {test: (line) => /credit balance/i.test(line), why: t('helperState.creditsEmpty'), hint: t('helperState.addCredits'),
    fix: {label: t('helperState.manageBilling'), url: 'https://console.anthropic.com/settings/billing'}},
  {test: (line, run) => run.billing === 'Claude subscription' || /Claude Code|usage window|your plan|resets? at/i.test(line), why: t('helperState.planUsageReached'),
    hint: line => { const at = /resets? (?:at|in) ([^.;)]+)/i.exec(line); return at ? t('helperState.resetsAt', {time: at[1].trim()}) : t('helperState.planReset'); },
    fix: {label: t('helperState.viewPlanUsage'), url: 'https://claude.ai/settings/usage'}},
  {test: (line) => /specified API usage limits?|spending limit|spend limit/i.test(line), why: t('helperState.apiSpendReached'), hint: t('helperState.raiseLimit'),
    fix: {label: t('helperState.manageApiLimits'), url: 'https://console.anthropic.com/settings/limits'}},
];
/** Describe a recorded spending or stop condition and its existing remedy; return null for active or unaffected runs. */
export function aiLimitHead(run, name = t('helperState.runTask')) {
  if (!run || run.live || run.waiting || (run.ok && !run.off)) return null;
  const lines = [run.problem, run.result, ...(run.log || []), ...(run.report || [])].filter(Boolean).map(String);
  const limit = lines.find(line => isSpendingLimit(line));
  const stop = limit ? '' : lines.find(stopCause);   // Why (#3322, Gitar): a real limit's own page is the fix; the stop stays a warning line of its own
  const hit = stop || limit || lines.find(line => AI_BUSY.test(line));
  if (!hit) return null;
  const what = AI_STOPPED_WHAT[run.kind] || t('helperState.runTask');
  const title = t('helperState.couldNotFinish', {name});
  if (stop) return {problem: stop, title, summary: t('helperState.couldNotComplete', {reason: stopCause(stop), task: what}), hint: t('helperState.stopHelpRun'), fix: {label: t('helperState.openAiSettings'), view: 'settings'}};
  if (!isSpendingLimit(hit)) return {problem: hit, title, summary: t('helperState.providerBusy', {task: what}), hint: t('helperState.tryShortly'), fix: null};
  const kind = LIMIT_KINDS.find(one => one.test(hit, run));
  if (kind) return {problem: hit, title, summary: t('helperState.limitCouldNotComplete', {reason: kind.why, task: what}), hint: typeof kind.hint === 'function' ? kind.hint(hit) : kind.hint, fix: kind.fix};
  return {problem: hit, title, summary: t('helperState.providerLimit', {task: what}),
    hint: t(run.kind === 'mail' || name === 'Gmail check' ? 'helperState.increaseCheck' : run.kind === 'search' || name === 'Find jobs' ? 'helperState.increaseSearch' : 'helperState.increaseTask'),
    fix: {label: t('helperState.manageAi'), url: {'Claude subscription': 'https://claude.ai/settings/usage', 'ChatGPT plan': CODEX_USAGE, 'OpenAI API credits': OPENAI_LIMITS}[run.billing]
      || 'https://console.anthropic.com/settings/limits'}};
}
// A run the app's watchdog stopped (lib/pipeline.js stoppedReason): what happened, the step it was on in plain words, and the way
// out, with the log folded since the box says it (the owner's targeted fix #4, 6 Oct 2026: 110 log lines hid the reason).
const STOPPED = /Stopped by (?:Jobadabra|Job Pilotto): (no output for (\d+) (min|s)|still running after (\d+) min)\b.*?(?:The last thing it did: (.+))?$/;
const DOING = [[/^Descriptions:/, t('helperState.fetchingDescriptions')], [/^Scor(?:ed|ing) /, t('helperState.scoringJobs')], [/^Enriched /, t('helperState.readingJobs')],
  [/^(?:Checking employer career pages|Checked: )/, t('helperState.checkingCareers')], [/^(?:Searching job boards|Job boards:)/, t('helperState.searchingBoards')]];
const unit = (n, word) => t(word === 'minute' ? 'helperState.minutes' : 'helperState.seconds', {count: Number(n)});
export function stoppedHead(run) {
  if (!run || run.live || run.waiting || (run.ok && !run.off)) return null;
  const line = [run.problem, run.summary, run.result, ...[...(run.log || [])].reverse()].filter(Boolean).map(String).find(text => STOPPED.test(text));
  if (!line) return null;
  const [, stopped, quiet, scale, total, lastLine = ''] = STOPPED.exec(line);
  const last = lastLine.trim() === 'nothing yet' ? '' : lastLine.trim();
  const doing = DOING.find(([pattern]) => pattern.test(last))?.[1] || '';
  const search = run.kind === 'search' || !run.kind;
  return {problem: line, stopped, last, doing,
    title: quiet ? t('helperState.stoppedQuiet', {duration: unit(quiet, scale === 'min' ? 'minute' : 'second')}) : t('helperState.stoppedRunning', {duration: unit(total, 'minute')}),
    summary: t('helperState.stoppedSummary', {while: doing ? t('helperState.whileDoing', {task: doing}) : '', result: t(search ? 'helperState.searchUnfinished' : 'helperState.notFinished')}),
    hint: t('helperState.runAgainHint'), fix: {label: t('helperState.runAgain'), rerun: true}};
}
// A run that did its work but whose Telegram message did not arrive (lib/run-result.js deliveryProblem, or the engine's own
// "Warning: Telegram refused the digest: …"): Completed with warnings, its steps ticked, then this box under them with the paper
// plane and the way to Telegram settings (the owner's targeted fix #5, 6 Oct 2026: a delivery failure read as a failed search).
const NOT_DELIVERED = /^not delivered:\s*/i;
const TELEGRAM_SAID = /Telegram (?:refused the digest|did not accept the digest|could not be reached|is limiting the bot)[^\n]*/;
export function deliveryHead(run) {
  if (!run || run.live || run.waiting || !run.ok || run.off) return null;
  const lines = [...(run.log || []), ...(run.report || [])].map(String).filter(line => TELEGRAM_SAID.test(line));
  const flagged = NOT_DELIVERED.test(run.problem || '') ? String(run.problem).replace(NOT_DELIVERED, '') : '';
  if (!lines.length && !flagged) return null;
  const reason = lines.length ? TELEGRAM_SAID.exec(lines.at(-1))[0] : `${flagged.replace(/^./, c => c.toUpperCase())}.`;
  return {problem: reason, delivery: true, lines, icon: 'send', title: t('helperState.telegramNotDelivered'),
    summary: t(run.kind === 'search' || !run.kind ? 'helperState.searchTelegramMiss' : 'helperState.runTelegramMiss'), hint: reason, fix: {label: t('helperState.openTelegram'), view: 'settings'}};
}
// Whether the bot reached the person on the latest run that tried: 'blocked' (refused / not delivered), 'ok' (a message arrived), or null (no run tried).
// Newest first, as the runs list is. A saved token alone proves neither (#1663).
export function telegramHealth(runs) {
  for (const run of runs || []) {
    if (!run || run.live || run.waiting) continue;
    if (deliveryHead(run) || /^not sent: Telegram/i.test(run.telegramNote || '')) return 'blocked';
    if (run.telegram) return 'ok';
  }
  return null;
}

// A Gmail check with Gmail not connected: nothing was checked, the box says so and connects it (the owner's fix #6, 6 Oct 2026).
export function notConnectedHead(run, connectedNow = null) {
  if (!run?.off || run.live || run.waiting) return null;
  // Connected since: the run stays as it was (history), without a button to connect what already is.
  if (connectedNow === true) return {problem: t('helperState.gmailWasOff'), title: t('helperState.gmailWasOff'), icon: 'mail', short: t('helperState.gmailOffShort'),
    summary: t('helperState.gmailBefore'), hint: t('helperState.gmailNow'), fix: null};
  return {problem: t('helperState.gmailOff'), title: t('helperState.gmailOff'), icon: 'mail', short: t('helperState.gmailOffShort'),
    summary: t('helperState.connectBeforeCheck'), fix: {label: t('helpers.connectGmail'), view: 'settings'}};
}
// A run that ended while it waited for another Jobadabra run (lib/pipeline.js run_lock): it never started its work (fix #10).
const WAITED = /Another Jobadabra (?:search|run) is running[^\n]*waiting for it/i;
const DOING_NOUN = {tailor: t('helperState.tailoringNoun'), visits: t('helperState.browserJobsNoun'), kits: t('helperState.preparingNoun'), search: t('helperState.searchNoun'), scout: t('helperState.widerNoun'), weekly: t('helperState.analysisNoun'),
  insight: t('helperState.insightNoun'), mail: t('helperState.gmailNoun'), review: t('helperState.reviewNoun'), interview: t('helperState.interviewNoun')};
export function waitedHead(run) {
  if (!run || run.live || run.waiting || run.ok || run.problem) return null;
  const line = (run.log || []).map(String).find(text => WAITED.test(text));
  if (!line) return null;
  const title = t('helperState.couldNotStart', {task: DOING_NOUN[run.kind] || t('helperState.runNoun')});
  return {problem: line, title, short: title, icon: 'clock', quiet: true,
    summary: t('helperState.waitedSummary'),
    hint: t('helperState.waitedHint'), fix: {label: t('helpers.tryAgain'), rerun: true}};
}

export function failureHead(run, name = '') {
  if (!run || run.live || run.waiting || (run.ok && !run.off)) return null;
  // Jobadabra was closed while it ran (lib/pipeline.js takeQueue): not an error, and its log is kept (owner, 7 Oct 2026: it read "stopped unexpectedly").
  if (run.interrupted) {
    return {problem: 'interrupted', quiet: true, short: t('helperState.interrupted'), viewLog: true, title: t('helperState.interruptedTitle', {name: name || t('helperState.runTask')}),
      summary: t('helperState.interruptedSummary'), fix: {label: t('helperState.runAgain'), rerun: true}};
  }
  const problem = String(run.problem || '').trim();
  if (run.off && !problem) return notConnectedHead(run);   // #1661: Gmail not connected is not "stopped unexpectedly"
  // No reason recognised: say it stopped unexpectedly, offer to run it again and the log (the owner's fix #7, 6 Oct 2026: "Had problems" over a raw log).
  if (!problem) {
    return {problem: 'unexpected', unexpected: true, quiet: true, short: t('helperState.unexpectedError'), viewLog: true,
      title: t('helperState.stoppedUnexpected', {name: run.kind === 'search' ? t('helperState.jobSearchTask') : name || t('helperState.runTask')}),
      summary: t('helperState.unexpectedSummary'), fix: {label: t('helperState.runAgain'), rerun: true}};
  }
  const fix = PROBLEM_FIXES.find(([pattern]) => pattern.test(problem));
  const lead = /^not (checked|delivered):\s*/i.exec(problem)?.[1]?.toLowerCase();   // the title says it; the sentence under it is only the reason
  const reason = problem.replace(/^not (?:checked|delivered):\s*/i, '');
  // A task that failed with its own reason (its first "✗ <what>: <why>" line, lib/pipeline.js failedLine): it did not finish, and runs again
  // (owner, 8 Oct 2026: a browser run read "Not checked", a Gmail title, with no Run again).
  const rerun = !lead && !fix;
  return {problem, notChecked: lead === 'checked', title: lead === 'delivered' ? t('helperState.notDelivered') : lead ? t('helperState.notChecked') : t('helperState.didNotFinish', {name: name || t('helperState.runTask')}),
    summary: `${reason.replace(/^./, c => c.toUpperCase()).replace(/\.$/, '')}.`, fix: fix ? {label: fix[1], view: fix[2]} : rerun ? {label: t('helperState.runAgain'), rerun: true} : null};
}

// What the box says for a run whose card has no result: the interrupted / failed head run-status already words, else a finished run whose result was never saved.
// `tone`: the box's colour by cause (an interrupted run is not an error; a run with nothing saved is neither a success nor a failure); `pill`: the card header's pill for it.
export function noResultHead(run, kind) {
  const failed = failureHead(run, kind.name);
  if (failed) return {...failed, tone: failed.problem === 'interrupted' || notChecked(run) ? 'warn' : 'bad'};
  return {tone: 'info', pill: [t('helperState.noResult'), 'neutral'], title: t('helperState.finishedName', {name: kind.name}), short: t('helperState.noResultSaved'),
    summary: t('helperState.resultNotSaved'), fix: {label: t('helperState.readAgain'), retry: true}};
}


// What a failed run says about itself when no reason was recognised (#301, 5 Oct 2026: a Jobs check that was Failed read "1 new job", like a success, because the result a Notion row
// carries won). It says it failed first, and keeps what the run did report.
export function failedOutcome(run) {
  if (!run || run.live || run.waiting || (run.ok && !run.off)) return null;
  const said = String(run.result || '').trim();
  return said ? t('helperState.outcomeProblems', {result: said}) : null;
}

// One checklist step of a search: 'done', 'now', 'todo', 'warn' (the step a warned run stopped at) or 'fail' (the step a failed run stopped at).
// `at` is the index of the last step the log reached; a failed run's steps after it never ran, so they stay 'todo'.
export function phaseStatus(run, i, at) {
  const live = !!run?.live;
  if (i === at && !live && runWarned(run) && !deliveryHead(run)) return 'warn';   // a message not delivered is not a step that went wrong
  if (i === at && !live && !run?.waiting && (!run?.ok || run?.off)) return 'fail';
  return i < at || (i === at && !live) ? 'done' : i === at ? 'now' : 'todo';
}

// A run's status pill: running, queued, failed, completed with warnings, completed. [label, tone, options]
// A finished run that saved nothing (no result, summary, count, update or message): its pill says No result, its line that the result was not saved, and its
// run panel offers Read again (pages/activity-render.js), the same in the Actions banner, the drawer, Recent runs and Actions → Runs.
export const unsavedRun = run => !!run && !run.live && !run.waiting && !!run.ok && !run.off && !run.interrupted && !run.stopped && !run.result && !run.summary && !run.message
  && run.new == null && !run.updates?.length;
export function runStatus(run, warned) {
  if (run.live) return [t('helpers.running'), 'info', {dot: true}];
  if (run.waiting) return [t('helpers.queued'), 'neutral'];
  if (notChecked(run)) return [t('helperState.notChecked'), 'warn'];   // nothing was checked: not a failure, a connection to make
  if (run.interrupted) return [t('helperState.interrupted'), 'warn'];   // the app was closed while it ran (lib/pipeline.js takeQueue)
  if (run.stopped === 'you') return [t('helperState.stoppedYou'), 'neutral'];   // Stop on Actions or Recent activity: not a failure
  if (!run.ok) return stoppedHead(run) ? [t('helperState.stopped'), 'bad'] : [t('helpers.failed'), 'bad'];
  if (partialSearch(run)) return [t('helperState.partial'), 'warn'];   // it did not reach everything: more than a warning says, less than a failure
  if (warned) return [t('helpers.withWarnings'), 'warn'];   // a warning says more than an empty result
  return unsavedRun(run) ? [t('helperState.noResult'), 'neutral'] : [t('helpers.completed'), 'good'];   // nothing saved: never "Completed" (owner, 25 Oct 2026)
}

// The one pill for a run, wherever it is drawn: the Actions list (short words), the Recent activity header and the Actions result card ({long: true}: "Completed with warnings").
// Warned is derived here, from the row's flag, its log, its report, a Telegram miss or a partial result, for every engine (18 Oct 2026: the result card said "Completed" for a run the list called "With warnings").
export function runPill(run, {long = false} = {}) {
  const pill = runStatus(run, runWarned(run));
  return long && pill[0] === t('helpers.withWarnings') ? [t('helperState.completedWarnings'), ...pill.slice(1)] : pill;
}

// The dot of the bottom status bar. It must describe the SAME run as the words beside it (the last jobs check, else the last Gmail check): the newest run of any kind
// made a Gmail check that was not connected turn the dot red beside "Last jobs check · nothing new" (UI loop #59). A run that worked but warned is amber.
export function barState(running, shown) {
  if (running) return 'busy';
  if (!shown) return 'idle';
  if (!shown.ok || shown.off) return 'error';
  return runWarned(shown) ? 'warn' : 'ok';
}

// How far a running task is, from its live step when it counts ("Scout: checked 33 of 91: EF", "Reading employer job sites: 1,200 of 2,024"):
// the progress meter above the Technical log (pages/activity.js runProgress). null when the step does not count.
export function stepCount(step = '') {
  const m = /(\d[\d,]*) of (\d[\d,]*)/.exec(String(step));
  const [done, total] = m ? [m[1], m[2]].map(n => Number(n.replace(/,/g, ''))) : [0, 0];
  return total > 0 && done <= total ? {done, total, percent: Math.round(done / total * 100)} : null;
}
