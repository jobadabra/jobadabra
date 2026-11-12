// On-time starts for the pipeline's schedules (5 Oct 2026). GitHub's own scheduler is best-effort: the nightly build started six hours late two days running and the
// 09:47 e2e run never appeared. Cloudflare's cron triggers fire on time, so they start the workflows through the API; GitHub's crons stay in the workflow files as a
// backup (a second start finds nothing new to build, and the e2e plan caps runs per commit).
//
//   desktop.yml  -nightly: true    the nightly build, at 04:00 Zurich (the build runs only when the app changed since the last release)
//   e2e.yml      -scheduled: true  the three-a-day journey runs, planned exactly as the schedule event plans them
//   e2e.yml      -night_pass: n/5  the night burn-in: five full runs at fixed UTC times (NIGHT_SLOTS below), each on the commit of pass 1
//   self-heal-stats.yml            the numbers on the owner's /self-heal page, every 3 hours (GitHub's schedule left them 5-6 hours old on 5 Oct 2026)
//   search-personas.yml           the Search check's night run (SEARCH_SLOT below) and its week, 5 runs a person (SEARCH_WEEKLY)
//   press-tapes-auto.yml          the day's catch-all re-record of the Find jobs recordings (TAPES_SLOT below) and the hourly look that records only when many people have a gap (TAPES_CHECK below)
//   pr-verdict.yml                repairs pending PR verdicts every 10 minutes; shares the stats trigger to stay within the account limit
//   pr-labels.yml                 sets every open PR's Gitar label from Gitar's latest comment every 10 minutes (7 Nov 2026, gl): Gitar closes a finding by editing its comment, which starts no event
//   (site-replays.yml is no longer started here since 17 Oct 2026: replays are for debugging, by hand)
// One trigger for the night's four UTC hours (00-03): Cloudflare's free plan allows 5 cron triggers per ACCOUNT (other Workers hold 2), a sixth could not be registered
// (5 Oct 2026), and a 4th trigger for this Worker was refused (14 Oct 2026): the hour that is 02:00 in Zurich starts the replay gate, the one that is 04:00 the nightly.
// Why (31 Oct 2026, owner, "Worker cron"): GitHub never started #2648's sweep on schedule; reuse the stats trigger, keeping its UTC slots below.
export const CRONS = ['0 0,1,2,3 * * *', '47 21,23,1 * * *', '*/10 * * * *'];

// The night burn-in's five passes (UTC, HH:MM), spread over the night, never back to back. Each is the beta's own layout on the commit of pass 1 (e2e.yml input night_pass, desktop/e2e/lib/night-pass.mjs).
// Why (31 Oct 2026, owner: "Spread the 5 burn-in passes over the night at different hours, not back to back (keeps PR CI free by day, and catches time-of-day flakes like calendar's)"; a8 with the coordinator):
// they ride the ten-minute trigger, as the stats start does, because a 4th trigger for this Worker cannot be registered (the account's 5 are used; see CRONS above).
export const NIGHT_SLOTS = ['21:00', '23:30', '01:30', '03:30', '05:30'];
// The daily AI user agent session (ai-user-agents.yml), UTC HH:MM. Why (3 Nov 2026, AI user agents 7/12; owner: "start it now"): it rides the ten-minute trigger like the night passes (a 4th trigger cannot be registered),
// at an hour no pass, stats start or beta uses (the passes are above; stats start at minute 40 of hours divisible by 3; 04:40 is none of them), so its AI calls never queue behind another night job's.
export const AGENT_SLOT = '04:40';
// The night's Search check (search-personas.yml), UTC HH:MM. Why (4 Nov 2026, owner: "Night run, off PRs"): it rides the ten-minute trigger too, at the broker's quietest hour: 0 and 2 calls in the 00 hour of the last two nights.
// Six presses in a row took 26-29 min on 5-6 Nov 2026 (runs 41938128120, 42133678718; 33-44 min on 4 Nov), so 18 take about 80-85 min and it ends about 01:25: close to the 01:30 pass (6 Nov 2026, 4/5). TODO(AI): move this slot earlier or start the pass later if the two overlap (6 Nov 2026); the scout at about 02:30 and AGENT_SLOT come later.
export const SEARCH_SLOT = '00:00';
// The day's one re-record of the Find jobs recordings (press-tapes-auto.yml), UTC HH:MM. Why (12 Nov 2026, owner, asked via AskUserQuestion by sa: "Report only, live decides (Recommended)": "recordings are renewed
// once after a day's merges instead of after each merge"): it rides the ten-minute trigger, after the night's passes (the last starts 05:30) and after Thursday's Search week (SEARCH_WEEKLY below: 03:00, about 7 h, ends about 10:00), which would
// hold the broker past the re-record guard's 5 h wait and end that day's run red (Gitar on #3899, 12 Nov 2026); a by-hand Search check still makes its guard wait.
export const TAPES_SLOT = '10:30';
// The hourly look at how stale the recordings are (press-tapes-auto.yml input min_gaps), at this minute of every hour except TAPES_SLOT's, UTC. Why (13 Nov 2026, owner, asked via AskUserQuestion by mac-9a:
// "When the replay finds many empty": "The daily replay re-records by itself when it sees several people with 0 jobs, then re-runs. It only spends a run when the recordings are stale."; rejected: "By hand after merge
// batches", "Add a second daily slot"): on 12 Nov 22 search merges landed after the 16:20Z re-record and the replay read 0 jobs for 14 of 18 people. The look is the workflow's offline gap check (no AI call); below `minGaps`
// people with a gap it ends with one summary line, at or above it records them and replays again. The line, 12 of 18 (Why, 13 Nov 2026): the gap check read 12-18 people (median 15) on each of the 17 checks of 12 Nov, a day of about 60 search
// merges, so a line near 6 would re-record every 2-3 h on a busy day (the 8 re-records a day that "saved Codex-plan calls" ended on 12 Nov); 12 is the lowest count seen on that stale day and two thirds of the people. A quiet day stays under it, and the
// 10:30 run records whatever gap is left. And at most one hourly re-record every 6 h (owner, 13 Nov 2026, asked via AskUserQuestion by mac-9a: "At most one every 6 h"; the workflow reads the last start from its own runs); the 10:30 run does not wait for it, and its recording starts the 6 h. TODO(AI): read the count right after a full re-record (about 0-2 expected, not yet measured: no check ran between a re-record and the next merges) and lower the line if the day's tail stays stale (13 Nov 2026).
export const TAPES_CHECK = {minute: 30, minGaps: 12};
export const STORE_WATCH_MINUTE = 20;
// The weekly Microsoft Store submission (msix-store-weekly.yml), Monday, UTC HH:MM. Why (7 Nov 2026, owner: "Weekly, a fixed day"; "To release less often on Microsoft store"): Microsoft took 5 days to certify
// one version while a stable came out every day. It rides the ten-minute trigger (a 4th trigger cannot be registered), after the night's passes (the last starts 05:30) and the AI agent (04:40).
export const STORE_WEEKLY = {day: 1, time: '07:00'};
// The Search check's week (search-personas.yml, 5 runs a person), UTC day + HH:MM. Why (11 Nov 2026, owner via AskUserQuestion in session sa: "2 runs nightly, 5 runs weekly
// (Recommended)"; "each of the runs should provide new jobs"): about 7 h of the one-at-a-time group, so it starts after the night (00:00, ends about 02:30) and ends long before the
// next; Thursday, the day after the Codex subscription's weekly reset (Wednesday morning), when it has the most room for the week's ~3,000 calls.
export const SEARCH_WEEKLY = {day: 4, time: '03:00'};
const hhmm = date => `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
/** The night pass due at this moment as "n/5", or '' when none. */
export const nightPassAt = date => (NIGHT_SLOTS.includes(hhmm(date)) ? `${NIGHT_SLOTS.indexOf(hhmm(date)) + 1}/${NIGHT_SLOTS.length}` : '');

// The hour in Zurich (0-23) at this moment: 04:00 all year, whether UTC+1 or UTC+2.
export const zurichHour = date => Number(new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/Zurich', hour: '2-digit', hourCycle: 'h23'}).format(date));

export function jobsFor(cron, now = new Date()) {
  if (cron === '0 0,1,2,3 * * *' || cron === '0 2,3 * * *' || cron === '0 2 * * *' || cron === '0 3 * * *') {   // the night's UTC hours: 02:00 Zurich = the replay gate, 04:00 = the nightly
    const hour = zurichHour(now);
    return hour === 4 ? [{workflow: 'desktop.yml', inputs: {nightly: 'true'}}] : [];
  }
  if (cron === '47 21,23,1 * * *') return [{workflow: 'e2e.yml', inputs: {scheduled: 'true'}}];   // the site replays run once a day (the 02:00 Zurich hour above), no longer beside each e2e run (owner, 17 Oct 2026)
  if (cron === '*/10 * * * *') {
    const jobs = [{workflow: 'pr-verdict.yml'}, {workflow: 'pr-labels.yml'}];   // Why (7 Nov 2026, gl, owner: "Redrawn on a timer too"): the Gitar label is stale for at most this tick; with no open PR the run reads none and ends
    if (now.getUTCMinutes() === 40 && now.getUTCHours() % 3 === 0) jobs.push({workflow: 'self-heal-stats.yml', inputs: {scheduled: 'true'}});
    const pass = nightPassAt(now);
    if (pass) jobs.push({workflow: 'e2e.yml', inputs: {night_pass: pass}});
    if (hhmm(now) === AGENT_SLOT) jobs.push({workflow: 'ai-user-agents.yml', inputs: {scheduled: 'true'}});
    if (hhmm(now) === SEARCH_SLOT) jobs.push({workflow: 'search-personas.yml', inputs: {scheduled: 'true'}});
    if (hhmm(now) === TAPES_SLOT) jobs.push({workflow: 'press-tapes-auto.yml'});
    else if (now.getUTCMinutes() === TAPES_CHECK.minute) jobs.push({workflow: 'press-tapes-auto.yml', inputs: {min_gaps: String(TAPES_CHECK.minGaps)}});   // the hourly look, never beside the day's run
    if (now.getUTCDay() === SEARCH_WEEKLY.day && hhmm(now) === SEARCH_WEEKLY.time) jobs.push({workflow: 'search-personas.yml', inputs: {scheduled: 'true', presses: '5'}});
    // Why (5 Nov 2026, owner: "when Microsoft accepts a new release version, I'd like to get a message on telegram"): Microsoft certifies for hours to days, so an hourly look (minute 20) tells him within the hour;
    // it rides this trigger (no 4th trigger can be registered) and costs one Ubuntu minute unless a submitted version waits (msix-store-watch.yml).
    if (now.getUTCMinutes() === STORE_WATCH_MINUTE) jobs.push({workflow: 'msix-store-watch.yml'});
    if (now.getUTCDay() === STORE_WEEKLY.day && hhmm(now) === STORE_WEEKLY.time) jobs.push({workflow: 'msix-store-weekly.yml'});
    return jobs;
  }
  if (cron === '40 */3 * * *') return [{workflow: 'self-heal-stats.yml', inputs: {scheduled: 'true'}}];
  return [];
}

// The title each on-time run shows on GitHub (its run-name), so a person reading Actions sees who started it (6 Oct 2026: the owner looks at GitHub only, and these
// were plain workflow_dispatch runs by their account). desktop.yml's is read by the e2e gate too: keep it. test/watchdog.test.js holds the workflows to these.
// Until 21 Oct 2026 (remove then): site-replays.yml was replay-offline.yml (renamed 14 Oct 2026). A dispatch that finds no such workflow (404) is tried under the other
// name, so neither side of the gap between the merge and this Worker's deploy misses a tick. Test: app-core/test/scheduler.test.js.
export const LEGACY_NAMES = {'site-replays.yml': 'replay-offline.yml'};
const isNotFound = error => /\b404\b/.test(String(error?.message));

export const TITLES = {'desktop.yml': 'Nightly beta', 'e2e.yml': 'E2E check · on time (Worker cron)', 'self-heal-stats.yml': 'Self-heal stats · on time (Worker cron)', 'site-replays.yml': 'Replay check · on time (Worker cron)', 'search-personas.yml': 'Search check · nightly (Worker cron)', 'ai-user-agents.yml': 'AI user agent · nightly (Worker cron)', 'pr-verdict.yml': 'PR verdict sweep · on time (Worker cron)', 'pr-labels.yml': 'PR labels sweep · on time (Worker cron)', 'msix-store-weekly.yml': 'Microsoft Store · weekly submission'};

// dispatch(env, inputs, workflow) starts a workflow on main (index.js); notify(text) tells the owner when it could not, on Telegram; report(text) on GitHub, in the
// watchdog's issue (watchdog.js), where the owner looks. Neither can reach anyone when the token is the problem: the GitHub-side watchdog covers that.
export async function runScheduled(event, env, {dispatch, notify = async () => {}, report = async () => {}, now = new Date(event?.scheduledTime || Date.now())}) {
  const started = [], failed = [];
  for (const job of jobsFor(event.cron, now)) {
    try {
      try { await dispatch(env, job.inputs, job.workflow); }
      catch (error) {
        const legacy = LEGACY_NAMES[job.workflow];
        if (!legacy || !isNotFound(error)) throw error;
        console.log(`scheduled ${job.workflow} not found: starting ${legacy}`);
        await dispatch(env, job.inputs, legacy);
      }
      started.push(job.workflow);
      console.log(`scheduled ${job.workflow} cron=${event.cron}`);
    } catch (error) {
      console.log(`scheduled start failed ${job.workflow} cron=${event.cron}: ${error.message}`);
      // Why (31 Oct 2026, review #2653; 5 Nov 2026, ms): a failed ten-minute sweep (the PR verdicts, and since 7 Nov 2026 the Gitar labels) must not page Telegram and the watchdog issue 144 times a day, nor the hourly Store check 24 times a day; still log and fail the cron.
      if (!['pr-verdict.yml', 'pr-labels.yml', 'msix-store-watch.yml'].includes(job.workflow)) {
        await notify(`⚠️ The scheduled start of ${job.workflow} failed (${event.cron}): ${error.message.slice(0, 200)}. GitHub's own schedule is the backup.`);
        await report(`The Worker's cron (${event.cron}) could not start ${job.workflow}: ${error.message.slice(0, 300)}`).catch(() => {});
      }
      failed.push(`${job.workflow}: ${error.message.slice(0, 120)}`);
    }
  }
  // Loud, after every job had its try: the cron then shows as failed in Cloudflare. 5-6 Oct 2026: the Worker had been created afresh without its secrets, every start
  // was refused (401) for a day, and the warning above needs the Telegram token it also lacked, so each cron reported "success" while nothing started.
  if (failed.length) throw new Error(`scheduled start failed: ${failed.join('; ')}`);
  return started;
}
