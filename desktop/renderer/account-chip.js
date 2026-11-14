// The "Account needed" chip on a job (Jobs list row, board card and job page): the job's application page asks the person to sign in or create an account, or applies on LinkedIn with Easy Apply.
// Why (13 Nov 2026, owner: "Let's somehow mark the jobs that requires an account... Let's add a chip to that job"): read from the apply check's own flags
// (lib/triage-read.js `login`, `accountCreation`, judged by the AI in lib/form-judge.js), never a second detector and never a guess from a host name.
// The decision is apply-triage-mode.js accountNeed (pure); guarded by test/unit/renderer/apply-triage-mode.test.js.
import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
import {tag} from './components.js';
import {icon} from './icons.js';
import {accountNeed} from './apply-triage-mode.js';

/**
 * The chip for `accountNeed(read, route)`: a key icon and "Account needed" (its tooltip says sign in or create), or for an Easy Apply job (route 'linkedin') the LinkedIn icon and
 * "LinkedIn Easy Apply". Null when the job needs no account. Takes the read and the job's `apply_route`; never throws.
 */
export function accountChip(read, route = '') {
  const need = accountNeed(read, route);
  if (!need) return null;
  const linkedin = need.kind === 'linkedin';
  const node = tag(t(linkedin ? 'helperTail.linkedinEasyApply' : 'helperTail.accountNeeded'),
    {title: t(linkedin ? 'helperTail.linkedinEasyApplyTip' : need.why === 'sign-in' ? 'helperTail.accountNeededSignIn' : 'helperTail.accountNeededCreate')});
  node.classList.add('is-account');
  node.prepend(icon(linkedin ? 'linkedin' : 'key', 'icon ui-tag-icon'));
  return node;
}
