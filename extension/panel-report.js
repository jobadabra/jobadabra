// panel popup: restyled by the panel redesign. "Report" in the panel's footer (owner, 19 Oct 2026: the recording is always on, so Report sends it): a small popup ON the panel that says what goes, takes an
// optional note, then Send or Cancel. Nothing is recorded or reloaded by pressing it: the worker (messages-report.js) hands the trace kept so far to the app, which removes the personal details, holds
// the result and answers with counts; Send sends that, Cancel drops it. Drawn inside the panel's own shadow root with the panel's CSS tokens (so its theme reaches it); review.js mounts it and opens it.
// It still works after a Stop (the recording kept until then is what is sent). Guard: desktop/test/unit/extension/report-panel.test.js, desktop/e2e/test/report-button.test.mjs.
(() => {
  const t = (...args) => window.__jobadabraPanelI18n.t(...args);
  if (window.__jobadabraReport) return;
  const STYLE = `.report-pop { position: fixed; right: 18px; bottom: 84px; width: 348px; max-width: calc(100vw - 36px); z-index: 2; padding: 14px; border-radius: 14px; color: var(--ink); background: var(--card);
      border: 1px solid var(--line); box-shadow: 0 10px 32px var(--shadow); pointer-events: auto; }
    .report-pop b { display: block; margin-bottom: 6px; font-size: 14px; } .report-pop p { margin: 0 0 8px; } .report-pop .muted { color: var(--muted); font-size: 12px; }
    .report-pop textarea { width: 100%; min-height: 54px; resize: vertical; padding: 7px 9px; border-radius: 8px; border: 1px solid var(--line); background: var(--soft); color: var(--ink); font: inherit; }
    .report-pop .row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 10px; }
    .report-pop .act { padding: 7px 14px; border-radius: 8px; border: 1px solid var(--line); background: var(--btn); color: var(--ink); font-weight: 600; }
    .report-pop .act.main { background: var(--signal); border-color: var(--signal); color: var(--on-signal); } .report-pop .act[disabled] { opacity: .6; cursor: default; }
    .report-pop .act:focus-visible, .report-pop textarea:focus-visible { outline: 3px solid var(--info); outline-offset: 2px; }`;
  const WORDS = {stopped: 'Jobadabra was stopped before anything was recorded on this page. Press Apply in the app to start again.',
    off: 'The recording is turned off in Jobadabra Settings, so there is nothing to send.', empty: 'Nothing has been recorded on this page yet (a sign-in page is never recorded). Try again after the page has loaded.',
    worker: 'Jobadabra could not reach its extension service. Reload this page and try again.', app: 'The Jobadabra app did not answer. Is the app open? Open it and press Report again.', expired: 'This report expired. Press Report again.',
    failed: 'The app hit an error while preparing this report, so nothing was sent. Press Report again; if it repeats, the app\'s log says what stopped it.',
    connect: 'The extension is not connected to the app. Open Jobadabra, then reload this page and press Report again.',
    old: 'This version of the app does not have Report yet. Update the app, then try again.',
    error: 'The extension hit an error while handing over the recording. Reload this page and try again.',
    unknown: 'The app did not understand the request. Update the app and the extension to the same version.',
    other: 'Something unexpected stopped the report, so nothing was sent. Press Report again.'};
  const BLOCKED = 'Jobadabra could not remove everything personal from it safely, so nothing was sent.';   // the same sentence the app logs
  const KINDS = {email: 'an e-mail address', phone: 'a phone number', name: 'your name', 'name-in-code': 'your name inside a script', location: 'your place', token: 'a sign-in token'};
  const word = kind => t('report.refused.'+kind,WORDS[kind]);
  const kindWord = kind => KINDS[kind] ? t('report.kind.'+kind,KINDS[kind]) : kind;
  let pop = null, send = null, lastView = null, sending = false, refreshSummary = () => {};
  const value = text => typeof text === 'function' ? text() : text;

  const say = (title, text, buttons = [], extra = []) => {
    lastView = [title,text,buttons,extra];
    pop.replaceChildren();
    const head = document.createElement('b'), body = document.createElement('p'), row = document.createElement('div');
    head.textContent = value(title); body.textContent = value(text); row.className = 'row';
    for (const [label, main, onPress] of buttons) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = `act${main ? ' main' : ''}`; button.textContent = value(label);
      button.addEventListener('click', event => { if (event.isTrusted) onPress(button); });   // a page's script cannot press it for the person
      row.append(button);
    }
    pop.append(head, body, ...extra, row);
    pop.hidden = false;
  };
  const close = () => { pop.hidden = true; };
  // The one true sentence for an answer that is not ok: its kind, else what the last check found, else what the upload said; never "the app is not open" unless the app did not answer.
  const refusal = answer => ((WORDS[answer?.refused] ? word(answer.refused) : '') || (answer?.blocked ? `${t('report.blocked',BLOCKED)} ${t('report.stillFound','Still found: {kinds}.',{kinds:[...new Set((answer.blocked || []).map(kindWord))].join(', ')})}` : answer?.error || word('other')));
  const ask = message => (send ? send(message).catch(() => null) : Promise.resolve(null));

  async function open() {
    say(() => (t("report.sendTitle", 'Send this form\'s recording?')), () => (t("report.preparing", 'Preparing what would be sent…')), [[() => (t("common.cancel", 'Cancel')), false, close]]);
    const state = await ask({type: 'report-state'});
    if (!state) { say(() => (t("report.nothingSent", 'Nothing was sent')), () => (word('worker')), [[() => (t("common.ok", 'OK')), true, close]]); return; }
    if (state.problem) { say(() => (t("report.nothingSent", 'Nothing was sent')), () => (refusal({refused: state.problem})), [[() => (t("common.ok", 'OK')), true, close]]); return; }   // the app could not be asked: that is not "turned off"
    if (state.enabled === false) { say(() => (t("report.nothing", 'Nothing to send')), () => (word('off')), [[() => (t("common.ok", 'OK')), true, close]]); return; }
    if (!state.has) { say(() => (t("report.nothingYet", 'Nothing to send yet')), () => (word(state.stopped ? 'stopped' : 'empty')), [[() => (t("common.ok", 'OK')), true, close]]); return; }
    const answer = await ask({type: 'report-send'});
    if (!answer?.ok) { say(() => (t("report.nothingSent", 'Nothing was sent')), () => (answer ? refusal(answer) : word('worker')), [[() => (t("common.ok", 'OK')), true, close]]); return; }
    const data = answer.preview || {}, removed = Object.values(data.removed || {}).reduce((sum, n) => sum + (Number(n) || 0), 0);
    const note = Object.assign(document.createElement('textarea'), {placeholder: t("report.note", 'What went wrong? (optional)'), maxLength: 300});
    const lines = document.createElement('div');
    lines.innerHTML = '<p class="muted"></p><p class="muted">Never sent: what you typed, passwords, cookies, your CV or your profile. Encrypted before it leaves this Mac; deleted after 30 days.</p>';
    const summaryLine = lines.firstChild, privacyLine = lines.lastChild;
    const summary = () => t('report.summary','{responses} from {sites}. Personal details removed: {removed}.',{responses:t('report.responses','{count} page responses',{count:data.responses || 0}),sites:t('report.sites','{count} sites',{count:(data.hosts || []).length}),removed}) + (data.removed?.unclean ? t('report.unclean',' One page part could not be cleaned, so it was left out.') : '');
    summaryLine.textContent = summary();
    const privacy = 'Never sent: what you typed, passwords, cookies, your CV or your profile. Encrypted before it leaves this Mac; deleted after 30 days.';
    privacyLine.textContent = t('report.privacy',privacy);
    privacyLine.dataset.jpI18n = 'report.privacy';
    note.dataset.jpPlaceholder = 'report.note';
    refreshSummary = () => { summaryLine.textContent = summary(); };
    say(() => (t("report.sendTitle", 'Send this form\'s recording?')), () => (t("report.explains", 'It shows how Jobadabra read this form, so it can be fixed.')), [[() => (t("common.cancel", 'Cancel')), false, async () => { close(); ask({type: 'report-cancel'}); }], [() => (t("report.send", 'Send')), true, async button => {
      sending = true; button.disabled = true; button.textContent = t("report.sending", 'Sending…');
      const done = await ask({type: 'report-confirm', note: note.value});
      sending = false;
      if (done?.ok) say(() => (t("report.sent", 'Sent')), () => (t("report.thanks", 'Thank you. It is encrypted, and you can delete it any time in Jobadabra Settings.')), [[() => (t("common.ok", 'OK')), true, close]]);
      else say(() => (t("report.nothingSent", 'Nothing was sent')), () => (done ? refusal(done) : word('worker')), [[() => (t("common.ok", 'OK')), true, close]]);
    }]], [summaryLine, privacyLine, note]);
  }

  // review.js hands over the panel's shadow root and its message function, then opens the popup from the footer's Report. The first state answer goes back to review.js (whether the switch is on).
  function mount(root, sendMessage, onState = () => {}) {
    send = sendMessage;
    root.append(Object.assign(document.createElement('style'), {textContent: STYLE}));
    pop = Object.assign(document.createElement('div'), {className: 'report-pop', hidden: true});
    pop.setAttribute('role', 'dialog'); pop.dataset.jpAriaLabel = 'report.aria';
    pop.setAttribute('aria-label', t("report.aria", 'Send this form\'s recording'));
    (root.querySelector('.jp') || root).append(pop);   // inside the panel's own box: its fonts and colour tokens apply
    ask({type: 'report-state'}).then(onState);
  }
  window.__jobadabraPanelI18n?.onChange(() => { refreshSummary(); if (!sending && pop && !pop.hidden && lastView) say(...lastView); });
  window.__jobadabraReport = {mount, open, words: WORDS, sentence: refusal};   // words and sentence: for desktop/test/unit/extension/report-failures.test.js
})();
