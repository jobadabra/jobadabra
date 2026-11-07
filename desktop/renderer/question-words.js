// The words of a "Which job is this email about?" question, shared by the Gmail card (pages/activity.js) and its popup (pages/reassign.js).

// An invitation (a calendar email) or any other email.
import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
export const emailNoun = email => (/invit|calendar|meeting/i.test(`${email?.subject || ''} ${email?.sender || ''}`) ? 'invitation' : 'email');

// Why it is asked: what the email names, and what it lacks.
export const questionWhy = (noun = 'email', company = '') => (company ? t(noun === 'invitation' ? 'helperFlow.invitationNames' : 'helperFlow.emailNames', {company})
  : t('helperFlow.emailUnclear'));

// The popup's three answers: the line under them and the button, per answer.
export const CHOICES = {
  tracked: {note: t('helperFlow.emailLinkPicked'), save: t('helperFlow.emailLink')},
  new: {note: t('helperFlow.emailLinkNew'), save: t('helperFlow.emailCreateLink')},
  none: {note: t('helperFlow.emailOutside'), save: t('helpers.save')},
};
