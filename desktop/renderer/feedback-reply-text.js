import '../i18n/screens-helpers.js';
import {date} from '../i18n/format.js';
import {getLocale} from '../i18n/index.js';
import {t} from '../i18n/index.js';
// The words on the card for the owner's answer to a feedback (drawn by pages/feedback-reply.js). Pure, so a test reads it without a window.
const SHORT = new Intl.DateTimeFormat(undefined, {day: 'numeric', month: 'short'});

// The owner's line often names the version already ("Fixed in 0.9.12."): the arrival line then adds nothing.
const sameVersion = reply => { const version = String(reply.arrival || '').match(/\d+\.\d+\.\d+/)?.[0]; return !!version && String(reply.message || '').includes(version); };

/** One reply ({on, excerpt, kind, message, arrival}) -> {title, said, answer, tone}. */
export function cardText(reply) {
  const day = reply.on ? (getLocale() === 'en' ? SHORT.format(new Date(`${reply.on}T12:00:00`)) : date(`${reply.on}T12:00:00`, {day: 'numeric', month: 'short'})) : '';
  const fixed = reply.kind === 'fixed';
  return {tone: fixed ? 'good' : 'info', title: fixed ? t('helperTail.feedbackFixed') : t('helperTail.feedbackHeard'),
    said: t('helperTail.wroteExcerpt', {day: day ? t('helperTail.onDay', {day}) : '', excerpt: reply.excerpt}), answer: [reply.message, sameVersion(reply) ? '' : reply.arrival].filter(Boolean).join(' ')};
}
