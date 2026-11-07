// Settings → Plan: the free allowance ("12 of 20 free applications · 41 days left", one bar per number), also as a small counter in the sidebar, and the friendly
// dialog when the allowance ends (main asks for it, 'allowance' event). No key can be entered any more (17 Oct 2026: the free trial is open to everyone); an install
// that already holds one keeps it: it shows as Founder / Friend and can be removed here (lib/license.js still checks it).
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
import {$, message} from './core.js';
import {openSetting} from './settings.js';
import {chip} from '../license-chip.js';
import {endedLine} from '../plan-line.js';
import {showProCard} from './plan-waitlist.js';
import {initPlan} from './plan.js';
import {byStore} from '../store-words.js';

const KIND = {founder: t('pagesAuditSecond.a124'), friend: t('pagesAuditSecond.a125'), pass: t('pagesAuditSecond.a126'), pro: 'Pro'};

// The sidebar counter: "12 of 20 applications used" with a thin bar; a click opens Settings → Plan. Hidden for a licensed install.
function showChip(state) {
  const shown = chip(state);
  const button = $('allowance-chip');
  button.hidden = !shown;
  if (!shown) return;
  $('allowance-chip-plan').textContent = shown.plan;
  $('allowance-chip-text').textContent = shown.text;
  button.title = shown.title;
  button.dataset.tone = shown.tone;
  $('allowance-chip-fill').style.width = `${shown.percent}%`;
}

export function showLicense(state) {
  showChip(state);
  const {licensed, ended} = state;
  // Free is named and marked "Your plan" (17 Oct 2026, owner: it must be clear I'm on the free plan); the Pro card beside it is the offer.
  $('license-title').textContent = licensed ? t('pagesPlans.allowance') : t('pagesPlans.free');
  $('license-pill').textContent = licensed ? (state.license.kind === 'pro' ? 'Pro' : t('pagesShortJobs.m209', {"value1": KIND[state.license.kind]})) : ended ? t('pagesPlans.freeOver') : t('pagesPlans.yourPlan');
  $('license-pill').className = `ui-pill tone-${licensed ? 'good' : ended ? 'warn' : 'good'}`;
  // Same count as the sidebar chip: applications USED, filling, red for the last 5.
  const shown = chip(state);
  $('license-used-label').textContent = licensed ? t('pagesPlans.applicationsSent') : t('pagesPlans.applicationsUsed');
  $('license-used').textContent = licensed ? t('pagesDynamicProfileReady.m253', {"used": state.used}) : t('pagesShortJobs.m211', {"used": shown.used, "limit": state.limit});
  // A Pro's second number is its AI credit (owner, 27 Oct 2026): on our AI the credit left, a bar like the sidebar's; on its own AI a full bar, unlimited, and why.
  const pro = state.license?.kind === 'pro', ourAi = pro && !!state.pro?.ourAi;
  const noCredit = state.pro?.hasCredit === false || !state.pro?.creditPercent;
  $('license-days-label').textContent = pro ? t('pagesPlans.aiCredit') : licensed ? t('pagesPlans.licensedTo') : t('pagesPlans.daysLeft');
  $('license-days').textContent = pro ? (ourAi ? shown.text.replace(/^AI credit /, '') + t('pagesFinalCopy.left') : t('pagesPlans.unlimitedOwn')) : licensed ? state.license.name : t('pagesShortJobs.m212', {"daysLeft": state.daysLeft});
  $('license-bar').hidden = licensed;
  $('license-days-bar').hidden = licensed && !pro;
  if (pro) {
    $('license-days-bar').firstElementChild.style.width = `${ourAi ? shown.percent : 100}%`;
    $('license-days-bar').dataset.tone = ourAi ? shown.tone : 'good';
  } else if (shown) {
    $('license-bar').firstElementChild.style.width = `${shown.percent}%`;
    $('license-bar').dataset.tone = shown.tone;
    // The days bar fills as the days are used; red when the last 5 are left, like the applications.
    const daysUsed = Math.max(0, Math.min(60, 60 - (state.daysLeft ?? 60)));
    $('license-days-bar').firstElementChild.style.width = `${Math.max(2, Math.round(daysUsed / 60 * 100))}%`;
    $('license-days-bar').dataset.tone = (state.daysLeft ?? 60) <= 5 ? 'bad' : 'info';
  }
  $('license-note').textContent = pro ? (!ourAi ? t('pagesPlans.ownAiNotCounted') : noCredit ? t('pagesPlans.noCredit') : t('pagesPlans.noEnd'))
    : licensed ? (state.license.until ? t('pagesDynamicProfileReady.m254', {"until": state.license.until}) : t('pagesPlans.noEnd'))
    : ended ? t('pagesDynamicProfileReady.m255', {"byStore": byStore(t('pagesPlans.trackingNotion'), t('pagesPlans.trackingLocal'))})
      : '';   // the rule is the page's subtitle; the one line about Pro is below
  showProCard(state);   // the Pro card with the waitlist button, while Pro is off (pages/plan-waitlist.js)
  $('license-note').hidden = !$('license-note').textContent;
  $('setting-license-key').hidden = !licensed || state.license?.kind === 'pro';   // only an install that already holds a key; a Pro account has none
  $('license-holder').textContent = licensed ? t('pagesShortJobs.m213', {"name": state.license.name, "value2": KIND[state.license.kind], "value3": state.license.until ? t('pagesShortJobs.m214', {"until": state.license.until}) : ''}) : '';
  if (state.keyProblem) message('license-message', t('pagesDynamicProfileReady.m256', {"keyProblem": state.keyProblem}), 'error');
}

export async function init() {
  const refresh = async () => showLicense(await window.pilot.license());
  await refresh();
  initPlan(refresh);   // the Plan card: Upgrade or the AI credit (pages/plan.js); it asks again so the counter and the line follow the site's answer
  $('allowance-chip').addEventListener('click', () => openSetting('license'));
  // The count moves as applications are sent: look again now and then, and when the window comes back to the front.
  setInterval(() => refresh().catch(() => {}), 10 * 60 * 1000);
  window.addEventListener('focus', () => refresh().catch(() => {}));
  window.pilot.onAllowanceChanged?.(() => refresh().catch(() => {}));   // the main process saved a fresh trial answer for a thanked report (lib/app-feedback-replies.js)
  document.querySelector('[data-settings-go="license"]').addEventListener('click', refresh);
  $('license-remove').addEventListener('click', async () => { message('license-message', ''); showLicense(await window.pilot.licenseRemove()); });
  // The allowance ended and something new was started: say so once, kindly, and point to the Plan page.
  window.pilot.onAllowance(state => {
    showLicense(state);
    $('allowance-plan').textContent = endedLine(state);
    if (!$('allowance-dialog').open) $('allowance-dialog').showModal();
  });
  $('allowance-settings').addEventListener('click', () => { $('allowance-dialog').close(); openSetting('license'); });
}
