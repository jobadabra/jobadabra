// Display formatting follows the chosen app language while callers retain currency and time-zone semantics.
import {getLocale} from './index.js';

/** Format a numeric value for the app language, preserving caller-supplied currency/unit options. */
export const number = (value, options = {}) => new Intl.NumberFormat(getLocale(), options).format(value);
/** Format an existing date with caller-owned time-zone and precision options. */
export const date = (value, options = {}) => new Intl.DateTimeFormat(getLocale(), options).format(value instanceof Date ? value : new Date(value));
/** Format a relative duration using locale grammar, including translated today/yesterday where applicable. */
export const relative = (value, unit, options = {}) => new Intl.RelativeTimeFormat(getLocale(), {numeric: 'auto', ...options}).format(value, unit);
