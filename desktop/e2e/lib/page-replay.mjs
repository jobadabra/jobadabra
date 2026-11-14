/* global document */
// Job: serve stored answers
// Layer 2 of applying reliability (spec: docs/superpowers/specs/2026-10-10-applying-reliability-layers.md): recorded pages replayed with the REAL extension,
// offline. A case (e2e/recorded/<shape>-<n>/case.json) serves its pages at their real addresses (context.route), answers the app's AI calls from the case
// (no AI, no network), opens the first page as an application tab (`start: "panel"`: then presses the panel's Fill) and checks `expect`. Isolation: lib/real-extension.mjs (fake applicant, stub app).
// Guard: integration/extension/recorded-pages.test.mjs runs every case; desktop/test/replay-privacy.test.js keeps personal data out of the cases.
import fs from 'node:fs';
import path from 'node:path';
import {E2E} from './app.mjs';
import {startRealExtension} from './real-extension.mjs';
import {fillStateOf} from './extension.mjs';
import {endingOfStuck} from '../../../extension/ladder/endings.js';
import {movesFromRequests, repairsFromRequests} from './ladder-moves.mjs';
import {falseReadings} from './replay-truth.mjs';
import {fillSeconds} from './replay-time.mjs';
import {linesOfCase, saysWord} from './replay-lines.mjs';
import {timedReplay} from './replay-deadline.mjs';
import {syntheticNavigation, takeSyntheticRedirect, routeSyntheticNavigation} from './synthetic-navigation.mjs';

export const REPLAY_DIR = path.join(E2E, 'recorded');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const pathKey = url => { const parsed = new URL(url); return `${parsed.host}${parsed.pathname}`.replace(/\/$/, ''); };

export function loadCases(dir = REPLAY_DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(name => fs.existsSync(path.join(dir, name, 'case.json'))).sort()
    .map(name => ({name, dir: path.join(dir, name), ...JSON.parse(fs.readFileSync(path.join(dir, name, 'case.json'), 'utf8'))}));
}

// The AI answers of a case as the stand-in's `answer` map: a route's stubbed answer is one body, or a list of {when: {field: value}, answer} picked by what the extension sent (the ladder: an unsure answer, then a digest request); the last entry is the default.
export function answerFor(item) {
  const pick = (list, sent) => { let request = {}; try { request = JSON.parse(sent || '{}'); } catch { /* not JSON: the default */ } const sees = entry => Object.entries(entry.when || {}).every(([field, value]) => request[field] === value) && (entry.whenFilled || []).every(field => Array.isArray(request[field]) && request[field].length > 0) && (entry.whenButtons || []).every(text => (request.buttons || []).includes(text)) && (!entry.whenCandidate || (Array.isArray(request.candidates) && request.candidates.some(item => item?.text === entry.whenCandidate))); return (list.find(sees) || list.at(-1)).answer; };   // whenFilled: the request carried that list (a frame candidate), so the answer may name it; whenButtons: the sketch listed those buttons, so the answer may name one (a modal's control beyond the sketch's cap)
  // ...or {"byHost": {<host>: answer}} when a journey crosses pages that the AI answers differently (the request's `url` says which).
  const hostOf = text => { try { return new URL(JSON.parse(text).url).hostname; } catch { return ''; } };
  // An answer with "_delayMs" comes that much later (a slow AI on a real run: the fill waits for its answers while the page is half filled); the field itself is never sent.
  // A route's answer may also be a function of the request body (sync or async): widget-zoo.mjs --model answers the fill check with the real model.
  const late = fn => sent => { const found = fn(sent); const ms = Number(found?._delayMs) || 0; if (!ms) return found; const {_delayMs, ...rest} = found; return new Promise(resolve => setTimeout(() => resolve(rest), ms)); };
  return Object.fromEntries(Object.entries(item.ai || {}).map(([route, body]) => [route, late(typeof body === 'function' ? body : Array.isArray(body) ? sent => pick(body, sent) : body.byHost ? text => { const entry = body.byHost[hostOf(text)]; return Array.isArray(entry) ? pick(entry, text) : entry || {}; } : () => body)]));
}
export const caseHosts = item => [...new Set(item.pages.map(page => new URL(page.url).host))];
// A page may load a REAL widget library, pinned in desktop/e2e/vendor/ (VERSIONS.md), as <script src="vendor:<file>"></script>: it is served inline, so a replay needs no network.
export const VENDOR_DIR = path.join(E2E, 'vendor');
// A library's stylesheet the same way: <link rel="stylesheet" href="vendor:<file>.css"> becomes an inline <style> (its image urls point at nothing offline, as a blocked sprite would).
export const inlineVendor = html => html
  .replace(/<script src="vendor:([\w.-]+\.js)"><\/script>/g, (tag, name) => `<script>${fs.readFileSync(path.join(VENDOR_DIR, name), 'utf8')}</script>`)
  .replace(/<link rel="stylesheet" href="vendor:([\w.-]+\.css)">/g, (tag, name) => `<style>${fs.readFileSync(path.join(VENDOR_DIR, name), 'utf8')}</style>`);
export const caseFiles = item => new Map(item.pages.map(page => [pathKey(page.url), inlineVendor(fs.readFileSync(path.join(item.dir, page.file), 'utf8'))]));
// A page's HTTP status per load, in turn (case.json pages[].status: 503 or [503, 200]; the last repeats; 200 when absent): a site that errors, then answers (the site_broken
// ending, extension/ladder/site-broken.js). answerPage serves a case page with it: a status that is not 2xx gets a bare error page, as a site's server sends.
export const caseStatuses = item => new Map(item.pages.filter(page => page.status != null).map(page => [pathKey(page.url), [].concat(page.status)]));
// A page's answer delayed (case.json pages[].delayMs): a site whose server answers a press late (record-once spec, 15 Oct 2026: a press answered after 20 s). The request stays open meanwhile.
export const caseDelays = item => new Map(item.pages.filter(page => page.delayMs > 0).map(page => [pathKey(page.url), Number(page.delayMs)]));
// Serve one offline route from case-owned HTML/status/delay/redirect maps; missing pages return404, and a pending synthetic redirect returns302 once.
export async function answerPage(route, files, statuses = new Map(), delays = new Map(), redirects = new Map()) {
  const redirect = takeSyntheticRedirect(route.request().url(), redirects);
  if (redirect) return route.fulfill({status: 302, headers: {location: redirect}, body: ''});
  const key = pathKey(route.request().url()), body = files.get(key);
  if (!body) return route.fulfill({status: 404, body: ''});
  if (delays.get(key)) await new Promise(resolve => setTimeout(resolve, delays.get(key)));
  const list = statuses.get(key), status = !list ? 200 : list.length > 1 ? list.shift() : list[0];
  return route.fulfill({status, contentType: 'text/html; charset=utf-8', body: status >= 200 && status < 300 ? body : `<!doctype html><title>${status}</title><h1>${status}</h1>`});
}
export const isExtensionPage = open => open.url().startsWith('chrome-extension://');

// The body of the last request on that route (parsed), or null.
const lastBody = (list, route) => { for (const request of [...list()].reverse()) { if (request.route !== route) continue; try { return JSON.parse(request.body); } catch { return null; } } return null; };

// The case's checks on ITS tab. scope: {run, page (the tab), pages() (the case's non-extension tabs), mine() (requests that are the case's: told/asked/judged count only these, so a
// parallel tab's request never satisfies a check), all() (every request: notTold counts all, so a parallel tab can only add a failure, never hide one), opened() (tabs opened during the run)}.
// -> {ok, failures: [why], seen: {tabs, opened}, moves()}. expect: {told: [log words], stuck: ['<why>' | '<why>|<need start>'] (a "can't reach" report), ending: [ending] (what the report names: extension/ladder/endings.js), notTold: [..], maxTabs, maxNewTabs (tabs opened during the run), attached: [selector], filled: [selector], kept: [selector] (still holds a value after the page settled), valueHas: ["selector|digits"] (the box holds those digits), pressed: [selector] (a pressable button, aria-pressed=true), chosen: [selector] (a choice option that reads as on: aria-checked/aria-pressed true, or a checked native radio/checkbox), asked: [question] (listed in the fields of an /extension/answer request: the reader saw it), empty: [selector], gone: [selector], notJudged: ["<label>:<state>"] (the form judge was never sent that), present: [selector] (an element matches: a state a widget shows only by a class or attribute), seconds}
// clean-code-ok: Why (1 Nov 2026, layer 1 of the e2e move): the existing one-check-per-key judge, renamed from judgeCase; three more checks (panelSays, absent, notPanelSays) join its list; splitting it is its own change.
export async function judgePhase(item, scope) {
  const {run, mine, all} = scope, failures = [];
  if (item.start === 'panel') await run.fillWithPanel(scope.page);   // a form page's fill starts from the panel's Fill button (as the person, or the app's start signal, would)
  const expect = item.expect || {}, deadline = Date.now() + (expect.seconds || 40) * 1000;
  const page = () => scope.pages().at(-1) || scope.page;
  // The request-based checks over one list of requests (the strict list is only the case's own, the loose one adds lines no case's host names: see replay-browser.mjs).
  // The "can't reach" reports the extension sent the app (/extension/event, type stuck): {why, needs}.
  const stuckReports = list => list().filter(request => request.route === '/extension/event').map(request => { try { return JSON.parse(request.body); } catch { return null; } }).filter(body => body?.type === 'stuck');
  // The extension's decision lines placed on this case: every push of the browser since it began, each line placed by its host or its tab (lib/replay-lines.mjs).
  const logLines = () => (scope.every || mine)().filter(one => one.route === '/extension/log').flatMap(request => { try { return JSON.parse(request.body).entries; } catch { return []; } });   // a body cut at the recording limit: none
  const placedLines = () => (scope.otherHosts ? linesOfCase(logLines(), {own: caseHosts(item), others: scope.otherHosts}).mine : logLines());
  const requestChecks = list => ({
    told: word => list().some(request => request.body.includes(word)) || (!!scope.otherHosts && saysWord(placedLines(), word)),   // in a shared browser a line also counts when it is placed on this case's own tab (lib/replay-lines.mjs), whichever push carried it
    // stuck: ["<why>"] or ["<why>|<the start of what the person is told>"]: a "can't reach" report with that reason (and need).
    stuck: spec => { const [why, needs = ''] = spec.split('|'); return stuckReports(list).some(body => body.why === why && String(body.needs || '').startsWith(needs)); },
    // ending: ["<ending>"]: a "can't reach" report names that ending of the outcome contract (extension/ladder/endings.js endingOfStuck).
    ending: name => stuckReports(list).some(body => endingOfStuck(body.why, body.needs) === name),
    asked: label => list().some(request => request.route === '/extension/answer' && request.body.split('"page_text"')[0].includes(`"label":${JSON.stringify(label)}`)),
    // What the extension showed the form judge (form-ready.js: /extension/account-judge, phase form): "<label>:<state>" of one control of the sketch it sent.
    judged: spec => list().some(request => { try { const body = JSON.parse(request.body); return request.route === '/extension/account-judge' && body.phase === 'form' && body.sketch.controls.some(control => `${control.label}:${control.state}` === spec); } catch { return false; } }),
    // What sits on top of the page, as the sketch the extension sent the form judge or the page-kind ask says (extension/on-top.js): the layer's shape.
    onTop: shape => list().some(request => { try { const body = JSON.parse(request.body); return (request.route === '/extension/account-judge' && body.phase === 'form' ? body.sketch : request.route === '/extension/page-kind' ? body : null)?.onTop?.shape === shape; } catch { return false; } }),
  });
  const checks = {
    ...requestChecks(mine),
    attached: selector => page().evaluate(css => (document.querySelector(css)?.files?.length || 0) > 0, selector).catch(() => false),
    filled: selector => page().evaluate(css => !!document.querySelector(css)?.value, selector).catch(() => false),
    pressed: selector => page().evaluate(css => document.querySelector(css)?.getAttribute('aria-pressed') === 'true', selector).catch(() => false),
    chosen: selector => page().evaluate(css => { const el = document.querySelector(css); return !!el && (['aria-checked', 'aria-pressed'].some(name => el.getAttribute(name) === 'true') || el.checked === true || !!el.querySelector('input:checked')); }, selector).catch(() => false),
    // valueHas: ["<selector>|<digits>"]: the box's value still holds those digits (a phone widget that went back to its own country code does not).
    valueHas: spec => page().evaluate(([css, digits]) => (document.querySelector(css)?.value || '').replace(/\D/g, '').includes(digits), spec.split('|')).catch(() => false),
    // valueIs: ["<selector>|<text>"]: the box holds exactly that (a first-name box that got the family name fails: 12 Oct 2026, labels the page tied to no box).
    valueIs: spec => page().evaluate(([css, text]) => (document.querySelector(css)?.value || '').trim() === text, spec.split('|')).catch(() => false),
    // panelHas: ["<text>"]: the extension's panel shows a visible button with exactly that text (its own open shadow root, which a page selector cannot reach).
    panelHas: text => page().evaluate(want => [...(document.getElementById('jobadabra-review-host')?.shadowRoot?.querySelectorAll('button') || [])].some(button => button.textContent.trim() === want && button.getClientRects().length > 0), text).catch(() => false),
    // reviewSays: ["<key>|<value>", ...]: ONE report the extension sent the app on /extension/review carries every pair (JSON values compared as text: "role|form", "account|true"). Unlike `told` it reads
    // only that route, so a word the page's other requests also carry cannot satisfy it (R3, 1 Nov 2026: the one-page form's role next to the panel's raw password-box flag).
    reviewSays: spec => { const pairs = [].concat(spec).map(one => one.split('|')); return mine().some(request => { if (request.route !== '/extension/review') return false; try { const body = JSON.parse(request.body); return pairs.every(([key, value]) => String(body[key]) === value); } catch { return false; } }); },
    gone: selector => page().evaluate(css => !document.querySelector(css)?.getClientRects().length, selector).catch(() => false),
    present: selector => page().evaluate(css => !!document.querySelector(css), selector).catch(() => false),
    // panelSays: ["<text>"]: the extension's panel (its own open shadow root) shows that text in a visible element (a warning line, a count; a hidden line does not count).
    panelSays: text => page().evaluate(want => [...(document.getElementById('jobadabra-review-host')?.shadowRoot?.querySelectorAll('*') || [])].some(el => !el.children.length && el.getClientRects().length > 0 && el.textContent.replace(/\s+/g, ' ').includes(want)), text).catch(() => false),
  };
  const pending = Object.entries(checks).flatMap(([kind, check]) => (expect[kind] || []).map(arg => ({kind, arg, check})));
  while (pending.length && Date.now() < deadline) {
    for (const one of [...pending]) if (await one.check(one.arg)) pending.splice(pending.indexOf(one), 1);
    if (pending.length) await wait(500);
  }
  if (!Object.keys(checks).some(kind => (expect[kind] || []).length)) await (windowMode() === 'quick' && item.start !== 'panel' ? watchWindow(page, scope.strict || all, deadline) : wait(Math.max(0, deadline - Date.now())));   // only "must not happen" checks: watch the window, but end it when the fill has finished and the page went quiet
  for (const left of pending) failures.push(`${left.kind}: ${left.arg}`);
  const readings = await falseReadings(item, {page, mine}, {deadline});   // truth and agreement at the case's end (lib/replay-truth.mjs): a false reading fails every case
  failures.push(...readings.failures);
  for (const word of expect.notTold || []) if (requestChecks(all).told(word)) failures.push(`notTold: ${word}`);
  for (const spec of expect.notJudged || []) if (requestChecks(all).judged(spec)) failures.push(`notJudged: ${spec}`);   // the form judge was never shown that control in that state
  for (const selector of expect.empty || []) if (await checks.filled(selector)) failures.push(`empty: ${selector}`);
  for (const selector of expect.absent || []) if (await checks.present(selector)) failures.push(`absent: ${selector} is on the page`);   // e.g. "#org[data-jobadabra-ai]": a plain fact is not marked as an AI answer
  for (const text of expect.notPanelSays || []) if (await checks.panelSays(text)) failures.push(`notPanelSays: the panel says "${text}"`);   // e.g. "Ready to submit" over a required control it could not fill
  // kept: a box the fill typed must still hold its value once the page has had its say (an upload's own autofill rewrites boxes a moment later): read after the page settled.
  if ((expect.kept || []).length) { await wait(expect.keptAfter || 2500); for (const selector of expect.kept) if (!(await checks.filled(selector))) failures.push(`kept: ${selector} is empty after the page settled`); }
  // The end state, once (the panel reports before the fill too): after the page settled, the fill's settled record and the panel's last report must say the same as the case
  // (spec 2026-10-12-fill-ladder, amendment 4: one truth per control). traced: "<label>:<outcome>" in /extension/run's trace; pending: in /extension/review's pending;
  // notPending: not in it AND in its filled list (a required field the panel reports filled).
  if (['traced', 'notTraced', 'pending', 'notPending', 'atMost'].some(kind => (expect[kind] || []).length)) {
    await wait(expect.endAfter || 3000);
    const run = lastBody(mine, '/extension/run'), review = lastBody(mine, '/extension/review');
    for (const spec of expect.traced || []) if (!(run?.trace || []).some(row => `${row.label}:${row.outcome}` === spec)) failures.push(`traced: ${spec} (the fill's record says ${(run?.trace || []).filter(row => spec.startsWith(`${row.label}:`)).map(row => row.outcome).join('/') || 'nothing'})`);
    for (const label of expect.notTraced || []) if ((run?.trace || []).some(row => row.label === label)) failures.push(`notTraced: the fill's record has a row "${label}" (${(run?.trace || []).filter(row => row.label === label).map(row => `${row.outcome}, ${row.reason || 'no reason'}`).join('/')})`);   // a row the page does not have (a phantom: one control counted twice)
    for (const label of expect.pending || []) if (!(review?.pending || []).includes(label)) failures.push(`pending: ${label} is not left in the panel's report`);
    for (const label of expect.notPending || []) if (!review || (review.pending || []).includes(label) || !(review.filled || []).includes(label)) failures.push(`notPending: ${label} is ${(review?.pending || []).includes(label) ? 'left in' : 'not listed as filled by'} the panel's report`);   // listed as filled: a label the panel names otherwise is no pass
    // atMost: "<selector>|<attribute>|<n>": a number the page counts on an element (how often a menu was opened) stays at or under n (the attempt log's bound, amendment 1).
    for (const spec of expect.atMost || []) { const [css, name, most] = spec.split('|'); const seen = await page().evaluate(([sel, attr]) => Number(document.querySelector(sel)?.getAttribute(attr) || 0), [css, name]).catch(() => NaN); if (!(seen <= Number(most))) failures.push(`atMost: ${css} ${name} is ${seen}, more than ${most}`); }
  }
  const tabs = scope.pages().length, opened = scope.opened();
  if (expect.maxTabs != null && tabs > expect.maxTabs) failures.push(`maxTabs: ${tabs} > ${expect.maxTabs}`);
  if (expect.maxNewTabs != null && opened > expect.maxNewTabs) failures.push(`maxNewTabs: ${opened} > ${expect.maxNewTabs}`);
  if (process.env.REPLAY_LOG || failures.length) {   // REPLAY_LOG=1, or any failed case (CI too, 14 Oct 2026): the extension's own decision lines, to read why a case failed (what the failure list cannot tell)
    for (const entry of placedLines()) console.log(`  [extension ${item.name}] ${entry.text} ${JSON.stringify(entry.fields)}`);
    const unplaced = scope.otherHosts ? linesOfCase(logLines(), {own: caseHosts(item), others: scope.otherHosts}).unplaced : 0;
    if (unplaced) console.log(`  [extension ${item.name}] (${unplaced} more line(s) no case could be told apart on: left out)`);
  }
  // A check that only a line no case's host names satisfied (it could be another tab's): the pass must be confirmed alone before it counts. A "told" word on a line placed on the case's own tab is attributed.
  const confirm = [];
  if (!failures.length && scope.strict) {
    if (expect.maxNewTabs != null && scope.unplacedTabs?.()) confirm.push(`maxNewTabs: ${scope.unplacedTabs()} tab(s) opened by nobody we know`);   // could be this case's: proven alone
    const strict = requestChecks(scope.strict);
    if (expect.maxNewTabs != null && scope.unplacedTabs?.()) confirm.push(`maxNewTabs: ${scope.unplacedTabs()} tab(s) opened by nobody we know`);   // could be this case's: proven alone
    for (const kind of ['told', 'asked', 'judged', 'onTop', 'stuck', 'ending']) for (const arg of expect[kind] || []) if (!strict[kind](arg)) confirm.push(`${kind}: ${arg}`);
  }
  return {ok: !failures.length, failures, confirm, seen: {tabs, opened}, truth: readings.counts, moves: () => movesFromRequests(mine()), repairs: () => repairsFromRequests(mine())};   // the ladder moves the case's pages confirmed (lib/ladder-moves.mjs), read once the run is over: a report can land after the judgment
}

// One of the person's presses between two judged phases: a page control (Next) or the extension panel's own button ("Fill again", in its open shadow root), each a real click
// by role and name, as the person's would be: a panel a page's modal dialog covers cannot be pressed.
// Why (13 Nov 2026, LinkedIn Easy Apply 4a): the panel's press was a script click, which reached the panel even behind LinkedIn's modal (showModal) where a person cannot.
async function pressStep(tab, step) {
  if (step.click) await tab.locator(step.click).click();
  if (!step.panel) return;
  const panel = tab.locator('#jobadabra-review-host'), button = panel.getByRole('button', {name: step.panel, exact: true});
  const pill = panel.getByTitle('Jobadabra', {exact: true});
  if ((await pill.getAttribute('aria-expanded')) === 'false') await pill.click();   // the panel shows as its pill (above a page's modal): the person opens it first; an open card is never toggled shut
  await button.click().catch(async error => {   // the red says what the panel showed instead: its buttons, whether each is seen, the pill's state and the panel's parent
    const seen = await panel.getByRole('button').evaluateAll(list => list.map(one => `${one.textContent.trim().slice(0, 30)}${one.checkVisibility() ? '' : ' (hidden)'}${one.disabled ? ' (disabled)' : ''}`).filter(Boolean));
    // Why (14 Nov 2026, main red at 691d7224, runs 43527732560 and 43530467683): the panel read "Ready" after the page's Next, and the red could not say whether the next step was
    // not shown, shown and empty (the panel wrong) or already filled; the page's own visible required fields say which, ahead of the buttons (the case's error is cut at 200 characters).
    // A page gone mid-press (navigated, closed) makes the probe itself fail: said as text, so the panel's own error below is always the one thrown (Gitar on #4142, reopened as #4148).
    const required = await tab.locator('[required]').evaluateAll(list => list.filter(one => one.checkVisibility()).map(one => (['checkbox', 'radio'].includes(one.type) ? one.checked : !!one.value))).then(
      list => `${list.length} visible required, ${list.filter(filled => !filled).length} empty`,
      probe => `required fields not read (${String(probe?.message || probe).slice(0, 60)})`);
    throw new Error(`panel button "${step.panel}" not pressed; page: ${required}; pill expanded=${await pill.getAttribute('aria-expanded')}, panel in <${await panel.evaluate(host => host.parentElement?.localName)}>, buttons: ${seen.join(' | ')}\n${error.message}`);
  });
}
const phaseLabel = (item, index) => (Array.isArray(item.then) ? `then ${index + 1}` : 'then');

// A case may go on after its first judgment as the person would: case.json `then` is {do: [{click: '<selector>'} | {panel: '<button text>'}], expect: {...}}, or a list
// of them, one per later step of a multi-step form (step 2 is filled only once the person has reached it: Next pressed, then the panel's "Fill again").
// Why (13 Nov 2026, LinkedIn Easy Apply 3/5): LinkedIn's dialog has four steps (contact, resume, questions, review); one `then` could judge only the second.
// scope.judge / scope.press stand in for the page's judge and the person's press only in test/replay/then-phases.test.mjs.
export async function judgeCase(item, scope) {
  const {judge = judgePhase, press = pressStep} = scope;
  let result = await judge(item, scope);
  const failures = [...result.failures], confirm = [...(result.confirm || [])];
  for (const [index, phase] of [].concat(item.then || []).entries()) {
    if (!result.ok) break;
    const tab = scope.pages().at(-1) || scope.page;
    for (const step of phase.do || []) await press(tab, step);
    result = await judge({...item, start: undefined, expect: phase.expect}, scope);
    failures.push(...result.failures.map(text => `${phaseLabel(item, index)}: ${text}`));
    confirm.push(...(result.confirm || []));
  }
  return {...result, failures, ok: result.ok, confirm};
}

// JP_REPLAY_WINDOW: 'quick' (a pull request's page cases: .github/workflows/page-cases.yml) ends the window early; anything else is 'full', the whole window (main, the daily run, a local run).
export const windowMode = () => (process.env.JP_REPLAY_WINDOW === 'quick' ? 'quick' : 'full');

// The window a case with only "must not happen" checks is watched for. In 'quick' mode it ends early, on the real signal, once the page's fill state has left "running" (done/error/no-form: written by
// the hand-off fill; in a shared browser only requests naming the case's own host count, other tabs' traffic never ends the quiet) and no request but the panel's repeated report has come for `quietMs` (12 s: the extension's longest idle wait before it acts again is 8 s, "no form came", cookie-banner-links-1); a case started from the panel (its fill state is the earlier hand-off's: extension.mjs fillState) and a page with no fill state are watched the whole window, as before. Never past the deadline.
export async function watchWindow(page, all, deadline, {quietMs = 12000, minMs = 12000} = {}) {
  const began = Date.now();
  const acts = () => all().filter(request => request.route !== '/extension/review').length;   // the panel repeats its report (/extension/review) every ~2 s on a page at rest: not an act
  let count = acts(), since = Date.now();
  while (Date.now() < deadline) {
    await wait(500);
    if (acts() !== count) { count = acts(); since = Date.now(); }
    const state = (await fillStateOf(page()).catch(() => null))?.state;
    if (state && state !== 'running' && Date.now() - since >= quietMs && Date.now() - began >= minMs) return;
  }
}

// A case's checks can pass while its fill still runs; the fill's last reports (the moves it confirmed: lib/ladder-moves.mjs) land after it. Before a case's tab is closed it waits for the
// page's own fill state to leave "running", at most `ms`, then the reports' flight time. A page with no fill state is not waited for. The checks are not changed.
export async function fillSettled(page, ms = 4000) {
  let state = await fillStateOf(page).catch(() => null);
  for (const end = Date.now() + ms; state?.state === 'running' && Date.now() < end; state = await fillStateOf(page).catch(() => null)) await wait(200);
  if (state) await wait(300);
}

// The applicant details a case runs with (null: the harness default). contact.phoneParts: the number in pieces, a public case holds no phone number (test/guards/privacy/recorded-privacy.test.js).
export const contactOf = item => (item.contact ? {first_name: 'Test', last_name: 'Candidate', email: 'test.candidate@example.com', ...item.contact, ...(item.contact.phoneParts ? {phone: item.contact.phoneParts.join(' ')} : {})} : null);

// One case in its own browser (JP_REPLAY_TABS=1, and the run alone after a failure in parallel): the same checks over every request of that browser.
export async function runCase(item, {extensionDir} = {}) {
  const startupController = new AbortController();
  let run, startupClose;
  return timedReplay(item, async step => {
    const navigation = syntheticNavigation(item);
    run = await step('browser.start', () => startRealExtension({extensionDir, signal: startupController.signal, onCleanup: close => { startupClose = close; }, cv: item.cv !== false, ...(contactOf(item) ? {contact: contactOf(item)} : {}), allowAllSites: true, answer: answerFor(item), offline: true}), late => late.close());   // offline: nothing but the case's pages
    const pages = caseFiles(item), statuses = caseStatuses(item), delays = caseDelays(item);
    for (const host of caseHosts(item)) await run.context.route(`https://${host}/**`, route => answerPage(route, pages, statuses, delays, navigation.redirects));
    await routeSyntheticNavigation(run.context, run.page, item, route => answerPage(route, pages, statuses, delays, navigation.redirects));
    let opened = 0;   // every tab a page or the extension opened during the run (a tab loop closes the tab behind it: the count at the end stays 1)
    run.context.on('page', open => { if (!open.url().startsWith('chrome-extension://')) opened += 1; });
    await step('goto', () => run.page.goto(`${navigation.startUrl}#jobpilotto-fill`, {waitUntil: 'domcontentloaded'}));
    const result = await step('judge', () => judgeCase(item, {run, page: run.page, pages: () => run.context.pages().filter(open => !isExtensionPage(open)), mine: () => run.requests, all: () => run.requests, opened: () => opened}));
    if (!(await step('isolation', () => run.assertIsolated()))) result.failures.push('isolation');
    await step('fillSettled', () => fillSettled(run.page));
    return {...result, ok: !result.failures.length, fillTime: () => fillSeconds(run.requests, caseHosts(item))};   // the fill's own clock (lib/replay-time.mjs)
  }, async step => {
    startupController.abort();
    const close = run?.close || startupClose;
    if (close) await step('browser.close', close);
  });
}
