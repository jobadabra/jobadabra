// Project the wizard's counted CV-detail save result only when it is sent to the window; canonical notes remain unchanged.
import {settingsText as words} from '../i18n/settings-native.js';

/** Format the existing save-result counts; null is the unchanged background-read timeout, never an inferred CV result. */
export function detailsProgress(done) {
  if (!done) return words('detailsReading');
  const saved = done.saved?.length || 0, left = done.left?.length || 0;
  if (!saved && !left) return words('detailsNone');
  return words('detailsFilled', {count: saved}) + (left ? words('detailsLeft', {count: left}) : '');
}
