// Drawer → Application (owner's spec, 10 Oct 2026): Preparation (what the app drafted) and Submitted (what was actually sent, frozen at submission);
// beside them Apply readiness and Account / Credentials (owner, 13 Nov 2026: "beside these. I should see a tab with Apply readiness and with Account/Credentials"). Opens on Submitted when a snapshot exists, else on Preparation; the choice is kept per job for the session.
import '../../i18n/screens-helpers.js';
import {t} from '../../i18n/index.js';
import {choice} from './parts.js';
import {preparationView} from './application-preparation.js';
import {submittedView} from './application-submitted.js';
import {accountView, readinessView} from './application-readiness.js';
import {nextPart} from './drawer-actions.js';
import '../../i18n/screens-pages.js';
import {forgetPractice, practiceView} from './application-practice.js';
import {PRACTICE_WORDS} from '../practice-words.js';
import {practice} from '../practice.js';

const chosen = new Map();   // job url → 'preparation' | 'submitted' | 'readiness' | 'account'
const OPTIONS = [['preparation', t('helpers.preparation')], ['submitted', t('helpers.submitted')], ['readiness', t('pagesReadinessTab.tabReadiness')], ['account', t('pagesReadinessTab.tabAccount')]];
const VIEWS = {readiness: readinessView, account: accountView};
// The Timeline's "View snapshot": the next time the Application tab opens for this job, it opens on what was sent.
export const showSubmitted = url => chosen.set(url, 'submitted');

export function applicationTab(ctx, redraw) {
  const options = practice.on ? [...OPTIONS, ['practice', PRACTICE_WORDS.option]] : OPTIONS;   // the practice run's third part (renderer/practice.js)
  if (nextPart.has(ctx.job.url)) { chosen.set(ctx.job.url, nextPart.get(ctx.job.url)); nextPart.delete(ctx.job.url); }   // the ⋯ menu's "Fix what's missing": Apply readiness
  const active = chosen.get(ctx.job.url) || (ctx.parts.submitted ? 'submitted' : 'preparation');
  const body = active === 'practice' ? practiceView(ctx, redraw) : VIEWS[active] ? VIEWS[active](ctx, redraw) : active === 'submitted' ? submittedView(ctx) : preparationView(ctx);
  return [choice(options, active, key => { chosen.set(ctx.job.url, key); if (key === 'practice') forgetPractice(ctx.job.url); redraw(); }, t('helpers.application')), ...body];
}
