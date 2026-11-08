// Project only the two canonical app-owned history reasons; stored rows and arbitrary explanations remain original.
import {registerMessages, SUPPORTED_LOCALES, t} from './index.js';
import {rows} from './catalogs/history-labels.js';
for (const [column, locale] of SUPPORTED_LOCALES.entries()) registerMessages(locale, 'historyLabels', Object.fromEntries(Object.entries(rows).map(([key, values]) => [key, values[column]])));
const reasons = Object.fromEntries(Object.entries(rows).map(([key, values]) => [values[0], key]));

/** Translate a known producer-owned history reason at display time; preserve every unknown explanation exactly. */
export function historyReason(value) { return Object.hasOwn(reasons, value) ? t(`historyLabels.${reasons[value]}`) : value; }
