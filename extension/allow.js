// The extension's own page with the one Allow button (Chrome asks for a site permission only from the extension's own page, on a click).
// Opened by visit.js when a tab the app marked waits for it; once allowed, the waiting tabs start reading and this page closes.
// Only what manifest.json declares (optional_host_permissions): Chrome refuses a request for anything else with no prompt (7 Oct 2026: every Allow
// click said Not allowed, because 'http://*/*' was asked too). test/guards/rules/extension-permissions.test.js checks it.
import {displayLanguage,localize} from './i18n.js';
const ui = await displayLanguage();
const render = () => localize(document,ui);
ui.subscribe(render); render();
const ALL_SITES = {origins: ['https://*/*']};
document.getElementById('allow').addEventListener('click', async () => {
  const ok = await chrome.permissions.request(ALL_SITES).catch(() => false);
  const said = document.getElementById('said');
  said.className = ok ? 'done' : '';
  said.dataset.i18n = ok ? 'allow.allowed' : 'allow.denied';
  said.textContent = ui.t(said.dataset.i18n);
  if (ok) setTimeout(() => window.close(), 1500);
});
