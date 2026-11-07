import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
// The Profile's unanswered "Target: ❓" is a placeholder, not a value: with no real figure it reads as not set (UI loop #272).
export function compensationText(value) {
  const text = String(value || '').trim();
  return !text || (text.includes('❓') && !/\d/.test(text)) ? t('helperTail.profileUnset') : text;
}
