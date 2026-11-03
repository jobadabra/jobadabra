// Context fetcher: a Worker's request, error and CPU numbers per day from Cloudflare's analytics GraphQL (one constant query); ref "analytics worker=<script name> days=<1-30>".
import {LIMITS, finish, guarded, json, token, unavailable} from '../lib.mjs';

export const name = 'cloudflare';
const QUERY = `query Worker($account: String!, $script: String!, $since: Time!, $until: Time!) { viewer { accounts(filter: {accountTag: $account}) { workersInvocationsAdaptive(limit: 5000, filter: {scriptName: $script, datetime_geq: $since, datetime_leq: $until}, orderBy: [datetimeHour_DESC]) { dimensions { status datetimeHour } sum { requests errors } quantiles { cpuTimeP99 } } } } }`;
const API = 'https://api.cloudflare.com/client/v4';

/** Why (3 Nov 2026, harness map spec): a query only, never a mutation; the token is a Cloudflare API token with the single permission "Account Analytics Read" (env CLOUDFLARE_READ_TOKEN). Only counts and CPU times leave Cloudflare: no URL, IP or header is ever selected. */
export async function fetch(ref, {limits = LIMITS, env = {}, fetchImpl = globalThis.fetch} = {}) {
  return guarded(async () => {
    const m = /^analytics\s+worker=([\w-]{1,63})\s+days=(\d{1,2})$/.exec(String(ref || '').trim());
    const days = Number(m?.[2]);
    if (!m || days < 1 || days > (limits.windowDays ?? LIMITS.windowDays)) return unavailable(`a Cloudflare ref is "analytics worker=<name> days=<1-${limits.windowDays ?? LIMITS.windowDays}>"`);
    const headers = {authorization: `Bearer ${token(env, 'CLOUDFLARE_READ_TOKEN')}`};
    // Why (3 Nov 2026): the account id is not kept in this public repo: CLOUDFLARE_ACCOUNT_ID, else the one account the token can see; with several, guessing the first could show another account's numbers.
    let account = env.CLOUDFLARE_ACCOUNT_ID;
    if (!account) {
      const list = (await json(fetchImpl, `${API}/accounts`, {method: 'GET', headers}, limits.timeoutMs))?.result;
      if (!Array.isArray(list) || list.length !== 1) return unavailable('the token sees none or several Cloudflare accounts: set CLOUDFLARE_ACCOUNT_ID');
      account = list[0]?.id;
    }
    if (!/^[0-9a-f]{32}$/.test(String(account))) return unavailable('no Cloudflare account visible to the token');
    // Why (3 Nov 2026, review of 6/8): whole UTC days (the oldest day is not a partial one that looks like a drop), newest rows first so the 5000-row limit can only cut the oldest hours.
    const until = new Date(), since = new Date(Date.UTC(until.getUTCFullYear(), until.getUTCMonth(), until.getUTCDate() - (days - 1)));
    const data = await json(fetchImpl, `${API}/graphql`, {
      method: 'POST', headers: {...headers, 'content-type': 'application/json'},
      body: JSON.stringify({query: QUERY, variables: {account, script: m[1], since: since.toISOString(), until: until.toISOString()}}),
    }, limits.timeoutMs);
    if (data?.errors?.length) return unavailable('Cloudflare refused the analytics query');
    const rows = data?.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive;
    if (!Array.isArray(rows)) return unavailable('Cloudflare answered in an unexpected shape');
    if (!rows.length) return unavailable(`no invocations of "${m[1]}" in ${days} days (wrong script name?)`);
    const perDay = new Map(), perStatus = new Map(), count = v => (Number.isFinite(v) && v >= 0 ? v : NaN);
    for (const r of rows) {
      const day = /^\d{4}-\d\d-\d\d(?=T)/.exec(String(r?.dimensions?.datetimeHour))?.[0], status = String(r?.dimensions?.status);
      const requests = count(r?.sum?.requests), errors = count(r?.sum?.errors), cpu = count(r?.quantiles?.cpuTimeP99 ?? 0);
      if (!day || !/^\w{1,40}$/.test(status) || [requests, errors, cpu].some(Number.isNaN)) return unavailable('Cloudflare answered in an unexpected shape');
      const d = perDay.get(day) || {requests: 0, errors: 0, cpu: 0};
      perDay.set(day, {requests: d.requests + requests, errors: d.errors + errors, cpu: Math.max(d.cpu, cpu)});
      perStatus.set(status, (perStatus.get(status) || 0) + requests);
    }
    return finish(`# Cloudflare Worker ${m[1]}, last ${days} days (UTC days, today is partial)`, [
      'Day | requests | errors | worst hourly CPU p99 (µs)', '--- | --- | --- | ---',
      ...[...perDay].sort(([a], [b]) => a.localeCompare(b)).map(([day, d]) => `${day} | ${d.requests} | ${d.errors} | ${d.cpu}`),
      '', `Requests by status: ${[...perStatus].map(([st, n]) => `${st} ${n}`).join(' · ')}`,
      rows.length >= 5000 ? '\nCut: Cloudflare returned its 5000-row limit, so the oldest hours are missing.' : '',
    ].join('\n'), limits, true);
  });
}
