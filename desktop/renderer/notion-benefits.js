// Why connect Notion: the advantages, written once. Shown in the connect dialog, on a locked page, in Settings → Notion
// (all of them). Claims beyond these need the owner's say-so.
import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
export const NOTION_BENEFITS = [
  {icon: 'cloud', lead: t('helperFlow.notionCloud'), text: t('helperFlow.notionCloudText')},
  {icon: 'globe', lead: t('helperFlow.notionDevices'), text: t('helperFlow.notionDevicesText')},
  {icon: 'eye', lead: t('helperFlow.notionSee'), text: t('helperFlow.notionSeeText')},
  {icon: 'help', lead: t('helperFlow.notionHelp'), text: t('helperFlow.notionHelpText')},
  {icon: 'zap', lead: t('helperFlow.notionUnlock'), text: t('helperFlow.notionUnlockText')},
  {icon: 'shield', lead: t('helperFlow.notionYours'), text: t('helperFlow.notionYoursText')},
];

export const GATE_TITLE = t('helperFlow.notionGateTitle');
export const GATE_FOOTNOTE = t('helperFlow.notionGateFoot');
// Under Not now: why not (optional, one tap). Keys = lib/notion-gate.js WHY.
export const WHY_CHOICES = [['no_notion', t('helperFlow.notionNoUse')], ['privacy', t('helperFlow.privacy')], ['later', t('helperFlow.later')], ['other', t('helperFlow.somethingElse')]];
// A locked page → the reason it is locked (keys = lib/notion-gate.js REASONS).
export const LOCKED_VIEWS = {focus: 'focus', sessions: 'apply', interviews: 'interviews', calendar: 'interviews', reports: 'focus', employers: 'employers'};
