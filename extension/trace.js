// The form trace (spec docs/superpowers/specs/2026-10-16-report-from-the-trace.md §1-§2): on a tab the app opened, from the job posting on, it keeps every response the page gets (address, status,
// timing, content type, location, body) through Chrome's debugger Network events, IN MEMORY ONLY (trace-buffer.js), so "Report this form" can hand it over at once, with no reload.
// It never reads request bodies, request headers or cookies. A page with a password field is never kept: that page is dropped whole, the debugger is released while it is shown (Chrome's bar goes
// away there) and the trace goes on after it. It shares the one debugger attachment with the fill's clicks (stop-state.js). Off when the Settings switch is off: no attach, no bar.
// Guards: desktop/test/unit/extension/trace.test.js, trace-buffer.test.js, trace-debugger.test.js.
import {attachDebugger, detachDebugger, forgetDebuggerUsers, isStopped} from './stop-state.js';
import {createBuffer} from './trace-buffer.js';

const KEEP_HEADER = /^(content-type|location|access-control-.*)$/i;   // the response headers a record holds (net-keep.js KEEP_HEADER)
const TYPES = {Document: 'document', Script: 'script', Stylesheet: 'stylesheet', Image: 'image', Font: 'font', Media: 'media', XHR: 'xhr', Fetch: 'fetch', Ping: 'ping'};
const TEXTUAL = new Set(['document', 'script', 'stylesheet', 'font', 'xhr', 'fetch', 'ping']);   // an image or media body is blanked or dropped by the scrub anyway: never read
const WATCH_MS = 1000;
const INTERCEPT = {patterns: [{resourceType: 'XHR', requestStage: 'Response'}, {resourceType: 'Fetch', requestStage: 'Response'}]};
const HOLD_MS = 500;   // a paused reply is let go after at most this long, body or not: a slow or never-ending reply must not stall the person's page

export function createTrace({chrome, attach = attachDebugger, detach = detachDebugger, stopped = isStopped, now = Date.now, hasPassword = async () => false, enabled = async () => true,
  setTimer = setTimeout, clearTimer = clearTimeout, buffer = createBuffer({now}), onChange = () => {}}) {
  const runs = new Map();   // tab id -> the live capture of that tab
  const starting = new Map();   // tab id -> the start still waiting (the app's answer, the attach)

  const send = (tabId, method, params) => chrome.debugger.sendCommand({tabId}, method, params);
  const pick = headers => Object.fromEntries(Object.entries(headers || {}).filter(([name]) => KEEP_HEADER.test(name)).map(([name, value]) => [name.toLowerCase(), String(value)]));
  const fetchMode = headers => String((headers || {})['Sec-Fetch-Mode'] || (headers || {})['sec-fetch-mode'] || '');   // the one request header read: it tells a beacon from a page's own call

  function finish(run, request, failed) {
    run.pending.delete(request.id);
    if (run.requests.get(request.id) === request) run.requests.delete(request.id);   // a finished request's body lives in the buffer only (and is evicted there)
    const reply = request.status > 0;
    const entry = {method: request.method, url: request.url, type: request.type, mode: request.mode, startMs: request.began - run.t0, waitMs: now() - request.began, bodyKey: '',
      status: request.status, failed: failed && !reply, headers: request.headers, hadCookie: false, body: request.body ?? null, size: request.size ?? 0, ...(request.bodyLost ? {bodyLost: true} : {})};
    buffer.add(run.tabId, entry, request.body ? request.body.length : 0);
  }

  // A reply of an XHR or fetch is taken at the Fetch domain's RESPONSE stage, where Chrome keeps it paused until we let it go: a page that navigates away right after its reply (a form built from the
  // answer and submitted: SuccessFactors' Apply) has lost the body by the time anything is read after loadingFinished (measured on a local page: 4 of 12 lost; at the response stage 0 of 60).
  // Every paused reply is released AS RECEIVED, whatever happens: an event stream is let go at once, any other after at most HOLD_MS, a failed one stays failed, and on a paused trace (a sign-in
  // page) nothing is read at all. The person's page never waits on us for longer than HOLD_MS.
  async function holdReply(tabId, params) {
    const run = runs.get(tabId);
    const release = () => (params.responseErrorReason !== undefined ? send(tabId, 'Fetch.failRequest', {requestId: params.requestId, errorReason: params.responseErrorReason})
      : send(tabId, params.responseStatusCode === undefined ? 'Fetch.continueRequest' : 'Fetch.continueResponse', {requestId: params.requestId})).catch(() => {});
    const type = String((params.responseHeaders || []).find(header => /^content-type$/i.test(header.name))?.value || '');
    if (!run || run.paused || params.responseStatusCode === undefined || /event-stream/i.test(type)) return release();
    try {
      const got = await Promise.race([send(tabId, 'Fetch.getResponseBody', {requestId: params.requestId}), new Promise((resolve, reject) => setTimer(() => reject(new Error('too slow')), HOLD_MS))]);
      if (params.networkId && runs.get(tabId) === run && !run.paused) run.bodies.set(params.networkId, got.base64Encoded ? got.body : btoa(unescape(encodeURIComponent(got.body))));
    } catch { /* a redirect, an empty reply or a slow one: the later read decides */ }
    return release();
  }

  // The body is read the instant Chrome says the loading finished (the earliest the protocol allows: Network.getResponseBody answers only after loadingFinished), never later. A page that navigates away
  // right after a reply (a form built from the answer and submitted) has its body evicted a moment later; when that read still fails on a reply that carried bytes (a 2xx whose encodedDataLength > 0),
  // the entry is flagged bodyLost, never kept as a clean empty reply: a report replaying it would serve an EMPTY answer (the same class as the recorder's, net-record.mjs, 16 Oct 2026).
  async function onFinished(run, request, encoded) {
    try {
      if (!TEXTUAL.has(request.type)) throw new Error('not read');
      let text = run.bodies.get(request.id);   // taken at the response stage (holdReply): the body the page got, before it could navigate away
      if (text !== undefined) run.bodies.delete(request.id);
      else { const {body, base64Encoded} = await send(run.tabId, 'Network.getResponseBody', {requestId: request.id}); text = base64Encoded ? body : btoa(unescape(encodeURIComponent(body))); }
      request.body = text; request.size = Math.floor(text.length * 3 / 4);
    } catch {   // a redirect, a cached reply or an image: the entry is kept without a body; a text reply that had bytes and could not be read is flagged
      request.body = null; request.size = Math.floor(encoded || 0);
      request.bodyLost = TEXTUAL.has(request.type) && request.status >= 200 && request.status < 300 && Number(encoded) > 0;
    }
    if (runs.get(run.tabId) === run && !run.paused) finish(run, request, false);
  }

  // The next page of the application; the run's own first page (base) while it is still empty, so a run never leaves an empty page that takes a kept slot (trace-buffer.js `pinned`).
  function nextPage(run) {
    const base = run.base;
    run.base = null;
    return base && !base.entries.length && buffer.current(run.tabId) === base ? base : buffer.page(run.tabId);
  }

  function onEvent(source, method, params) {
    if (method === 'Fetch.requestPaused') { holdReply(source.tabId, params); return; }   // always answered: a paused reply is never left waiting, whether a trace runs on the tab or not
    const run = runs.get(source.tabId);
    if (!run || run.paused) return;
    if (method === 'Page.frameNavigated') {
      if (params.frame.parentId) return;
      run.top = params.frame.id;
      if (!run.docSeen) run.missed = {page: nextPage(run), at: now() - run.t0};   // committed, but its request went out before the trace listened: loaded() reads it back
      run.shown = buffer.current(run.tabId);
      return;
    }
    if (method === 'Network.requestWillBeSent') {
      if (!/^https?:/i.test(params.request.url)) return;
      const old = run.requests.get(params.requestId);
      if (params.redirectResponse && old) { old.status = params.redirectResponse.status; old.headers = pick(params.redirectResponse.headers); finish(run, old, false); }
      // A top-level navigation (not a redirect, not a frame inside the page) starts the next page of the application.
      else if (params.type === 'Document' && params.requestId === params.loaderId && (!run.top || params.frameId === run.top)) { run.docSeen = true; run.missed = null; nextPage(run); }
      run.seen.add(params.request.url);
      run.requests.set(params.requestId, {id: params.requestId, method: params.request.method, url: params.request.url, type: TYPES[params.type] || 'other', mode: fetchMode(params.request.headers),
        began: now(), status: 0, headers: {}});
      run.pending.add(params.requestId);
    } else if (method === 'Network.responseReceived') {
      const request = run.requests.get(params.requestId);
      if (request) { request.status = params.response.status; request.headers = pick(params.response.headers); }
    } else if (method === 'Network.loadingFinished') {
      const request = run.requests.get(params.requestId);
      if (request && run.pending.has(request.id)) onFinished(run, request, params.encodedDataLength);
    } else if (method === 'Network.loadingFailed') {
      const request = run.requests.get(params.requestId);
      if (request && run.pending.has(request.id)) finish(run, request, true);
    }
  }
  chrome.debugger.onEvent.addListener(onEvent);

  // Why (10 Nov 2026, rr): the trace attaches only once the app has said the switch is on, and the page does not wait for that answer: the 27 Oct report began after its form had loaded, held
  // no document and could not replay. So when a page's document is complete (DOMContentLoaded) and the trace never saw its request, the page is read back from Chrome (Page.getResourceContent):
  // its document, and when the trace began after the commit also the code and styles it loaded before, never an image or a reply to a call (method and status unknown). Kept flagged `recovered`
  // (status and timing were not seen; a text Chrome no longer has is `bodyLost`, never an empty reply). Never on a page with a password field; dropped when a navigation began meanwhile.
  const READ_BACK = new Set(['script', 'stylesheet', 'font']);
  const bare = url => String(url || '').split('#')[0];
  async function readBack(run, url) {
    const missed = run.missed;
    run.missed = null;
    if (await hasPassword(run.tabId).catch(() => true)) return;   // a sign-in page: the watch pauses the trace; nothing is read
    const tree = (await send(run.tabId, 'Page.getResourceTree').catch(() => null))?.frameTree, frame = tree?.frame;
    if (!frame || frame.parentId || !/^https?:/i.test(frame.url || '') || bare(frame.url) !== bare(url)) return;   // not the page whose document just completed
    const items = [{url: frame.url, type: 'document', mimeType: frame.mimeType},
      ...(missed ? [] : (tree.resources || []).filter(item => !item.failed && !item.canceled && READ_BACK.has(TYPES[item.type]) && !run.seen.has(item.url)).map(item => ({...item, type: TYPES[item.type]})))];
    const entries = [];
    for (const [index, item] of items.entries()) {
      let body = null;
      try { const got = await send(run.tabId, 'Page.getResourceContent', {frameId: frame.id, url: item.url}); body = got.base64Encoded ? got.content : btoa(unescape(encodeURIComponent(got.content))); } catch { /* Chrome no longer has it */ }
      entries.push({method: 'GET', url: item.url, type: item.type, mode: index ? '' : 'navigate', startMs: missed ? missed.at - 1 : index ? -1 : -2, waitMs: 0, bodyKey: '', status: 200, failed: false,
        headers: item.mimeType ? {'content-type': String(item.mimeType)} : {}, hadCookie: false, body, size: body ? Math.floor(body.length * 3 / 4) : 0, recovered: true, ...(body ? {} : {bodyLost: true})});
    }
    if (runs.get(run.tabId) !== run || run.paused || run.docSeen || run.missed) return;   // a navigation began while reading: that page is no longer the one shown
    const page = missed?.page || run.base;
    if (!page || buffer.current(run.tabId) !== page) return;
    run.shown = page;
    for (const entry of entries) buffer.add(run.tabId, entry, entry.body ? entry.body.length : 0);
  }

  // A sign-in page is never kept: it and everything after its navigation are dropped, the debugger is let go of (no bar on the page), the gap is marked.
  function pause(run) {
    buffer.dropFrom(run.tabId, run.shown);
    run.paused = true; run.requests.clear(); run.pending.clear();
    if (run.held) { run.held = false; send(run.tabId, 'Fetch.disable').catch(() => {}); detach(run.tabId).catch(() => {}); }   // no reply is held on a sign-in page, or after the debugger is let go
    onChange(run.tabId);
  }
  async function resume(run) {
    try { await attach(run.tabId); } catch { return end(run.tabId); }
    run.held = true;
    try { await send(run.tabId, 'Network.enable'); await send(run.tabId, 'Page.enable'); } catch { return end(run.tabId); }
    await send(run.tabId, 'Fetch.enable', INTERCEPT).catch(() => {});   // not fatal: without it a body is read later, and flagged when lost
    run.paused = false; run.shown = null; run.docSeen = false; run.missed = null; run.base = buffer.page(run.tabId);
  }
  const watch = run => {
    run.watch = setTimer(async () => {
      if (runs.get(run.tabId) !== run) return;
      if (stopped()) { halt(run.tabId); return; }
      const password = await hasPassword(run.tabId).catch(() => false);
      if (runs.get(run.tabId) !== run) return;
      if (password && !run.paused) pause(run);
      else if (!password && run.paused) await resume(run);
      if (runs.get(run.tabId) === run) watch(run);
    }, WATCH_MS);
  };

  // The recording stops and the debugger is released; what was recorded stays in memory (a Stop, Chrome's Cancel, DevTools taking over: Report after it sends the pages recorded before).
  function halt(tabId) {
    const run = runs.get(tabId);
    runs.delete(tabId);
    if (!run) return;
    clearTimer(run.watch);
    if (run.held) { run.held = false; send(tabId, 'Fetch.disable').catch(() => {}); detach(tabId).catch(() => {}); }
    onChange(tabId);
  }
  function end(tabId) {   // the application ended, the tab closed, the switch went off: the trace is gone
    buffer.drop(tabId);
    halt(tabId);
  }

  async function begin(tabId) {
    if (stopped() || !(await enabled().catch(() => false)) || runs.has(tabId)) return runs.has(tabId);
    const run = {tabId, t0: now(), requests: new Map(), pending: new Set(), top: null, shown: null, paused: false, held: false, bodies: new Map(), seen: new Set(), docSeen: false, missed: null};
    runs.set(tabId, run);
    run.base = buffer.page(tabId);   // this run's first page: replies caught before a navigation of its own; a read-back of the page it began on joins it (readBack), one page, not two
    try {
      await attach(tabId);   // the one place the debugger is attached (stop-state.js): never while the person pressed Stop, and only on a tab the app opened
      run.held = true;
      await send(tabId, 'Network.enable');
      await send(tabId, 'Page.enable');
      await send(tabId, 'Fetch.enable', INTERCEPT).catch(() => {});   // not fatal: without it a body is read later, and flagged when lost
      run.top = (await send(tabId, 'Page.getFrameTree').catch(() => null))?.frameTree?.frame?.id || null;
    } catch { run.held = false; end(tabId); return false; }
    if (await hasPassword(tabId).catch(() => false)) pause(run);
    watch(run);
    onChange(tabId);
    return true;
  }

  return {
    isTracing: tabId => runs.has(tabId),
    has: tabId => buffer.has(tabId),
    pageCount: tabId => buffer.pageCount(tabId),
    bytes: tabId => buffer.bytes(tabId),
    // The tab is (about to be) an application's page: start keeping its trace once; a second call while the first waits joins it (never a second run). -> whether it is tracing
    start(tabId) {
      if (runs.has(tabId)) return Promise.resolve(true);
      if (!starting.has(tabId)) starting.set(tabId, begin(tabId).finally(() => starting.delete(tabId)));
      return starting.get(tabId);
    },
    // The page's document is complete (webNavigation DOMContentLoaded, top frame, url = its address): read it back when the trace never saw its request (readBack). Once per document.
    async loaded(tabId, url) {
      await starting.get(tabId)?.catch(() => false);   // a start still waiting for the app's answer: the page may be complete before it attaches (the 27 Oct report)
      const run = runs.get(tabId);
      if (!run || run.paused) return;
      const seen = run.docSeen;
      run.docSeen = false;
      if (!seen) await readBack(run, url);
    },
    // A navigation began on the tab: a trace paused on a sign-in page picks up again before the next page's first request.
    async navigating(tabId) { const run = runs.get(tabId); if (run?.paused) { if (await hasPassword(tabId).catch(() => true)) return; await resume(run); } },
    // -> {ok, entries, truncated} from memory, at once. scope: 'journey' | 'page'. Nothing is read from the page and the tab is not touched.
    snapshot(tabId, scope = 'journey') {
      if (!buffer.has(tabId)) return {ok: false, refused: runs.has(tabId) ? 'empty' : 'off'};
      return {ok: true, ...buffer.snapshot(tabId, scope)};
    },
    end,
    endAll() { for (const tabId of [...runs.keys()]) end(tabId); buffer.dropAll(); },
    haltAll() { for (const tabId of [...runs.keys()]) halt(tabId); },
    // Chrome let go by itself (a closed tab, DevTools, the person's Cancel): nothing is held any more.
    detached(tabId) { forgetDebuggerUsers(tabId); const run = runs.get(tabId); if (run) { run.held = false; halt(tabId); } },
  };
}
