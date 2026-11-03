// Which extension copy the app opens its pages in, and why it could not. ONE owner of "the extension is here": the extension's own check-in (it names its id: server.extensionSeen()),
// with the browser-profile scan (lib/extension-install.js installed()) only as the fallback before its first check-in.
// Why (3 Nov 2026, owner: "Turn on LinkedIn doesn't work… I have the extension enabled"): Settings → Connections said Connected (the check-in) while the page opener, which used only the scan,
// found nothing: newer Chrome keeps an unpacked copy in Preferences with no manifest and a path outside the app's own folder, which the scan cannot match. Guard: test/extension-target.test.js.
import {launchOnce} from './chrome-launch-once.js';
import {staleExtension} from './server-env.js';
import {newer} from './updater.js';

/**
 * The copy to open a page of. `seen` = the person's check-in {id, version, at} or null; `found` = installed() entries.
 * -> {id, browser} | null. A check-in's id wins (the browser is the one that holds that id in the scan, else '' = the default Chromium browser); no check-in: the app's own copy, else the first.
 */
export function extensionTarget({seen = null, found = []} = {}) {
  if (seen?.id) return {id: seen.id, browser: found.find(entry => entry.id === seen.id)?.app || ''};
  const copy = found.find(entry => entry.current) || found[0] || null;
  return copy?.id ? {id: copy.id, browser: copy.app || ''} : null;
}

/**
 * Open `page` (e.g. linkedin.html) of the person's extension. `open(url, {browser})` is extension-install.js openInChrome. -> true (opened) | false (the browser would not) | null (no copy to open).
 */
export async function openExtensionPage(page, {seen, found, open}) {
  const target = extensionTarget({seen, found});
  return target ? await open(`chrome-extension://${target.id}/${page}`, {browser: target.browser}) : null;
}

/** Is version `a` strictly older than `b`? One comparator for versions (lib/updater.js newer); a copy newer than the app (a development checkout) is never "older". */
export const olderThan = (a, b) => newer(b, a);

/**
 * Why no page opened, said for the person: 'missing' (the app has never heard from the extension: connect it), 'unknown-copy' (it checked in, but as a copy whose id the app does not
 * know), 'chrome' (it is there: the browser would not open; `note` adds how to update it when its version is strictly older than this app's).
 * -> {reason, note}. A reason that blames the extension is only ever given when the app has not heard from it.
 */
export function noPageReason({seen = null, found = [], latest = ''} = {}) {
  if (!seen && !found.length) return {reason: 'missing', note: ''};
  if (seen && !seen.id && !found.length) return {reason: 'unknown-copy', note: ''};
  const note = seen?.version && latest && olderThan(seen.version, latest) ? staleExtension(seen.version, latest, seen.id) : '';
  return {reason: 'chrome', note};
}

/**
 * Wraps the LinkedIn page opener so a press that opened nothing carries its reason. `open()` -> {opened, …} (launchOnce's answer); `context()` -> {seen, found, latest}, read when it fails.
 */
export function reasonedOpen(open, context) {
  return async () => {
    const result = await open();
    return result.opened ? result : {...result, opened: false, ...noPageReason(context())};
  };
}

/**
 * The LinkedIn consent page opener the window's "Turn on LinkedIn" calls: one launch at a time (launchOnce), the check-in's id first, the profile scan as the fallback, a reason when nothing opened.
 * `server` = {extensionSeen(), latestExtension()}; `installed()` = the scan's copies; `open` = extension-install.js openInChrome. -> async () => {opened, starting?, reason?, note?}
 */
export function linkedinPageOpener({server, installed, open}) {
  const launch = launchOnce(() => openExtensionPage('linkedin.html', {seen: server.extensionSeen(), found: installed(), open}), () => server.extensionSeen()?.at || 0);
  return reasonedOpen(launch, () => ({seen: server.extensionSeen(), found: installed(), latest: server.latestExtension()}));
}
