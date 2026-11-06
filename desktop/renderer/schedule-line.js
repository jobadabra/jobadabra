// The schedule line under a task on the Actions page: "runs every 4 h · next Today 05:29", from the real schedule (Settings → Automation) and the next run the app computes. Guarded by test/unit/renderer/actions-layout.test.js.
export const DEFAULT_SCHEDULE = {search: 4, mail: 3};

// The saved schedule with ONE choice changed. Why (5 Nov 2026, owner: the person sees Find jobs and Gmail only): the old
// save wrote this screen's defaults for every task, and its scout default (daily) differs from the app's (lib/cadence.js: off for new
// installs), so changing any row on a new install switched the separate employer run on. Only what the person changed is written.
export const scheduleWith = (saved, kind, value) => ({...(saved || {}), [kind]: value});

/**
 * Where a scheduled job really runs, in the words Schedules shows (owner, 5 Nov 2026: "Yes, say where"). Find jobs: our servers when that Always on is on,
 * else the person's GitHub when theirs is, else this Mac while the app is open. Gmail is always this Mac, while open.
 */
export function whereRuns(kind, {hostedOn = false, cloudRepo = ''} = {}) {
  if (kind === 'mail') return 'This Mac, while open';
  if (hostedOn) return 'Our servers, your Mac can be off';
  if (cloudRepo) return 'GitHub, your Mac can be off';
  return 'This Mac, while open';
}
/** True while our servers really run the search: on, and not paused (14 days idle, trial over, budget, guard: renderer/hosted-words.js). Why (5 Nov 2026, review): "on" alone showed "Our servers" for a paused job. */
export const hostedRuns = hosted => !!hosted?.on && hosted.schedule?.state !== 'paused';
/** "Today 07:00" / "Tomorrow 07:00" / "Mon 07:00" in the person's own time; '' when there is no time or it is not a date (a garbled server answer must not print "Invalid Date"). */
export function nextWord(at, now = new Date()) {
  const date = at ? new Date(at) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  const day = date.toDateString() === now.toDateString() ? 'Today'
    : date.toDateString() === new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toDateString() ? 'Tomorrow'
      : date.toLocaleDateString([], {weekday: 'short'});
  return `${day} ${date.toTimeString().slice(0, 5)}`;
}
/** Find jobs' next run, from where it runs: the server's own time on our servers, else the one the app computes (lib/schedule.js: this Mac, or GitHub's cron). */
export const searchNextAt = ({hostedOn = false, hostedAt = null, appAt = null} = {}) => (hostedOn ? hostedAt : appAt);
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
