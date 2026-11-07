// Import from LinkedIn, the engine (lib/linkedin-import.js): consent through the site, the key in the Keychain only, the Member Snapshot reads made on this Mac with
// paging and the "not prepared yet" answer, 401/403/429 never retried, and the tables mapped to a CV. Recorded-shape fixtures (test/fixtures/linkedin-snapshot.json), never the live API.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {cancel, connect, disconnect, DOMAINS, fetchAll, fetchDomain, readToken, saveToken, state, toProfileCv} from '../../../lib/linkedin-import.js';
import {receive as handedOver} from '../../../lib/oauth-handoff.js';

const receive = fields => handedOver('linkedin-import', new URLSearchParams(fields));

const FIXTURE = JSON.parse(fs.readFileSync(new URL('../../fixtures/linkedin-snapshot.json', import.meta.url), 'utf8'));
const TOKEN = 'AQV-fake-dma-token-1234567890';
const json = (body, status = 200) => new Response(JSON.stringify(body), {status});

// A stand-in for api.linkedin.com: the fixture's pages by domain and start; `overrides` change one domain's answer; every call is kept.
function linkedin({overrides = {}, calls = []} = {}) {
  const fetcher = async (url, init) => {
    calls.push({url: String(url), init});
    const u = new URL(url);
    const domain = u.searchParams.get('domain'), start = Number(u.searchParams.get('start') || 0);
    if (typeof overrides[domain] === 'function') { const answer = overrides[domain](calls.filter(c => c.url.includes(`domain=${domain}`)).length); if (answer) return answer; }
    const pages = FIXTURE[domain];
    return pages?.[start] ? json(pages[start]) : json({message: 'No data found for this memberId'}, 404);
  };
  return Object.assign(fetcher, {calls});
}
function keychain() {
  const items = new Map(), log = [];
  return {items, log, write: (service, value, o) => { log.push(['write', service, o.account]); items.set(service, value); return true; }, read: service => items.get(service) ?? null, remove: service => { log.push(['remove', service]); items.delete(service); }};
}
function storage() { let settings = {}; return {settings: () => settings, saveSettings: patch => { settings = {...settings, ...patch}; }}; }
const NOW = new Date('2026-11-03T10:00:00Z');

test('connect opens the site with a state, waits, and takes the key only for that state, once', async () => {
  let opened = '';
  const waiting = connect(url => { opened = url; }, {site: 'https://site.test'});
  await new Promise(r => setImmediate(r));
  assert.match(opened, /^https:\/\/site\.test\/api\/linkedin-import\/start\?state=[A-Za-z0-9_-]{43}$/);
  const state = new URL(opened).searchParams.get('state');
  assert.equal(receive({state: 'x'.repeat(43), access_token: TOKEN, expires_in: '5184000'}), false, 'an attacker\'s state: dropped unread');
  assert.equal(receive({state, access_token: TOKEN, expires_in: '5184000'}), true);
  assert.deepEqual(await waiting, {ok: true, token: TOKEN, expiresIn: 5184000});
  assert.equal(receive({state, access_token: TOKEN}), false, 'used once');
  assert.equal(receive({state: 'y'.repeat(43), access_token: TOKEN}), false, 'nothing waits: a key that arrives anyway is dropped (a victim\'s browser on an attacker\'s link)');
});

test('cancelled, no answer in 5 minutes, or the browser would not open: a plain error', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const waiting = connect(() => {}, {site: 'https://x'});
  await new Promise(r => setImmediate(r));
  cancel();
  assert.equal((await waiting).error, 'Cancelled.');
  const timedOut = connect(() => {}, {site: 'https://x', timeout: 5});
  t.mock.timers.tick(5);
  assert.match((await timedOut).error, /EU, EEA and Switzerland[^]*data file/);
  assert.match((await connect(() => { throw new Error('no browser'); }, {site: 'https://x'})).error, /could not be opened/);
});

test('the key goes to the Keychain only; settings hold when it ends, never the value; an expired key is deleted', () => {
  const kc = keychain(), s = storage();
  assert.deepEqual(saveToken(s, {token: TOKEN, expiresIn: 5184000}, {keychain: kc, now: NOW}), {ok: true});
  assert.deepEqual(kc.log[0], ['write', 'jobadabra.linkedin.dma_token', 'jobadabra']);
  assert.ok(!JSON.stringify(s.settings()).includes(TOKEN), 'the value is never in the settings');
  assert.deepEqual(state(s, {keychain: kc, now: NOW}), {connected: true, connectedAt: NOW.toISOString(), expiresAt: '2027-01-02T10:00:00.000Z'});
  assert.equal(readToken(s, {keychain: kc, now: NOW}), TOKEN);
  assert.deepEqual(state(s, {keychain: kc, now: new Date('2027-01-03T00:00:00Z')}), {connected: false, expired: true});
  assert.equal(kc.items.size, 0, 'expiry deletes the item');
  assert.equal(s.settings().linkedinImport, null);
  assert.equal(readToken(s, {keychain: kc, now: NOW}), null);
  assert.match(saveToken(s, {token: TOKEN}, {keychain: {write: () => false}}).error, /Keychain would not keep/);
});

test('fetchDomain follows LinkedIn\'s next pages of this endpoint, with the version header and the key', async () => {
  const f = linkedin();
  const got = await fetchDomain(TOKEN, 'POSITIONS', {fetcher: f});
  assert.equal(got.ok, true);
  assert.deepEqual(got.rows.map(r => r['Company Name']), ['Acme', 'Acme', 'Northwind']);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].init.headers['Linkedin-Version'], '202312');
  assert.equal(f.calls[0].init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.match(f.calls[0].url, /^https:\/\/api\.linkedin\.com\/rest\/memberSnapshotData\?q=criteria&domain=POSITIONS$/);
  const hostile = linkedin({overrides: {SKILLS: () => json({paging: {links: [{rel: 'next', href: 'https://evil.test/steal'}]}, elements: [{snapshotDomain: 'SKILLS', snapshotData: [{Name: 'SQL'}]}]})}});
  assert.equal((await fetchDomain(TOKEN, 'SKILLS', {fetcher: hostile})).rows.length, 1);
  assert.equal(hostile.calls.length, 1, 'a next link that is not this endpoint is never followed (the key goes to LinkedIn only)');
});

test('"No data found" is pending (or the end of the pages); 401, 403, 429 and 426 stop and are never retried', async () => {
  const none = linkedin({overrides: {LANGUAGES: () => json({status: 404, message: 'No data found for this memberId'}, 404)}});
  assert.equal((await fetchDomain(TOKEN, 'LANGUAGES', {fetcher: none})).kind, 'pending');
  for (const [status, kind] of [[401, 'unauthorized'], [403, 'unauthorized'], [429, 'rate'], [426, 'version'], [500, 'error']]) {
    const f = linkedin({overrides: {PROFILE: () => json({message: 'x'}, status)}});
    const got = await fetchDomain(TOKEN, 'PROFILE', {fetcher: f});
    assert.equal(got.kind, kind, String(status));
    assert.equal(f.calls.length, 1, `${status}: one call, no retry`);
  }
  assert.equal((await fetchDomain(TOKEN, 'PROFILE', {fetcher: async () => { throw new Error('offline'); }})).kind, 'error');
});

test('fetchAll reads the five domains in order, asks a pending one again, and stops at once on a 401/429', async () => {
  const steps = [];
  const f = linkedin({overrides: {LANGUAGES: n => (n < 3 ? json({message: 'No data found for this memberId'}, 404) : null)}});
  const all = await fetchAll(TOKEN, {fetcher: f, sleep: async () => {}, onProgress: (d, s) => steps.push(`${d}:${s}`)});
  assert.deepEqual(Object.keys(all.status), DOMAINS);
  assert.ok(Object.values(all.status).every(s => s === 'ok'), JSON.stringify(all.status));
  assert.deepEqual(steps.filter(s => s.startsWith('LANGUAGES')), ['LANGUAGES:pending', 'LANGUAGES:pending', 'LANGUAGES:ok']);
  assert.deepEqual(DOMAINS, ['PROFILE', 'POSITIONS', 'EDUCATION', 'SKILLS', 'LANGUAGES'], 'only the profile tables, never messages, connections or the Changelog');
  assert.ok(f.calls.every(c => DOMAINS.some(d => c.url.includes(`domain=${d}`))));
  const slow = await fetchAll(TOKEN, {fetcher: linkedin({overrides: {LANGUAGES: () => json({message: 'No data found for this memberId'}, 404)}}), sleep: async () => {}, wait: 10000, every: 5000});
  assert.equal(slow.status.LANGUAGES, 'pending');
  assert.equal(slow.status.POSITIONS, 'ok', 'what arrived is kept while one is pending');
  const limited = linkedin({overrides: {POSITIONS: () => json({}, 429)}, calls: []});
  const stopped = await fetchAll(TOKEN, {fetcher: limited, sleep: async () => {}});
  assert.equal(stopped.stopped, 'rate');
  assert.equal(limited.calls.filter(c => c.url.includes('EDUCATION')).length, 0, 'nothing more is asked after a 429');
});

test('the tables become a CV by structure: positions grouped by company, education, skills, languages, name and summary', async () => {
  const all = await fetchAll(TOKEN, {fetcher: linkedin(), sleep: async () => {}});
  const cv = toProfileCv(all.tables);
  assert.deepEqual(cv.jobs.map(j => [j.company, j.roles.map(r => r.title)]), [['Acme', ['Product Manager', 'Associate Product Manager']], ['Northwind', ['Data Analyst']]]);
  assert.deepEqual(cv.jobs[0].roles[0].bullets, ['Led the pricing relaunch', 'Grew activation by 18%']);
  assert.equal(cv.jobs[0].roles[0].period, 'Jan 2021 – Present');
  assert.equal(cv.name, 'Anna Rossi');
  assert.equal(cv.location, 'Wien, Austria');
  assert.equal(cv.skills, 'SQL, Looker, Stakeholder management');
  assert.equal(cv.languages, 'German (Native or bilingual), English (Full professional)');
  assert.deepEqual(cv.education, [{school: 'Universität Wien', degree: 'MSc Economics', period: '2013 – 2015'}]);
  assert.match((() => { try { toProfileCv({'Positions.csv': []}); } catch (e) { return e.message; } })(), /no positions[^]*data file/);
  assert.ok(!JSON.stringify(cv).includes('Birth Date') && !JSON.stringify(cv).includes('1010'), 'only the mapped columns pass: no birth date, no postal code in the CV');
});

test('disconnect deletes the key first, asks the site to revoke it, and a failed revoke never keeps the key', async () => {
  const kc = keychain(), s = storage();
  saveToken(s, {token: TOKEN, expiresIn: 5184000}, {keychain: kc, now: NOW});
  const calls = [];
  const answer = await disconnect(s, {keychain: kc, now: NOW, site: 'https://site.test', fetcher: async (url, init) => { calls.push({url, body: JSON.parse(init.body)}); return json({ok: true}); }});
  assert.deepEqual(answer, {ok: true, revoked: true});
  assert.deepEqual(calls, [{url: 'https://site.test/api/linkedin-import/revoke', body: {token: TOKEN}}]);
  assert.equal(kc.items.size, 0);
  assert.equal(s.settings().linkedinImport, null);
  saveToken(s, {token: TOKEN}, {keychain: kc, now: NOW});
  assert.deepEqual(await disconnect(s, {keychain: kc, now: NOW, fetcher: async () => { throw new Error('offline'); }}), {ok: true, revoked: false});
  assert.equal(kc.items.size, 0, 'deleted even when LinkedIn could not be asked');
  assert.deepEqual(await disconnect(s, {keychain: kc, now: NOW, fetcher: async () => { throw new Error('must not call'); }}), {ok: true, revoked: false}, 'nothing held: nothing sent');
});
