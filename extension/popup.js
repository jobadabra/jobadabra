// The toolbar popup: whether the extension can reach the Jobadabra app and, on a tab the app opened and manages, what fits that tab (Apply on this page,
// Allow, Read on a board it opened for you, Stop). On any other tab it only says where things happen: no control at all (popup-controls.js, owner 16 Oct 2026).
import {startDisplayPage} from './display-page.js';
import {localize} from './i18n.js';
import {api, settings} from './flow.js';
import {popupMode} from './tab-pages.js';
import {POPUP_CONTROLS, judgedUrl, popupControls} from './popup-controls.js';

const i18n = startDisplayPage(document);
const t = (key, values) => i18n.t(key, values);
const messages = new Map();
const text = (id, key, values = {}) => { messages.set(id, {key, values}); document.getElementById(id).textContent = t(key, values); };
const externalText = (id, value) => { messages.delete(id); document.getElementById(id).textContent = value; };
const renderLanguage = () => { localize(document, i18n); for (const [id, {key, values}] of messages) document.getElementById(id).textContent = t(key, values); renderProgress?.(); };
let renderProgress = null;
i18n.subscribe(renderLanguage);
renderLanguage();
const $ = id => document.getElementById(id);
$('settings').addEventListener('click', event => { event.preventDefault(); chrome.runtime.openOptionsPage(); });
const show = (ids) => { for (const id of POPUP_CONTROLS) $(id).hidden = !ids.includes(id); };   // the one place a control appears

// Stop: one press halts the extension everywhere (stop.js). Wired first, shown on a managed tab before the connection check, so a slow check never hides it.
$('stop').addEventListener('click', () => {
  $('stop').disabled = true;
  chrome.runtime.sendMessage({type: 'stop', reason: 'the Stop button in the toolbar popup'}, answer => {
    $('stop-note').className = 'stopped';
    text('stop-note', answer?.ok ? 'stopped' : 'stopError');
  });
});

async function connection(config, app) {
  try {
    await api(config, '/extension/review', {method: 'POST', body: '{}'});  // a harmless call: matches no page, changes nothing
    $('status').classList.add('on');
    text('status', app ? 'connected' : 'connectedWorker');
  } catch (error) {
    if (error.status && error.status !== 401) {  // it answered (your Worker has no review route): reachable
      $('status').classList.add('on');
      text('status', app ? 'connected' : 'connectedWorker');
    } else {
      text('status', app ? 'appOffline' : 'workerOffline');
    }
  }
}

const allowButton = (done) => $('visit-allow').addEventListener('click', async () => {
  const ok = await chrome.permissions.request({origins: ['https://*/*']}).catch(() => false);
  text('visit-progress', ok ? done : 'notAllowed');
});

(async () => {
  const config = await settings();
  const app = !config.workerUrl || config.workerUrl.startsWith('http://127.0.0.1');
  const checked = connection(config, app);
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  if (!app || !tab?.id) return checked;
  const kept = await chrome.storage.session.get([`armed:${tab.id}`, `readmark:${tab.id}`]).catch(() => ({}));
  const mode = popupMode({url: judgedUrl(tab.url, kept[`readmark:${tab.id}`]), armed: kept[`armed:${tab.id}`]});
  // A tab the app opened to apply: the panel on the page fills the form.
  if (mode === 'fill') {
    // Not allowed on this site yet: the panel can't start, so the popup says so and offers the Allow (site-allow.js), never "the panel fills the form".
    if (!(await chrome.permissions.contains({origins: [`${new URL(tab.url).origin}/*`]}).catch(() => true))) {
      text('intro', 'fillPermission');
      $('visit').hidden = false;
      show(popupControls(mode, {allowed: false}));
      allowButton('allowedFill');
      return checked;
    }
    text('intro', 'fillIntro');
    // Always there on a tab the app opened (owner, 9 Oct 2026: after a refresh nothing started and there was no way to start it): run the fill again, here.
    show(popupControls(mode));
    $('apply-here').addEventListener('click', () => {
      $('apply-here').disabled = true;
      text('apply-progress', 'starting');
      chrome.runtime.sendMessage({type: 'applyHere', tabId: tab.id}, answer => { if (answer?.ok) text('apply-progress', 'started'); else if (answer?.whyKey) text('apply-progress',answer.whyKey,answer.whyValues); else if (answer?.why) externalText('apply-progress', answer.why); else text('apply-progress', 'startError'); $('apply-here').disabled = false; });
    });
    return checked;
  }
  if (mode !== 'read' && mode !== 'board') return checked;   // the person's own tab: only the line that says where things happen
  // A tab the app opened to read its jobs: it reads by itself (visit.js), so nothing to press but Stop; only what it does.
  $('visit').hidden = false;
  const host = new URL(tab.url).hostname;
  const allowed = await chrome.permissions.contains({origins: ['https://*/*']}).catch(() => true);
  show(popupControls(mode, {allowed}));
  // Waiting for the one-time permission (Chrome asks; withdraw it any time in Chrome's settings).
  if (!allowed) {
    text('visit-text', 'readPermission');
    allowButton('allowedRead');
  } else if (mode === 'board') {
    // "Read this board": the app opened it and waits; the person signs in here if the board asks, then presses Read (their own visit, in their own Chrome).
    text('visit-text', 'boardIntro', {host});
    for (const [id, filter] of [['read-filter', true], ['read-as-is', false]]) $(id).addEventListener('click', () => {
      $('read-filter').disabled = $('read-as-is').disabled = true;
      text('visit-progress', filter ? 'filtering' : 'readingShort');
      chrome.runtime.sendMessage({type: 'visitRead', tabId: tab.id, filter}, state => {
        $('read-filter').disabled = $('read-as-is').disabled = false;
        if (!state?.ok) text('visit-progress', 'notRead', {error:state?.error || t('noAnswer')});
      });
    });
  } else {
    text('visit-text', 'autoReading');
  }
  const progress = state => {
    if (!state) return;
    renderProgress = () => {
      const values = {name:state.name || host, pages:i18n.number(state.pages), jobs:t('jobs', {count:state.jobs})};
      externalText('visit-progress', state.stopped
        ? (state.filters?.length ? t('filters', {filters:state.filters.join(', ')}) : '') + (state.note ? `${state.note}. ` : '') + t('readStopped', {...values, pages:t('pages', {count:state.pages}), reason:state.stopped})
        : t('reading', values));
    };
    renderProgress();
  };
  progress((await chrome.storage.session.get(`visit:${tab.id}`))[`visit:${tab.id}`]);
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'session' && changes[`visit:${tab.id}`]) progress(changes[`visit:${tab.id}`].newValue); });
  return checked;
})();
