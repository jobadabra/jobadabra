import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
// The line under the extension's install steps: where the app looked for the browser profiles on this computer.
// Renderer code, so the list comes in as an argument rather than being read here (renderer/os.js sets the precedent).
//
// It exists for the machine where the extension isn't found and the reason isn't "it isn't installed": a browser this
// app doesn't know, or one started with --user-data-dir, keeps its profile somewhere no list here can guess. The
// browser itself knows — chrome://version prints its Profile Path — so the words say where to look instead.
const list = items => (items.length > 1 ? t('helperTail.listAnd', {items: items.slice(0, -1).join(', '), last: items.at(-1)}) : String(items[0] || ''));

export function lookedText(looked) {
  if (!looked?.length) return '';
  const here = looked.filter(entry => entry.there).map(entry => entry.dir);
  const first = t('helperTail.lookedIn', {folders: list(looked.map(entry => entry.dir))});
  if (!here.length) {
    return t('helperTail.foldersMissing', {first});
  }
  // Naming them again only says something when some are missing (the usual Mac has all six).
  return here.length === looked.length ? first : t('helperTail.foldersHere', {first, folders: list(here)});
}
