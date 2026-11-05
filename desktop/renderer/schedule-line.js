// The schedule line under a task on the Actions page: "runs every 4 h · next Today 05:29", from the real schedule (Settings → Automation) and the next run the app computes. Guarded by test/unit/renderer/actions-layout.test.js.
export const DEFAULT_SCHEDULE = {search: 4, mail: 3};

// The saved schedule with ONE choice changed. Why (5 Nov 2026, owner: the person sees Find jobs and Gmail only): the old
// save wrote this screen's defaults for every task, and its scout default (daily) differs from the app's (lib/cadence.js: off for new
// installs), so changing any row on a new install switched the separate employer run on. Only what the person changed is written.
export const scheduleWith = (saved, kind, value) => ({...(saved || {}), [kind]: value});
const dayWord = (date, now) => {
  if (date.toDateString() === now.toDateString()) return 'today';
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return date.toDateString() === tomorrow.toDateString() ? 'tomorrow' : date.toLocaleDateString([], {weekday: 'short'});
};
export function scheduleLine(value, nextAt, now = new Date()) {
  if (value === undefined || value === null || value === '') return '';
  if (String(value) === '0' || value === 'off') return 'Runs on demand';
  const every = value === 'daily' ? 'runs daily' : `runs every ${value} h`;
  const date = nextAt ? new Date(nextAt) : null;
  if (!date || Number.isNaN(date.getTime())) return every;
  return `${every} · next ${dayWord(date, now)} ${date.toTimeString().slice(0, 5)}`;
}
