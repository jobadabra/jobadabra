// Project fixed notification preference labels only at the desktop display boundary, preserving website payloads and unknown rows.
import {registerMessages, SUPPORTED_LOCALES, t} from './index.js';
import {rows} from './catalogs/mail-labels.js';
for (const [column, locale] of SUPPORTED_LOCALES.entries()) registerMessages(locale, 'mailLabels', Object.fromEntries(Object.entries(rows).map(([key, values]) => [key, values[column]])));

/** Translate a known preference ID; an unknown or custom name stays byte-for-byte supplied content. */
export function mailLabel(id, fallback) { return Object.hasOwn(rows, id) ? t(`mailLabels.${id}`) : fallback; }

/** Translate the two fixed news preference descriptions without rewriting unknown website descriptions. */
export function mailDescription(id, fallback) { return ['releases', 'tips'].includes(id) ? t(`mailLabels.${id}Description`) : fallback; }
