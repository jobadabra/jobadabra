// node agent-run-upload.mjs <artifacts folder>: after the AI persona session, send its run (pictures, video, record) to the private store behind Admin → Testing → AI persona. GITHUB_RUN_ID and REPLAYS_PUBLISH_KEY come from the workflow. Never fails the job: it prints one line.
// Job: report health
import {uploadAgentRun} from './lib/agent-run-upload.mjs';

const [dir = ''] = process.argv.slice(2);
console.log(await uploadAgentRun(dir, process.env.GITHUB_RUN_ID));
