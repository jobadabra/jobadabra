// The words and states of the one Always on choice card (owner, 4 Nov 2026: "The user should choose between these 2 options. Either going with our servers, either going with his own, which is his Notion + his Github + his API AI Key"). Pure: renderer/pages/always-on-choice.js draws it.
// Two ways, one running at a time; "ours" is not pickable until the site says it is open (the hosted runner is not live yet), unless it is what runs now (#3158). Guard: test/unit/renderer/always-on-choice-words.test.js.
import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
export const NAME = t('helperMore.alwaysOn');
export const LEAD = t('helperMore.alwaysLead');

/** -> 'ours' | 'own' | 'both' | null: what is running now (our servers, the person's own GitHub repo, or, by mistake, both). */
export const running = ({hostedOn = false, cloudRepo = ''} = {}) => (hostedOn && cloudRepo ? 'both' : hostedOn ? 'ours' : cloudRepo ? 'own' : null);

/** -> the way the card shows first: the running one (the own way when both run, it has the way to turn it off), else ours when it can run, else the person's own. */
export const startWay = ({now, open}) => (now === 'both' ? 'own' : now || (open ? 'ours' : 'own'));

/** -> whether the "our servers" choice can be picked: our servers take a schedule (`open`, and `canRun` the in-house key), or they are what runs now (then it must stay reachable: it is where Always on is turned off). */
export const oursPickable = ({open, canRun = true, now = null}) => now === 'ours' || now === 'both' || (open && canRun);

/** -> the two choice cards (components.js choiceCards). `open`: whether our servers can take a schedule yet; `canRun`: whether this install holds the in-house key (Free AI or Pro) they need; `now`: what runs now.
 * Why (#3158, 5 Nov 2026): the running way is always pickable; with hosted Always on running and the site closed, picking "your own accounts" hid the server card and the way back to turn it off. */
export const choices = ({open, canRun = true, now = null}) => {
  const pickable = oursPickable({open, canRun, now}), oursRuns = now === 'ours' || now === 'both';
  return [
    {id: 'ours', icon: 'cloud', title: t('helperMore.onOurServers'), badge: [t('helperMore.easiest'), 'good'], disabled: !pickable, note: oursRuns ? '' : !open ? t('helperMore.notOpenYet') : canRun ? '' : t('helperMore.needsFreePro'),
      text: t('helperMore.oursMorning')},
    {id: 'own', icon: 'github', title: t('helperMore.onOwnAccounts'), badge: [t('helperMore.advanced'), 'info'], disabled: false,
      text: t('helperMore.ownAccountsText')}, // about Notion
  ];
};

/** -> [text, tone] for the card's status pill. */
export const pill = now => (now === 'both' ? [t('helperMore.onTwice'), 'warn'] : now === 'ours' ? [t('helperMore.onOurs'), 'good'] : now === 'own' ? [t('helperMore.onOwn'), 'good'] : [t('helperMore.off'), 'neutral']);

const NAMES = {ours: t('helperMore.ourServers'), own: t('helperMore.yourAccounts')};
/** -> one line when the picked way is not the running one (nothing turns off by itself), or when both run, else ''. */
export const notice = ({now, picked}) => (now === 'both' ? t('helperMore.bothAlways') : now && picked && now !== picked
  ? t('helperMore.alwaysRunning', {where: NAMES[now]}) : '');
