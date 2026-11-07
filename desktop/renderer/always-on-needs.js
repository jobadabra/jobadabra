// What Always on on GitHub still needs from the person, as checklist rows (pure; the card is renderer/pages/connections.js). Guard: test/always-on-needs.test.js.
// Why (3 Nov 2026, owner: "they should use their own API Key ... I think we should request it before we copy the template"): Free AI's token sits in the same key slot as a person's own key
// and is never copied to GitHub (lib/github.js), so it counts as missing here (ownKeys), and the row says where else to go without a key: our servers.
import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
import {ownKeys} from './ai-engine-view.js';

/** state: the window's state ({secrets, ownSecrets}); key: the chosen family's {name, provider, cli}. -> rows {id, title, why, button, alt?}, empty when Always on can be turned on. */
export function alwaysOnNeeds(state, key) {
  const secrets = state.secrets || {}, own = ownKeys(state), freeAi = !own[key.name] && !!secrets[key.name];
  return [
    !secrets.NOTION_TOKEN && {id: 'notion', title: t('helperMore.connectNotion'), why: t('helperMore.jobsSavedThere'), button: t('helperMore.connectNotionArrow')}, // about Notion
    // Always on runs the chosen family's API engine (lib/ai/index.js alwaysOnEngine): Anthropic's key for Claude, OpenAI's for OpenAI.
    !own[key.name] && {id: 'ai', title: t('helperMore.addProviderKey', {provider: key.provider}),
      why: t('helperMore.githubOwnKeyWhy', {engine: freeAi ? 'Free AI' : key.cli}),
      button: t('helperMore.addApiKeyArrow'), alt: {setting: 'hosted', button: t('helperMore.useOurServersArrow')}},
  ].filter(Boolean);
}

export const NOTION_FOR = t('helperMore.notionFor');
export const KEY_FOR = t('helperMore.keyFor');

/** The own way's three requirements as sibling rows (owner, 4 Nov 2026: “Notion should not be inside Github. They should be siblings. Both of them are needed”): Notion and the API key here, GitHub is its own row.
 *  -> {rows: [{id, title, pill: [text, tone], line, button?, alt?}], done}; done counts GitHub when `githubOn`, out of 3. */
export function requirementRows(state, key, {githubOn = false} = {}) {
  const missing = alwaysOnNeeds(state, key), need = id => missing.find(row => row.id === id);
  const notion = need('notion'), ai = need('ai');
  const rows = [
    // Each row says what it is for (owner, 4 Nov 2026: "GitHub (explain for what), Notion (explain for what), API AI Key (explain for what)").
    notion ? {id: 'notion', title: 'Notion', pill: [t('helperMore.needed'), 'warn'], line: NOTION_FOR, button: notion.button} // about Notion
      : {id: 'notion', title: 'Notion', pill: [t('helpers.connected'), 'good'], line: NOTION_FOR}, // about Notion
    ai ? {id: 'ai', title: t('helperMore.providerApiKey', {provider: key.provider}), pill: [t('helperMore.needed'), 'warn'], line: `${KEY_FOR} ${ai.why}`, button: ai.button, alt: ai.alt}
      : {id: 'ai', title: t('helperMore.providerApiKey', {provider: key.provider}), pill: [t('helperMore.added'), 'good'], line: t('helperMore.keyEncrypted', {purpose: KEY_FOR})},
  ];
  return {rows, done: rows.filter(row => row.pill[1] === 'good').length + (githubOn ? 1 : 0)};
}
