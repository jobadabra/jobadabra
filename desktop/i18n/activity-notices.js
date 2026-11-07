// Register standalone activity notification catalogs without changing shared runtime or persisted/control messages.
import {registerMessages, t} from './index.js';
import en from './catalogs/activity-notices/en.js';
import de from './catalogs/activity-notices/de.js';
import fr from './catalogs/activity-notices/fr.js';
import it from './catalogs/activity-notices/it.js';
import es from './catalogs/activity-notices/es.js';
import ro from './catalogs/activity-notices/ro.js';
import ru from './catalogs/activity-notices/ru.js';
for (const [locale, messages] of Object.entries({en, de, fr, it, es, ro, ru})) registerMessages(locale, 'activityNotice', messages);

/** Translate only an app-owned activity display template, interpolating raw values once as plain text. */
export function activityText(key, variables) { return t(`activityNotice.${key}`, variables); }

const handoffKeys = {captcha_preflight: 'captchaPreflight', captcha_runtime: 'captchaRuntime', stopped: 'stopped',
  submission_outcome_unknown: 'outcomeUnknown', app_closed: 'appClosed', app_updated: 'appUpdated'};

/** Resolve native handoff display copy from an unchanged reason ID; control/journal/email text stays with callers. */
export function activityHandoff(reason, fallback = 'reviewSelf') {
  return activityText(Object.hasOwn(handoffKeys, reason) ? handoffKeys[reason] : fallback);
}
