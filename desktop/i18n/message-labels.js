// Translate the two fixed drawer communication headings without changing the stored section names used to find content.
import {registerMessages, SUPPORTED_LOCALES, t} from './index.js';
import {rows} from './catalogs/message-labels.js';
for (const [column, locale] of SUPPORTED_LOCALES.entries()) registerMessages(locale, 'messageLabels', Object.fromEntries(Object.entries(rows).map(([key, values]) => [key, values[column]])));
const headings = Object.fromEntries(Object.entries(rows).map(([key, values]) => [values[0], key]));

/** Translate a fixed app-authored communication heading; custom and employer-authored headings keep their exact text. */
export function messageHeading(value) { return Object.hasOwn(headings, value) ? t(`messageLabels.${headings[value]}`) : value; }
