// The floor "the server never presses Submit" as a net under the filler (private spec jobadabra-lab:docs/specs/2026-10-17-ready-to-send.md): the extension has no Submit path, and this stops what it would never do anyway.
// Why (10 Nov 2026, cs 3/4, owner chose Build it now): the one exception is the press of the auto night that submit-gate.js permitted, let through by `allow` below; fill and readiness keep the full net.
// Every request the night's browser makes goes through `net`: a form submission (a POST that navigates a page) or a POST/PUT whose address ends in a submit or apply word is refused and counted. A CV upload on choice
// (a multipart POST that is not a navigation) goes through: the fill needs it. A word list is a safety floor here, never a meaning. Guard: desktop/test/unit/ready-fill/ready-fill.test.js.
const SUBMIT_PATH = /\/(submit|apply|applications?)(\.json)?\/?$/i;

// Pure: is this request a submit? `request` is {method, url, navigation}.
export function looksLikeSubmit({method, url, navigation}) {
  if (!['POST', 'PUT', 'PATCH'].includes(String(method).toUpperCase())) return false;
  if (navigation) return true;
  try { return SUBMIT_PATH.test(new URL(url).pathname); } catch { return false; }
}

// Routes a Playwright context: -> {blocked: [{host, method}], allowed} that fills as requests are refused or let through.
// allow(request): the auto night's one way through (auto-night.mjs: only its job's own pages, only while submit-gate.js's permit lasts); the fill and readiness nights pass none, so nothing passes.
// refused(request): told of each refused send after it was refused (the auto night ends a job whose page sent itself early).
export async function net(context, {allow = () => false, refused = () => {}} = {}) {
  const state = {blocked: [], allowed: 0};
  await context.route('**/*', route => {
    const request = route.request();
    const submit = looksLikeSubmit({method: request.method(), url: request.url(), navigation: request.isNavigationRequest()});
    if (submit && allow(request) === true) { state.allowed++; return route.continue(); }
    if (submit) { state.blocked.push({host: new URL(request.url()).hostname, method: request.method()}); try { refused(request); } catch {} return route.abort('blockedbyclient'); }
    return route.continue();
  });
  return state;
}
