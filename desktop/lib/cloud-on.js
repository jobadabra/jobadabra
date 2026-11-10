// Which installs may use Full automation in the cloud at all (cloud browser runner cs 4/4): a real install of the person's own (not the twin, the demo, a test, CI or a smoke run) with Always on
// (on our servers or the person's own GitHub, as Apply readiness: lib/job-actions-handlers.js). A leaf: the quit dialog and the hand-over both ask it. Guard: test/unit/main/cloud-quit.test.js.
import {state as hostedSearch} from './hosted-search.js';
import {isTwin} from './twin.js';

const NOT_HERE = ['JOBADABRA_DEMO', 'JOBADABRA_E2E', 'JOBADABRA_SMOKE', 'CI'];

/** A real install of the person's own: not the twin, the demo, a test, CI or a smoke run. */
export const realInstall = () => !isTwin() && !NOT_HERE.some(name => process.env[name]);
/** Always on on a real install: the cloud may take its Full automation items. */
export const cloudOn = storage => realInstall() && (!!storage.settings().cloud?.repo || !!hostedSearch(storage).on);

