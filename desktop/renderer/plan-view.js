import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
import {number} from '../i18n/format.js';
import {FREE_WEAKER_SHORT} from './ai-tier-words.js';
import {buysSuffix} from './credit-buys-view.js';
// The Pro plan's words and numbers for the window (Settings → Plan, the sidebar counter, ⌘K), kept free of the DOM so a test can read them
// (private spec jobadabra-lab:docs/specs/2026-10-16-pro-plan.md §4, owner decisions 16 Oct 2026): the AI credit LEFT is a bar and a percent, never dollars or "applications left" (an AMOUNT bought or added says what it buys: owner, 27 Oct 2026, renderer/credit-buys.js);
// "one-time payment, no subscription", never "lifetime"; the own key is the way out when the credit runs low. Prices come from the site's offers (/api/pro/status), never from here.
// "I have Pro" (a code by e-mail adds a computer) is hidden for now, owner 24 Oct 2026: "too an edge case". Turn on to bring back the Plan card button and the ⌘K entry; the sign-in code stays.
export const SHOW_I_HAVE_PRO = false;
export const OWN_KEY = t('helperMore.ownKeyUnlimited');
export const NO_CREDIT = t('helperMore.noCreditOwnKey');
const EVERYTHING = [t('helperMore.unlimitedApplications'), t('helperMore.exportJobList'), t('helperMore.ownKeyNothingCounted'), t('helperMore.addCreditAnytime'), t('helperMore.refund14')];
export const ALWAYS_ON = t('helperMore.alwaysMorning');
// What each package says it includes (the prices come from the site's offers, never from here).
export const PACKAGE_INCLUDES = {pro: [...EVERYTHING, ALWAYS_ON], 'pro-ai': [t('helperMore.allPro'), t('helperMore.wholeSearchCredit'), ALWAYS_ON]};
export const INCLUDED = EVERYTHING;   // the waitlist card's list (pages/plan-waitlist.js)
export const TOPUP_NOTE = t('helperMore.topupNote');
// The euro amount an offer adds, as the site says it (offers[].creditEur; 24 Oct 2026: €1 of credit = €1 at our AI prices, so a top-up adds what it costs). '' when the site did not send it (an older site).
// Why (27 Oct 2026, owner): an amount always says what it buys (renderer/credit-buys.js), so "€10 of AI credit" reads "€10 of AI credit (about 70 applications)"; the bar itself stays a percent. The desktop-only localized credit wrapper preserves that estimate and the shared calculation.
export const creditWords = offer => (offer?.creditEur > 0 ? t('helperMore.creditWords', {amount: euro(offer.creditEur), buys: buysSuffix(offer.creditEur)}) : '');
export const NOTES = {
  30: t('helperMore.creditUnder30'),
  10: t('helperMore.creditUnder10'),
  0: t('helperMore.creditUsed'),
};
// The two plans side by side on a Pro's Plan card (owner, 27 Oct 2026: "the free plan/card shown, but just not selectable. Or disabled"; "the Pro plan should be selected").
export const PLAN_CHOICES = [
  {id: 'free', icon: 'user', title: t('helperMore.free'), text: t('helperMore.freePlanDescription', {quality: FREE_WEAKER_SHORT}), disabled: true},
  {id: 'pro', icon: 'zap', title: 'Pro', text: t('helperMore.proPlanDescription')},
];
export const CODE_CREDIT_NOTE = t('helperMore.codeCreditNote');
export const NO_CREDIT_BLOCK = t('helperMore.noCreditBlock');

const euro = value => number(value, {style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2});
const offerOf = (plan, id) => (plan.offers || []).find(offer => offer.id === id);
// The site's offers as the card shows them: {kind (the checkout kind), name, price, list, included, button}.
const packageCard = offer => ({kind: offer.id, name: offer.name, price: euro(offer.price), list: offer.list ? euro(offer.list) : null, button: t('helperMore.stripePay'),
  included: (PACKAGE_INCLUDES[offer.id] || []).map(text => (creditWords(offer) && text === PACKAGE_INCLUDES['pro-ai'][1] ? t('helperMore.creditNoSetup', {credit: creditWords(offer)}) : text))});

// What the Plan card shows for the site's answer: null when the plan is off (nothing about Pro is on screen) or the site offered nothing.
export function planView(plan = {}) {
  // Pro by a promo code while paying is off (owner, 27 Oct 2026: "I clicked 'add credit' ... I see nothing relevant"): the card still shows the AI credit, and a promo
  // code is the way to add some (credit codes); no packs to buy.
  if (plan.mode === 'promo' && plan.plan === 'pro') {
    const percent = Math.max(0, Math.min(100, plan.creditPercent ?? 0)), base = {mode: 'promo', title: t('helperMore.yourPlan'), kind: 'pro', pill: 'Pro', upgrade: null, topups: [], promo: true};
    return plan.hasCredit === false ? {...base, hasCredit: false, label: t('helperMore.noCreditYet'), note: CODE_CREDIT_NOTE}
      : {...base, hasCredit: true, percent, label: t('helperMore.creditPercentLeft', {percent}), tone: (plan.warn ?? 99) <= 10 ? 'bad' : 'info', note: NOTES[plan.warn] || OWN_KEY};
  }
  if (!['test', 'live'].includes(plan.mode)) return null;
  const base = {mode: plan.mode, title: plan.plan === 'pro' ? t('helperMore.yourPlan') : t('helperMore.upgradePlan')};   // Free is the card above ("Your plan"); this one only offers more, so no second Free pill
  if (plan.plan !== 'pro') {
    const packages = ['pro', 'pro-ai'].map(id => offerOf(plan, id)).filter(Boolean).map(packageCard);
    return packages.length ? {...base, kind: 'upgrade', pill: '', packages} : null;
  }
  const topups = (plan.offers || []).filter(offer => offer.id.startsWith('topup')).map(offer => ({kind: offer.id, price: euro(offer.price), adds: creditWords(offer)}));
  const upgrade = plan.package === 'pro' && offerOf(plan, 'upgrade') ? {kind: 'upgrade', price: euro(offerOf(plan, 'upgrade').price), name: offerOf(plan, 'upgrade').name} : null;
  if (plan.hasCredit === false) return {...base, kind: 'pro', pill: plan.package === 'pro-ai' ? 'Pro + AI' : 'Pro', hasCredit: false, label: t('helperMore.proUnlimited'), note: NO_CREDIT, upgrade, topups};
  const percent = Math.max(0, Math.min(100, plan.creditPercent ?? 0));
  return {...base, kind: 'pro', pill: plan.package === 'pro-ai' ? 'Pro + AI' : 'Pro', hasCredit: true, percent, label: t('helperMore.creditPercentLeft', {percent}), tone: (plan.warn ?? 99) <= 10 ? 'bad' : 'info', note: NOTES[plan.warn] || OWN_KEY, warn: plan.warn ?? null, upgrade, topups};
}

// The warning to say once per step (30, 10, then 0): which steps were already said, and what to say now. -> {say: 30 | 10 | 0 | null, said: [...]}
export function warnNow(warn, said = []) {
  if (warn == null) return {say: null, said: []};   // above 30% again: the steps are new next time
  return said.includes(warn) ? {say: null, said} : {say: warn, said: [...said, warn]};
}

// "I have Pro": what to say for the site's refusal of a code.
const WORDS = {
  expired: t('helperMore.codeExpiredAsk'), locked: t('helperMore.codeTooManyAsk'), other: t('helperMore.otherProAccount'),
};
/** Describe the site sign-in result, including remaining tries; preserve an unknown provider error as received. */
export const signinWords = answer => answer.error === 'wrong' ? t('helperMore.signinCodeWrong', {count: answer.left}) : WORDS[answer.error] || answer.error || t('helperMore.didNotWork');


// A promo code: what to say for the site's answer (the site decides; the words are fixed here).
const PROMO_WORDS = {wrong: t('helperMore.codeWrong'), expired: t('helperMore.codeExpired'), used_up: t('helperMore.codeUsedUp'), pro_only: t('helperMore.codeProOnly'), limit: t('helperMore.codeTooManyHour'), offline: t('helperMore.codeOffline')};
/** Describe the site redemption result without changing it; unknown failures use the localized generic fallback. */
export const redeemWords = answer => (!answer.ok ? PROMO_WORDS[answer.error] || t('helperMore.didNotWork')
  : answer.credit > 0 ? (answer.already ? t('helperMore.codeAlreadyAdded') : t('helperMore.creditAdded', {amount: euro(answer.credit), buys: buysSuffix(answer.credit)}))
  : answer.already ? t('helperMore.proAlreadyOn') : t('helperMore.proThankYou'));

// The top-up dialog (pages/topup-dialog.js; owner, 26 Oct 2026): why our AI stopped -> {tag, title, body, wait, primary, pro}. why: a refusal (renderer/refusal.js) or a Free
// AI line (lib/ai-caps.js): cap 'day' | 'month' | 'trial' | 'busy' | 'busy-month' | 'off' (the free tier: credit never meets a Free line), none = Pro's AI credit gone.
// One rule (owner, 27 Oct 2026: "If they're free tier, they should upgrade to pro. Otherwise, they just need to topup"): free → Upgrade to Pro, Pro → Top up.
// action: what was pressed ('Find jobs'), or '' for a step nobody pressed.
export const UPGRADE = t('helperMore.upgradePro'), TOP_UP = t('helperMore.topUp');
const inWords = ms => (ms < 3600000 ? t('helperMore.minuteDuration', {count: Math.max(1, Math.round(ms / 60000))}) : ms < 2 * 86400000 ? t('helperMore.hourMinuteDuration', {hours: Math.floor(ms / 3600000), minutes: Math.round((ms % 3600000) / 60000)}) : t('helperMore.daysDuration', {count: Math.round(ms / 86400000)}));
export function topupWords(why = {}, action = '', now = Date.now()) {
  const uses = action ? t('helperMore.actionUsesAi', {action}) : t('helperMore.aiStepsPaused');
  const left = why.resetsAt ? Date.parse(why.resetsAt) - now : NaN;
  const resets = left > 0 ? t('helperMore.resetsIn', {duration: inWords(left)}) : '';
  const free = {primary: UPGRADE, pro: false};
  switch (why.cap) {
    case 'day': return {...free, tag: t('helperMore.freeTodayReached'), title: t('helperMore.usedToday'), body: t('helperMore.resetTomorrow', {resets}), wait: t('helperMore.waitTomorrow')};
    case 'month': return {...free, tag: t('helperMore.freeMonthReached'), title: t('helperMore.usedMonth'), body: t('helperMore.resetMonth', {resets}), wait: t('helperMore.waitMonth')};
    case 'trial': return {...free, tag: t('helperMore.trialAiUsed'), title: t('helperMore.usedTrial'), body: t('helperMore.trialContinue', {uses}), wait: ''};
    case 'busy': case 'busy-month': case 'off': return {...free, tag: t('helperMore.freePausedTag'), title: t('helperMore.freePaused'), body: t('helperMore.pausedContinue', {reason: why.text || why.message || t('helperMore.freeBusyAll')}), wait: t('helperMore.tryLater')};
    default: return {primary: TOP_UP, pro: true, tag: t('helperMore.proNoCredit'), title: t('helperMore.topUpContinue'), body: t('helperMore.planNoCredit', {uses}), wait: ''};
  }
}
