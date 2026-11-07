// Drawer → Match: the score with its parts, why it fits and what to check (the Jobs list's own analysis, pages/jobs-fit.js fitDetail),
// then the fit line the search saved. Not scored: a state card. A score read with an earlier Profile says so.
import '../../i18n/screens-helpers.js';
import {t} from '../../i18n/index.js';
import {matchGroups, matchView} from '../job-page-view.js';
import {lastActivity} from '../pages/activity-render.js';
import {fitDetail} from '../pages/jobs-fit.js';
import {button, group, skeleton, stateCard} from './parts.js';
import {plainError} from '../run-warnings.js';

export function matchTab({job, page}) {
  const match = matchView(job, page);
  if (!match) {
    // A check is running: this job is waiting its turn (the Recent activity bar knows). Else it waits for the next one; "Check now" starts it, as on the Jobs page.
    if (lastActivity?.running && (lastActivity.running.kind || 'search') === 'search') {
      return [stateCard({icon: 'info', title: t('helpers.scoring'), text: t('helpers.scoringWaiting')}), ...skeleton()];
    }
    return [stateCard({icon: 'target', title: t('helpers.notScored'), text: t('helpers.notScoredReason'),
      actions: [button(t('helpers.checkNow'), () => document.getElementById('refresh').click(), 'primary')]})];
  }
  const nodes = [];
  if (match.older_places) nodes.push(olderPlacesCard(job));
  if (match.scoring_method === 'Previous') {
    nodes.push(stateCard({title: t('helpers.oldProfile'), text: t('helpers.oldProfileText')}));
  }
  if (match.fit_detail) nodes.push(fitDetail(match));
  nodes.push(...matchGroups(match).filter(part => part.title === t('helpers.fit')).map(part => group(part.title, part.lines)));
  return nodes;
}

// Scored with other places than today's (owner, 17 Oct 2026): said on this job, with a Refresh for this one job. Nothing re-scores by itself.
function olderPlacesCard(job) {
  const refresh = button(t('helpers.refreshScore'), async event => {
    const control = event.currentTarget;
    control.disabled = true;
    const result = await window.pilot.refreshLocations(job.url).catch(error => ({ok: false, error: error.message}));
    control.textContent = plainError(result.ok ? (result.queued ? t('helpers.markedOld') : t('helpers.nothingRefresh')) : result.error || t('helpers.notQueued'));
  });
  return stateCard({title: t('helpers.oldPlaces'), text: t('helpers.oldPlacesText'), actions: [refresh]});
}
