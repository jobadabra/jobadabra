// One AI user agent session: the planner's goals, one explorer loop per goal (lib/explore.mjs with the agent's own instructions and its extra action "note"), a second opinion on every note, then the findings and the summary.
// Job: report health
// Why (3 Nov 2026, AI user agents 6/12; owner asked for an agent that clicks around the app like a tester and interprets what it sees as it goes): the session is pure given its inputs (act is the page, ask the acting model, judgeAsk the second opinion),
// so a scripted model plays a whole night in a unit test; the suite (suites/agent.mjs) only wires the real app and the broker. Nothing here reaches a network, a clock or the owner's data.
import {explore, stepWords} from './explore.mjs';
import {judgeNote} from './agent-judge.mjs';
import {KINDS, SEVERITIES, TYPES, toFinding, validateNote} from './agent-notes.mjs';
import {GOAL_VERDICTS, summarizeSession} from './agent-session.mjs';

const MIN_STEPS_PER_GOAL = 6;
const choice = values => ({type: 'string', enum: ['', ...values]});

// Why (3 Nov 2026, AI user agents 7/12): in its first real session the agent ended a goal as could-not-finish for the Focus page after pressing More actions, never using the go action it was offered; the prompt now says what go is for.
export const AGENT_SYSTEM = `You are a person using the Jobadabra desktop app (a job-search tool) in a TEST account, to get ONE thing done, and you notice when the app does not behave as it should.
You are given your goal and what is known about how the app should behave (rules with ids like jobs-3, and notes from earlier sessions). Work like a person with that goal: go where you would go, use the controls you would use, and sometimes do the unexpected (go back, change your mind, come back later).
The action go opens any page of the app by its name, from anywhere: use it when your goal is on another page, instead of looking for a way there.
After a step that should have changed something, look at the page again and check that it did, and that what you set is what is now shown.
When you believe something is a bug, answer with the action note: type (ui, ux, data, performance, error), kind, severity, view, a short title, expected (cite the rule id, for example "jobs-3 …", or write "general UX: <the principle>"), observed (what you saw, a full sentence) and why (what it costs the person).
A real bug, by severity: high = loses data, shows a wrong result or a false status, or leaves the person stuck; medium = confuses or makes the person work around it; low = wording or taste (not filed). Never note: taste, a toast caught half-way, a guess about the app's insides, anything you cannot show on the page.
When the goal is done, or cannot be done, answer with the action done: verdict is worked (the goal was reached and everything held), doubts (reached, but something looked off), could-not-finish (you could not reach it) or bug (you noted a bug that stopped you); summary is one sentence of what you saw.
Controls marked [not allowed] are refused (they delete, send, sign in, leave the app or spend AI credit). Each turn you answer with ONE JSON action and nothing else; fields the action does not use are "" (control: -1).`;

/**
 * The agent's extra action and fields for explore(): `note` (an argued bug, validated by lib/agent-notes.mjs, never repaired) and the verdict a goal ends with. `sink` collects the valid notes.
 * `knowledgeIds`: the rule ids a note may cite; `views`: the screens it may name; `goal`: the goal being worked, kept on each note.
 */
export function agentExtend({knowledgeIds, views, goal, sink, shoot = null}) {
  const text = {type: 'string'};
  return {actions: ['note'], without: ['report_bug'], properties: {type: choice(TYPES), kind: choice(KINDS), severity: choice(SEVERITIES), expected: text, observed: text, why: text, verdict: choice(GOAL_VERDICTS)},
    async take(input, row, {steps = []} = {}) {
      const checked = validateNote({...input, view: input.view || row.view}, {knowledgeIds, views});
      if (!checked.ok) { row.refused = checked.why; return `Refused: ${checked.why}. Note it again with an argument, or leave it.`; }
      sink.push({...checked.note, goal: goal.n, trail: steps.slice(-12).map(stepWords), image: shoot ? await shoot() : ''});   // the screen as it is NOW: the second opinion judges this, not where the session ends up
      row.title = checked.note.title;
      return 'Noted. Carry on with your goal.';
    }};
}

/** What one goal's loop leaves: the verdict the agent gave, or why it did not give one. */
function goalResult(goal, result) {
  const final = result.final;
  if (final && GOAL_VERDICTS.includes(final.verdict)) return {n: goal.n, verdict: final.verdict, summary: final.summary, steps: result.steps.length};
  if (final) return {n: goal.n, verdict: 'doubts', summary: `ended without a verdict: ${String(final.summary || '').slice(0, 120)}`, steps: result.steps.length};
  return {n: goal.n, verdict: 'could-not-finish', summary: `the goal ran out of room (${result.stopped})`, steps: result.steps.length};
}

/** The text put before a goal's first page view: the goal, then what is known about the areas it touches. */
export const goalIntro = (goal, knowledge) => `Your goal (${goal.group}): ${goal.label}\n\nWhat is known about the app:\n${knowledge || '(nothing recorded yet)'}`;

/**
 * Runs a whole session. `plan`: planSession's {seed, persona, goals}; `knowledge`: the prompt text (knowledgeFor); `knowledgeIds`: the rule ids a note may cite; `caps`: {maxSteps, maxCalls, maxMinutes} for the whole session,
 * shared out between the goals (at least 6 steps each); `shoot()` -> base64 PNG of the screen, taken when a note is made and kept for the second opinion (optional). The session ends early, keeping what it has, when the broker refuses (an `api:` stop).
 * -> {summary, findings, observations, trace, spent, notes}: `findings` are ctx.findings items (source ai-user-agent); `observations` are {Area: [text]} for the field notes (the goals that did not simply work).
 */
export async function runSession({act, ask, judgeAsk, views, plan, knowledge = '', knowledgeIds = [], caps = {}, now = Date.now, log = () => {}, shoot = null, session = {}}) {
  const {maxSteps = 60, maxCalls = 260, maxMinutes = 35} = caps, started = now();
  const perGoal = Math.max(MIN_STEPS_PER_GOAL, Math.floor(maxSteps / Math.max(1, plan.goals.length)));
  const spent = {calls: 0, input: 0, output: 0, ms: 0}, notes = [], results = [], trace = [];
  let stoppedByBroker = '';
  for (const goal of plan.goals) {
    const callsLeft = maxCalls - spent.calls, minutesLeft = maxMinutes - (now() - started) / 60000;
    if (callsLeft <= 0 || minutesLeft <= 0) break;
    const mine = [];
    const result = await explore({act, ask, views, caps: {maxSteps: perGoal, maxCalls: callsLeft, maxMinutes: minutesLeft}, now, log, system: AGENT_SYSTEM, first: goalIntro(goal, knowledge),
      extend: agentExtend({knowledgeIds, views, goal, sink: mine, shoot})});
    for (const key of ['calls', 'input', 'output', 'ms']) spent[key] += result.spent[key];
    trace.push(...result.trace.map(row => ({...row, goal: goal.n})));
    notes.push(...mine);
    results.push(goalResult(goal, result));
    log(`  goal ${goal.n} "${goal.label}": ${results.at(-1).verdict}, ${mine.length} note(s)`);
    if (result.stopped.startsWith('api:')) { stoppedByBroker = result.stopped; break; }
  }
  // Why (3 Nov 2026, code review on 8/12): the judge asks for Claude alone and may wait up to the broker call's 180 s; the notes are judged one after another after the goals, so after the first call that gets no answer the rest are not asked (a refusal or a stuck Claude would otherwise cost 180 s per note and the step limit would end the night before the summary is written).
  let judgeDown = '';
  for (const note of notes) {
    const skipped = Boolean(judgeDown);
    const opinion = skipped ? {verdict: 'unavailable', reason: `not asked: ${judgeDown}`} : await judgeNote({ask: judgeAsk, note, image: note.image || ''});
    if (opinion.verdict === 'unavailable' && !judgeDown) judgeDown = opinion.reason;
    Object.assign(note, {judge: opinion.verdict, judgeReason: opinion.reason});
    if (!skipped) spent.calls++;   // a note that was not asked made no call (Gitar, #3094)
    spent.input += opinion.usage?.input_tokens || 0; spent.output += opinion.usage?.output_tokens || 0; spent.ms += opinion.ms || 0;
  }
  const summary = summarizeSession({session: session.id || '', persona: plan.persona?.name || '', seed: plan.seed, goals: plan.goals, results, notes,
    cost: {calls: spent.calls, tokensIn: spent.input, tokensOut: spent.output, ms: now() - started}});
  const findings = summary.filed.map(note => toFinding(note, {steps: note.trail, session: {persona: plan.persona?.name || '', seed: plan.seed, snapshot: session.snapshot || ''}}));
  const observations = {};
  for (const row of summary.goals) if (row.verdict !== 'worked') (observations[row.group] ||= []).push(`${row.label}: ${row.summary}`);
  return {summary, findings, observations, trace, spent, notes, stopped: stoppedByBroker || 'goals'};
}
