// node search-night-upload.mjs <verdict.json>: after the nightly Search check's compare step, send its verdict to Admin → Job search → Night search. GITHUB_RUN_ID and REPLAYS_PUBLISH_KEY come from the workflow; a local run sends nothing. Never fails the run.
// Job: report health
import {uploadSearchNight} from './lib/search-night-upload.mjs';

const [file = ''] = process.argv.slice(2);
console.log(await uploadSearchNight(file, process.env.GITHUB_RUN_ID));
