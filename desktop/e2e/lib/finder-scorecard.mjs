// The Finder's scorecard for the triage-github-open-issues skill (.claude/skills/triage-github-open-issues): per detector, how many findings were real, false (and why), and how often the filed severity
// was wrong; published in each selfheal snapshot (selfheal-stats.mjs) for the Finder scorecard card of /admin/testing/self-healing, which shows the change since the previous snapshot. Builds on lib/selfheal-stats.mjs (the same classify(), so /admin/operations/self-healing and this agree). Pure.
// Why (5 Nov 2026, owner: "turn this pinned issues into dashboards/tabs/pages in Admin"): the scorecard was a comment per triage on the pinned issue #341; the page is its home now.
import {detectorOf, summarize} from './selfheal-stats.mjs';
import {resolutionOf} from './resolution.mjs';

// severity.mjs leaves this in the body when a judge changes the filed level, so the filed level is not lost.
export const FILED = /<!-- severity-filed:(high|medium|low) -->/;
const LEVEL = {low: 1, medium: 2, high: 3};
const levelOf = issue => ((issue.labels || []).map(label => label.name || label).find(name => name.startsWith('severity:')) || '').slice(9);

export function scorecard(issues, {now = new Date()} = {}) {
  const {totals} = summarize(issues), groups = {};
  for (const issue of issues) (groups[detectorOf(issue)] ??= []).push(issue);
  const detectors = Object.entries(groups).map(([source, list]) => {
    const row = summarize(list).byDetector[0], causes = {}, severityChanged = {judged: 0, raised: 0, lowered: 0};
    for (const issue of list) {
      const why = resolutionOf(issue);
      if (why.startsWith('fp:') || why === 'by-design') causes[why] = (causes[why] || 0) + 1;
      const filed = FILED.exec(String(issue.body || ''))?.[1], level = levelOf(issue);
      if (filed && level && filed !== level) { severityChanged.judged++; severityChanged[LEVEL[level] > LEVEL[filed] ? 'raised' : 'lowered']++; }
    }
    const real = row.fixed + row.queued, judged = real + row.falsePositive + row.harness;
    return {source, detector: row.detector, filed: row.filed, real, falsePositive: row.falsePositive + row.harness, open: row.open + row.unclear,
      precision: judged ? Math.round(100 * real / judged) : null, causes, severityChanged};
  }).sort((a, b) => b.filed - a.filed);
  // The yield (owner, 9 Oct 2026: "more and more real issues, fewer and fewer false"): real and false findings by the week they were found, this week vs the one before.
  const week = (from, to) => { const list = issues.filter(issue => { const at = Date.parse(issue.createdAt || 0); return at >= now - from * 86400000 && at < now - to * 86400000; });
    const {totals: t} = summarize(list); return {real: t.real, falsePositive: t.falsePositive + t.harness}; };
  const yieldOf = {thisWeek: week(7, 0), lastWeek: week(14, 7)};
  return {at: now.toISOString().slice(0, 10), yield: yieldOf, totals: {filed: totals.filed, real: totals.real, falsePositive: totals.falsePositive + totals.harness, open: totals.unjudged, precision: totals.precision}, detectors};
}
