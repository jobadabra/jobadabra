// Send one AI persona run (its pictures, its video, then its record) to the private store behind the Admin "AI persona" tab, with CI's narrow REPLAYS_PUBLISH_KEY; never throws.
// Job: report health
// Why (4 Nov 2026, AI user agents 9/12 part 2b): the record goes LAST so the tab never lists a run whose pictures or video are still missing; a file the store refuses is named in the output and the rest still go.
// A local run sends nothing (the screenshots show the app's demo data on this Mac). JP_CI_ROWS_DRY=1|true: say what would go, send nothing. Guard: e2e/test/pool/agent-run-upload.test.mjs.
import fs from 'node:fs';
import path from 'node:path';

export const AGENT_RUN_SITE = 'https://www.jobadabra.top/agent/run';
const TYPES = {'run.json': 'application/json', 'video.webm': 'video/webm', png: 'image/png'};

/** The files of a run in the order they go: pictures, the video, the record last. `dir`: the artifacts folder holding agent-run.json, shot-N.png and agent-video.webm. -> [{name, path, type}] */
export function runFiles(dir) {
  const have = name => fs.existsSync(path.join(dir, name));
  const shots = fs.existsSync(dir) ? fs.readdirSync(dir).filter(name => /^shot-\d{1,2}\.png$/.test(name)).sort((a, b) => parseInt(a.slice(5), 10) - parseInt(b.slice(5), 10)) : [];
  return [...shots.map(name => ({name, path: path.join(dir, name), type: TYPES.png})),
    ...(have('agent-video.webm') ? [{name: 'video.webm', path: path.join(dir, 'agent-video.webm'), type: TYPES['video.webm']}] : []),
    ...(have('agent-run.json') ? [{name: 'run.json', path: path.join(dir, 'agent-run.json'), type: TYPES['run.json']}] : [])];
}

/** Upload the run in `dir` as GitHub run `run`. -> one line for the job's log. */
export async function uploadAgentRun(dir, run, {env = process.env, fetcher = fetch} = {}) {
  const why = !env.CI ? 'a local run: the files stay on the Mac' : !env.REPLAYS_PUBLISH_KEY ? 'no REPLAYS_PUBLISH_KEY in this run' : !/^\d{6,15}$/.test(String(run || '')) ? 'no run id' : '';
  if (why) return `agent run: not sent (${why})`;
  const files = runFiles(dir);
  if (!files.some(file => file.name === 'run.json')) return 'agent run: nothing to send (no agent-run.json)';
  if (['1', 'true'].includes(String(env.JP_CI_ROWS_DRY || '').toLowerCase())) return `agent run: dry run: would send ${files.map(file => file.name).join(', ')}`;
  const sent = [], refused = [];
  for (const file of files) {
    try {
      const answer = await fetcher(`${AGENT_RUN_SITE}?run=${run}&file=${file.name}`, {method: 'PUT', headers: {Authorization: `Bearer ${env.REPLAYS_PUBLISH_KEY}`, 'Content-Type': file.type, 'X-Caller': 'agent-run-upload'},
        body: fs.readFileSync(file.path), signal: AbortSignal.timeout(120000)});
      (answer.ok ? sent : refused).push(answer.ok ? file.name : `${file.name} (${answer.status})`);
    } catch (error) { refused.push(`${file.name} (${String(error?.message || error).slice(0, 60)})`); }
  }
  return `agent run: sent ${sent.length} of ${files.length} files to /admin/ai-persona${refused.length ? `; not sent: ${refused.join(', ')}` : ''}`;
}
