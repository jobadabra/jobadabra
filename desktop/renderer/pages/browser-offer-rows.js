// What the "Find jobs using your browser" offer on a finished Find jobs run's card says, and when (pure, no page: its test runs without a DOM).
// Used by pages/browser-offer.js (the card) and nav.js (⌘K); the count is settings.refusedOffer (lib/refused-offer.js). Guard: test/guards/safety/refused-reads-button.test.js.
import {counted as countedLabel} from './page-counts.js';
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';

export const LABEL = t('pagesActivity.browserFind');
export const ALLOW = t('pagesAuditFirst.a35');
const plural = (n, word) => countedLabel(word, n);
const isSearch = run => run?.kind === 'search';
/** The newest finished search run of `runs` (by id), or null; a live run is not finished. */
export const newestSearch = (runs = []) => runs.filter(run => isSearch(run) && !run.live).sort((a, b) => Number(b.id) - Number(a.id))[0] || null;

// The offer on this run's card, or null: only the newest finished Find jobs run, and only while refused sites are due.
export function browserOffer(run, {runs = [], settings = {}} = {}) {
  const offer = settings?.refusedOffer, count = Number(offer?.count) || 0;
  if (!isSearch(run) || run.live || !count) return null;
  const newest = newestSearch(runs);
  if (newest && String(newest.id) !== String(run.id)) return null;
  const names = (offer.names || []).slice(0, 3), more = count - names.length;
  const which = names.length ? ` (${names.join(', ')}${more > 0 ? t('pagesDynamicSetup.andMore', {count: more}) : ''})` : '';
  return {count, at: offer.at, allow: settings.refusedNeedsAllow === true,
    text: t('pagesDynamicSetup.m68', {"plural": plural(count, 'site'), "which": which, count: count})};
}

// ⌘K: brings you to the button on that run's card (it does not press it), or null when nothing is offered. Named apart from the Actions card
// "Find jobs using your browser" (which picks any sites to read): two rows with one label in Actions read as a duplicate (owner, 27 Oct 2026).
export function paletteEntry({runs = [], settings = {}} = {}) {
  const run = newestSearch(runs), offer = browserOffer(run, {runs, settings});
  return offer ? {label: t('pagesDynamicSetup.m69', {"plural": plural(offer.count, 'site')}), hint: t('pagesDynamicSetup.m70', {"LABEL": LABEL}), runId: run.id} : null;
}
