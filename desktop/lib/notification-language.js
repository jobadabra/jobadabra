// Resolve end-user notification language from the existing desktop appearance preference without storing another choice.
import {getLocale, resolveLocale} from '../i18n/index.js';

/** Use an explicit saved language or the current startup/IPC resolution of system; fresh and invalid choices keep English. */
export function notificationLanguage(storage) {
  const choice = storage.settings().displayLanguage;
  return resolveLocale(choice === 'system' ? getLocale() : choice);
}
