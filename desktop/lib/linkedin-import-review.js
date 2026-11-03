// "What came in from LinkedIn" (spec docs/superpowers/specs/2026-11-03-linkedin-profile-import-design.md, "Merging"): the rows the person ticks, built from what LinkedIn
// returned and what they already have, and what ticking saves. Pure, no AI of its own: which of their roles a LinkedIn position is, and which bullets add something, is the
// AI match of lib/experience.js (fixed integers the code validates). Invariants: nothing is added until a row is ticked; a Your details line that has a value and differs
// is unticked and never replaces; the main CV is never edited; Birth Date and the other unmapped columns never leave the fetch. Guard: test/linkedin-import-review.test.js.

export const DETAIL_COLUMNS = {first_name: 'First Name', last_name: 'Last Name', location: 'Geo Location', street: 'Address', postal_code: 'Zip Code', website: 'Websites'};
const norm = text => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const list = text => String(text || '').split(',').map(part => part.trim()).filter(Boolean);
// LinkedIn writes websites as "[PERSONAL:https://a.example,BLOG:https://b.example]": the first address.
const firstUrl = text => (String(text || '').match(/https?:\/\/[^\s,\]]+/) || [''])[0];
const roleKey = (job, role) => [job.company, role.title, role.period].map(norm).join('|');
const eduKey = e => [e.school, e.degree].map(norm).join('|');
const valueOf = (key, text) => (key === 'website' ? firstUrl(text) : String(text || '').trim());

/** The Your details rows: an empty line LinkedIn can fill (ticked), or a line with another value (shown with both, unticked). Same values are left out. */
export function detailRows(profileRow, contact = {}) {
  const rows = [];
  for (const [field, column] of Object.entries(DETAIL_COLUMNS)) {
    const linkedin = valueOf(field, profileRow?.[column]);
    if (!linkedin) continue;
    const current = String(contact[field] || '').trim();
    if (!current) rows.push({id: `d:${field}`, kind: 'detail', field, current: '', linkedin, chip: 'new', ticked: true});
    else if (norm(current) !== norm(linkedin)) rows.push({id: `d:${field}`, kind: 'detail', field, current, linkedin, chip: 'differs', ticked: false});
  }
  return rows;
}

/**
 * The review. main: the person's main CV or null (the CV step: everything is new); cv: LinkedIn's, in the app's schema; match: lib/experience.js's, one entry per LinkedIn role in
 * order (sourceRole, mainJob, mainRole, newBullets). -> {positions, education, skills, languages, details, have: {skills, languages, education}}; a row = {id, kind, label, sub, chip, ticked}.
 */
export function buildReview({main, cv, match = [], profileRow = null, contact = {}, known = null}) {
  const knownRoles = new Set((known?.jobs || []).flatMap(job => job.roles.map(role => roleKey(job, role))));   // already imported before: not offered again (an Update shows only what is new)
  const positions = [];
  let at = 0;
  cv.jobs.forEach((job, j) => job.roles.forEach((role, r) => {
    const m = match.find(entry => entry.sourceRole === at) || {mainJob: -1, newBullets: []};
    const matched = !!main && m.mainJob >= 0;
    const chip = !matched ? 'new' : m.newBullets.length ? 'new-bullets' : 'same';
    if (chip !== 'same' && !knownRoles.has(roleKey(job, role))) positions.push({id: `p:${j}:${r}`, kind: 'position', job: j, role: r, sourceRole: at, label: `${role.title} · ${job.company}`, sub: role.period,
      chip, newBullets: m.newBullets.length, ticked: true});
    at++;
  }));
  const haveSchools = new Set((main?.education || []).map(e => norm(e.school)));
  const knownSchools = new Set((known?.education || []).map(eduKey));
  const education = (cv.education || []).map((e, i) => ({id: `e:${i}`, kind: 'education', index: i, label: [e.degree, e.school].filter(Boolean).join(' · '), sub: e.period, chip: 'new', ticked: true,
    have: haveSchools.has(norm(e.school)) || knownSchools.has(eduKey(e))})).filter(row => !row.have);
  const haveSkills = new Set([...list(main?.skills), ...list(known?.skills)].map(norm));
  const skills = list(cv.skills).filter(s => !haveSkills.has(norm(s)));
  const haveLanguages = new Set([...list(main?.languages), ...list(known?.languages)].map(item => norm(item.replace(/\(.*\)/, ''))));
  const languages = list(cv.languages).filter(item => !haveLanguages.has(norm(item.replace(/\(.*\)/, ''))));
  return {
    positions, education: education.map(({have, ...row}) => row),
    skills: skills.map((s, i) => ({id: `s:${i}`, kind: 'skill', label: s, chip: 'new', ticked: true})),
    languages: languages.map((l, i) => ({id: `l:${i}`, kind: 'language', label: l, chip: 'new', ticked: true})),
    details: detailRows(profileRow, contact),
    have: {skills: list(cv.skills).length - skills.length, languages: list(cv.languages).length - languages.length, education: (cv.education || []).length - education.length},
  };
}

/** The ticked rows (ids) -> {cv, match, details}: LinkedIn's CV cut to what was picked, its match re-indexed to the picked roles, and the Your details values to save. */
export function applyPicks({cv, match = []}, review, ticked) {
  const on = new Set(ticked);
  const keep = rows => rows.filter(row => on.has(row.id));
  const roles = new Set(keep(review.positions).map(row => row.sourceRole));
  const jobs = [], newMatch = [];
  let at = 0;
  for (const job of cv.jobs) {
    const kept = [];
    for (const role of job.roles) {
      if (roles.has(at)) { kept.push(role); const m = match.find(entry => entry.sourceRole === at); newMatch.push({sourceRole: newMatch.length, mainJob: m?.mainJob ?? -1, mainRole: m?.mainRole ?? -1, newBullets: m?.newBullets || []}); }
      at++;
    }
    if (kept.length) jobs.push({...job, roles: kept});
  }
  const picked = {jobs, match: newMatch};
  const education = keep(review.education).map(row => cv.education[row.index]);
  if (education.length) picked.education = education;
  const skills = keep(review.skills).map(row => row.label);
  if (skills.length) picked.skills = skills.join(', ');
  const languages = keep(review.languages).map(row => row.label);
  if (languages.length) picked.languages = languages.join(', ');
  const details = Object.fromEntries(keep(review.details).map(row => [row.field, row.linkedin]));
  return {cv: {name: cv.name, summary: cv.summary, location: cv.location, ...picked, jobs}, match: newMatch, details};
}

/**
 * What the one LinkedIn source holds after an Add: what it held before plus the picked rows (never less). old: the saved source {cv, match} or null; picked: applyPicks' {cv, match}.
 * Why (independent review, 3 Nov 2026): saving only the picked rows used to replace the source, so an Update that ticked one skill deleted every earlier import.
 */
export function mergeSource(old, picked) {
  if (!old?.cv) return picked;
  let at = 0;
  const jobs = old.cv.jobs.map(job => ({...job, roles: job.roles.map(role => ({role, m: (old.match || []).find(entry => entry.sourceRole === at++)}))}));
  at = 0;
  for (const job of picked.cv.jobs) {
    let target = jobs.find(j => norm(j.company) === norm(job.company));
    if (!target) { target = {...job, roles: []}; jobs.push(target); }
    for (const role of job.roles) {
      const m = picked.match.find(entry => entry.sourceRole === at++);
      if (!target.roles.some(x => roleKey(target, x.role) === roleKey(job, role))) target.roles.push({role, m});
    }
  }
  const match = [];
  const union = (a, b) => { const seen = new Set(); return [...list(a), ...list(b)].filter(item => !seen.has(norm(item)) && seen.add(norm(item))).join(', '); };
  const education = [...(old.cv.education || [])];
  for (const e of picked.cv.education || []) if (!education.some(x => eduKey(x) === eduKey(e))) education.push(e);
  const outJobs = jobs.map(job => ({...job, roles: job.roles.map(({role, m}) => { match.push({sourceRole: match.length, mainJob: m?.mainJob ?? -1, mainRole: m?.mainRole ?? -1, newBullets: m?.newBullets || []}); return role; })}));
  return {cv: {...old.cv, jobs: outJobs, education, skills: union(old.cv.skills, picked.cv.skills), languages: union(old.cv.languages, picked.cv.languages)}, match};
}
