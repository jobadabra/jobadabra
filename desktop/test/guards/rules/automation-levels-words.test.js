// No text the app or the extension shows says Jobadabra never submits while the app offers Full automation (owner, 12 Nov 2026, asked via AskUserQuestion: "I don't think we should seel this that \"never submits\"... we offer different level of automations and review. This is what we can sell"; "Yes, next free slot" for the app's own lines).
// Why (12 Nov 2026, [27-pane-at]): the third level fills AND submits once the person's checks pass, yet the Chrome dialog, the extension's options page and README, the Sessions card and the welcome screen still said "never presses Submit" / "you click Submit yourself" (sister guard on the site: jobadabra-web test/guards/automation-levels-words.test.js).
import assert from 'node:assert/strict';
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const read = file => readFileSync(join(root, file), 'utf8');

// The claim in its spoken forms (en de fr it es ro ru); each is false once Automatically exists.
const NEVER_SUBMITS = [
  /never\s+(?:presses|press|clicks?|submits?|sends?)\b[^.<"]{0,20}\bsubmit|never\s+submits?\b/i,
  /you\s+always\s+(?:press|click)\s+submit/i,
  /click\s+submit,?\s+never\s+automated/i,
  /never\s+applies\s+on\s+its\s+own/i,
  /nie(?:mals)?\s+(?:auf\s+)?Absenden/i,
  /jamais\s+sur\s+Envoyer|n’appuie\s+jamais/i,
  /non\s+(?:preme|clicca)\s+mai\s+(?:su\s+)?Invia/i,
  /nunca\s+(?:pulsa|presiona)\s+Enviar/i,
  /nu\s+apasă\s+(?:niciodată\s+)?Trimite/i,
  /(?:никогда\s+)?не\s+нажимает\s+«Отправить»/i,
];
// Why (12 Nov 2026, [27-pane-at]): these features really never submit, whatever the level: Claude's takeover of a stuck page (text417/419, claudeConsent), Apply with Claude (consentDetail, claude.consent) and the AI-app's own rule (appPrivacy).
const TRUE_NEVER = /text417|text419|consentDetail|claude\.consent|claudeConsent|appPrivacy/;
// Already scoped to the levels that never submit, or to the agents' own rules.
const SCOPED = /Standard or Background|by default|AGENTS\.md|Full automation/;

const walk = dir => readdirSync(join(root, dir)).flatMap(name => {
  const rel = `${dir}/${name}`;
  return statSync(join(root, rel)).isDirectory() ? walk(rel) : [rel];
});
const SHOWN = [
  ...walk('desktop/i18n/catalogs').filter(file => file.endsWith('.js')),
  ...walk('extension/locales').filter(file => file.endsWith('.js')),
  'desktop/renderer/index.html', 'extension/options.html', 'extension/README.md', 'README.md',
];

test('the app still offers the Automatically level, so the guard below is in force', () => {
  assert.match(read('desktop/renderer/apply-settings-model.js'), /id:\s*'auto'/, 'if the "auto" mode was removed on purpose, retire this guard with the owner\'s yes');
});

test('no text shown to a person claims Jobadabra never submits', () => {
  const bad = [];
  for (const file of SHOWN) {
    let prev = '';   // an HTML text may run on to the next line: its key is on the line before
    read(file).split('\n').forEach((line, i) => {
      const owned = TRUE_NEVER.test(line) || TRUE_NEVER.test(prev) && !/data-i18n/.test(line);
      prev = line;
      if (owned || SCOPED.test(line)) return;
      const hit = NEVER_SUBMITS.map(re => line.match(re)).find(Boolean);
      if (hit) bad.push(`${file}:${i + 1}: "${hit[0]}"`);
    });
  }
  assert.deepEqual(bad, [], 'say what each level does (In Chrome, In the background, Automatically), not "never submits":\n' + bad.join('\n'));
});

test('the third level is named as Settings → Apply names it: "Full automation", never "Automatically"', () => {
  // Why (12 Nov 2026, [27-pane-at], Gitar on #3926): the first draft told people to "turn on Automatically", a name no screen shows; helperMore.fullAutomation is the label (Vollautomatik, Automatisation complète, …).
  assert.match(read('desktop/i18n/catalogs/helpers/en-more.js'), /"fullAutomation": "Full automation"/);
  const bad = [];
  for (const file of SHOWN) read(file).split('\n').forEach((line, i) => { if (/\bAutomatically\b/.test(line)) bad.push(`${file}:${i + 1}`); });
  assert.deepEqual(bad, [], 'name the level "Full automation" (its translations are in desktop/i18n/catalogs/helpers/*-more.js):\n' + bad.join('\n'));
});

test('the guard catches the old claim in each language', () => {
  for (const old of ['It never presses Submit: you do.', 'Jobadabra never clicks Submit.', 'Jobadabra klickt niemals auf Absenden.', 'Jobadabra drückt nie auf Absenden.', 'Elle ne clique jamais sur Envoyer', 'Jobadabra n’appuie jamais sur Envoyer.',
    'Jobadabra non preme mai Invia.', 'Jobadabra nunca pulsa Enviar.', 'Jobadabra nu apasă niciodată Trimite.', 'Jobadabra не нажимает «Отправить».', 'You always press Submit', 'you review and click Submit, never automated.', 'The system never applies on its own initiative']) {
    assert.ok(NEVER_SUBMITS.some(re => re.test(old)), old);
  }
  assert.ok(!NEVER_SUBMITS.some(re => re.test('Jobadabra submits only in Full automation, once you turned it on.')), 'the true wording passes');
});
