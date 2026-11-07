// Pure call-time constructors for the remaining app-owned native dialogs and notification labels.
import {registerMessages, t} from '../i18n/index.js';
import en from '../i18n/catalogs/native/remaining-en.js';
import de from '../i18n/catalogs/native/remaining-de.js';
import fr from '../i18n/catalogs/native/remaining-fr.js';
import it from '../i18n/catalogs/native/remaining-it.js';
import es from '../i18n/catalogs/native/remaining-es.js';
import ro from '../i18n/catalogs/native/remaining-ro.js';
import ru from '../i18n/catalogs/native/remaining-ru.js';

for (const [locale, messages] of Object.entries({en, de, fr, it, es, ro, ru})) registerMessages(locale, 'nativeRemaining', messages);
const text = (key, variables) => t(`nativeRemaining.${key}`, variables);

/** Construct the move prompt; action 0 moves, action 1 leaves the app in place. */
export function applicationsMoveOptions() {
  return {type: 'question', message: text('moveMessage'), detail: text('moveDetail'),
    buttons: [text('moveAction'), text('notNow')], defaultId: 0, cancelId: 1};
}

/** Construct replacement consent without changing the data-location warning or button indices. */
export function applicationsReplaceOptions() {
  return {type: 'question', message: text('replaceMessage'), detail: text('replaceDetail'),
    buttons: [text('replaceAction'), text('cancel')], defaultId: 0, cancelId: 1};
}

/** Surround an unchanged technical error with localized manual move instructions, interpolating once. */
export function applicationsFailureOptions(error) {
  return {type: 'warning', message: text('moveFailed'), detail: text('moveFailedDetail', {error})};
}

/** Construct the duplicate-copy note; Windows alone removes apps, and Store-only data may be lost. */
export function duplicateCopyOptions({self}) {
  return {type: 'info', title: 'Jobadabra', message: text('twiceMessage'),
    detail: [text('twiceIntro'), text(self === 'store' ? 'twiceStore' : 'twiceExe'), text('twiceRisk')].join('\n\n'),
    buttons: [text('installedApps'), text('keepBoth')], defaultId: 0, cancelId: 1, noLink: true};
}

/** Construct Claude permission copy; Cancel remains the default and the user reviews and submits. */
export function claudeConsentOptions() {
  return {type: 'warning', buttons: [text('allow'), text('cancel')], defaultId: 1, cancelId: 1,
    message: text('consentMessage'), detail: text('consentDetail')};
}

/** Construct a stuck-session notice while preserving the company's exact text. */
export function stuckSessionNotice({company} = {}) {
  return {title: text('stuckTitle') + (company ? ` · ${company}` : ''), body: text('stuckBody')};
}

/** Return the localized Focus reminder title; generated reminder prose is untouched by the caller. */
export function focusReminderTitle() { return text('focusTitle'); }

/** Construct input notification labels; an existing session brief remains byte-for-byte unchanged. */
export function sessionInputNotice({title, brief}) {
  return {title: text('inputTitle', {title}), body: brief || text('inputBody')};
}

/** Explain the disabled Claude action without changing feature gating or consent state. */
export function claudeOffText() { return text('claudeOff'); }
