// Project canonical critical labels and typed pipeline kinds into native quit-dialog text without changing tracking or logs.
import {getLocale, registerMessages, SUPPORTED_LOCALES, t} from './index.js';
import {rows} from './catalogs/quit-labels.js';
import {messages as activity} from './catalogs/pages/activity.js';
import {messages as common} from './catalogs/pages/common.js';

for (const [column, locale] of SUPPORTED_LOCALES.entries()) registerMessages(locale, 'quitLabel', Object.fromEntries(Object.entries(rows).map(([key, values]) => [key, values[column]])));
// Why (7 Nov 2026): the registry and quit logs retain canonical identities; only known app-owned labels have a display projection.
const criticalKeys = new Map(Object.entries(rows).map(([key, values]) => [values[0], key]));
const taskKeys = {insight: 'insight', weekly: 'searchAnalysis', kits: 'prepareTop', visits: 'browserFind', tailor: 'tailor', today: 'todayList', scout: 'moreEmployers', mail: 'gmailCheck'};

/** Translate only known app-owned registry labels at display time; unknown labels pass through unchanged. */
export function criticalLabel(label) {
  const key = criticalKeys.get(label);
  return key ? t(`quitLabel.${key}`) : label;
}

/** Use existing page catalogs for known pipeline kinds; preserve the supplied English or unknown-kind callback wording. */
export function taskLabel(kind, fallback) {
  const locale = getLocale();
  // Why (7 Nov 2026): existing English callbacks may carry custom labels; unknown task kinds always retain that caller wording.
  if (locale === 'en') return fallback(kind);
  if (kind === 'search') return common[locale].findJobs;
  return activity[locale][taskKeys[kind]] || fallback(kind);
}
