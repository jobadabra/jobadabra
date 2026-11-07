// Refresh derived notification delivery metadata on normal app lifecycle events, without sending messages or editing the display preference.
import {client, setVariables} from './github.js';
import {serializeRepoUpdate} from './github-update-queue.js';
import {refreshLanguage, SLOW_MS} from './notify-channel.js';
import {notificationLanguage} from './notification-language.js';
import {log} from './log.js';
import {refresh as refreshBot} from './telegram-cloud.js';
import {api as telegramApi} from './telegram.js';
const pending = new WeakMap();

async function refreshBotLanguage(storage, fetcher = globalThis.fetch) {
  const bounded = (url, init) => fetcher(url, {...init, signal: AbortSignal.timeout(SLOW_MS)});
  return await refreshBot(storage, {fetcher: bounded, telegram: (token, method, data) => telegramApi(token, method, data, bounded)}) || {ok: false, skipped: true};
}

/** Queue a language-only write with full repository updates; resolve the current target when its turn begins. */
export function refreshScheduledLanguage(storage, fetcher = globalThis.fetch) {
  return serializeRepoUpdate(storage, () => refreshScheduledCurrent(storage, fetcher));
}

async function refreshScheduledCurrent(storage, fetcher) {
  const repo = storage.settings().cloud?.repo;
  if (!repo) return {ok: false, skipped: true};
  const token = storage.secret('GITHUB_TOKEN');
  if (!token) return {ok: false, skipped: true};
  const language = notificationLanguage(storage);
  const signal = AbortSignal.timeout(SLOW_MS);
  await setVariables(client(token, (url, init) => fetcher(url, {...init, signal})), repo, {JOBADABRA_NOTIFICATION_LANGUAGE: language});
  return {ok: true, language};
}

/** Serialize startup/change refreshes per profile; report failures without blocking local appearance or discarding the next normal retry. */
export function refreshDeliveryLanguage(storage, {demo = false, cloud = false, fetcher, service = refreshLanguage, scheduled = refreshScheduledLanguage, bot = refreshBotLanguage} = {}) {
  if (demo) return Promise.resolve({ok: true, skipped: true});
  const next = (pending.get(storage) || Promise.resolve()).then(async () => {
    const tasks = cloud ? [service, scheduled, bot] : [service, scheduled];
    const answers = await Promise.allSettled(tasks.map(refresh => Promise.resolve().then(() => refresh(storage, fetcher))));
    const ok = answers.every(answer => answer.status === 'fulfilled' && (answer.value.ok || answer.value.skipped));
    if (!ok) log('notify', 'delivery language refresh not acknowledged');
    return {ok};
  }).catch(() => ({ok: false}));
  pending.set(storage, next);
  return next;
}
