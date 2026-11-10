// Whether Find jobs may read EURES (the EU job portal) in this app: only an installed beta or stable build, never a run from source, CI or a test.
// Why (10 Nov 2026, owner: "we should make sure that our algorim/search can be as good as EURES, without using EURES... until then, we shouldn't not rely on EURES";
// "In the beta/stable releases it should be on... But local and on CI ... it should be off"): our own sources are measured without it (the Night search), people keep it.
// The one owner of the rule; lib/pipeline-env.js tells the engine (JOBADABRA_EURES=1, src/features.py 'eures'). Test runs are the ones telemetry already knows (lib/telemetry.js).
import {reportingOff} from './telemetry.js';

/**
 * True only for an installed build (beta, stable or test channel) outside CI and every test run.
 * @param {object} env the app's own environment
 * @param {{packaged?: boolean}} build `packaged`: Electron's app.isPackaged
 * @returns {boolean}
 */
export function euresOn(env = process.env, {packaged = false} = {}) {
  return packaged && !reportingOff(env, {packaged});
}
