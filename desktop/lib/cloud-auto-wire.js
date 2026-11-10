// Puts Full automation in the cloud on this Mac (lib/cloud-auto.js, cloud browser runner cs 4/4): which install may send, where its jobs, batch and settings come from, and the outcome take-back that runs
// every minute while an item is out (and once after the start). Registered once from lib/ready-handlers.js, which owns the departure hooks (lock, sleep, shutdown, quit). Nothing here presses Submit.
// Not for the twin, the demo, tests, CI or smoke runs (they never reach the site), and only with Always on. Guard: test/unit/main/cloud-auto.test.js.
import {cloudOn} from './cloud-on.js';
import {extensionStore} from './store/extension-store.js';
import {backgroundApplyFor} from './background-apply-controller.js';
import {createCloudAuto, keepCloudAuto} from './cloud-auto.js';
import {ownKeyFor} from './ready-batch.js';
import {keysOf} from './ai/index.js';
import {applyOf, AUTO_DEFAULTS} from '../renderer/apply-settings-model.js';
import * as site from './ready-site.js';

// The controller is made on first use (it opens the store and the hidden browser's bookkeeping): a start with nothing sent never builds it.
const lazy = get => Object.fromEntries(['candidates', 'send', 'unsend', 'closeLocal', 'take'].map(name => [name, (...args) => get()[name](...args)]));

export const TAKE_EVERY_MS = 60 * 1000;
/**
 * `build(list)`: lib/ready-batch.js buildBatch over this store; `jobs()`: the kept job list. -> the cloud Full automation (lib/cloud-auto.js), registered for the stop paths.
 * With `app` (main's), the outcome take-back starts: after 20 s, then every minute while an item is out.
 */
export function wireCloudAuto({storage, app = null, build, jobs, log = () => {}, background = () => backgroundApplyFor(storage), site: given = site}) {
  const store = extensionStore(storage);
  const auto = createCloudAuto({storage, eligible: () => cloudOn(storage), side: lazy(() => background().cloud), jobs, build, site: given, log,
    kitInfo: async url => { const found = await store.findJob(url); const kit = found ? await store.kit(found.id) : null; return {stage: found?.stage || '', eligible: typeof kit?.eligible === 'boolean' ? kit.eligible : null}; },
    waitMin: () => applyOf(storage.settings()).auto?.waitMin ?? AUTO_DEFAULTS.waitMin,
    ownKey: () => ownKeyFor(storage.settings(), keysOf(storage)),
    markApplied: async (url, why) => (await import('./server-env.js')).localEnv(storage).markApplied(url, why)});
  given.onTaken?.(got => auto.heard(got));   // an outcome taken by any /reads call (the cloud read's own) is written here too
  keepCloudAuto(storage, auto);
  if (app) {
    const timer = setInterval(() => auto.takeBack(), TAKE_EVERY_MS), first = setTimeout(() => auto.takeBack(), 20000);
    timer.unref?.(); first.unref?.();
  }
  return auto;
}
