// The gallery page: static code that reads its rows live from the artifact's database (`claude.use("db")`), so the owner never reloads or saves it.
// Why (8 Nov 2026, owner via coordinator: "is it live/realtime always?"; first version was a 07:04 snapshot): collection `previews` holds the collector's rows of the current batch (`meta/current`), `adds` holds rows a session adds itself.
// Row: {session, title, sub, url, state: waiting|approved|changes|answered|unknown, mtime (ms), why?, rows?: [{what, before, after}], pics?: [{label, src}]}; src is `images/…` or an https asset URL.

export const STATES = {
  waiting: {icon: '⏳', word: 'Waiting on you', css: 'wait'},
  approved: {icon: '✅', word: 'Approved', css: 'ok'},
  changes: {icon: '✏️', word: 'Changes asked', css: 'chg'},
  answered: {icon: '💬', word: 'Owner replied since', css: 'ans'},
  unknown: {icon: '•', word: 'No answer recorded', css: 'unk'},
};

const CSS = `:root{color-scheme:light;--bg:#f6f7f9;--card:#fff;--ink:#1c2230;--mute:#667085;--line:#e3e6ec;--wait:#b54708;--waitbg:#fef0c7;--ok:#067647;--okbg:#d1fadf;--chg:#b42318;--chgbg:#fee4e2;--ans:#1d4ed8;--ansbg:#dbeafe;--unk:#475467;--unkbg:#eaecf0;--accent:#3b5bdb}
@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;--bg:#12151c;--card:#1b2029;--ink:#e8ebf1;--mute:#9aa3b2;--line:#2a313d;--wait:#fdb022;--waitbg:#4a3508;--ok:#6ce9a6;--okbg:#0b3a26;--chg:#fda29b;--chgbg:#4a1511;--ans:#93c5fd;--ansbg:#1e3a8a;--unk:#c0c6d2;--unkbg:#2a313d;--accent:#8ea2ff}}
:root[data-theme="dark"]{color-scheme:dark;--bg:#12151c;--card:#1b2029;--ink:#e8ebf1;--mute:#9aa3b2;--line:#2a313d;--wait:#fdb022;--waitbg:#4a3508;--ok:#6ce9a6;--okbg:#0b3a26;--chg:#fda29b;--chgbg:#4a1511;--ans:#93c5fd;--ansbg:#1e3a8a;--unk:#c0c6d2;--unkbg:#2a313d;--accent:#8ea2ff}
*{box-sizing:border-box}a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 -apple-system,"Segoe UI",Helvetica,Arial,sans-serif}
main{max-width:1180px;margin:0 auto;padding:28px 20px 60px}h1{margin:0 0 4px;font-size:26px;text-wrap:balance}h2{margin:34px 0 12px;font-size:18px}h2 small{color:var(--mute);font-weight:500;margin-left:6px}
.lead{color:var(--mute);margin:0 0 18px}a{color:var(--accent)}#live{display:inline-flex;gap:6px;align-items:center;font-size:13px;color:var(--mute)}#live i{width:9px;height:9px;border-radius:50%;background:var(--unk)}#live.on i{background:var(--ok)}
.stats{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0}.stat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 16px;min-width:130px}.stat b{display:block;font-size:26px;font-variant-numeric:tabular-nums}
.bar{display:flex;height:10px;border-radius:6px;overflow:hidden;background:var(--line);margin:6px 0 4px}.seg.wait{background:var(--wait)}.seg.ok{background:var(--ok)}.seg.chg{background:var(--chg)}.seg.ans{background:var(--ans)}.seg.unk{background:var(--unk)}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;margin:0 0 16px}
.card header{display:flex;gap:12px;align-items:flex-start;margin-bottom:12px}.who{background:var(--accent);color:#fff;border-radius:8px;padding:3px 9px;font-weight:700;font-size:13px;min-width:34px;text-align:center}
.t{flex:1;font-weight:600;min-width:0;overflow-wrap:anywhere}.sub{font-weight:400;color:var(--mute);font-size:13px;margin-top:2px}.meta{display:flex;flex-direction:column;align-items:flex-end;gap:4px}.when{color:var(--mute);font-size:12px}
.chip{border-radius:999px;padding:3px 10px;font-size:13px;font-weight:600;white-space:nowrap}.chip.wait{background:var(--waitbg);color:var(--wait)}.chip.ok{background:var(--okbg);color:var(--ok)}.chip.chg{background:var(--chgbg);color:var(--chg)}.chip.ans{background:var(--ansbg);color:var(--ans)}.chip.unk{background:var(--unkbg);color:var(--unk)}
.row{border-top:1px solid var(--line);padding-top:10px;margin-top:10px}.what{color:var(--mute);font-size:13px;margin-bottom:6px}
.pair{display:flex;gap:14px;flex-wrap:wrap}figure{margin:0;flex:1 1 320px;min-width:0}figcaption{font-size:12px;color:var(--mute);margin-bottom:4px;font-weight:600}img{max-width:100%;border:1px solid var(--line);border-radius:8px;display:block}
details{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 14px;margin:14px 0}summary{cursor:pointer;font-weight:600}li{margin:3px 0;color:var(--mute);font-size:13px}`;

// The page script. Rows come from a shared store, so every string is set with textContent and every URL is checked before it reaches src / href.
const SCRIPT = `
const STATES = ${JSON.stringify(STATES)};
const $ = id => document.getElementById(id);
const okSrc = s => typeof s === 'string' && /^(images\\/[\\w.-]+|https:\\/\\/[^\\s"'<>]+)$/.test(s);
const okHref = s => typeof s === 'string' && /^https:\\/\\/[^\\s"'<>]+$/.test(s);
function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
function ago(ms) { const h = Math.max(0, Math.round((Date.now() - ms) / 3600000)); return h < 1 ? 'just now' : h < 48 ? h + ' h ago' : Math.round(h / 24) + ' days ago'; }
function chip(state) { const s = STATES[state] || STATES.unknown; const c = el('span', 'chip ' + s.css); c.append(el('span', null, s.icon + ' '), document.createTextNode(s.word)); return c; }
function fig(label, src, alt) { const f = el('figure'); if (label) f.append(el('figcaption', null, label)); if (okSrc(src)) { const a = el('a'); a.href = src; a.target = '_blank'; a.rel = 'noopener'; const i = el('img'); i.loading = 'lazy'; i.src = src; i.alt = alt || ''; a.append(i); f.append(a); } return f; }
function card(r) {
  const c = el('article', 'card'), h = el('header'), t = el('div', 't'), m = el('div', 'meta');
  h.append(el('span', 'who', String(r.session || '?')));
  if (okHref(r.url)) { const a = el('a', null, r.title); a.href = r.url; a.target = '_blank'; a.rel = 'noopener'; t.append(a); } else t.append(document.createTextNode(String(r.title || '')));
  t.append(el('div', 'sub', [r.sub, r.why ? 'demo data: ' + r.why : ''].filter(Boolean).join(' · ')));
  m.append(chip(r.state), el('span', 'when', ago(r.mtime))); h.append(t, m); c.append(h);
  for (const row of Array.isArray(r.rows) ? r.rows : []) { const d = el('div', 'row'), p = el('div', 'pair'); d.append(el('div', 'what', row.what)); if (row.before) p.append(fig('Before', row.before, 'Before: ' + row.what)); if (row.after) p.append(fig('After', row.after, 'After: ' + row.what)); d.append(p); c.append(d); }
  if (Array.isArray(r.pics) && r.pics.length) { const p = el('div', 'pair'); for (const x of r.pics) p.append(fig(x.label, x.src, r.title)); c.append(p); }
  return c;
}
let collector = [], adds = [], current = null, meta = {};
function render() {
  const rows = [...collector.filter(r => r.batch === current), ...adds].filter(r => r && typeof r === 'object').sort((a, b) => b.mtime - a.mtime);
  const count = s => rows.filter(r => r.state === s).length;
  const stats = $('stats'); stats.replaceChildren();
  for (const s of Object.keys(STATES)) { const d = el('div', 'stat'); d.append(el('b', null, String(count(s))), chip(s)); stats.append(d); }
  const bar = $('bar'); bar.replaceChildren();
  for (const s of Object.keys(STATES)) { const g = el('div', 'seg ' + STATES[s].css); g.style.flex = String(Math.max(count(s), 0.001)); g.title = STATES[s].word; bar.append(g); }
  const list = $('list'); list.replaceChildren();
  const section = (title, rs) => { if (!rs.length) return; const h = el('h2', null, title); h.append(el('small', null, String(rs.length))); list.append(h); rs.forEach(r => { try { list.append(card(r)); } catch (e) { list.append(el('p', 'lead', 'A row could not be shown: ' + String(r.title || '?'))); } }); };
  section('Waiting on you', rows.filter(r => r.state === 'waiting'));
  section('Answered or no answer recorded', rows.filter(r => r.state !== 'waiting'));
  if (!rows.length) list.append(el('p', 'lead', 'Nothing to show yet.'));
  const nb = $('boards'); nb.replaceChildren(); const boards = Array.isArray(meta.boards) ? meta.boards : [];
  if (boards.length) { nb.append(el('h2', null, 'Board cards waiting on you')); const u = el('ul'); for (const b of boards) { const li = el('li'); if (okHref(b.url)) { const a = el('a', null, b.title); a.href = b.url; a.target = '_blank'; a.rel = 'noopener'; li.append(a); } else li.textContent = b.title; u.append(li); } nb.append(u); }
  const ns = $('notshown'); ns.replaceChildren(); const hidden = Array.isArray(meta.notShown) ? meta.notShown : [];
  if (hidden.length) { const d = el('details'); d.append(el('summary', null, 'Not shown: nothing marks them as demo data (' + hidden.length + ')')); const u = el('ul'); hidden.slice(0, 80).forEach(n => u.append(el('li', null, n))); d.append(u); ns.append(d); }
  $('refreshed').textContent = typeof meta.refreshedAt === 'string' ? 'Collector last ran ' + meta.refreshedAt.replace('T', ' ').slice(0, 16) + ' UTC.' : '';
}
async function start() {
  const timer = setTimeout(() => { $('live').lastChild.textContent = ' cannot reach the store yet'; }, 10000);
  const db = typeof claude !== 'undefined' && claude.use ? await claude.use('db') : null;
  if (!db) { clearTimeout(timer); $('live').lastChild.textContent = ' not live: open it signed in to claude.ai'; return; }
  const alive = () => { clearTimeout(timer); $('live').className = 'on'; $('live').lastChild.textContent = ' live: updates appear by themselves'; };
  db.doc('meta/current').onSnapshot(s => { const d = s.exists ? s.data() : {}; current = d.batch || null; meta = d; alive(); render(); });
  db.collection('previews').onSnapshot(s => { collector = s.docs.map(d => d.data()); alive(); render(); });
  db.collection('adds').onSnapshot(s => { adds = s.docs.map(d => d.data()); alive(); render(); });
}
start();`;

/** The whole page (no rows inside: they arrive live from the database). */
export function renderPage() {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Previews gallery</title>
<style>
${CSS}
</style></head><body><main>
<h1>Previews gallery</h1><p class="lead">Every UI picture waiting for your yes, and the answered ones of the last 3 days. <span id="live"><i></i><span> connecting…</span></span> <span id="refreshed"></span></p>
<div class="stats" id="stats"></div><div class="bar" id="bar" role="img" aria-label="Previews by state"></div>
<div id="boards"></div><div id="list"></div><div id="notshown"></div>
</main><script>${SCRIPT}
</script></body></html>
`;
}
