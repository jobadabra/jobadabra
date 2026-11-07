// Register display-only credit/trial guidance without changing allowance rules, refusal identifiers or provider messages.
import {registerMessages, SUPPORTED_LOCALES} from './index.js';
import {rows} from './catalogs/allowance-notices.js';
for (const [column, locale] of SUPPORTED_LOCALES.entries()) registerMessages(locale, 'allowanceNotice', Object.fromEntries(Object.entries(rows).map(([key, values]) => [key, values[column]])));
export {t} from './index.js';
