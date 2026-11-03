// Context fetcher: one Linear issue (title, state, labels, description, last comments) through a READ-only GraphQL query; ref "JOB-123".
import {LIMITS, finish, guarded, json, token, unavailable} from '../lib.mjs';

export const name = 'linear';
const QUERY = `query Issue($id: String!, $comments: Int!) { issue(id: $id) { identifier title description priority state { name } labels { nodes { name } } comments(last: $comments) { nodes { body createdAt } } } }`;

/** Why (3 Nov 2026, harness map spec): a query only, never a mutation; the key is a Linear read-only personal key from env LINEAR_READ_KEY (Authorization carries the key itself, no "Bearer"). */
export async function fetch(ref, {limits = LIMITS, env = {}, fetchImpl = globalThis.fetch} = {}) {
  return guarded(async () => {
    const id = String(ref || '').trim();
    if (!/^[A-Z]{2,6}-\d{1,6}$/.test(id)) return unavailable('a Linear ref looks like JOB-123');
    const data = await json(fetchImpl, 'https://api.linear.app/graphql', {
      method: 'POST',
      headers: {'content-type': 'application/json', authorization: token(env, 'LINEAR_READ_KEY')},
      body: JSON.stringify({query: QUERY, variables: {id, comments: limits.maxItems ?? LIMITS.maxItems}}),
    }, limits.timeoutMs);
    const issue = data?.data?.issue;
    if (!issue) return unavailable('no such issue');
    const comments = (issue.comments?.nodes || []).map(c => `- ${String(c.createdAt).slice(0, 10)}: ${c.body}`).join('\n') || '(none)';
    return finish(`# Linear ${issue.identifier}: ${issue.title}`, [
      `State: ${issue.state?.name ?? '?'} · Priority: ${issue.priority ?? '?'} · Labels: ${(issue.labels?.nodes || []).map(l => l.name).join(', ') || '(none)'}`,
      '', '## Description', issue.description || '(empty)', '', '## Comments', comments,
    ].join('\n'), limits);
  });
}
