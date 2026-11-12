// No text the app or the extension shows says Jobadabra never submits while the app offers "Automatically" (owner, 12 Nov 2026, asked via AskUserQuestion: "I don't think we should seel this that \"never submits\"... we offer different level of automations and review. This is what we can sell"; "Yes, next free slot" for the app's own lines).
// Why (12 Nov 2026, [27-pane-at]): the third level fills AND submits once the person's checks pass, yet the Chrome dialog, the extension's options page and README, the Sessions card and the welcome screen still said "never presses Submit" / "you click Submit yourself" (sister guard on the site: jobadabra-web test/guards/automation-levels-words.test.js).
import assert from 'node:assert/strict';
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';

const root = new URL('../../../../', import.meta.url).pathname;
const read = file => readFileSync(join(root, file), 'utf8');

// The claim in its spoken forms (en de fr it es ro ru); each is false once Automatically exists.
const NEVER_SUBMITS = [
  /never\s+(?:presses|press|clicks?|submits?|sends?)\b[^.<"]{0,20}\bsubmit|never\s+submits?\b/i,
  /you\s+always\s+(?:press|click)\s+submit/i,
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
const SCOPED = /Standard or Background|by default|AGENTS\.md/;

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

test('the guard catches the old claim in each language', () => {
  for (const old of ['It never presses Submit: you do.', 'Jobadabra never clicks Submit.', 'Jobadabra klickt niemals auf Absenden.', 'Jobadabra drückt nie auf Absenden.', 'Elle ne clique jamais sur Envoyer', 'Jobadabra n’appuie jamais sur Envoyer.',
    'Jobadabra non preme mai Invia.', 'Jobadabra nunca pulsa Enviar.', 'Jobadabra nu apasă niciodată Trimite.', 'Jobadabra не нажимает «Отправить».', 'You always press Submit']) {
    assert.ok(NEVER_SUBMITS.some(re => re.test(old)), old);
  }
  assert.ok(!NEVER_SUBMITS.some(re => re.test('Jobadabra submits only in Automatically, once you turned it on.')), 'the true wording passes');
});
