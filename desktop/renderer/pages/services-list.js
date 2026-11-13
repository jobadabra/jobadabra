// The services Settings lists (Overview's "Your setup", Connections, the alert and the dot): each one's name, icon, words and whether it is required.
// Moved out of pages/settings.js (26 Oct 2026, pure move, the file was past 450 lines). Guards: test/unit/renderer/notify-choice.test.js (Telegram's required rule), the settings tests.
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
import {shared} from './shared.js';
import {offered} from '../key-sources.js';
import {telegramRequired} from '../notify-words.js';
import {LINE} from '../linkedin-words.js';
import {rowOf, view as easyApplyView} from '../easy-apply-words.js';

// Connections status, shared by Overview (cards + alert), Connections (Connected / Available + alert) and the
// dot on Connections. required: counted for the alert and the dot (Google Jobs and Always on are optional extras;
// Always on's card opens its setup on the Automation page).
const ALL_SERVICES = [
  {id: 'ai', name: 'AI', icon: 'bot', what: t('pagesDetails.aiChoices'), required: true,
    why: t('pagesDetails.aiWhy')},
  {id: 'notion', name: 'Notion', icon: 'layers', what: t('pagesDetails.workspace'), required: false,   // about Notion
    why: t('pagesDetails.notionWhy')},
  {id: 'google', name: t('pagesLinkedinServices.gmailCalendar'), icon: 'mail', what: t('pagesDetails.readOnly'), required: true,
    why: t('pagesDetails.gmailWhy')},
  {id: 'extension', name: t('pagesDetails.extensionName'), icon: 'puzzle', what: t('pagesDetails.formFilling'), required: true,
    why: t('pagesDetails.extensionWhy')},
  {id: 'linkedin-jobs', name: t('pagesLinkedinServices.linkedinJobs'), icon: 'linkedin', what: t('pagesDynamicSessionReports.m333', {"LINE": LINE}), required: false, connect: t('pagesCommon.turnOn')},   // opt-in (owner, 31 Oct 2026): pages/linkedin-consent.js
  {id: 'linkedin-easy-apply', name: 'LinkedIn Easy Apply', icon: 'linkedin', what: t('pagesEasyApply.what'), required: false, connect: t('pagesCommon.turnOn'),   // plan 1/5: pages/easy-apply-consent.js
    shown: () => rowOf(easyApplyView).shown},
  {id: 'telegram', name: 'Telegram', icon: 'send', what: t('pagesDetails.digests'), required: () => telegramRequired(shared.state.notifyBy, shared.state.settings.notifyBy) || !!shared.state.settings.telegramChatId,   // optional with e-mail unless chosen; listed while connected
    why: t('pagesLinkedinServices.notificationWhy')},
  {id: 'serpapi', name: 'Google Jobs (SerpApi)', icon: 'search', what: t('pagesDetails.moreResults'), connect: t('pagesDetails.addKey')},
  {id: 'brave', name: t('pagesLinkedinServices.webSearch'), icon: 'search', what: t('pagesLinkedinServices.findOwnSites'), connect: t('pagesDetails.addKey')},
  {id: 'cloud', name: t('pagesLinkedinServices.githubAlways'), icon: 'cloud', what: t('pagesLinkedinServices.runsMacOff'), connect: t('pagesCommon.setup')},
  {id: 'tg-cloud', name: t('pagesLinkedinServices.cloudflareButtons'), icon: 'zap', what: t('pagesLinkedinServices.botMacOff'), connect: t('pagesCommon.setup'),
    shown: () => !!shared.state.settings.cloud?.repo},  // it starts runs in the GitHub repository, so only with Always on
];
export const SERVICES = ALL_SERVICES.filter(service => offered(service.id));
export const isRequired = service => (typeof service.required === 'function' ? service.required() : !!service.required);
