// Settings: only the connection to the Jobadabra app — filled in by itself when this page opens, or by Connect.
// The user's contact details and CV live in the app, which the extension asks for each time it fills a form (flow.js).
import {plainWhy} from './ai-reply.js';
import {pair, api} from './flow.js';
import {displayLanguage, localize, locales, languageNames} from './i18n.js';

const $ = id => document.getElementById(id);
const i18n = await displayLanguage();
const t = (key, values) => i18n.t(key, values);
const language = $('displayLanguage');
const follow = document.createElement('option');
follow.value = 'desktop';
language.append(follow);
for (const locale of locales) {
  const option = document.createElement('option');
  option.value = locale; option.textContent = languageNames[locale]; language.append(option);
}
let connectionState = 'checking', connectionDetail = ['looking'];
function renderLanguage() {
  localize(document, i18n); follow.textContent = t('follow'); language.value = i18n.choice();
  pairWords(connectionState, ...connectionDetail);
}
i18n.subscribe(renderLanguage);
language.addEventListener('change', () => i18n.preference(language.value));
const APP_URL = 'http://127.0.0.1';
const usesApp = url => !url || url.startsWith(APP_URL);   // the same rule as flow.js: not our own Worker
const stored = await chrome.storage.local.get(['workerUrl', 'token', 'checkEligibility', 'testMode', 'clickDropdowns', 'acceptConsents']);
// Every site: an optional permission, granted only by Chrome's own prompt from this click.
const EVERY_SITE = {origins: ['https://*/*']};
$('anySite').checked = await chrome.permissions.contains(EVERY_SITE);
$('anySite').addEventListener('change', async () => {
  const on = $('anySite').checked;
  const ok = await (on ? chrome.permissions.request(EVERY_SITE) : chrome.permissions.remove(EVERY_SITE)).catch(() => false);
  if (on && !ok) $('anySite').checked = false;
});
// Cookies: an optional permission too, asked by Chrome from this click (ready-handoff.js uses it only when granted).
const COOKIES = {permissions: ['cookies']};
$('carryLogins').checked = await chrome.permissions.contains(COOKIES);
$('carryLogins').addEventListener('change', async () => {
  const on = $('carryLogins').checked;
  const ok = await (on ? chrome.permissions.request(COOKIES) : chrome.permissions.remove(COOKIES)).catch(() => false);
  if (on && !ok) $('carryLogins').checked = false;
});
$('acceptConsents').checked = stored.acceptConsents !== false;   // on unless turned off (owner, 17 Oct 2026)
$('acceptConsents').addEventListener('change', () => chrome.storage.local.set({acceptConsents: $('acceptConsents').checked}));
// Chrome grants debugger only at install (it can't be optional); this switch decides whether it's used.
$('clickDropdowns').checked = stored.clickDropdowns !== false;  // on by default
$('clickDropdowns').addEventListener('change', () => chrome.storage.local.set({clickDropdowns: $('clickDropdowns').checked}));
$('testMode').checked = stored.testMode === true;
$('testMode').addEventListener('change', () => chrome.storage.local.set({testMode: $('testMode').checked}));
$('checkEligibility').checked = stored.checkEligibility !== false;
$('checkEligibility').addEventListener('change', () => chrome.storage.local.set({checkEligibility: $('checkEligibility').checked}));
$('workerUrl').value = stored.workerUrl || '';
$('token').value = stored.token || '';

// The pair button is the escape hatch (a reinstalled app, another Mac, a new workspace), not a step: the extension
// pairs itself whenever the app turns its token down. So it only looks like a call to action when there is one — with
// the app answering it is a small Reconnect beside the answer.
function pairWords(state, key = '', values = {}) {
  connectionState = state; connectionDetail = [key, values];
  const button = $('pair');
  // Only "the app couldn't be reached" is a call to action; the rest are quiet, so the page never asks for a click
  // that has nothing to do.
  button.className = state === 'disconnected' ? '' : 'secondary small';
  button.disabled = state === 'checking';
  button.textContent = t(state === 'connected' ? 'reconnect' : state === 'checking' ? 'connecting' : 'connect');
  $('pair-status').textContent = key ? t(key, values) + (state === 'connected' ? ' ✓' : '') : '';
  $('pair-status').className = state === 'connected' ? 'on' : '';
}
async function connectToApp() {
  pairWords('checking', 'looking');
  try {
    const {workerUrl, token} = await pair();
    $('workerUrl').value = workerUrl;
    $('token').value = token;
    pairWords('connected', 'connected');
    await api({workerUrl, token}, '/extension/review', {method:'POST', body:'{}'}).catch(() => {});
  } catch (error) {
    pairWords('disconnected', 'connectError', {error:plainWhy(error)});
  }
}
$('pair').addEventListener('click', connectToApp);
// Opening the page refreshes the connection — and heals a token the app rotated (reinstall, reset, another Notion
// workspace), because pair() saves what it finds. A URL of your own is left alone.
if (usesApp(stored.workerUrl) || !stored.token) connectToApp();
else pairWords('worker', 'worker');
renderLanguage();
// Existing review polling refreshes managed tabs; options also refreshes when the person returns from desktop Settings.
window.addEventListener('focus', async () => {
  const config = await chrome.storage.local.get(['workerUrl', 'token']);
  if (usesApp(config.workerUrl) && config.token) await api(config, '/extension/review', {method:'POST', body:'{}'}).catch(() => {});
});

$('save').addEventListener('click', async () => {
  await chrome.storage.local.set({workerUrl: $('workerUrl').value.trim(), token: $('token').value.trim()});
  $('saved').textContent = t('saved');
  setTimeout(() => { $('saved').textContent = ''; }, 2000);
});
