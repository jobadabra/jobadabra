// What the Focus "Allow in Incognito" line says and when (pure, no page: its test runs without a DOM). Used by pages/focus-incognito.js; guard: test/unit/renderer/focus-incognito.test.js.
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
export const waitingOf = settings => settings?.refusedNeedsIncognito === true ? (settings.refusedIncognitoWaiting || []).length : 0;
export const lineOf = count => t('pagesDynamicFocusInterviews.m194', {"count": count});
