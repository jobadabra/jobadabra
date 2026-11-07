// The capture script the practice server adds to every page it serves: it reads a form when it is submitted and tells the catcher.
// Why (7 Nov 2026, pj): of 163 recorded forms only 52 post to a server, 61 stop their own submit (`onsubmit="return false"`); a server alone would miss most Submits.
// The script runs in the page, in the capture phase, so it sees the submit before the page's own handler can stop it. It never changes a field or stops the submit.
// Password values are never read: the ledger shows "[hidden]" (a fictional applicant has none, but a recorded page might hold a typed one).

/** The script text, injected before `</body>` by server.js. Posts JSON {page, how, fields:[[name, value]]} to /__caught on the page's own origin. */
export const CAPTURE_SHIM = `(function(){
  if (window.__practiceShim) return; window.__practiceShim = 1;
  function show(el, v){
    if (v instanceof File) return '[file ' + v.name + ', ' + v.size + ' bytes]';
    if (el && (el.type === 'password')) return '[hidden]';
    return String(v);
  }
  function tell(form, how){
    try {
      var out = [];
      new FormData(form).forEach(function(v, k){ var el = form.elements[k]; out.push([k, show(el && el.length === undefined ? el : null, v)]); });
      fetch('/__caught', {method: 'POST', keepalive: true, headers: {'content-type': 'application/json'}, body: JSON.stringify({page: location.href, how: how, fields: out})});
    } catch (e) { /* the page goes on */ }
  }
  document.addEventListener('submit', function(e){ tell(e.target, 'submit'); }, true);
  var native = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function(){ tell(this, 'form.submit()'); return native.apply(this, arguments); };
})();`;
