// The app's own socket takes a sign-in or connect result (POST /<flow>/callback, a form body), posted here by a page of the website in the person's own browser after they consented
// (website shared/oauth-handoff.js; app lib/oauth-handoff.js receive() keeps it only for the state this app made and is waiting on). The result is in the body, never in an address, so it
// does not stay in the browser's history (independent review, 3 Nov 2026). Why (3 Nov 2026, Gitar on web#336): the result must land on the consenting person's machine only.
// Guard: test/oauth-handoff.test.js (real requests to a real local server, every flow).
import {FLOWS, receive} from './oauth-handoff.js';

const flowOf = url => /^\/([a-z-]+)\/callback(?:\?|$)/.exec(String(url))?.[1] || '';

/** -> whether the url is a hand-off callback of one of the flows. */
export const isOauthHandoff = url => FLOWS.includes(flowOf(url));

const card = (title, text, ok) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${title}</title>
<style>:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 -apple-system,"Segoe UI",sans-serif;background:Canvas;color:CanvasText}
main{max-width:420px;padding:32px;text-align:center}h1{font-size:22px;margin:0 0 8px;color:${ok ? '#0f8a3c' : '#c9302c'}}p{margin:0;opacity:.8}</style></head>
<body><main><h1>${title}</h1><p>${text}</p></main></body></html>`;

/** The route handler: POST only (a GET, with or without a query, is dropped unread); the answer says nothing but whether Jobadabra took it. */
export async function handleOauthHandoff(req, res, body) {
  const flow = flowOf(req.url);
  const taken = req.method === 'POST' && receive(flow, new URLSearchParams(body?.toString() || ''));
  res.writeHead(taken ? 200 : 400, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer'});
  res.end(taken ? card('Connected ✓', 'Go back to Jobadabra: it takes it from here. You can close this tab.', true)
    : card('Not connected', 'Jobadabra was not waiting for this. Start again from the Jobadabra app.', false));
}
