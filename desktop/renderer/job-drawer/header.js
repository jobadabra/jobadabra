// The drawer's fixed header (pages/job-panel.js): the score ring, the title, "company · place", the job's own status and key chips, and
// the controls: previous / next ("3 of 38"), expand, close; "Back to Recent activity" above them when a run opened the job.
// One header for every tab. Words: renderer/job-page-view.js headerFacts, interviewFacts. Guarded by test/unit/renderer/job-drawer.test.js.
import '../../i18n/screens-helpers.js';
import {t} from '../../i18n/index.js';
import {stageText} from '../jobs-board-rules.js';
import {el, pill} from '../components.js';
import {icon} from '../icons.js';
import {fitRing, isOldScore} from '../fit-ring.js';
import {staleTip} from '../rescore-words.js';
import {band} from '../jobs-view.js';
import {appliedLine, nextInterview, notSeen} from '../job-page-view.js';
import {accountChip} from '../account-chip.js';

function control(name, title, run, disabled = false) {
  const node = Object.assign(el('button', 'ghost icon-btn jd-control'), {type: 'button', title, disabled});
  node.setAttribute('aria-label', title);
  node.append(typeof name === 'string' ? icon(name) : name);
  node.addEventListener('click', run);
  return node;
}

// at: {index, total} of the list the drawer was opened from; back: {label, run} or null; on: {prev, next, expand, close}; read: this window's apply check of the job (pages/jobs-triage.js), or null.
export function drawerHeader(job, page, {at, back, expanded, on, read = null}) {
  const head = el('header', 'jd-head');
  if (back) {
    const link = Object.assign(el('button', 'link jd-back', `← ${back.label}`), {type: 'button'});
    link.addEventListener('click', back.run);
    head.append(link);
  }
  const top = el('div', 'jd-top');
  const old = isOldScore(job);
  const cell = el('div', `fit-cell ${band(job.fit)}${old ? ' is-stale' : ''}`);
  if (old) cell.title = staleTip;   // the list row's own tooltip: the badge says old, this says re-score
  cell.append(fitRing(job.fit, 'lg', old));
  const words = el('div', 'jd-title');
  words.append(el('h2', '', job.title), el('p', 'muted', [job.company, job.location || page?.app?.location].filter(Boolean).join(' · ')));
  const chips = el('div', 'jd-chips');
  const stage = page?.app?.stage || job.stage;
  if (stage) chips.append(pill(stageText(stage), 'info'));
  if (job.work_mode) chips.append(pill(job.work_mode, 'neutral'));
  if (notSeen(page)) chips.append(pill(t('helpers.notSeen'), 'warn', {title: t('helpers.notSeenHint')}));
  const account = accountChip(read || page?.check, job.apply_route);   // this window's latest check, else the stored one (lib/job-page-handlers.js jobCore)
  if (account) chips.append(account);
  const applied = appliedLine(job, page?.app);
  if (applied) chips.append(el('span', 'muted small', applied));
  if (chips.childNodes.length) words.append(chips);
  const nav = el('div', 'jd-nav');
  const flip = control('chevron', t('helpers.previousJob'), on.prev, !at || at.index <= 0);
  flip.classList.add('is-flipped');
  nav.append(flip, el('span', 'muted small jd-count', at && at.total > 1 ? t('helpers.position', {index: at.index + 1, total: at.total}) : ''),
    control('chevron', t('helpers.nextJob'), on.next, !at || at.index >= at.total - 1),
    control('maximize', expanded ? t('helpers.shrink') : t('helpers.expand'), on.expand), control('close', t('helpers.closeEsc'), on.close));
  top.append(cell, words, nav);
  head.append(top);
  const next = nextInterview(page?.app);
  if (next) {   // the next step, on every tab: when, and the way to its interview
    const bar = el('div', 'jd-next');
    // Prepare builds the interview prep kit (the Focus action); a job with no application has none to build: the bar leads to its interviews.
    const open = Object.assign(el('button', 'primary', page?.app?.id ? t('helpers.prepareArrow') : t('helpers.interviewsArrow')), {type: 'button'});
    open.addEventListener('click', page?.app?.id ? on.prepare : on.interviews);
    bar.append(icon('calendar'), el('span', '', t('helpers.nextInterview', {when: next.when})), open);
    head.append(bar);
  }
  return head;
}
