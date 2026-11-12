// Send the night's Search check verdict (result/verdict.json, tools/persona-search/gate.py compare) to the private store behind Admin → Job search → Night search, with CI's narrow REPLAYS_PUBLISH_KEY; never throws.
// Job: report health
// Why (6 Nov 2026, owner: "the nightly search persona... I see nowhere in Admin... Am I getting alerted? I'm not alerted"): the verdict stayed a GitHub artifact, so a night that measured 2 of 6 was green and unseen.
// The Worker (PUT /search-check/night, jobadabra-web #461) stores the night, judges it and tells the owner under the Notifications switches, so CI calls nothing else: no /ops/notify, no Telegram.
// Why (Gitar on #3337, 6 Nov 2026): a hand run on any branch would be filed as the day's night, could replace the real one and alert; only a run on main is a night (as lab-video-upload.mjs).
// Why (10 Nov 2026, owner: "We should trigger manually, to understand right away the direction"; sa): a by-hand run of all 18 was filed as the day's night and REPLACED the scheduled one; SEARCH_NIGHT_BY_HAND=yes (the workflow sets it when the run is not the scheduled one) sends `&by_hand=1`, which the site stores apart (jobadabra-web: Scoreboard) and never judges or alerts on.
// A local run sends nothing. JP_CI_ROWS_DRY=1|true: say what would go, send nothing. Counts only in the line it returns. Guard: e2e/test/pool/search-night-upload.test.mjs.
import fs from 'node:fs';

export const SEARCH_NIGHT_SITE = 'https://www.jobadabra.top/search-check/night';
// Why (11 Nov 2026, owner via AskUserQuestion in session sa: "2 runs nightly, 5 runs weekly (Recommended)"): the week has its own route, so it can never be filed as (and replace) a night;
// until jobadabra-web serves it, the site answers 404 and the week is one line here.
export const SEARCH_WEEK_SITE = 'https://www.jobadabra.top/search-check/weekly';
export const MAX_BYTES = 65536;   // the Worker's cap (admin/search-night.js MAX_BYTES): a bigger verdict is named here, not sent to a 413

// Why this run sends nothing, or '' when it may. In this order: a local run, a branch other than main, no key, no run id.
function refusal(env, run) {
  if (!env.CI) return 'a local run: nothing leaves the Mac';
  if (env.GITHUB_REF_NAME !== 'main') return `branch ${env.GITHUB_REF_NAME || '(none)'}: only a run on main is a night`;
  if (!env.REPLAYS_PUBLISH_KEY) return 'no REPLAYS_PUBLISH_KEY in this run';
  return /^\d{6,15}$/.test(String(run || '')) ? '' : 'no run id';
}

// What a sent verdict says in the log: the week, a by-hand run, or the night with the site's counts and alert.
function sentLine({week, byHand}, night, told) {
  if (week) return `search week: sent the week of ${night} (5 runs a person) to /admin/job-search/lab?tab=finish`;
  if (byHand) return `search night: sent a by-hand run of ${night} (stored beside the nights, never replaces one) to /admin/job-search/lab?tab=night`;
  const counts = Number.isInteger(told.measured) && Number.isInteger(told.total) ? `measured ${told.measured} of ${told.total}${told.dropped ? ', dropped' : ''}` : 'stored';
  return `search night: sent night ${night} (${counts}${told.alert ? `; alert: ${String(told.alert).slice(0, 40)}` : ''}) to /admin/job-search/lab?tab=night`;
}

// Where this run goes: the week's route (SEARCH_CHECK_SERIES=weekly) or the night's, `&by_hand=1` when the run is not the scheduled one.
function destination(env, run, night) {
  const week = env.SEARCH_CHECK_SERIES === 'weekly', byHand = env.SEARCH_NIGHT_BY_HAND === 'yes';
  const url = week ? `${SEARCH_WEEK_SITE}?week=${night}&run=${run}` : `${SEARCH_NIGHT_SITE}?night=${night}&run=${run}`;
  return {week, byHand, label: week ? 'search week' : 'search night', url: `${url}${byHand ? '&by_hand=1' : ''}`, what: week ? 'the week of' : byHand ? 'a by-hand run' : 'night'};
}

// What goes over the wire: the verdict compact and without `personas`. A file that is not a JSON object goes as it is (the site answers 400 and the line says so).
// Why (12 Nov 2026, owner's alert "Night search: no result last night", run 43124127967): gate.py writes verdict.json indented and with every person's full result under `personas`
// for its own compare; the site reads `rows` and the verdict's own fields only (jobadabra-web admin/search-night.js clean). The first night with all 18 measured was 106,067 bytes
// as written and was not sent; without the copy and the indent it is about 35,000.
function wire(text) {
  let verdict;
  try { verdict = JSON.parse(text); } catch { return Buffer.from(text); }
  if (!verdict || typeof verdict !== 'object' || Array.isArray(verdict)) return Buffer.from(text);
  const {personas: _unread, ...sent} = verdict;
  return Buffer.from(JSON.stringify(sent));
}

/** Upload the verdict file `file` as GitHub run `run`, filed under the UTC night of `now` (SEARCH_CHECK_SERIES=weekly: as the week starting that day, on its own route). -> one line for the job's log. */
export async function uploadSearchNight(file, run, {env = process.env, fetcher = fetch, now = new Date()} = {}) {
  const night = now.toISOString().slice(0, 10), to = destination(env, run, night);
  const why = refusal(env, run);
  if (why) return `${to.label}: not sent (${why})`;
  if (!file || !fs.existsSync(file)) return `${to.label}: nothing to send (no verdict.json)`;
  const body = wire(fs.readFileSync(file, 'utf8'));
  if (body.length > MAX_BYTES) return `${to.label}: not sent (the verdict is ${body.length} bytes, over ${MAX_BYTES})`;
  if (['1', 'true'].includes(String(env.JP_CI_ROWS_DRY || '').toLowerCase())) return `${to.label}: dry run: would send ${body.length} bytes for ${to.what} ${night}`;
  try {
    const answer = await fetcher(to.url, {method: 'PUT', headers: {Authorization: `Bearer ${env.REPLAYS_PUBLISH_KEY}`, 'Content-Type': 'application/json', 'X-Caller': 'search-night-upload'}, body, signal: AbortSignal.timeout(60000)});
    if (!answer.ok) return `${to.label}: not sent (the site answered ${answer.status})`;
    return sentLine(to, night, await answer.json().catch(() => ({})));
  } catch (error) { return `${to.label}: not sent (${String(error?.message || error).slice(0, 60)})`; }
}
