// LinkedIn jobs on every Find jobs, PR 2/3: the real seams of the step (lib/linkedin-headless.js) for this app: the owned browser, visits.runAll, the engine's list of
// searches (src.desktop linkedin-searches, the strategy's own words) and the existing light scoring run. Registered once by the visits handlers (lib/search-beside.js).
// `deps` lets a test inject every seam; nothing here starts a browser until the switch is on and a Find jobs is pressed.
import {linkedinReadBrowser} from './linkedin-browser.js';
import {linkedinStep} from './linkedin-headless.js';
import {extensionToken} from './server-env.js';
import * as pipeline from './pipeline.js';
import {refresh as realRefresh} from './linkedin-refresh.js';
import * as visits from './visits.js';
import {log as appLog} from './log.js';

/** -> {step(signal, onLine), searches(), score(fits, onLine)} for withBeside (lib/search-beside.js). */
export function linkedinSeams(storage, {browser = null, readBrowser = linkedinReadBrowser, readSession, runEngine = pipeline.run, run = visits.runAll, end = visits.done, port = Number(process.env.JOBADABRA_PORT || 47111), refresh = realRefresh,
  openCdp} = {}) {   // openCdp: the tab's CDP opener; left out, linkedinStep's own (lib/cdp-session.js). A stand-in browser passes its own (integration/app/linkedin-read.test.js)
  const searches = async () => {
    const {code, stdout} = await runEngine(storage, ['src.desktop', 'linkedin-searches']).catch(() => ({code: 1, stdout: ''}));
    try { return code === 0 ? JSON.parse(String(stdout).trim().split('\n').pop()).searches || [] : []; } catch { return []; }
  };
  // Why (#3711, 10 Nov 2026): each read gets its OWN short-lived browser (lib/linkedin-browser.js), deleted when the step ends: the kept, shared profile is where the session leaked to disk.
  const step = async (signal, onLine) => {
    const own = browser || readBrowser(storage);
    try {
      return await linkedinStep({storage, browser: own, openCdp, run, end, ...(readSession ? {readSession} : {}), tee: onLine, signal, searches, port, token: () => extensionToken(storage), refresh: options => refresh.ask(options)});   // read only when the browser starts (the switch is on)
    } finally {
      if (!browser && !(await own.dispose())) appLog('linkedin-jobs', 'the read browser\'s folder was not removed; the next start removes it', {folder: 'linkedin-read'});
    }
  };
  const score = (fits, onLine) => runEngine(storage, pipeline.visitsArgs(storage, fits), onLine);
  return {step, searches, score};
}
