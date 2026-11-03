// Free AI (owner, 16 Oct 2026): the engine for people with no key. The app's Anthropic SDKs (JS and the Python pipeline) are pointed at our website
// (ANTHROPIC_BASE_URL), which answers with an open model on Cloudflare Workers AI (site/src/free-ai.js). The "API key" is JPF1.<install>.<token>,
// the install's own token for purpose "ai"; no account, no founder key, nothing on this Mac from Cloudflare. An own key saved later → back to Anthropic directly.
import {installId} from './pool-share.js';
import {siteOffForUser} from './recipes.js';
import {installToken} from './install-token.js';
import {log as appLog} from './log.js';

export const FREE_BASE = 'https://www.jobadabra.top/api/ai';

// Our own keys: Free AI's JPF1.… and the founder/friend key (JP1.…) older apps used for the $1 credit.
export const isFreeKey = key => /^JPF?1\./.test(String(key || ''));

// Settings written by the credit (`aiTrial`) count as Free: those installs move over when the app starts (migrate).
export const isOn = settings => !!(settings?.aiFree || settings?.aiTrial);

// Point this process's Anthropic SDK at Free AI, or back at Anthropic.
export function apply(settings, env = process.env) {
  if (isOn(settings)) env.ANTHROPIC_BASE_URL = FREE_BASE;
  else delete env.ANTHROPIC_BASE_URL;
  // The end-to-end journey (desktop/e2e) sends the app's own AI calls through its test proxy, as lib/pipeline.js does for the engine.
  if (env.JOBADABRA_E2E && env.JOBADABRA_E2E_AI_BASE_URL) env.ANTHROPIC_BASE_URL = env.JOBADABRA_E2E_AI_BASE_URL;
  // The same for the OpenAI SDK (it follows OPENAI_BASE_URL): the e2e meters and replays the app's OpenAI calls too. Never set for a user.
  if (env.JOBADABRA_E2E && env.JOBADABRA_E2E_OPENAI_BASE_URL) env.OPENAI_BASE_URL = env.JOBADABRA_E2E_OPENAI_BASE_URL;
}

// Turn Free AI on: mint this install's token, keep JPF1.<install>.<token> as the Anthropic key. -> {ok, error?}
export async function start(storage, env = process.env, fetcher = globalThis.fetch) {
  // The end-to-end journey on CI's Free AI relay (desktop/e2e, lib/engine.mjs freeAi): the relay hands its own JPF1 key, so the Free card is pressed as a person
  // would, and the website is never asked. Never set for a user (the variable alone, without JOBADABRA_E2E, changes nothing).
  const relayKey = env.JOBADABRA_E2E && isFreeKey(env.JOBADABRA_E2E_FREE_AI_KEY) ? env.JOBADABRA_E2E_FREE_AI_KEY : '';
  if (relayKey) storage.setSecret('ANTHROPIC_API_KEY', relayKey);
  else if (siteOffForUser()) return {ok: false, error: 'This is not a regular install, so Free AI is not asked.'};
  else try {
    const install = installId(storage);
    const token = await installToken(storage, install, 'ai', {base: FREE_BASE.replace(/\/api\/ai$/, ''), fetcher});
    if (!token) return {ok: false, error: 'Free AI could not start just now. Check your connection and try again.'};
    storage.setSecret('ANTHROPIC_API_KEY', `JPF1.${install}.${token}`);
  } catch { return {ok: false, error: 'Free AI could not start just now. Check your connection and try again.'}; }
  storage.saveSettings({aiFree: true, aiTrial: false, aiEngine: 'api'});   // Free IS the Anthropic API engine: an earlier Codex/OpenAI/CLI pick must not stay in charge
  apply(storage.settings(), env);
  return {ok: true};
}

// At start-up: an install that had the $1 credit (a JP1.… key) gets its Free AI token, silently. Never throws.
export async function migrate(storage, env = process.env, fetcher = globalThis.fetch) {
  const settings = storage.settings();
  if (!settings.aiTrial || settings.aiFree) return {ok: true, moved: false};
  const result = await start(storage, env, fetcher);
  return {...result, moved: !!result.ok};
}

// Own key saved: stop using Free AI.
export function stop(storage, env = process.env) {
  if (!isOn(storage.settings())) return;
  storage.saveSettings({aiFree: false, aiTrial: false});
  apply(storage.settings(), env);
}

// The "API key" card pressed while Free is on (#1017): Free IS the 'api' engine, so the pick alone changes nothing. Leave Free and forget its token,
// so the key box is empty and waiting for the person's own key. Not on Free: nothing to do. -> true when Free was left.
export function leave(storage, env = process.env) {
  if (!isOn(storage.settings())) return false;
  stop(storage, env);
  if (isFreeKey(storage.secret('ANTHROPIC_API_KEY'))) storage.setSecret('ANTHROPIC_API_KEY', '');
  return true;
}

// The install's own AI token (JPF1.…) for an install whose Free AI is not on (it has its own key): kept on this Mac only, as the app's proof of the install to the website
// (the trial status, the notify e-mail, ensureRepoKey below). Never sent to GitHub (3 Nov 2026). Kept under this name; never throws.
export const TRIAL_KEY = 'JOBADABRA_TRIAL_KEY';
export async function ensureTrialKey(storage, fetcher = globalThis.fetch) {
  if (storage.secret(TRIAL_KEY) || /^JPF1\./.test(storage.secret('ANTHROPIC_API_KEY') || '') || siteOffForUser()) return;
  const install = installId(storage);
  try {
    const token = await installToken(storage, install, 'ai', {base: FREE_BASE.replace(/\/api\/ai$/, ''), fetcher});
    if (token) storage.setSecret(TRIAL_KEY, `JPF1.${install}.${token}`);
  } catch (error) { appLog('cloud', 'repo key not kept', {error: error.message, decidedBy: 'ensureRepoKey'}); }   // offline: the next sync tries again
}

// The key an Always-on repo on GitHub holds in place of the AI key (owner, 3 Nov 2026: "Free AI key, I think it's a security and cost risk to let it be copied and mass distribute outside the Jobadabra app").
// JPT1.<handle>.<mac> from the website: an opaque handle mapped to this install, good for the trial status and the notify e-mail and for nothing that spends AI. The website mints it only
// for a caller that shows the install's own AI key, so the proof is the key already on this Mac (a Free AI one, or the one ensureTrialKey keeps for an own-key install). Kept under this name.
export const REPO_KEY = 'JOBADABRA_REPO_TRIAL_KEY';
/** Gets this install's repo key from the website once and keeps it (storage secret REPO_KEY), for payload() in lib/github.js to send in place of the AI key.
 *  Takes the storage and a fetcher (tests); needs the install's own JPF1 key as proof (TRIAL_KEY or the Anthropic slot), else asks nothing. Returns nothing and never throws: a refusal or an
 *  answer that is not a JPT1 key keeps nothing; a failure (offline, or a store that refuses the secret) is written to the app log, never swallowed (3 Nov 2026: an unknown secret name hid here). */
export async function ensureRepoKey(storage, fetcher = globalThis.fetch) {
  if (/^JPT1\./.test(storage.secret(REPO_KEY) || '') || siteOffForUser()) return;
  const proof = [storage.secret(TRIAL_KEY), storage.secret('ANTHROPIC_API_KEY')].find(key => /^JPF1\./.test(key || '')) || '';
  const install = proof.split('.')[1];
  if (!install) return;
  try {
    const key = await installToken(storage, install, 'trial', {base: FREE_BASE.replace(/\/api\/ai$/, ''), fetcher, proof});   // the one way to ask the site for a token (install-token.js)
    if (/^JPT1\./.test(key)) storage.setSecret(REPO_KEY, key);
  } catch (error) { appLog('cloud', 'repo key not kept', {error: error.message, decidedBy: 'ensureRepoKey'}); }   // offline: the next sync tries again
}
