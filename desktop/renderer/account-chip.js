// The "Account needed" chip on a job (Jobs list row, board card and job page): the job's application page asks the person to sign in or create an account.
// Why (13 Nov 2026, owner: "Let's somehow mark the jobs that requires an account... Let's add a chip to that job"): read from the apply check's own flags
// (lib/triage-read.js `login`, `accountCreation`, judged by the AI in lib/form-judge.js), never a second detector and never a guess from a host name.
// The decision is apply-triage-mode.js accountNeed (pure); guarded by test/unit/renderer/apply-triage-mode.test.js.
import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
import {tag} from './components.js';
import {icon} from './icons.js';
import {accountNeed} from './apply-triage-mode.js';

/** The chip for `accountNeed(read)`: a key icon and "Account needed", its tooltip says sign in or create. Null when the job needs no account. Takes the read; never throws. */
export function accountChip(read) {
  const need = accountNeed(read);
  if (!need) return null;
  const node = tag(t('helperTail.accountNeeded'), {title: t(need.why === 'sign-in' ? 'helperTail.accountNeededSignIn' : 'helperTail.accountNeededCreate')});
  node.classList.add('is-account');
  node.prepend(icon('key', 'icon ui-tag-icon'));
  return node;
}
