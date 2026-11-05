// The app's side of Always on's Test button on the person's own GitHub (owner, 5 Nov 2026: "Direct check, ~5 s"): every link of the chain is looked at from the app, at once, and each is one step with
// Works or Failed and a plain line. NO run is started in their repository (the old way dispatched the engine's `test` job through GitHub Actions and took minutes).
// The links: the repository is there and our GitHub app is installed on it; the keys are there (their NAMES only: a value is never read); the daily workflow is enabled; Notion answers; the person's own AI key
// answers (never Free AI); a test message reaches them. Never reads or stores a secret. Guarded by test/unit/main/always-on-test.test.js.
import * as github from './github.js';
import * as ai from './ai/index.js';
import * as channel from './notify-channel.js';
import {isFreeKey, REPO_KEY} from './ai-free.js';
import {aiCheck, notifyCheck, notionCheck, timed} from './always-on-test-checks.js';

/** The checks, in order: `id` for the tests, `title` for the row; `settings` marks the step whose fix is the notifications pop-up. */
export const STEPS = [
  {id: 'repo', title: 'Your repository is there and Jobadabra is installed on it'},
  {id: 'keys', title: 'Your keys are in your repository'},
  {id: 'schedule', title: 'The daily run is switched on'},
  {id: 'notion', title: 'Notion answers with your token'},   // about Notion
  {id: 'ai', title: 'Your AI key answers'},
  {id: 'notify', title: 'A test message reached you', settings: true},
];
const ok = (line = '') => ({state: 'ok', line}), failed = line => ({state: 'failed', line}), skipped = line => ({state: 'skipped', line});
const NOT_CHECKED = 'Not checked: your repository came first.';

// The key names a run needs: the AI key of the engine GitHub uses (a Free AI key never goes there, so for it the AI step says why and this one asks for nothing), Notion, Telegram's two when it is set up,
// and the repo's trial key when e-mail is a way (a run mails with it). NAMES only: a value is never compared.
function neededKeys(storage) {
  const engine = ai.alwaysOnEngine(storage.settings(), ai.keysOf(storage)), keyName = ai.ENGINES[engine].key, own = storage.secret(keyName);
  const ways = channel.channelsOf(storage);
  return [...(own && !isFreeKey(own) ? [keyName] : []), 'NOTION_TOKEN', ...(channel.telegramReady(storage) ? ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'] : []),   // about Notion
    ...(ways.includes('email') && /^JPT1\./.test(storage.secret(REPO_KEY)) ? ['JOBADABRA_TRIAL_KEY'] : [])];
}

/** The chain that needs the repository: it is there and Jobadabra can reach it, its secrets by name, its daily workflow. Later links are skipped when an earlier one failed. -> {repo, keys, schedule}
 *  Why (5 Nov 2026, review): one read of the repository itself, not a list of installations (a list is paged and can pick another repo): the app's token sees a repository only where the app is installed. */
export async function repositoryChain(storage, {fetcher} = {}) {
  const {repo} = storage.settings().cloud || {}, token = storage.secret('GITHUB_TOKEN');
  const stop = line => ({repo: failed(line), keys: skipped(NOT_CHECKED), schedule: skipped(NOT_CHECKED)});
  if (!repo || !token) return stop('Always on is not connected to GitHub yet. Turn it on first.');
  const api = github.client(token, fetcher);
  try {
    const found = await api('GET', `/repos/${repo}`);
    if (found?.private === false) return stop(`${repo} is public. Make it private in its Settings, then test again.`);
  } catch (error) {
    if (error.status === 401) return stop('GitHub no longer accepts the sign-in. Connect GitHub again, then test again.');
    if (error.status === 404 || error.status === 403) return stop(`Jobadabra cannot see ${repo}. Check that the repository exists and that Jobadabra is installed on it (GitHub → Settings → Applications), then test again.`);
    return stop(error.message || 'GitHub did not answer. Test again in a minute.');
  }
  const [keys, schedule] = await Promise.all([keyNames(api, repo, storage), workflowState(api, repo)]);
  return {repo: ok(), keys, schedule};
}

async function keyNames(api, repo, storage) {
  try {
    const {secrets = []} = await api('GET', `/repos/${repo}/actions/secrets?per_page=100`) || {};   // names and dates only; GitHub never returns a value
    const have = new Set(secrets.map(item => item.name)), missing = neededKeys(storage).filter(name => !have.has(name));
    return missing.length ? failed(`Your repository lacks ${missing.join(', ')}. Press Update on the Always on card to send them again.`) : ok();
  } catch (error) { return failed(`GitHub would not list your repository's keys (${error.status || 'no answer'}). Test again in a minute.`); }
}

async function workflowState(api, repo) {
  try {
    const flow = await api('GET', `/repos/${repo}/actions/workflows/daily.yml`);
    return flow?.state === 'active' ? ok() : failed('The daily run is switched off in your repository. On GitHub: Actions, "daily", Enable workflow.');
  } catch (error) { return failed(error.status === 404 ? 'The daily run is not in your repository. Press Update on the Always on card.' : `GitHub did not answer (${error.status || 'no answer'}). Test again in a minute.`); }
}

const DEADLINE_MS = 15000;
// A link that has not answered by then is a failed step: the Test always ends (it has no run to time out).
function within(work, line, ms) {
  let timer;
  return Promise.race([work, new Promise(done => { timer = setTimeout(() => done(failed(line)), ms); })]).finally(() => clearTimeout(timer));
}
let inflight = null;

/** The whole Test: all checks at once. -> {ok: true, verdict: 'passed' | 'failed', steps: [{id, title, state, line, settings}]}. A check that throws or hangs is a failed step, never a missing one.
 *  One at a time: a press while a Test runs gets that Test's answer, so no second message or e-mail goes out (review, 5 Nov 2026). Passing is about NAMES and answers: a value in the repository is never compared. */
export function checkAll(storage, options = {}) {
  inflight ??= run(storage, options).finally(() => { inflight = null; });
  return inflight;
}

async function run(storage, {fetcher = globalThis.fetch, now, deadline = DEADLINE_MS} = {}) {
  const guard = (work, said) => within(work.catch(() => failed(said)), said, deadline), quick = timed(fetcher);
  const [chain, notion, aiKey, notify] = await Promise.all([
    within(repositoryChain(storage, {fetcher: quick}).catch(() => ({repo: failed('GitHub did not answer. Test again in a minute.'), keys: skipped(NOT_CHECKED), schedule: skipped(NOT_CHECKED)})), 'GitHub did not answer.', deadline).then(done => (done.repo ? done : {repo: done, keys: skipped(NOT_CHECKED), schedule: skipped(NOT_CHECKED)})),
    guard(notionCheck(storage, {fetcher}), 'Notion did not answer.'),   // about Notion
    guard(aiCheck(storage, {fetcher}), 'The AI key could not be checked.'),
    guard(notifyCheck(storage, {fetcher, now}), 'The test message could not be sent.'),
  ]);
  const by = {...chain, notion, ai: aiKey, notify};
  const steps = STEPS.map(({id, title, settings}) => ({id, title, ...by[id], ...(settings ? {settings: true} : {})}));
  return {ok: true, verdict: steps.every(step => step.state === 'ok') ? 'passed' : 'failed', steps};
}
