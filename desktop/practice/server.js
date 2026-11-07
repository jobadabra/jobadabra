// Practice jobs: one loopback HTTPS server that serves recorded employer pages at their recorded addresses and catches every Submit (spec 2026-11-07-practice-jobs-design.md).
// Job: catch the submit
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import {CAPTURE_SHIM} from './shim.js';

const here = import.meta.dirname;   // Why (7 Nov 2026, pj 1/4, Windows CI): new URL(import.meta.url).pathname is "/D:/a/..." on Windows and made "D:\D:\a\..."
export const RECORDED = path.resolve(here, '..', 'e2e', 'recorded');
const VENDOR = path.resolve(here, '..', 'e2e', 'vendor');
const BODY_CAP = 1_000_000;

const key = (host, pathname) => `${host}${pathname}`.replace(/\/+$/, '');
// A recorded page may load a pinned widget library as <script src="vendor:file.js">: inline it, so serving needs no other file (same rule as e2e/lib/page-replay.mjs inlineVendor).
const inlineVendor = html => html
  .replace(/<script src="vendor:([\w.-]+\.js)"><\/script>/g, (tag, name) => `<script>${fs.readFileSync(path.join(VENDOR, name), 'utf8')}</script>`)
  .replace(/<link rel="stylesheet" href="vendor:([\w.-]+\.css)">/g, (tag, name) => `<style>${fs.readFileSync(path.join(VENDOR, name), 'utf8')}</style>`);
/** -> html with the capture script before `</body>` (or at the end when the page has none). */
export const withShim = html => { const tag = `<script>${CAPTURE_SHIM}</script>`; return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${tag}</body>`) : html + tag; };

/** -> [{name, dir, pages: [{url, file}]}] for the named recorded cases (all of them when `names` is empty). */
export function loadCases(names = [], dir = RECORDED) {
  const wanted = names.length ? names : fs.readdirSync(dir).filter(name => fs.existsSync(path.join(dir, name, 'case.json'))).sort();
  return wanted.map(name => ({name, dir: path.join(dir, name), ...JSON.parse(fs.readFileSync(path.join(dir, name, 'case.json'), 'utf8'))}));
}
/** -> Chromium's host-resolver rule: the practice hosts go to the server, every other name fails to resolve (so no employer can be reached). */
export const hostRulesFor = (hosts, port) => [...hosts.map(host => `MAP ${host} 127.0.0.1:${port}`), 'MAP * ~NOTFOUND , EXCLUDE 127.0.0.1 , EXCLUDE localhost'].join(', ');

const THANKS = '<!doctype html><meta charset="utf-8"><title>Application received</title><body style="font:16px system-ui;padding:40px"><h1>Thank you, your application has been received.</h1><p>Practice: nothing was sent to an employer.</p></body>';

/**
 * Start the practice server on 127.0.0.1 (a free port) for `cases`. Invariants: it listens on loopback only; a request for a host that is not a case's is
 * answered 404 and counted in strangers(), never forwarded; a password's value is never recorded (the script writes "[hidden]"; a POST nobody reported keeps names only). -> {port, hosts, hostRules(), caught(), strangers(), close()}.
 * ledgerFile: when given, it is rewritten whole with the current list (one JSON line per caught submission) after every change; an entry can be completed in place.
 */
export async function startPractice({cases, ledgerFile = ''}) {
  const pages = new Map();
  for (const item of cases) for (const page of item.pages) { const url = new URL(page.url); pages.set(key(url.host, url.pathname), inlineVendor(fs.readFileSync(path.join(item.dir, page.file), 'utf8'))); }
  const hosts = [...new Set([...pages.keys()].map(k => k.split('/')[0]))];
  const caught = [];
  let strangers = 0;
  // The ledger file always holds the current list (an entry can be completed by the second report of the same Submit), written whole: it is a handful of lines.
  const save = () => { if (ledgerFile) fs.writeFileSync(ledgerFile, caught.map(entry => JSON.stringify(entry)).join('\n') + '\n'); };
  const record = entry => { caught.push(entry); save(); return entry; };
  const ID = /__practice_id(?:"\r\n\r\n|=)([a-z0-9]+)/;   // the token the script puts in the form (urlencoded or multipart)
  const namesOf = (body, type) => (/multipart/i.test(type) ? [...body.matchAll(/name="([^"]+)"/g)].map(match => match[1]) : [...new URLSearchParams(body).keys()]).filter(name => name !== '__practice_id');
  const pathOf = page => { try { return new URL(page).pathname; } catch { return ''; } };
  const certDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-practice-cert-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=jp-practice', '-keyout', path.join(certDir, 'key.pem'), '-out', path.join(certDir, 'cert.pem')], {stdio: 'ignore'});
  const readBody = req => new Promise(resolve => { let text = ''; req.on('data', chunk => { if (text.length < BODY_CAP) text += chunk; }); req.on('end', () => resolve(text)); });
  const server = https.createServer({key: fs.readFileSync(path.join(certDir, 'key.pem')), cert: fs.readFileSync(path.join(certDir, 'cert.pem'))}, async (req, res) => {
    const host = String(req.headers.host || '').split(':')[0];
    const pathname = new URL(req.url, 'https://x').pathname;
    if (!hosts.includes(host)) { strangers++; res.writeHead(404, {'content-type': 'text/plain'}).end('not a practice host'); return; }
    if (req.method === 'POST' && pathname === '/__caught') {
      let sent = {}; try { sent = JSON.parse(await readBody(req)); } catch { /* an empty entry */ }
      const fields = Array.isArray(sent.fields) ? sent.fields : [];
      const id = String(sent.id || '');
      // The page's own POST can arrive before the script's report (the page leaves as it posts): it made a name-only entry with the same token; this report completes it.
      const waiting = id && caught.find(entry => entry.id === id);
      if (waiting) { Object.assign(waiting, {how: String(sent.how || 'submit'), path: pathOf(sent.page) || waiting.path, fields}); save(); }
      else record({at: new Date().toISOString(), id, host, path: pathOf(sent.page), how: String(sent.how || 'submit'), fields, posted: false});
      res.writeHead(204).end(); return;
    }
    if (req.method === 'POST') {   // the form's own POST: it marks the script's entry for this submit, or is the entry when the script's report is missing or late
      const body = await readBody(req);
      const id = ID.exec(body)?.[1] || '';
      const mine = id && caught.find(entry => entry.id === id);
      if (mine) { mine.posted = true; mine.postedTo = pathname; save(); }
      // Why (7 Nov 2026, Gitar on #3523): only the page in the browser knows a field is a password, so a POST nobody reported keeps the field names and no values.
      else record({at: new Date().toISOString(), id, host, path: pathname, how: 'post', fields: namesOf(body, req.headers['content-type'] || '').map(name => [name, '[not read: no script report]']), posted: true, postedTo: pathname});
      res.writeHead(200, {'content-type': 'text/html; charset=utf-8'}).end(THANKS); return;
    }
    const html = pages.get(key(host, pathname));
    if (html === undefined) { res.writeHead(404, {'content-type': 'text/plain'}).end('not a practice page'); return; }
    res.writeHead(200, {'content-type': 'text/html; charset=utf-8'}).end(withShim(html));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return {port, hosts, hostRules: () => hostRulesFor(hosts, port), caught: () => caught.map(e => ({...e})), strangers: () => strangers,
    close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections?.(); fs.rmSync(certDir, {recursive: true, force: true}); })};
}
