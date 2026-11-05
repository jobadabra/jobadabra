// The AI user agent's named plans: a short, fixed list of goals per tester bug (what a person would simply try), for the replay proof, and the switch that takes a rule out of what the agent knows.
// Job: report health
// Why (3 Nov 2026, AI user agents 8/12; spec "Proof"): the proof replays this week's four tester bugs on the commit before each fix. A plan names what a person does on the screen and never the defect, so the agent has to notice it;
// the rule each bug broke is in docs/app-expectations (written from the fix PRs), so a run WITH the rule measures whether the agent applies it, and a run WITHOUT it (`withoutRules`) measures whether it finds the bug unprompted.

/** Plan id -> the rule its bug broke, the data the app needs for it (`data`: `cv` = a CV shape of lib/agent-persona.mjs, `inbound` = how many mail-lead rows; lib/agent-seed.mjs) and the goals (area = the knowledge file's area). The ids are the proof's four bugs: three from #3027 (the commit before it is b4d64112), one from #3026 (before it b6014b04). */
export const NAMED_PLANS = {
  'learned-questions': {rule: 'profile-1', data: {cv: 'headingLines'}, goals: [{group: 'Profile', label: 'Open What we learned and go through the questions it asks you, one by one'}]},
  'saved-answers': {rule: 'profile-2', data: {cv: 'headingLines'}, goals: [{group: 'Profile', label: 'Open What we learned and read the answers it shows as already saved'}]},
  'languages': {rule: 'profile-3', data: {cv: 'manyLanguages'}, goals: [{group: 'Profile', label: 'Open What we learned and answer the question it asks about the languages you speak'}]},
  'inbound': {rule: 'jobs-3', data: {inbound: 3}, goals: [{group: 'Jobs', label: 'Open the Inbound list and read each row, then find the same job in the Jobs list and compare them'}]},
  // Why (5 Nov 2026, AI user agents FR 3/4, owner: a session told only "fill up all my details and report what you see" filed 8 real messages; replays 41935417039, 41938143953: 7 navigation goals of ~14 steps ended could-not-finish): one open task like a person's, with the data of two bugs in the app and all the steps. Its goal names no defect.
  // Why (5 Nov 2026, AI user agents tuning, Opus read of the first 12 notes: none was the planted bug and no goal had opened the Board): the Board lists each job as a card with a chip; this goal opens it and reads the cards, naming no defect. Same data and rule as 'inbound' (jobs-3).
  'board': {rule: 'jobs-3', data: {inbound: 3}, goals: [{group: 'Jobs', label: 'Open the Jobs Board and read each card, the chip on it and the column it sits in'}]},
  'fill-details': {rule: 'profile-1', data: {cv: 'headingLines', inbound: 3}, goals: [{group: 'Profile', label: 'Fill in all my details from my CV in the app, then go through my jobs and my inbound list as I would; if something looks off, note it'}]},
};

// Why (4 Nov 2026, AI user agents FR 3/4, owner: "All four now"): the free goals found 0 of the 4 tester bugs on the commit before each fix because the suite's one applicant never has the data a bug needs (a CV with headings, a many-language line, mail leads). Each night puts ONE of these shapes in the app, picked by the night's seed,
// before the free goals; the goals and the rules stay free, so the shape only makes the bug reachable and the agent still has to notice it. The data keys are the ones of NAMED_PLANS above (lib/agent-seed.mjs reads both).
/** Shape id -> the data the app needs for it. */
export const SHAPES = {
  headings: {cv: 'headingLines'},
  languages: {cv: 'manyLanguages'},
  inbound: {inbound: 3},
};

/** The shape a night seeds: AGENT_SHAPE when it names one, 'none' (or a named plan, which seeds its own data) = no shape, empty = the one the seed picks (the seed number modulo the shape count). An unknown name throws and says which exist. */
export function shapeFor(seed, wanted = '', planId = '') {
  const ids = Object.keys(SHAPES), name = String(wanted || '').trim();
  if (planId || name === 'none') return '';
  if (!name) return ids[Math.floor(Math.abs(Number(seed))) % ids.length || 0];
  if (!Object.hasOwn(SHAPES, name)) throw new Error(`no shape "${name}": the shapes are ${ids.join(', ')}, or none`);
  return name;
}

/** A named plan as the session's plan: `{seed, persona: {name}, goals: [{n, group, label, pair}], newShare, changedAreas}`. Throws on an unknown id and says which exist. */
export function namedPlan(id, seed) {
  const plan = NAMED_PLANS[id];
  if (!plan) throw new Error(`no named plan "${id}": the plans are ${Object.keys(NAMED_PLANS).join(', ')}`);
  return {seed, persona: {name: `named plan ${id}`}, goals: plan.goals.map((goal, i) => ({n: i + 1, group: goal.group, label: goal.label, pair: `named plan ${id}`})), newShare: 1, changedAreas: []};
}

/** The rule ids to take out of what the agent knows, from a comma list ("profile-1, jobs-3"); empty = none. */
export const rulesOff = text => String(text || '').split(',').map(id => id.trim()).filter(Boolean);

/** `expectations` ({area: [{id, …}]}) without the entries named in `off`: the agent then neither reads them nor may cite them. */
export const withoutRules = (expectations, off) => Object.fromEntries(Object.entries(expectations).map(([area, entries]) => [area, entries.filter(entry => !off.includes(entry.id))]));
