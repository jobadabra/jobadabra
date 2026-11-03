// What Always on on GitHub still needs from the person, as checklist rows (pure; the card is renderer/pages/connections.js). Guard: test/always-on-needs.test.js.
// Why (3 Nov 2026, owner: "they should use their own API Key ... I think we should request it before we copy the template"): Free AI's token sits in the same key slot as a person's own key
// and is never copied to GitHub (lib/github.js), so it counts as missing here (ownKeys), and the row says where else to go without a key: our servers.
import {ownKeys} from './ai-engine-view.js';

/** state: the window's state ({secrets, ownSecrets}); key: the chosen family's {name, provider, cli}. -> rows {id, title, why, button, alt?}, empty when Always on can be turned on. */
export function alwaysOnNeeds(state, key) {
  const secrets = state.secrets || {}, own = ownKeys(state), freeAi = !own[key.name] && !!secrets[key.name];
  return [
    !secrets.NOTION_TOKEN && {id: 'notion', title: 'Connect Notion', why: 'Your jobs are saved there.', button: 'Connect Notion →'},
    // Always on runs the chosen family's API engine (lib/ai/index.js alwaysOnEngine): Anthropic's key for Claude, OpenAI's for OpenAI.
    !own[key.name] && {id: 'ai', title: `Add an ${key.provider} API key`,
      why: `GitHub runs in the cloud, so it cannot use ${freeAi ? 'Free AI' : key.cli} on this Mac. Paste your own key; it is stored as an encrypted GitHub secret. No key? Run it on our servers instead: no key needed.`,
      button: 'Add API key →', alt: {setting: 'hosted', button: 'Use our servers →'}},
  ].filter(Boolean);
}
