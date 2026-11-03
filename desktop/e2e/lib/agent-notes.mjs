// The AI user agent's notes: what it files when it thinks something is a bug. A note is an ARGUMENT (expected, observed, why it matters), is judged cold by a second call, ranked and capped, and becomes one Finder finding.
// Job: report health
// Why (3 Nov 2026, AI user agents 5/11; owner: "in the beginning I think it's fine to report anything what he thinks is a bug, but he should have an argument why he think it's a bug"): a note with no argument is not filed
// (counted as dropped), a replayable-only filter would make the agent a black box, and a flood guard (12 a session, ranked) stands in for a filter until precision is known.
import {NEEDS_HUMAN} from './triage-findings.mjs';

export const TYPES = ['ui', 'ux', 'data', 'performance', 'error'];
/** The Finder's existing kinds plus the two the agent adds (spec "Findings"). */
export const KINDS = ['text', 'functionality', 'wrong-result', 'consistency', 'empty-state', 'unnamed-control', 'slow-no-feedback'];
export const SEVERITIES = ['high', 'medium', 'low'];
/** The most issues one session files; the rest are listed in its report with their arguments. */
export const MAX_FILED = 12;
const MIN_WORDS = 3;

/** The strict shape of a note the model writes (every field required, as the explorer's action schema): `views` are the screens it may name. */
export function noteSchema(views) {
  const text = {type: 'string'};
  return {type: 'object', additionalProperties: false, required: ['type', 'kind', 'severity', 'view', 'title', 'expected', 'observed', 'why'],
    properties: {type: {enum: TYPES}, kind: {enum: KINDS}, severity: {enum: SEVERITIES}, view: {enum: views}, title: text, expected: text, observed: text, why: text}};
}

const words = value => String(value ?? '').trim().split(/\s+/).filter(Boolean).length;
/**
 * Whether a raw note is an argument. -> {ok: true, note} with trimmed fields, or {ok: false, why}. The `expected` must cite a knowledge entry (`knowledgeIds`, e.g. "jobs-3") or name its principle
 * ("general UX: …"): an expectation that is neither is the agent's taste, not an argument. `observed` and `why` need a few words each. A bad type, kind, severity or view is refused, never repaired.
 */
export function validateNote(raw, {knowledgeIds = [], views = null} = {}) {
  if (!raw || typeof raw !== 'object') return {ok: false, why: 'not an object'};
  const note = Object.fromEntries(['type', 'kind', 'severity', 'view', 'title', 'expected', 'observed', 'why'].map(key => [key, String(raw[key] ?? '').trim()]));
  if (!TYPES.includes(note.type)) return {ok: false, why: `type "${note.type}" is not one of ${TYPES.join(', ')}`};
  if (!KINDS.includes(note.kind)) return {ok: false, why: `kind "${note.kind}" is not one of the Finder's kinds`};
  if (!SEVERITIES.includes(note.severity)) return {ok: false, why: `severity "${note.severity}" is not high, medium or low`};
  if (views && !views.includes(note.view)) return {ok: false, why: `view "${note.view}" is not a screen of the app`};
  if (!note.title) return {ok: false, why: 'no title'};
  if (words(note.observed) < MIN_WORDS || words(note.why) < MIN_WORDS) return {ok: false, why: 'no argument: observed and why it matters need a sentence each'};
  const cited = knowledgeIds.find(id => note.expected.includes(id));
  if (!cited && !/^general UX:\s*\S/i.test(note.expected)) return {ok: false, why: 'no argument: expected cites no knowledge entry and names no UX principle'};
  return {ok: true, note: {...note, title: note.title.slice(0, 80), cites: cited || ''}};
}

const SEVERITY_RANK = {high: 0, medium: 1, low: 2};
const JUDGE_RANK = {agrees: 0, unknown: 1, disagrees: 2};
/**
 * Which notes are filed. Low severity is never filed (the Finder's rule, owner 4 Oct 2026: "if we assess it as low, let's not open it"; the agent's nitpicks of wording are low). The rest are ranked
 * proved first, then judge agrees, then severity, then the order the agent noted them, and cut at `cap`. -> {filed, over, low}: `over` and `low` are listed in the report, never silently lost.
 */
export function rankNotes(notes, cap = MAX_FILED) {
  const low = notes.filter(note => note.severity === 'low');
  const ranked = notes.filter(note => note.severity !== 'low').map((note, index) => ({note, index}))
    .sort((a, b) => (Number(!!b.note.proved) - Number(!!a.note.proved)) || ((JUDGE_RANK[a.note.judge] ?? 1) - (JUDGE_RANK[b.note.judge] ?? 1)) || (SEVERITY_RANK[a.note.severity] - SEVERITY_RANK[b.note.severity]) || (a.index - b.index))
    .map(each => each.note);
  return {filed: ranked.slice(0, cap), over: ranked.slice(cap), low};
}

/**
 * A note as the Finder's finding (what a suite pushes to ctx.findings; lib/triage-findings.mjs normalize reads it): the detail carries what was observed and the steps in words, `impact` is why it
 * matters, `expected` is the entry it relies on, and `agent` is what the labels and the replay line need. `steps`: the session's steps so far in words; `session`: {persona, seed, snapshot}.
 */
export function toFinding(note, {steps = [], session = {}} = {}) {
  const trail = steps.slice(-12).map((step, i) => `${i + 1}. ${step}`).join('\n');
  return {view: note.view, severity: note.severity, kind: note.kind, title: note.title, source: 'ai-user-agent',
    detail: `${note.observed}${trail ? `\n\nSteps before it:\n${trail}` : ''}`, impact: note.why, expected: note.expected,
    agent: {type: note.type, persona: session.persona || '', seed: session.seed ?? '', snapshot: session.snapshot || '', judge: note.judge || 'unknown', judgeReason: note.judgeReason || '', proved: !!note.proved, cites: note.cites || ''}};
}

/** The labels the Finder's list is filtered by: the agent type (precision per type), the persona, the second opinion, and `proved`. needs-human is added when the judge disagrees.
 * Why (3 Nov 2026, Gitar on #3073): the seed is NOT a label: triage creates every label in the repo, and a seed per session would grow the label list without end; it is in the issue body's "Who found it" line. */
export function agentLabels(agent) {
  return [`agent-type:${agent.type}`, ...(agent.persona ? [`persona:${agent.persona}`.slice(0, 50)] : []), `judge:${agent.judge || 'unknown'}`,
    ...(agent.proved ? ['proved'] : []), ...(agent.judge === 'disagrees' ? [NEEDS_HUMAN] : [])];
}
