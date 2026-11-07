// Platform compatibility for explicit app-owned wording; personal DOM content is never rewritten.
export {osText, pick} from '../i18n/platform.js';

/** Hide explicitly marked Mac-only tips without observing or changing text or personal attributes. */
export function localize(root, platform) {
  if (platform !== 'win32') return;
  for (const el of root.querySelectorAll?.('[data-mac-only]') || []) el.hidden = true;
}
