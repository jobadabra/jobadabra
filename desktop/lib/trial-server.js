// The free trial as the website counts it (GET /api/trial/status, site/src/trial.js): the app asks with its install key and keeps the answer in settings.trialServer,
// which lib/license.js reads with the local numbers (the highest count and earliest first run win), so the app and the Always on runs cannot disagree. Offline: the local numbers stand.
import {FREE_BASE, TRIAL_KEY, isFreeKey, isOn} from './ai-free.js';
import {siteOffForUser} from './recipes.js';

const BASE = FREE_BASE.replace(/\/api\/ai$/, '');
const EVERY = 6 * 60 * 60 * 1000;

// -> true when the answer was saved. Never throws.
export async function refresh(storage, license, {fetcher = globalThis.fetch, now = Date.now} = {}) {
  const key = storage.secret(TRIAL_KEY) || (/^JPF1\./.test(storage.secret('ANTHROPIC_API_KEY') || '') ? storage.secret('ANTHROPIC_API_KEY') : '');
  if (!key || !isFreeKey(key) || siteOffForUser()) return false;
  try {
    const settings = storage.settings(), mine = license.state();
    const query = new URLSearchParams({applied: String(mine.used), first: settings.firstRunAt || ''});
    // Why (10 Nov 2026, owner, asked via AskUserQuestion "App sends a flag"): a trial on the person's own AI has 30 free applications, not 20. The app says so once; the site grants it and keeps it. The flag is never the key itself.
    if (!isOn(settings)) query.set('own_ai', '1');
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
