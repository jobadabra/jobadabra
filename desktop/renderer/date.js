// One date format for the screens: "8 Oct", and "8 Oct 2025" only when it isn't this year (owner, 9 Oct 2026). A date alone
// ("2026-10-08") is read at noon, so no time zone moves it a day; an unreadable value gives ''. Guarded by test/unit/renderer/date.test.js.
import {getLocale, registerMessages, t} from '../i18n/index.js';
import {number} from '../i18n/format.js';
import messages from '../i18n/catalogs/time.js';
for (const [locale, catalog] of Object.entries(messages)) registerMessages(locale, 'time', catalog);
export function shortDay(value, now = Date.now()) {
  const text = String(value || '');
  const at = Date.parse(text.length === 10 ? `${text}T12:00:00` : text);
  if (!text || !Number.isFinite(at)) return '';
  const thisYear = new Date(at).getFullYear() === new Date(now).getFullYear();
  return new Date(at).toLocaleDateString(getLocale() === 'en' ? 'en-GB' : getLocale(), {day: 'numeric', month: 'short', ...(thisYear ? {} : {year: 'numeric'})});
}

/** Display a saved screen's age with the existing minute/hour/day/week precision. */
export function savedAgo(iso, now = Date.now()) {
  const minutes = Math.floor((now - Date.parse(iso)) / 60000);
  if (!Number.isFinite(minutes) || minutes < 1) return t('time.justNow');
  if (minutes < 60) return t('time.minutesAgo', {count: number(minutes)});
  if (minutes < 1440) return t('time.hoursAgo', {count: number(Math.floor(minutes / 60))});
  const days = Math.floor(minutes / 1440);
  return days < 14 ? t('time.daysAgo', {count: number(days)}) : t('time.weeksAgo', {count: number(Math.floor(days / 7))});
}

/** Display a run's local clock and date in the selected language, without changing its time zone. */
export function runWhen(iso, now = Date.now()) {
  const at = new Date(iso), today = new Date(now);
  const time = at.toLocaleTimeString(getLocale(), {hour: '2-digit', minute: '2-digit'});
  if (at.toDateString() === today.toDateString()) return t('time.today', {time});
  const options = today - at > 7 * 86400000 ? {day: 'numeric', month: 'short'} : {weekday: 'short'};
  return `${at.toLocaleDateString(getLocale(), options)} ${time}`;
}
