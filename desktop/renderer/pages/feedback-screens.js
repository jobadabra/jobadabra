// Which screens "Send feedback → Include this screen's data" knows (renderer/feedback-data.js is the registry): one line per page, each reading the state that page already keeps.
// A screen not listed here sends its visible text. Add a page by adding its line; the dialog never changes.
import {registerScreenData, readScreenData, jobsData, focusData} from '../feedback-data.js';
import {isInbound} from '../origin.js';
import {jobsState} from './jobs-state.js';
import {shared} from './shared.js';
import {searchingNow} from './jobs-find.js';
import {strategyState} from './strategy-state.js';
import {focusItems} from './focus.js';
import {screenData as answersScreen} from './application-answers.js';

registerScreenData('jobs', () => jobsData({rows: jobsState.visible || [], total: (shared.allJobs || []).length, filters: jobsState.filters, statFilter: jobsState.statFilter,
  text: document.getElementById('filter-text')?.value || '', sort: document.getElementById('sort-by')?.value || '', mode: jobsState.mode, origin: job => (isInbound(job) ? 'inbound' : 'outbound'),
  searching: searchingNow(), lastSearchAt: shared.state?.settings?.lastSearchAt || ''}));
registerScreenData('profile:answers', answersScreen);
registerScreenData('strategy', () => (strategyState.lastStrategy ? {strategy: strategyState.lastStrategy} : null));
registerScreenData('focus', () => focusData(focusItems()));

// Why (3 Nov 2026, desktop AI MCP spec): the main process asks the window for a screen's data through this one function (lib/desktop-ai-handlers.js windowScreen), the same registry the
// feedback dialog reads: no second exporter. A key of '' means the screen open now.
window.jobadabraScreenData = key => readScreenData(key || undefined);
