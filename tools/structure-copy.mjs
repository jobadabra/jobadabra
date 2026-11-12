// A page's structural copy: tags, attribute names and link shapes only, stripped inside the page before anything leaves it, and refused on any word or digit left.
// Why (#3710 PR 2, owner, 12 Nov 2026, asked via AskUserQuestion: "Yes, sa's shape + flags"): the extension learns LinkedIn's /jobs/search-results/ from ONE copy of
// its structure; every text node, attribute value, id and digit run is gone before the file is written. Kept, and only this: tag names (h1-h6 keep their digit),
// attribute NAMES with no value, and for a link its path SHAPE ('#' for a segment that held a digit, 'a' for any other: /a/a/#/) plus three value-less flags:
// jp-same-host, jp-same-path (the page's own path), jp-query-id (a query value that is a digit run). No word of the page, no host, no query.
//   node tools/structure-copy.mjs capture --profile <browser profile> --out <file> [--deny <words file>] [--wait <s>]
//     waits for a tab on /jobs/search-results/ in the browser that profile runs (its DevToolsActivePort), strips it in the page, checks, then writes.
//     Prints counts only, never an address. The words file (kept outside the repo) lists words that must not appear: a hit refuses the copy.
//   node tools/structure-copy.mjs check <file> [--deny <words file>]   exit 1 and the reason when the copy holds anything else.
import fs from 'node:fs';

/** Runs INSIDE the page (sent as its source): the document as indented tags with attribute names only, links as shapes. -> string. */
export function stripPage() {
  const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
  const EMPTY = new Set(['script', 'style', 'noscript', 'template', 'svg', 'iframe', 'object', 'canvas', 'video', 'audio', 'textarea', 'select']);
  const here = new URL(location.href);
  const nameOf = raw => { const low = raw.toLowerCase(); return /^h[1-6]$/.test(low) ? low : low.replace(/[^a-z_:.-]/g, '').replace(/^[^a-z]+/, ''); };
  const link = href => {
    let at;
    try { at = new URL(href, here.href); } catch { return null; }
    if (!/^https?:$/.test(at.protocol)) return null;
    const parts = at.pathname.split('/').filter(Boolean).map(part => (/\d/.test(part) ? '#' : 'a'));
    const shape = `/${parts.join('/')}${parts.length && at.pathname.endsWith('/') ? '/' : ''}`;
    const flags = [at.host === here.host && 'jp-same-host', at.host === here.host && at.pathname === here.pathname && 'jp-same-path',
      [...at.searchParams.values()].some(value => /^\d+$/.test(value)) && 'jp-query-id'].filter(Boolean);
    return {shape, flags};
  };
  const out = [];
  const walk = (node, depth) => {
    if (out.length > 120000) return;
    const tag = nameOf(node.tagName || '');
    if (!tag) return;
    const names = new Set();
    for (const raw of node.getAttributeNames()) { const name = nameOf(raw); if (name && name !== 'href') names.add(name); }
    let attrs = [...names].sort();
    if (tag === 'a' && node.hasAttribute('href')) {
      const seen = link(node.getAttribute('href'));
      attrs = [seen ? `href="${seen.shape}"` : 'href=""', ...(seen?.flags || []), ...attrs];
    }
    const pad = ' '.repeat(Math.min(depth, 80));
    out.push(`${pad}<${[tag, ...attrs].join(' ')}>`);
    if (VOID.has(tag)) return;
    if (!EMPTY.has(tag)) {
      if (node.shadowRoot) { out.push(`${pad} <jp-shadow>`); for (const kid of node.shadowRoot.children) walk(kid, depth + 2); out.push(`${pad} </jp-shadow>`); }
      for (const kid of node.children) walk(kid, depth + 1);
    }
    out.push(`${pad}</${tag}>`);
  };
  walk(document.body, 0);
  return out.join('\n');
}

const LINE = /^ *<\/?(?:h[1-6]|[a-z][a-z_:.-]*)(?: (?:href="(?:\/(?:[a#](?:\/[a#])*\/?)?)?"|[a-z][a-z_:.-]*))*>$/;

/**
 * The refusing check: every line is one tag with attribute names, only href carries a value and that value is a shape of 'a', '#' and '/';
 * no digit outside h1-h6; no denied word anywhere. -> {ok: true, lines, links} or {ok: false, why} (the why names a line number, never its content).
 */
export function checkCopy(text, deny = []) {
  const lines = String(text).split('\n');
  if (lines.length < 20) return {ok: false, why: `only ${lines.length} lines: not a page`};
  for (const [index, line] of lines.entries()) {
    if (!LINE.test(line)) return {ok: false, why: `line ${index + 1} is not a bare tag (text or an attribute value)`};
    if (/\d/.test(line.replace(/<\/?h[1-6]\b/g, ''))) return {ok: false, why: `line ${index + 1} holds a digit`};
  }
  const low = String(text).toLowerCase();
  const hit = deny.map(word => word.trim().toLowerCase()).filter(word => word.length >= 3).find(word => low.includes(word));
  if (hit) return {ok: false, why: 'a denied word is in the copy'};
  return {ok: true, lines: lines.length, links: lines.filter(line => /^ *<a href=/.test(line)).length};
}

const option = (flag, fallback = '') => { const at = process.argv.indexOf(flag); return at > 0 ? process.argv[at + 1] : fallback; };
const denyWords = () => (option('--deny') ? fs.readFileSync(option('--deny'), 'utf8').split('\n').filter(Boolean) : []);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function evaluate(socketUrl, expression) {
  const socket = new WebSocket(socketUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = () => reject(new Error('the tab closed')); });
  try {
    socket.send(JSON.stringify({id: 1, method: 'Runtime.evaluate', params: {expression, returnByValue: true}}));
    const answer = await new Promise((resolve, reject) => {
      socket.onmessage = event => { const data = JSON.parse(event.data); if (data.id === 1) resolve(data); };
      socket.onclose = () => reject(new Error('the tab closed'));
    });
    if (answer.result?.exceptionDetails) throw new Error('the page script failed');
    return answer.result?.result?.value;
  } finally { socket.close(); }
}

async function resultsTab(profile) {
  try {
    const port = Number(fs.readFileSync(`${profile}/DevToolsActivePort`, 'utf8').split('\n')[0]);
    const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    return tabs.find(tab => tab.type === 'page' && /^\/jobs\/search-results\/?$/.test(new URL(tab.url).pathname)) || null;
  } catch { return null; }
}

async function capture() {
  const profile = option('--profile'), out = option('--out'), until = Date.now() + Number(option('--wait', '600')) * 1000;
  if (!profile || !out) { console.error('usage: capture --profile <dir> --out <file> [--deny <file>] [--wait <s>]'); process.exit(2); }
  let tab = null;
  while (!tab && Date.now() < until) { tab = await resultsTab(profile); if (!tab) await sleep(500); }
  if (!tab) { console.error('no results tab seen'); process.exit(1); }
  console.log('results tab seen: waiting for its links to settle');
  let last = -1, steady = 0;
  for (let n = 0; n < 30 && steady < 3; n++) {
    const count = await evaluate(tab.webSocketDebuggerUrl, "document.readyState === 'complete' ? document.querySelectorAll('a[href]').length : -1");
    steady = count > 0 && count === last ? steady + 1 : 0;
    last = count;
    await sleep(1000);
  }
  const text = await evaluate(tab.webSocketDebuggerUrl, `(${stripPage})()`);
  const verdict = checkCopy(text, denyWords());
  if (!verdict.ok) { console.error(`refused: ${verdict.why}`); process.exit(1); }
  fs.writeFileSync(out, `${text}\n`);
  console.log(`written: ${verdict.lines} lines, ${verdict.links} links`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv[2] === 'capture') await capture();
  else if (process.argv[2] === 'check') {
    const verdict = checkCopy(fs.readFileSync(process.argv[3], 'utf8').replace(/\n$/, ''), denyWords());
    console.log(verdict.ok ? `ok: ${verdict.lines} lines, ${verdict.links} links` : `refused: ${verdict.why}`);
    process.exit(verdict.ok ? 0 : 1);
  } else { console.error('usage: capture | check'); process.exit(2); }
}
