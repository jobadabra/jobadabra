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

/** The inbound rows of a persona: a recruiter lead waiting for an answer, an agency interview, and a lead whose application is already sent. Fictional employers on the e2e test host only. */
export function inboundRows(person, today = new Date()) {
  const role = person.role;
  return [
    {title: role, via: 'Huxley Partners', stage: 'Recruiter lead', location: person.place, reached_via: 'Email', url: 'https://jobs.e2e.test/huxley/lead', origin: 'Inbound'},
    {title: `Senior ${role}`, via: 'Kestrel Agency', stage: 'Interviewing', url: 'https://jobs.e2e.test/kestrel/senior', origin: 'Inbound'},
    {title: `${role} (team lead)`, via: 'Plover Partners', stage: 'Applied', applied_on: today.toISOString().slice(0, 10), reached_via: 'Email', url: 'https://jobs.e2e.test/plover/lead', origin: 'Inbound'},
  ];
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
    done.push(`CV of ${person.name} (${person.cv.shape})`);
  }
  if (data.inbound) {
    for (const row of inboundRows(person).slice(0, data.inbound)) await addApplication(ctx, row);
    done.push(`${data.inbound} inbound rows`);
  }
  return `seeded for ${planId}: ${done.join(', ')}`;
}
