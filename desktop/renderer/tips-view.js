// Desktop-only tip presentation leaves the extension’s shared canonical pool unchanged.
import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';

/** Translate the app-owned text of a known tip without changing its ID, source or audience metadata. */
export const tipText = tip => t(`helperTips.${tip.id}`);
