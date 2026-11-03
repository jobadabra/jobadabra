// What a named plan needs in the app before the agent starts: the persona's own CV (so the CV reads see headings and a many-language line) and inbound rows (mail leads), put in through the app's own paths.
// Job: serve stored answers
// Why (3 Nov 2026, AI user agents 8/12 part 2): the first replays showed two of the four tester bugs unreachable on the suite's fixed applicant ("Languages: no language lines", "0 Inbound, 0 jobs"). Only those shapes are seeded, only for a plan that names them;
// the app's CV read (desktop/lib/cv-queue.js) reads <data folder>/cv.pdf, and rows are written as the Focus suite does (lib/focus-data.mjs addApplication = the store's `applications.create`), never by hand into a file.
import fs from 'node:fs';
import path from 'node:path';
import {cvPdf} from './agent-cv-pdf.mjs';
import {addApplication} from './focus-data.mjs';
import {makePersona} from './agent-persona.mjs';
import {NAMED_PLANS} from './agent-plans.mjs';
import {pollUntil, stepTimeLeft} from './wait-on-state.mjs';

/** The inbound rows of a persona: a recruiter lead waiting for an answer, an agency interview, and a lead whose application is already sent. Fictional employers on the e2e test host only. */
export function inboundRows(person, today = new Date()) {
  const role = person.role;
  return [
    {title: role, via: 'Huxley Partners', stage: 'Recruiter lead', location: person.place, reached_via: 'Email', url: 'https://jobs.e2e.test/huxley/lead', origin: 'Inbound'},
    {title: `Senior ${role}`, via: 'Kestrel Agency', stage: 'Interviewing', url: 'https://jobs.e2e.test/kestrel/senior', origin: 'Inbound'},
    {title: `${role} (team lead)`, via: 'Plover Partners', stage: 'Applied', applied_on: today.toISOString().slice(0, 10), reached_via: 'Email', url: 'https://jobs.e2e.test/plover/lead', origin: 'Inbound'},
  ];
}

// The app's CV read (desktop/lib/cv-queue.js factProposals) is the one call whose first text block opens with the fact list.
const isCvRead = body => { const blocks = body?.messages?.[0]?.content; const last = Array.isArray(blocks) ? blocks[blocks.length - 1] : null; return typeof last?.text === 'string' && last.text.startsWith('<facts>'); };

/** The language line a CV states: "Languages: a, b" on one line, or the lines under a "Languages" heading up to the next blank line. -> '' when it has none. */
export function languageLine(lines) {
  const inline = lines.find(line => /^Languages:\s*\S/.test(line));
  if (inline) return inline.replace(/^Languages:\s*/, '').trim();
  const at = lines.indexOf('Languages');
  if (at < 0) return '';
  const under = [];
  for (const line of lines.slice(at + 1)) { if (!line.trim()) break; under.push(line.trim()); }
  return under.join(', ');
}

/** What a model that read this persona's CV would answer to the app's CV read, in the fixed answer shape: its language line, as the CV states it. */
export function cvReadAnswer(person) {
  const value = languageLine(person.cv.lines);
  return JSON.stringify({facts: value ? [{id: 'languages', value, how: 'stated', reason: 'The CV lists them under its language line.'}] : []});
}

// Why (3 Nov 2026, AI user agents 8/12, owner: "Answer the CV read in the agent suite"): the agent suite's app AI refuses every call (lib/context.mjs, offline AI), so What we learned never held a fact from the CV and two of the four tester bugs
// (a composite language line, a CV heading saved as an answer) could not appear. This answers only the CV read, from the persona's own CV; every other call keeps the suite's answer. Agent suite only, never the e2e answers table.
/** Install the CV-read answer on the suite's AI stand-in, in front of the answer it already has. */
export function answerCvRead(proxy, person) {
  const previous = proxy.canned();
  const answer = cvReadAnswer(person);
  let other = 0;
  proxy.setCanned(async body => {
    if (isCvRead(body)) { console.log('  AI stand-in: the app asked for the CV read; answered from the persona\'s CV'); return answer; }
    if (other++ < 5) {   // so a run says which calls reached the stand-in and whether the read was among them (replay 41664479049 could not tell); a document call's first block is only the PDF, so it is named by its system prompt and its last text
      const blocks = body?.messages?.[0]?.content, lastText = Array.isArray(blocks) ? blocks.filter(block => typeof block?.text === 'string').pop()?.text : blocks;
      const said = value => (typeof value === 'string' ? value : JSON.stringify(value ?? '')).replace(/\s+/g, ' ').slice(0, 80);
      console.log(`  AI stand-in: another call (${other}), left to the suite's answer; system "${said(body?.system)}", text "${said(lastText)}"`);
    }
    return previous ? previous(body) : null;
  });
}

const CV_READ_FILE = ['cv', 'fact-proposals.json'];
const keptRead = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; } };   // a file not there yet, or caught half-written, is "not kept yet", not a failure

/**
 * After a plan that seeded a CV and the window reloaded: wait until the app has kept the answer of its CV read (`cv/fact-proposals.json`), so What we learned shows it when the agent opens it. -> the ms waited, 0 for a plan with no CV.
 * Why (3 Nov 2026, AI user agents 8/12, replay 41665993170): the app asks for that read about 40 s after a load, behind its other background reads, and the agent's one-minute session had already looked at What we learned before the answer was kept.
 * No limit of its own (Rule B): it runs to the step's measured hang cap and, if that ends first, the red names the file it waited for and its last content, never "too slow".
 */
export async function waitCvRead(ctx, planId) {
  if (!NAMED_PLANS[planId]?.data?.cv) return 0;
  const file = path.join(ctx.profile, ...CV_READ_FILE);
  const {ms, value} = await pollUntil(async () => keptRead(file), kept => Boolean(kept), {capMs: stepTimeLeft(), what: `the app keeping the answer of its CV read (${CV_READ_FILE.join('/')})`});
  if (value?.error) console.log(`  the app kept its CV read with an error: ${value.error}`);
  return ms;
}

/**
 * Put the plan's data in the app that `ensureSetUp` built. A plan with no `data` changes nothing. -> a line for the log, or '' when nothing was seeded.
 * `ctx.profile` is the app's data folder, `ctx.data(store, command, args)` the store the app uses. The CV answers are read by the app on the next open of Profile, so the caller reloads the window after.
 */
export async function seedPlanData(ctx, planId, seed) {
  const data = NAMED_PLANS[planId]?.data;
  if (!data) return '';
  const person = makePersona(seed, data.cv ? {shape: data.cv} : {});
  const done = [];
  if (data.cv) {
    fs.writeFileSync(path.join(ctx.profile, 'cv.pdf'), cvPdf(person.cv.lines));
    fs.rmSync(path.join(ctx.profile, 'cv', 'fact-proposals.json'), {force: true});   // the read of the old CV; the app also keys it by the CV's hash, so this only saves a stale file
    answerCvRead(ctx.proxy, person);
    done.push(`CV of ${person.name} (${person.cv.shape}, its read answered)`);
  }
  if (data.inbound) {
    for (const row of inboundRows(person).slice(0, data.inbound)) await addApplication(ctx, row);
    done.push(`${data.inbound} inbound rows`);
  }
  return `seeded for ${planId}: ${done.join(', ')}`;
}
