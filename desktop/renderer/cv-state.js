// The one-glance caption beside "Current CV": ready, not read yet, or the read failed (then the error below says it, not a promise).
import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
export function cvStateText(status, readFailed) {
  if (status.base) return t('helperMore.cvReady', {design: status.custom ? t('helperMore.cvYourDesign') : t('helperMore.cvDefaultDesign')});
  return readFailed ? t('helperMore.cvNotRead') : t('helperMore.cvNotReadYet');
}
