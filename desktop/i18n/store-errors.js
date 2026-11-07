// Register only store-move UI text; the English diagnostic source remains the fallback and never changes with the locale.
import {registerMessages, SUPPORTED_LOCALES} from './index.js';
import {rows} from './catalogs/store-errors.js';
// Why (7 Nov 2026): canonical source errors supply English; only non-English UI text is registered so diagnostic prose has one owner.
for (const [column, locale] of SUPPORTED_LOCALES.entries()) registerMessages(locale, 'storeError', Object.fromEntries(Object.entries(rows).filter(([, values]) => typeof values[column] === 'string').map(([key, values]) => [key, values[column]])));
export {withDisplay} from './display-values.js';
