// Sends the "Nightly skipped" notice for a red main: node nightly-skipped.mjs <the gate's log file>. Called by the redmain step of .github/workflows/desktop.yml; prints the job-log lines; send() itself never throws (the workflow adds `|| echo` for a bug in the builders).
// Job: report health
import fs from 'node:fs';
import {send} from './ci-alert.mjs';
import {nightlyNotice} from './lib/nightly-alert.mjs';

const log = process.argv[2] && fs.existsSync(process.argv[2]) ? fs.readFileSync(process.argv[2], 'utf8') : '';
const {message, summary} = nightlyNotice(log, process.env);
console.log(`::notice title=Nightly skipped::${summary}`);
console.log(`No build tonight: ${summary.replace(/^Nightly skipped: /, '')}. Nothing is built or tested; the next beta re-checks the red suites first.`);
console.log(await send(message, process.env, fetch, {event: 'nightly-skipped'}));
