// Display known employer enum labels without translating arbitrary stored employer data or changing filters.
import {registerMessages, SUPPORTED_LOCALES, t} from './index.js';
import {rows} from './catalogs/employer-labels.js';
for (const [column, locale] of SUPPORTED_LOCALES.entries()) registerMessages(locale, 'employerLabels', Object.fromEntries(Object.entries(rows).map(([key, values]) => [key, values[column]])));

/** Translate only a fixed app-owned enum; custom values keep their exact original text. */
export function employerLabel(value) { return Object.hasOwn(rows, value) ? t(`employerLabels.${value}`) : value; }
