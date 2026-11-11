// Pasted keys and tokens: drop what copying adds (spaces, line breaks, invisible characters) and
// catch look-alike letters from another keyboard layout, which no API key contains.
import '../i18n/setup-notices.js';
import {withDisplay} from '../i18n/display-values.js';

const INVISIBLE = /[\s ​-‍⁠﻿]/g;

/** Clean a pasted key without changing validation; bad-character diagnostics disclose only one character and carry private UI metadata. */
export function cleanSecret(value) {
  const cleaned = String(value ?? '').replace(INVISIBLE, '');
  const bad = [...cleaned].findIndex(char => char < '!' || char > '~');
  if (bad === -1) return {value: cleaned};
  const char = [...cleaned][bad];
  const code = `U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
  return withDisplay({error: `Character ${bad + 1} ("${char}", ${code}) can't be part of a key: it looks like a letter ` +
    'from another keyboard layout or text editor. Copy the key again with its copy button and paste it here.'}, 'setupNotice.badCharacter', {position: bad + 1, char, code});
}

// The keys the PERSON saved. Free AI keeps its own token (JPF1.…, and the older credit's JP1.…) in the Anthropic key slot (lib/ai-free.js); that is not their key, so Settings must not call it
// "Connected" or show its last four characters as "your API key" (2 Nov 2026, owner: "How it can show Connected on the API key if no API is set").
const OURS = /^JPF?1\./;
/** secretsPresent() without Free AI's token: {NAME: boolean} of the keys the person saved themselves. */
export function ownSecretsPresent(storage) {
  const present = storage.secretsPresent();
  return {...present, ANTHROPIC_API_KEY: present.ANTHROPIC_API_KEY && !OURS.test(storage.secret('ANTHROPIC_API_KEY'))};
}
// Saved keys as dots plus their last 4 characters (never the key), for the ones that are the person's own.
export function ownSecretHints(storage, names = ['ANTHROPIC_API_KEY', 'NOTION_TOKEN', 'TELEGRAM_BOT_TOKEN', 'SERPAPI_API_KEY', 'OPENAI_API_KEY', 'BRAVE_SEARCH_API_KEY']) {
  const own = ownSecretsPresent(storage);
  return Object.fromEntries(names.filter(name => own[name]).map(name => [name, `${'•'.repeat(12)}${storage.secret(name).slice(-4)}`]));
}
