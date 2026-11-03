// Context fetcher: one Sentry issue (counts, release, the latest event's exception and in-app frames) by two GET calls; ref = the numeric issue id.
import {LIMITS, finish, guarded, json, token, unavailable} from '../lib.mjs';

export const name = 'sentry';
const TAGS = new Set(['release', 'environment', 'os', 'level', 'handled']); // a whitelist: user, device and url tags never reach the pack; "app@0.9.2" is shown as "app 0.9.2" so the e-mail scrub keeps the release

/** Why (3 Nov 2026, harness map spec): GET only; the token is a Sentry read token (project:read, event:read, org:read) from env SENTRY_READ_TOKEN; the "user" part of an event is never read. */
export async function fetch(ref, {limits = LIMITS, env = {}, fetchImpl = globalThis.fetch} = {}) {
  return guarded(async () => {
    const id = String(ref || '').trim();
    if (!/^\d{1,20}$/.test(id)) return unavailable('a Sentry ref is the numeric issue id');
    const base = String(env.SENTRY_URL || 'https://sentry.io').replace(/\/$/, '');
    if (!/^https:\/\/([a-z0-9-]+\.)*sentry\.io$/.test(base)) return unavailable('SENTRY_URL must be an https sentry.io host');
    const init = {method: 'GET', headers: {authorization: `Bearer ${token(env, 'SENTRY_READ_TOKEN')}`}};
    // Why (3 Nov 2026, try 1 live): the un-scoped /api/0/issues/<id>/ answers 404 for a personal token; the organisation path works. The slug is not kept in this public repo: SENTRY_ORG, else the first organisation the token can see.
    const org = env.SENTRY_ORG || (await json(fetchImpl, `${base}/api/0/organizations/`, init, limits.timeoutMs))[0]?.slug;
    if (!org || !/^[\w-]+$/.test(org)) return unavailable('no Sentry organisation visible to the token');
    const issue = await json(fetchImpl, `${base}/api/0/organizations/${org}/issues/${id}/`, init, limits.timeoutMs);
    const event = await json(fetchImpl, `${base}/api/0/organizations/${org}/issues/${id}/events/latest/`, init, limits.timeoutMs).catch(() => null);
    const tags = (event?.tags || []).filter(t => TAGS.has(t.key)).map(t => `${t.key}=${String(t.value).replace('@', ' ')}`).join(' · ');
    const values = (event?.entries || []).filter(e => e.type === 'exception').flatMap(e => e.data?.values || []);
    const frames = values.flatMap(v => (v.stacktrace?.frames || []).filter(f => f.inApp).slice(-(limits.maxItems ?? LIMITS.maxItems)).map(f => `  ${f.filename}:${f.lineNo} in ${f.function}`));
    return finish(`# Sentry ${id}: ${issue.title}`, [
      `Culprit: ${issue.culprit ?? '?'} · Level: ${issue.level ?? '?'} · Status: ${issue.status ?? '?'} · Events: ${issue.count ?? '?'} · First: ${String(issue.firstSeen).slice(0, 10)} · Last: ${String(issue.lastSeen).slice(0, 10)}`,
      tags && `Tags: ${tags}`,
      ...values.map(v => `Exception: ${v.type}: ${v.value}`),
      frames.length ? `In-app frames (oldest first):\n${frames.join('\n')}` : '',
    ].filter(Boolean).join('\n'), limits);
  });
}
