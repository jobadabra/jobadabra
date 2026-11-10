// The AI user agent's screen reader: after a goal, one call reads the words of the screen the goal ended on, without the actor's steps, and names what looks wrong to a first-time person, as notes the second opinion then checks like any other.
// Job: report health
// Why-changed (5 Nov 2026, the Opus read of the first 12 notes: 3 real, 9 not): the reader now checks that both sides of a contradiction count the same set before it reports one, and reads the app's conventions (docs/app-expectations jobs-5, profile-5, settings-3).
// Why (4 Nov 2026, AI user agents FR 3/4, owner: "I want us to trigger it manually, how many times it needs, until we make it work properly"): with the bug's data in the app and its screen opened, the actor still wrote no note (replays 41935417039, 41935578876; the 3 Nov table: named plans with the rule off found 0 of 6).
// The actor is busy with its goal and says "done" on a screen it reached; a reader that only reads one screen's words and asks "does anything here contradict itself or not mean what its place says" is a different judgment, made on the screen as the person sees it. A call that fails or answers in the wrong shape leaves no note (never a guess).
import {KINDS, SEVERITIES, TYPES, validateNote} from './agent-notes.mjs';

const choice = values => ({type: 'string', enum: values});
const MAX_PROBLEMS = 2;

export const SCREEN_SYSTEM = `You read ONE screen of a desktop job-search app, as a person using it for the first time, and say what is wrong on it. You see the words on the screen (and a picture of it when given), and what is known about how the app should behave.
Look for what a person would trip over: two values on the screen that contradict each other (a job marked Applied that also says Not checked; a count that does not match the rows listed); an item that is not what its place asks for (a question that is only a bare label such as one word, an answer that is a section heading); an empty list or value where the screen itself shows there is data; a code, an internal word or a raw identifier shown as text; a status that does not match what was just done.
Report only what you can quote from the screen: at most ${MAX_PROBLEMS} problems, the most serious first, and none when the screen holds together. Each problem: type (ui, ux, data, performance, error), kind, severity (high = a wrong result or a false status, medium = confusing, low = wording or taste), view (the page name), a short title, expected (cite a known rule id such as jobs-3, or write "general UX: <the principle>"), observed (a full sentence quoting what the screen shows) and why (what it costs the person).
Before you report a contradiction, check that both sides name the same thing: a count that leaves out one kind of item (inbound jobs, the person's own edits) and a count of everything differ by design, and the rules under "What is known about the app" say so. A state shown because the person opened or pressed something (an open row marked Editing, a filter just switched off) is not a contradiction. A control named in the list of controls has a name: report an unnamed control only when the list shows no label for it. Quote the two sides you compare; when you cannot quote both from this screen, report nothing.
Never report taste, wording that is fine, a guess about the app's insides, or anything not on this screen. Answer with the JSON asked for.`;

// Why-changed (5 Nov 2026, replays 41944858938 and 41944862753): the reader wrote the view as "Jobs", validateNote wants the screen id "jobs", so every problem it found on the Board was refused (0 notes, 2 refused) and the proof run measured nothing; the schema now offers the screens as an enum.
/** The strict answer: a list of at most two problems, each in the shape of an agent note (empty = the screen holds together); `views` (the screens of the app) makes the view field a choice. */
export const screenSchema = (views = null, verify = false, reportProblems = true) => {
  const text = {type: 'string'};
  const problem = {type: 'object', additionalProperties: false, required: ['type', 'kind', 'severity', 'view', 'title', 'expected', 'observed', 'why'],
    properties: {type: choice(TYPES), kind: choice(KINDS), severity: choice(SEVERITIES), view: views?.length ? choice(views) : text, title: text, expected: text, observed: text, why: text}};
  const properties = {problems: {type: 'array', maxItems: reportProblems ? MAX_PROBLEMS : 0, items: problem}, ...(verify ? {completion: choice(['verified', 'incomplete', 'unknown']), completionReason: text} : {})};
  return {type: 'object', additionalProperties: false, required: Object.keys(properties), properties};
};

/** The words a problem quotes from the screen (between double quotes, 3 to 60 characters), in the order it quotes them: the first is the element the problem is about. */
export const quotedWords = text => [...String(text || '').matchAll(/"([^"]{3,60})"/g)].map(match => match[1]);

/**
 * Reads one screen. `ask({system, messages, schema})` is the broker call on the mid tier; `observation` is the screen as the actor sees it (explore.mjs formatObservation: page, words, controls); `goal` the goal just worked; `knowledge` the rules text the actor got;
 * `image` an optional base64 PNG. -> {notes, refused, ms, usage}: `notes` are the problems that passed lib/agent-notes.mjs validateNote (same argument bar as the actor's own notes), `refused` the reasons the others did not; a call that fails gives no notes and `failed`.
 */
export async function readScreen({ask, observation, goal, knowledge = '', knowledgeIds = [], views = null, image = '', now = Date.now, verify = false, reportProblems = true}) {
  const started = now(), prompt = `Goal the person was working on: ${goal.label} (${goal.group})\n\nWhat is known about the app:\n${knowledge || '(nothing recorded yet)'}\n\nThe screen:\n${observation}`;
  let answer;
  try {
    answer = await ask({system: SCREEN_SYSTEM + (!reportProblems ? '\nThis unchanged screen was already reviewed. Return problems: []; only verify this goal completion.' : '') + (verify ? '\nAlso verify whether the stated goal was actually completed from the observed steps and state. completion is verified only when ALL requested steps and results are evidenced. incomplete means the evidence shows an unmet requirement; unknown means proof is missing. An actor saying done or worked is not evidence. Explain with exact observations in completionReason.' : ''), messages: [{role: 'user', content: image ? [{type: 'image', source: {type: 'base64', media_type: 'image/png', data: image}}, {type: 'text', text: prompt}] : prompt}], schema: screenSchema(views, verify, reportProblems)});
  } catch (error) {
    return {notes: [], refused: [], failed: String(error?.message || error).slice(0, 120), ms: now() - started};
  }
  const text = typeof answer === 'string' ? answer : String(answer?.text ?? '');
  let data = null;
  try { data = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch (error) { data = {parseError: error.message}; }
  const spent = {ms: now() - started, usage: typeof answer === 'object' && answer ? answer.usage : undefined};
  if (!Array.isArray(data?.problems)) return {notes: [], refused: [], failed: 'the screen reader did not answer in the asked shape', ...spent};
  const notes = [], refused = [];
  for (const problem of data.problems.slice(0, reportProblems ? MAX_PROBLEMS : 0)) {
    const checked = validateNote(problem, {knowledgeIds, views});
    if (checked.ok) notes.push(checked.note); else refused.push(`${checked.why}: ${String(problem?.title || '').slice(0, 80)}`);
  }
  return {notes, refused, ...spent, ...(verify ? {completion: ['verified', 'incomplete', 'unknown'].includes(data.completion) ? data.completion : 'unknown', completionReason: String(data.completionReason || 'No completion evidence returned.').slice(0, 240)} : {})};
}
