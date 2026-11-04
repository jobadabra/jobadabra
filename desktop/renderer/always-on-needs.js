// What Always on on GitHub still needs from the person, as checklist rows (pure; the card is renderer/pages/connections.js). Guard: test/always-on-needs.test.js.
// Why (3 Nov 2026, owner: "they should use their own API Key ... I think we should request it before we copy the template"): Free AI's token sits in the same key slot as a person's own key
// and is never copied to GitHub (lib/github.js), so it counts as missing here (ownKeys), and the row says where else to go without a key: our servers.
import {ownKeys} from './ai-engine-view.js';

/** state: the window's state ({secrets, ownSecrets}); key: the chosen family's {name, provider, cli}. -> rows {id, title, why, button, alt?}, empty when Always on can be turned on. */
export function alwaysOnNeeds(state, key) {
  const secrets = state.secrets || {}, own = ownKeys(state), freeAi = !own[key.name] && !!secrets[key.name];
  return [
    !secrets.NOTION_TOKEN && {id: 'notion', title: 'Connect Notion', why: 'Your jobs are saved there.', button: 'Connect Notion →'}, // about Notion
    // Always on runs the chosen family's API engine (lib/ai/index.js alwaysOnEngine): Anthropic's key for Claude, OpenAI's for OpenAI.
    !own[key.name] && {id: 'ai', title: `Add an ${key.provider} API key`,
      why: `GitHub runs in the cloud, so it cannot use ${freeAi ? 'Free AI' : key.cli} on this Mac. Paste your own key; it is stored as an encrypted GitHub secret. No key? Run it on our servers instead: no key needed.`,
      button: 'Add API key →', alt: {setting: 'hosted', button: 'Use our servers →'}},
  ].filter(Boolean);
}

export const NOTION_FOR = 'Where Always on saves every job it finds, so they are there on any device.';
export const KEY_FOR = 'Pays for the AI that reads and scores each job.';

/** The own way's three requirements as sibling rows (owner, 4 Nov 2026: “Notion should not be inside Github. They should be siblings. Both of them are needed”): Notion and the API key here, GitHub is its own row.
 *  -> {rows: [{id, title, pill: [text, tone], line, button?, alt?}], done}; done counts GitHub when `githubOn`, out of 3. */
export function requirementRows(state, key, {githubOn = false} = {}) {
  const missing = alwaysOnNeeds(state, key), need = id => missing.find(row => row.id === id);
  const notion = need('notion'), ai = need('ai');
  const rows = [
    // Each row says what it is for (owner, 4 Nov 2026: "GitHub (explain for what), Notion (explain for what), API AI Key (explain for what)").
    notion ? {id: 'notion', title: 'Notion', pill: ['Needed', 'warn'], line: NOTION_FOR, button: notion.button} // about Notion
      : {id: 'notion', title: 'Notion', pill: ['Connected', 'good'], line: NOTION_FOR}, // about Notion
    ai ? {id: 'ai', title: `${key.provider} API key`, pill: ['Needed', 'warn'], line: `${KEY_FOR} ${ai.why}`, button: ai.button, alt: ai.alt}
      : {id: 'ai', title: `${key.provider} API key`, pill: ['Added', 'good'], line: `${KEY_FOR} Your own key, stored as an encrypted GitHub secret.`},
  ];
  return {rows, done: rows.filter(row => row.pill[1] === 'good').length + (githubOn ? 1 : 0)};
}
