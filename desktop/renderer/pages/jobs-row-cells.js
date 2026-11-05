// The Jobs row's company and place cells, drawn from the row model (job-row-model.js): a slot with nothing to say says N/A, and a company not named is a blank avatar.
// Moved out of pages/jobs-render.js (its file-size warning); guarded by integration/app/screen-jobs-inbound.test.js and test/unit/renderer/job-row-model.test.js.
import {el, pill} from '../components.js';
import {icon} from '../icons.js';
import {avatar, shortPlace, workMode} from '../jobs-view.js';
import {NA} from '../job-row-model.js';

// Pill tones: how a job is worked.
const MODE_TONE = {remote: 'good', hybrid: 'info'};

/** The company's logo: its initials on its hue, or a blank avatar when no company is named. Takes the row model's `who`; returns the element. */
function logoOf(who) {
  const logo = avatar(who.name);
  const badge = el('span', `logo${who.blank ? ' is-blank' : ''}`, who.blank ? '' : logo.initials);
  badge.style.setProperty('--hue', logo.hue);
  return badge;
}

/** The company column: logo and name (N/A when none is named). Takes the row model; returns the element. */
export function companyCell(parts) {
  const company = el('div', 'company');
  company.append(logoOf(parts.who), el('span', `name${parts.who.blank ? ' is-na' : ''}`, parts.who.name));
  return company;
}

/**
 * The place column, one line so every row is as tall as the next: "Moldova · Remote" (the mode's pill after the place; both cut with … and read in full on hover).
 * No place named: the line says N/A, so the row is built like every other. Takes the job; returns the element.
 */
export function placeCell(job) {
  const place = el('div', 'place');
  const line = el('div', 'place-line');
  line.append(icon(job.location || !job.work_mode ? 'pin' : 'globe'));
  if (job.location) { const shown = shortPlace(job.location); line.append(Object.assign(el('span', '', shown.text), {title: shown.full || shown.text})); }
  if (job.work_mode) { const mode = workMode(job.work_mode); line.append(pill(mode.label, MODE_TONE[mode.kind] || 'neutral', {title: job.work_mode})); }
  if (!job.location && !job.work_mode) line.append(el('span', 'is-na', NA));
  place.append(line);
  return place;
}
