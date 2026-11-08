// Sends one store-failure notice: node store-alert.mjs <chrome-store-publish|msix-store|msix-store-weekly> (env TAG, RUN, GITHUB_REPOSITORY, the alert secrets). Called by the failure steps of the store workflows.
// Job: report health
import {send} from './ci-alert.mjs';
import {storeNotice} from './lib/store-notices.mjs';

const found = storeNotice(process.argv[2], process.env);
if (!found) { console.log(`store-alert: unknown kind ${process.argv[2]}`); process.exit(0); }
console.log(await send(found.message, process.env, fetch, {event: found.event, ...(found.level ? {level: found.level} : {})}));
