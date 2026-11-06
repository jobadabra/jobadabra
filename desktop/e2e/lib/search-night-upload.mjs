// Send the night's Search check verdict (result/verdict.json, tools/persona-search/gate.py compare) to the private store behind Admin → Job search → Night search, with CI's narrow REPLAYS_PUBLISH_KEY; never throws.
// Job: report health
// Why (6 Nov 2026, owner: "the nightly search persona... I see nowhere in Admin... Am I getting alerted? I'm not alerted"): the verdict stayed a GitHub artifact, so a night that measured 2 of 6 was green and unseen.
// The Worker (PUT /search-check/night, jobadabra-web #461) stores the night, judges it and tells the owner under the Notifications switches, so CI calls nothing else: no /ops/notify, no Telegram.
// A local run sends nothing. JP_CI_ROWS_DRY=1|true: say what would go, send nothing. Counts only in the line it returns. Guard: e2e/test/pool/search-night-upload.test.mjs.
import fs from 'node:fs';

export const SEARCH_NIGHT_SITE = 'https://www.jobadabra.top/search-check/night';
export const MAX_BYTES = 65536;   // the Worker's cap (admin/search-night.js MAX_BYTES): a bigger verdict is named here, not sent to a 413

/** Upload the verdict file `file` as GitHub run `run`, filed under the UTC night of `now`. -> one line for the job's log. */
export async function uploadSearchNight(file, run, {env = process.env, fetcher = fetch, now = new Date()} = {}) {
  const why = !env.CI ? 'a local run: nothing leaves the Mac' : !env.REPLAYS_PUBLISH_KEY ? 'no REPLAYS_PUBLISH_KEY in this run' : !/^\d{6,15}$/.test(String(run || '')) ? 'no run id' : '';
  if (why) return `search night: not sent (${why})`;
  if (!file || !fs.existsSync(file)) return 'search night: nothing to send (no verdict.json)';
  const body = fs.readFileSync(file);
  if (body.length > MAX_BYTES) return `search night: not sent (the verdict is ${body.length} bytes, over ${MAX_BYTES})`;
  const night = now.toISOString().slice(0, 10);
  if (['1', 'true'].includes(String(env.JP_CI_ROWS_DRY || '').toLowerCase())) return `search night: dry run: would send ${body.length} bytes for night ${night}`;
  try {
    const answer = await fetcher(`${SEARCH_NIGHT_SITE}?night=${night}&run=${run}`, {method: 'PUT', headers: {Authorization: `Bearer ${env.REPLAYS_PUBLISH_KEY}`, 'Content-Type': 'application/json', 'X-Caller': 'search-night-upload'}, body, signal: AbortSignal.timeout(60000)});
    if (!answer.ok) return `search night: not sent (the site answered ${answer.status})`;
    const told = await answer.json().catch(() => ({}));
    const counts = Number.isInteger(told.measured) && Number.isInteger(told.total) ? `measured ${told.measured} of ${told.total}${told.dropped ? ', dropped' : ''}` : 'stored';
    return `search night: sent night ${night} (${counts}${told.alert ? `; alert: ${String(told.alert).slice(0, 40)}` : ''}) to /admin/job-search/lab?tab=night`;
  } catch (error) { return `search night: not sent (${String(error?.message || error).slice(0, 60)})`; }
}
