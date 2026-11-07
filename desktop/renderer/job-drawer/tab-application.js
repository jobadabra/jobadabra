// Drawer → Application, in two parts (owner's spec, 10 Oct 2026): Preparation (what the app drafted) and Submitted (what was actually sent,
// frozen at submission). Opens on Submitted when a snapshot exists, else on Preparation; the choice is kept per job for the session.
import '../../i18n/screens-helpers.js';
import {t} from '../../i18n/index.js';
import {choice} from './parts.js';
import {preparationView} from './application-preparation.js';
import {submittedView} from './application-submitted.js';

const chosen = new Map();   // job url → 'preparation' | 'submitted'
const OPTIONS = [['preparation', t('helpers.preparation')], ['submitted', t('helpers.submitted')]];
// The Timeline's "View snapshot": the next time the Application tab opens for this job, it opens on what was sent.
export const showSubmitted = url => chosen.set(url, 'submitted');

export function applicationTab(ctx, redraw) {
  const active = chosen.get(ctx.job.url) || (ctx.parts.submitted ? 'submitted' : 'preparation');
  const body = active === 'submitted' ? submittedView(ctx) : preparationView(ctx);
  return [choice(OPTIONS, active, key => { chosen.set(ctx.job.url, key); redraw(); }, t('helpers.application')), ...body];
}
