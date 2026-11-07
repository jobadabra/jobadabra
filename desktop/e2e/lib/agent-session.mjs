// What an AI user agent session leaves behind even when it finds nothing: one verdict per goal, the notes filed or held back, and a cost line. Pure: results in, a summary and its text out.
// Job: report health
// Why (3 Nov 2026, AI user agents 5/11; owner: records "what it did even when it finds nothing"): a quiet night must be readable as "it tried these 12 goals and all worked", not as silence; the sessions page and the PR-sized trend read this shape.
import {rankNotes} from './agent-notes.mjs';

export const GOAL_VERDICTS = ['worked', 'doubts', 'could-not-finish', 'bug'];

/** The strict answer the agent gives when it ends a goal: a verdict and one sentence of what it saw. */
export const goalSchema = () => ({type: 'object', additionalProperties: false, required: ['verdict', 'summary'], properties: {verdict: {enum: GOAL_VERDICTS}, summary: {type: 'string'}}});

/**
 * One session's summary. `goals`: the planner's [{n, group, label}]; `results`: [{n, verdict, summary, steps, noteIds?}]; `notes`: the validated notes of the session; `cost`: {calls, tokensIn, tokensOut, ms}.
 * A goal with no result is "not-started"; only an attempted goal can be "could-not-finish". Unknown actor verdicts become "doubts". The actor cannot claim that it never started a goal.
 */
export function summarizeSession({session, persona, seed, goals, results = [], notes = [], cost = {}, cap}) {
  const byGoal = new Map(results.map(result => [result.n, result]));
  const rows = goals.map(goal => {
    const result = byGoal.get(goal.n);
    if (!result) return {...goal, verdict: 'not-started', summary: 'the session ended before this goal', steps: 0};
    if (!GOAL_VERDICTS.includes(result.verdict)) return {...goal, verdict: 'doubts', summary: `the agent's verdict "${result.verdict}" is not one of ours: ${String(result.summary || '').slice(0, 120)}`, steps: result.steps || 0};
    return {...goal, verdict: result.verdict, summary: String(result.summary || '').slice(0, 240), steps: result.steps || 0, ...(result.failover ? {failover: result.failover} : {})};   // Why (7 Nov 2026, pz 2/5): the broker failed on this goal and Claude took over; kept apart from the summary (cut at 240, and read into field notes)
  });
  const ranked = rankNotes(notes, cap);
  const counts = Object.fromEntries([...GOAL_VERDICTS, 'not-started'].map(verdict => [verdict, rows.filter(row => row.verdict === verdict).length]));
  return {session, persona, seed, goals: rows, counts, filed: ranked.filed, over: ranked.over, low: ranked.low, held: ranked.held, steps: rows.reduce((sum, row) => sum + row.steps, 0), cost: {calls: 0, tokensIn: 0, tokensOut: 0, ms: 0, ...cost}};
}

/** The cost line of a session: calls, tokens and time, in the words the sessions page and the PR use. */
export const costLine = cost => `${cost.calls} AI calls, ${Math.round((cost.tokensIn + cost.tokensOut) / 1000)}k gross tokens (input + output), ${Math.round(cost.ms / 60000)} min`;

const ICON = {worked: '✅', doubts: '🤔', 'could-not-finish': '⛔', bug: '🐞', 'not-started': '⏸'};
/** The summary as markdown (the sessions page, the workflow's job summary): a verdict line first, a table of goals, then what was filed and what was held back. */
export function summaryMarkdown(summary) {
  const { counts } = summary;
  const head = `**${summary.persona}** (seed \`${summary.seed}\`): ${counts.worked} worked, ${counts.doubts} doubts, ${counts['could-not-finish']} could not finish, ${counts['not-started'] || 0} not started, ${counts.bug} bug${counts.bug === 1 ? '' : 's'}. Filed ${summary.filed.length}${summary.over.length ? `, ${summary.over.length} over the cap` : ''}${summary.low.length ? `, ${summary.low.length} low (never filed)` : ''}${summary.held.length ? `, ${summary.held.length} held (the second opinion was unavailable)` : ''}. ${costLine(summary.cost)}.`;
  const table = ['| # | Goal | Verdict | What it saw |', '|---|---|---|---|', ...summary.goals.map(goal => `| ${goal.n} | ${goal.label} | ${ICON[goal.verdict]} ${goal.verdict} | ${goal.summary.replace(/\|/g, '/')} |`)];
  // Why (3 Nov 2026, code review on 8/12): a night where Claude is down files nothing and looks green, so the held notes are named here (title, screen, what was seen) with the reason the judge gave.
  const held = summary.held.length ? ['', `**Held, not filed (${summary.held[0].judgeReason || 'the second opinion was unavailable'}):**`, ...summary.held.map(note => `- ${note.title} (${note.view}): ${String(note.observed).replace(/\s+/g, ' ').slice(0, 160)}`)] : [];
  const stopped = summary.stopped ? [`Stopped: ${{goals: 'every goal returned a verdict', budget: 'remaining token budget cannot fund another goal', steps: 'a goal reached its step limit'}[summary.stopped] || summary.stopped}.`, ''] : [];
  return [head, '', ...stopped, ...table, ...held].join('\n');
}
