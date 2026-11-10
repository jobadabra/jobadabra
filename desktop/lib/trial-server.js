// The free trial as the website counts it (GET /api/trial/status, site/src/trial.js): the app asks with its install key and keeps the answer in settings.trialServer,
// which lib/license.js reads with the local numbers (the highest count and earliest first run win), so the app and the Always on runs cannot disagree. Offline: the local numbers stand.
import {FREE_BASE, TRIAL_KEY, isFreeKey, isOn} from './ai-free.js';
import {siteOffForUser} from './recipes.js';

const BASE = FREE_BASE.replace(/\/api\/ai$/, '');
const EVERY = 6 * 60 * 60 * 1000;

/**
 * True when the person's own AI is the engine in charge: not Free AI (a later pick of another engine wins over a stale Free flag, as the renderer's usingFree), and a key of their own (an Anthropic or
 * OpenAI key that is not our JPF1 token) or their own CLI engine. Leaving Free AI alone, or the install's trial token, is not an own AI.
 */
export function ownAiInCharge(settings, secret) {
  if (isOn(settings) && (!settings.aiEngine || settings.aiEngine === 'api')) return false;
  const ownKey = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'].some(name => { const key = secret(name) || ''; return !!key && !isFreeKey(key); });
  return ownKey || ['cli', 'codex'].includes(settings.aiEngine);
}

// -> true when the answer was saved. Never throws.
export async function refresh(storage, license, {fetcher = globalThis.fetch, now = Date.now} = {}) {
  const key = storage.secret(TRIAL_KEY) || (/^JPF1\./.test(storage.secret('ANTHROPIC_API_KEY') || '') ? storage.secret('ANTHROPIC_API_KEY') : '');
  if (!key || !isFreeKey(key) || siteOffForUser()) return false;
  try {
    const settings = storage.settings(), mine = license.state();
    const query = new URLSearchParams({applied: String(mine.used), first: settings.firstRunAt || ''});
    // Why (10 Nov 2026, owner, asked via AskUserQuestion "App sends a flag"): a trial on the person's own AI has 30 free applications, not 20. The flag goes out with every ask while an own AI is in charge; the site keeps the first one
    // ("Keep 30") and ignores the rest. Never the key itself (Gitar on #3655: "Free off" is not proof of an own AI).
    if (ownAiInCharge(settings, name => storage.secret(name))) query.set('own_ai', '1');
    const headers = {'x-api-key': key};
    if (license.key()) headers['x-jp-license'] = license.key();
    const response = await fetcher(`${BASE}/api/trial/status?${query}`, {headers});
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.ok) return false;
    storage.saveSettings({trialServer: {applied: body.used, first: body.first, pro: !!body.pro, bonus: body.bonus, at: new Date(now()).toISOString()}});
    return true;
  } catch { return false; }
}

// At start and every few hours.
export function keepFresh(storage, license, options) {
  refresh(storage, license, options);
  setInterval(() => refresh(storage, license, options), EVERY).unref();
}
