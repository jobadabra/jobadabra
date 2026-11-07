// The version a check-in counts as: the extension's real one, except for a development copy (which keeps its manifest at the base and reloads for a stamped version).

import {newer} from './updater.js';

/**
 * -> the version the app counts the extension at: its manifest `version`; only a development copy (`development`) counts as the one it last reloaded for (`reloadedFor`) when that is higher.
 * Why (7 Nov 2026, owner's 0.9.13 retest): the extension reported `reloadedFor` as its version for every copy (1a6790aa, 15 Oct), so a reload that did not take (Chrome came back on 0.9.756) kept
 * reporting 0.9.759; the app saw "current" and every outdated check (Show in form, Find jobs using your browser, the fill report) stayed silent while old code filled the forms.
 */
export function reportedVersion({version = '', reloadedFor = ''} = {}, development = false) {
  return development && reloadedFor && newer(reloadedFor, version) ? reloadedFor : version;
}
