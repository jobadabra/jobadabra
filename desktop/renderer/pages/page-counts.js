// Locale-aware page entity counts; only app-owned noun identifiers are accepted here.
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
import {number} from '../../i18n/format.js';

/** Render a page's app-owned noun and count. User text is never treated as a translation key. */
export function counted(noun, count) {
  return t(`pagesCountNouns.${noun.replaceAll(' ', '_')}`, {count, shown: number(count)});
}
