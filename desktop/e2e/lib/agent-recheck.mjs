// The AI user agent's re-check after a save: read what the app now holds through the ONE shared reader (desktop/lib/desktop-ai-tools.js callTool, the desktop AI's read tools) and check, outside the agent, that no saved value is only a label.
// Job: report health
// Why (3 Nov 2026, AI user agents 3/7; owner: "would the AI user agent be able to read the app data without looking at the UI … or should we better build an MCP that will help also the AI User Agent"; mac-07 relaying: "Yes, one shared reader"):
// the agent sees the tools' redacted, capped text; the harness reads the same sources object UNREDACTED for the label-as-value verdict, so the agent has no raw store access and no write tool. The sources are the window's own
// screen registry (window.jobadabraScreenData, the Send-feedback mechanism), the same function mc's desktopAiSources calls in the running app. Spec: "Re-check (④) is what the explorer lacks".
/* global window */
import {callTool} from '../../lib/desktop-ai-tools.js';

/** The reader's sources for a Playwright page: the window's screen registry, answered as mc's windowScreen answers it (an unloaded app says so, with a note). The key goes in as an argument, never as code. */
export function pageSources(page) {
  const screen = async key => (await page.evaluate(each => (window.jobadabraScreenData ? window.jobadabraScreenData(each) : null), String(key)))
    || {screen: key, source: 'none', data: null, note: 'The app is still loading. Ask again in a moment.'};
  return {screen, questions: async () => {
    const read = await screen('profile:answers');
    return read.source === 'registry' ? read : {...read, note: 'Open Profile → What we learned once so the app loads the questions, then ask again.'};
  }};
}

/** What the AGENT may see of the stored data: a read tool's redacted text (get_open_questions, get_screen_data, ...). -> {text, isError} */
export async function agentRead(page, name = 'get_open_questions', args = {}) {
  return callTool(name, args, pageSources(page));
}

/** The saved answers as the harness checks them, unredacted: [{id, section, question, field, value, verdict}]. [] when the screen is not loaded. */
export async function storedQuestions(page) {
  const read = await pageSources(page).questions();
  return read.data?.questions || [];
}

const norm = text => String(text ?? '').normalize('NFKC').replace(/[\s_:.\-–—*#|]+/g, ' ').trim().toLowerCase();

/**
 * The label-as-value verdicts for saved answers. A saved value is wrong when it is only a name for the thing asked: its own question, its section, its field, or a heading line of the person's CV
 * (`headingLines`, from the persona's own data, never a word list in code). A question with no value is not a finding here (an unanswered question is allowed).
 * -> [{kind: 'value_equals_label' | 'value_is_cv_heading', id, question, value, why}]
 */
export function labelAsValue(questions, {headingLines = []} = {}) {
  const headings = new Set(headingLines.map(norm));
  const found = [];
  for (const item of questions) {
    const value = norm(item.value);
    if (!value) continue;
    const labels = [item.question, item.section, item.field].map(norm).filter(Boolean);
    if (labels.includes(value)) found.push({kind: 'value_equals_label', id: item.id, question: item.question, value: item.value, why: `the saved value "${item.value}" is the same words as the question, its section or its field: a label was saved as an answer`});
    else if (headings.has(value)) found.push({kind: 'value_is_cv_heading', id: item.id, question: item.question, value: item.value, why: `the saved value "${item.value}" is a section heading of the CV, not a fact from it`});
  }
  return found;
}

/** A planted bug for the proof (7/7) and the unit test: the same questions with answer `index`'s value set to its own question, as "Saved: Summary" was. */
export const plantLabelAsValue = (questions, index = 0) => questions.map((item, i) => (i === index ? {...item, value: item.question, verdict: 'confirmed'} : item));

/** One re-check: what the agent sees, and the harness verdicts. -> {agentText, findings, count} */
export async function recheck(page, {headingLines = []} = {}) {
  const [seen, questions] = await Promise.all([agentRead(page), storedQuestions(page)]);
  return {agentText: seen.text, agentError: !!seen.isError, count: questions.length, findings: labelAsValue(questions, {headingLines})};
}
