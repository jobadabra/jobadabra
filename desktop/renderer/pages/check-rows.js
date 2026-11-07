// What the Focus "quick check" line says and when (pure, no page: its test runs without a DOM). Used by pages/focus-check.js; guard: test/unit/renderer/focus-check.test.js.
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
export const CHECK_WAIT_MS = 12 * 60 * 1000;   // lib/refused-reads.js CHECK_WAIT_MS: a little longer than the extension holds the hidden window
export const checksOf = (settings, now = Date.now()) => (settings?.refusedCheckWaiting || []).filter(entry => now - entry.at < CHECK_WAIT_MS).map(entry => entry.host);
/** Describe the known host list for a site check without translating host names. */
export const checkLine = hosts => hosts.length === 1 ? t('pagesDynamicSetup.m79', {"value1": hosts[0]}) : t('pagesDynamicSetup.m80', {"length": hosts.length});
