// Refresh derived notification delivery metadata on normal app lifecycle events, without sending messages or editing the display preference.
import {client, setVariables} from './github.js';
import {refreshLanguage, SLOW_MS} from './notify-channel.js';
import {notificationLanguage} from './notification-language.js';
import {log} from './log.js';
const scheduledLanguages = new WeakMap(), pending = new WeakMap();

/** Update only the known user repo's language variable; no workflow/secret changes, and acknowledgement is private and rebuildable. */
export async function refreshScheduledLanguage(storage, fetcher = globalThis.fetch) {
  const repo = storage.settings().cloud?.repo;
  if (!repo) return {ok: false, skipped: true};
  const token = storage.secret('GITHUB_TOKEN');
  if (!token) return {ok: false, skipped: true};
  const language = notificationLanguage(storage);
  if (scheduledLanguages.get(storage) === language) return {ok: true, language};
  const signal = AbortSignal.timeout(SLOW_MS);
  await setVariables(client(token, (url, init) => fetcher(url, {...init, signal})), repo, {JOBADABRA_NOTIFICATION_LANGUAGE: language});
  scheduledLanguages.set(storage, language);
  return {ok: true, language};
}

/** Serialize startup/change refreshes per profile; report failures without blocking local appearance or discarding the next normal retry. */
export function refreshDeliveryLanguage(storage, {demo = false, fetcher, service = refreshLanguage, scheduled = refreshScheduledLanguage} = {}) {
  if (demo) return Promise.resolve({ok: true, skipped: true});
  const next = (pending.get(storage) || Promise.resolve()).then(async () => {
    const answers = await Promise.allSettled([service(storage, fetcher), scheduled(storage, fetcher)]);
    const ok = answers.every(answer => answer.status === 'fulfilled' && (answer.value.ok || answer.value.skipped));
    if (!ok) log('notify', 'delivery language refresh not acknowledged');
    return {ok};
  }).catch(() => ({ok: false}));
  pending.set(storage, next);
  return next;
}
