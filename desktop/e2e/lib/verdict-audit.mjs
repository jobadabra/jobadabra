// The verdict pass's measured accuracy (5 Oct 2026): "every verdict I checked was right" is not a number. Each week, five random verdicts of the last 7 days (on issues,
// Job: report health
// and the ones that kept a finding from being filed) go into the Verdict audit card of /admin/testing/bug-loop (D1 ci_state `verdict-audit`) with a 👍 / 👎 each; the owner ticks them, and the next audit
// reports the score. Pure. Why (5 Nov 2026, owner: "turn this pinned issues into dashboards/tabs/pages in Admin"): the audit was a GitHub issue with checkboxes (#2736).
import {MARK, whyOf} from './verdict-comment.mjs';

export const AUDIT_SIZE = 5;

// -> [{key, word, what, why, where}] judged in the window; `pick` is the random source (tests pass a fixed one).
export function sampleVerdicts({issues = [], register = [], now = Date.now(), days = 7, n = AUDIT_SIZE, pick = Math.random}) {
  const since = now - days * 86400000, pool = [];
  for (const issue of issues) for (const comment of issue.comments || []) {
    const word = MARK.exec(String(comment.body || ''))?.[1];
    if (word && Date.parse(comment.createdAt || 0) >= since) pool.push({key: `i${issue.number}`, word, what: String(issue.title || '').replace(/^\[auto-ui\] /, ''), why: whyOf(comment.body).slice(0, 300), where: `#${issue.number}`});
  }
  for (const item of register) if (Date.parse(item.date || 0) >= since - 86400000) pool.push({key: `r${item.id}`, word: item.word, what: `${item.view}: ${item.title}`, why: String(item.why || '').slice(0, 300), where: 'not filed (noise register)'});
  const out = [];
  while (pool.length && out.length < n) out.push(pool.splice(Math.floor(pick() * pool.length), 1)[0]);
  return out;
}

/** The owner's ticks on one stored audit -> {right, wrong, size}. */
export function auditScore(audit) {
  const items = Array.isArray(audit?.items) ? audit.items : [];
  return {right: items.filter(item => item?.tick === 'right').length, wrong: items.filter(item => item?.tick === 'wrong').length, size: items.length};
}
