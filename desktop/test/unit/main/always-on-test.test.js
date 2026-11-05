// Always on's Test on your own GitHub, the app's side (lib/always-on-test.js, lib/always-on-test-checks.js): every link is looked at directly, at once, with fake answers: no network, no run started in the
// person's repository, no secret value read or returned, Free AI never counts, one test e-mail a day.
// Guard: privacy — the test lists secret NAMES and never a value, and sends only the fixed test sentence; money — an AI check never uses Free AI and costs nothing (a models list).
import test from 'node:test';
import assert from 'node:assert/strict';
import {STEPS, checkAll} from '../../../lib/always-on-test.js';
import {aiCheck, notifyCheck, notionCheck} from '../../../lib/always-on-test-checks.js';

const TOKENS = {GITHUB_TOKEN: 'ghu_SECRET', NOTION_TOKEN: 'ntn_SECRET', ANTHROPIC_API_KEY: 'sk-ant-SECRET', TELEGRAM_BOT_TOKEN: '1:SECRETBOT', JOBADABRA_TRIAL_KEY: 'JPT1.handle.SECRETMAC'};   // the trial key is what our site knows this install by
function storage({secrets = {GITHUB_TOKEN: TOKENS.GITHUB_TOKEN, NOTION_TOKEN: TOKENS.NOTION_TOKEN, ANTHROPIC_API_KEY: TOKENS.ANTHROPIC_API_KEY, JOBADABRA_TRIAL_KEY: TOKENS.JOBADABRA_TRIAL_KEY}, settings = {}} = {}) {
  const kept = {cloud: {repo: 'me/jobadabra-personal-always-on'}, notifyBy: ['app'], ...settings};
  return {secret: name => secrets[name] || '', settings: () => kept, saveSettings: patch => Object.assign(kept, patch)};
}
const reply = (body, status = 200) => ({ok: status < 400, status, json: async () => body, headers: {get: () => null}});
// One fake internet: routes are [pattern, answer]; every call is recorded; an unlisted URL fails the test (nothing else may be reached).
function internet(routes) {
  const calls = [];
  const fetcher = async (url, options = {}) => {
    calls.push({url: String(url), method: options.method || 'GET', body: options.body || ''});
    const hit = routes.find(([pattern]) => pattern.test(String(url)));
    assert.ok(hit, `unexpected call: ${options.method || 'GET'} ${url}`);
    const answer = typeof hit[1] === 'function' ? hit[1](url, options) : hit[1];
    return answer instanceof Error ? Promise.reject(answer) : answer;
  };
  return {fetcher, calls};
}
const GITHUB = [
  [/\/repos\/me\/jobadabra-personal-always-on$/, reply({full_name: 'me/jobadabra-personal-always-on', private: true})],
  [/\/actions\/secrets\?/, reply({secrets: [{name: 'ANTHROPIC_API_KEY'}, {name: 'NOTION_TOKEN'}]})],
  [/\/actions\/workflows\/daily\.yml$/, reply({state: 'active'})],
];
const NOTION = [[/api\.notion\.com\/v1\/users\/me/, reply({id: 'u'})]];
const AI = [[/api\.anthropic\.com\/v1\/models/, reply({data: []})]];
const SITE = [[/\/api\/account\/email$/, reply({ok: true, email: 'a@b.co', confirmed: true})], [/\/api\/notify\/email$/, reply({ok: true})]];
const states = result => Object.fromEntries(result.steps.map(step => [step.id, step.state]));

test('everything works: six steps all ok, and the check only ever READS from GitHub (no run, no write)', async () => {
  const net = internet([...GITHUB, ...NOTION, ...AI, ...SITE]);
  const result = await checkAll(storage({settings: {notifyBy: ['email'], notifyEmail: 'a@b.co'}, secrets: {...TOKENS, TELEGRAM_BOT_TOKEN: ''}}), {fetcher: net.fetcher});
  assert.equal(result.verdict, 'passed', JSON.stringify(result.steps.filter(step => step.state !== 'ok')));
  assert.deepEqual(result.steps.map(step => step.id), STEPS.map(step => step.id));
  assert.ok(result.steps.every(step => step.state === 'ok' && step.line === ''), JSON.stringify(result.steps));
  const github = net.calls.filter(call => /api\.github\.com/.test(call.url));
  assert.ok(github.length >= 3 && github.every(call => call.method === 'GET'), 'GitHub is only read');
  assert.ok(!net.calls.some(call => /dispatches|\/runs/.test(call.url)), 'no workflow run is started or listed');
  assert.equal(result.steps.find(step => step.id === 'notify').settings, true);
});

test('no secret value ever leaves the app in a result, a line or a message (names only)', async () => {
  const net = internet([...GITHUB, ...NOTION, ...AI, ...SITE]);
  const result = await checkAll(storage({settings: {notifyBy: ['email'], notifyEmail: 'a@b.co'}}), {fetcher: net.fetcher});
  const text = JSON.stringify(result) + net.calls.filter(call => call.method !== 'GET').map(call => call.body).join('');
  for (const value of Object.values(TOKENS)) assert.ok(!text.includes(value), `${value} leaked`);
});

test('the repository is not visible to the app (not there, or Jobadabra not installed on it): that step fails in plain words and the two that need it are not checked; a public one is refused', async () => {
  const none = [[/\/repos\/me\/jobadabra-personal-always-on$/, reply({message: 'Not Found'}, 404)]];
  const result = await checkAll(storage(), {fetcher: internet([...none, ...NOTION, ...AI]).fetcher});
  assert.deepEqual([states(result).repo, states(result).keys, states(result).schedule], ['failed', 'skipped', 'skipped']);
  assert.match(result.steps[0].line, /cannot see me\/jobadabra-personal-always-on.*installed on it/);
  const open = [[/\/repos\/me\/jobadabra-personal-always-on$/, reply({private: false})]];
  assert.match((await checkAll(storage(), {fetcher: internet([...open, ...NOTION, ...AI]).fetcher})).steps[0].line, /is public/);
});

test('a Free AI person is not told to press Update for a key that never goes to GitHub; the AI step says why; the e-mail key name is required only when e-mail is a way', async () => {
  const net = internet([...GITHUB.map(([pattern, answer]) => (/secrets/.test(pattern) ? [pattern, reply({secrets: [{name: 'NOTION_TOKEN'}]})] : [pattern, answer])), ...NOTION]);
  const free = await checkAll(storage({secrets: {...TOKENS, ANTHROPIC_API_KEY: 'JPF1.abc.def'}}), {fetcher: net.fetcher});
  assert.deepEqual([states(free).keys, states(free).ai], ['ok', 'failed']);
  assert.match(free.steps.find(step => step.id === 'ai').line, /Free AI does not run on your own GitHub/);
  const mailing = storage({settings: {notifyBy: ['email'], notifyEmail: 'a@b.co'}, secrets: {...TOKENS, ANTHROPIC_API_KEY: '', JOBADABRA_REPO_TRIAL_KEY: 'JPT1.h.m'}});
  const lacking = await checkAll(mailing, {fetcher: internet([...GITHUB.map(([pattern, answer]) => (/secrets/.test(pattern) ? [pattern, reply({secrets: [{name: 'NOTION_TOKEN'}]})] : [pattern, answer])), ...NOTION, ...SITE]).fetcher});
  assert.match(lacking.steps.find(step => step.id === 'keys').line, /lacks JOBADABRA_TRIAL_KEY/);
});

test('a link that never answers ends as a failed step within the deadline, and a press during a Test gets that Test\'s answer (one message, one e-mail)', async () => {
  const hang = () => new Promise(() => {});
  const result = await checkAll(storage(), {fetcher: hang, deadline: 30});
  assert.equal(result.steps.length, STEPS.length);
  assert.equal(result.verdict, 'failed');
  assert.ok(result.steps.every(step => step.state !== 'ok'));
  const net = internet([...GITHUB, ...NOTION, ...AI, ...SITE]), mail = storage({settings: {notifyBy: ['email'], notifyEmail: 'a@b.co'}});
  const [first, second] = await Promise.all([checkAll(mail, {fetcher: net.fetcher}), checkAll(mail, {fetcher: net.fetcher})]);
  assert.equal(first, second, 'the same run');
  assert.equal(net.calls.filter(call => /notify\/email/.test(call.url)).length, 1);
});

test('a missing key is named, a disabled or absent daily workflow says what to press', async () => {
  const lacking = GITHUB.map(([pattern, answer]) => (/secrets/.test(pattern) ? [pattern, reply({secrets: [{name: 'NOTION_TOKEN'}]})] : /daily/.test(pattern) ? [pattern, reply({state: 'disabled_manually'})] : [pattern, answer]));
  const result = await checkAll(storage(), {fetcher: internet([...lacking, ...NOTION, ...AI]).fetcher});
  assert.equal(states(result).keys, 'failed');
  assert.match(result.steps.find(step => step.id === 'keys').line, /lacks ANTHROPIC_API_KEY/);
  assert.match(result.steps.find(step => step.id === 'schedule').line, /switched off/);
  const gone = GITHUB.map(([pattern, answer]) => (/daily/.test(pattern) ? [pattern, reply({message: 'Not Found'}, 404)] : [pattern, answer]));
  assert.match((await checkAll(storage(), {fetcher: internet([...gone, ...NOTION, ...AI]).fetcher})).steps.find(step => step.id === 'schedule').line, /not in your repository/);
});

test('Notion: answers, refused token, no token', async () => {
  assert.equal((await notionCheck(storage(), {fetcher: internet(NOTION).fetcher})).state, 'ok');
  const refused = await notionCheck(storage(), {fetcher: internet([[/notion/, reply({message: 'bad'}, 401)]]).fetcher});
  assert.deepEqual([refused.state, /refused your token \(401\)/.test(refused.line)], ['failed', true]);
  assert.match((await notionCheck(storage({secrets: {}}), {fetcher: internet([]).fetcher})).line, /not connected/);
});

test('the AI key: the person\'s own key is asked a models list; Free AI is refused WITHOUT any call; a refused key says so', async () => {
  const net = internet(AI);
  assert.equal((await aiCheck(storage(), {fetcher: net.fetcher})).state, 'ok');
  assert.equal(net.calls[0].method, 'GET', 'a list of models: it costs nothing');
  const free = internet([]);
  const refusedFree = await aiCheck(storage({secrets: {ANTHROPIC_API_KEY: 'JPF1.abc.def'}}), {fetcher: free.fetcher});
  assert.deepEqual([refusedFree.state, free.calls.length], ['failed', 0]);
  assert.match(refusedFree.line, /Free AI does not run on your own GitHub/);
  assert.match((await aiCheck(storage(), {fetcher: internet([[/anthropic/, reply({}, 401)]]).fetcher})).line, /refused the key \(401\)/);
  assert.match((await aiCheck(storage(), {fetcher: internet([[/anthropic/, reply({}, 403)]]).fetcher})).line, /answered 403: the key may be restricted/);   // a restricted key is not called refused
  assert.doesNotMatch((await aiCheck(storage(), {fetcher: internet([[/anthropic/, reply({}, 503)]]).fetcher})).line, /Check the key/);   // a provider outage is not the key's fault
  assert.match((await aiCheck(storage({secrets: {}}), {fetcher: free.fetcher})).line, /no AI key/i);
});

test('the notification step: nothing set up fails with the pop-up mark; Telegram is tried with the bot; an unconfirmed address is not mailed; the site decides how many test e-mails a day', async () => {
  assert.match((await notifyCheck(storage(), {fetcher: internet([]).fetcher})).line, /Nothing can reach you/);
  const keyless = await notifyCheck(storage({secrets: {}, settings: {notifyBy: ['email'], notifyEmail: 'a@b.co'}}), {fetcher: internet([]).fetcher});
  assert.match(keyless.line, /no key for our site yet/);   // said, never "the website could not be reached"
  const bot = internet([[/api\.telegram\.org\/bot1:SECRETBOT\/sendMessage/, reply({ok: true, result: {}})]]);
  assert.equal((await notifyCheck(storage({secrets: TOKENS, settings: {notifyBy: ['telegram'], telegramChatId: 7}}), {fetcher: bot.fetcher})).state, 'ok');
  assert.match(bot.calls[0].body, /"chat_id":7/);
  const unconfirmed = internet([[/\/api\/account\/email$/, reply({ok: true, email: 'a@b.co', confirmed: false})]]);
  const held = await notifyCheck(storage({settings: {notifyBy: ['email'], notifyEmail: 'a@b.co'}, secrets: {...TOKENS, TELEGRAM_BOT_TOKEN: ''}}), {fetcher: unconfirmed.fetcher});
  assert.deepEqual([held.state, /not confirmed/.test(held.line), unconfirmed.calls.some(call => /notify\/email/.test(call.url))], ['failed', true, false]);
  const mail = storage({settings: {notifyBy: ['email'], notifyEmail: 'a@b.co'}, secrets: {...TOKENS, TELEGRAM_BOT_TOKEN: ''}}), site = internet(SITE);
  assert.equal((await notifyCheck(mail, {fetcher: site.fetcher})).state, 'ok');
  assert.equal((await notifyCheck(mail, {fetcher: site.fetcher})).line, '', 'the app keeps no limit of its own: every press asks the site, which limits the test e-mail to once a day per address');
  assert.equal(site.calls.filter(call => /notify\/email/.test(call.url)).length, 2);
  assert.equal(mail.settings().aonTestMailAt, undefined);
  const earlier = internet([SITE[0], [/\/api\/notify\/email$/, reply({ok: true, earlier: true})]]);
  assert.equal((await notifyCheck(mail, {fetcher: earlier.fetcher})).line, 'A test e-mail already reached you today.', 'the site says it went earlier today: said, state stays ok');
  const stopped = internet([SITE[0], [/\/api\/notify\/email$/, reply({ok: false, reason: 'unconfirmed_stopped'}, 409)]]);
  const refused = await notifyCheck(mail, {fetcher: stopped.fetcher});
  assert.deepEqual([refused.state, /Send the confirm link again/.test(refused.line)], ['failed', true]);
});

test('a link that throws is a failed step, never a missing one', async () => {
  const net = internet([[/api\.github\.com/, new Error('offline')], ...NOTION, ...AI]);
  const result = await checkAll(storage(), {fetcher: net.fetcher});
  assert.equal(result.steps.length, STEPS.length);
  assert.equal(states(result).repo, 'failed');
  assert.equal(result.verdict, 'failed');
});
