// The LibreOffice download, shown while it runs (owner, 24 Oct 2026: "show a progress bar to the user, let him understand what happens under
// the hood"): a head with the share and MB, the bar, then each step ticking off, on every spot marked data-office-progress (Profile → CV).
// Reuses the onboarding "Reading your CV" block (.progress, .progress-head, .bar, .draft-feed). Fed by main's 'officeProgress' event
// (lib/office-addon.js). Guard: desktop/test/unit/renderer/office-progress.test.js.
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
import {number} from '../../i18n/format.js';
import {Eta} from '../eta.js';
const MB = bytes => Math.round(bytes / 1048576);
// One estimate per download (its start time), so the time left only ever goes down (eta.js).
const etas = new Map();
const etaOf = started => { if (!etas.has(started)) etas.set(started, new Eta(0)); return etas.get(started); };
const ORDER = ['download', 'check', 'unpack', 'ready'];
/** The person's computer in words ("your PC" on Windows, else "your Mac"); shared with browser-progress.js so one file holds the platform branch. */
export const computerOf = platform => (platform === 'win32' ? t('pagesDownloads.yourPc') : t('pagesDownloads.yourMac'));

// One event -> what the block shows: {hidden} or {title, right, share, steps: [{text, kind: done|now|next}], fine, action}
export function officeView(event = {}, {platform = 'darwin', now = Date.now()} = {}) {
  const {step = 'none', bytes = 0, total = 0, started = now, error = ''} = event;
  if (step === 'none' || step === 'ready') return {hidden: true};
  const computer = computerOf(platform);
  if (step === 'failed' || step === 'cancelled') {
    return {title: step === 'failed' ? t('pagesDownloads.officeFailed') : t('pagesDownloads.officeCancelled'), right: '', share: null, steps: [],
      fine: `${step === 'failed' ? `${error} ` : ''}${t('pagesDownloads.wordStillWorks')}`, action: t('pagesCommon.tryAgainShort')};
  }
  const at = ORDER.indexOf(step), seconds = (now - started) / 1000, speed = seconds > 2 ? bytes / seconds : 0;
  const leftText = step === 'download' && total && speed ? etaOf(started).text(seconds, bytes, total).replace(/^ · /, ', ') : '';
  const sizes = total ? t('pagesDownloads.sizes', {done: number(MB(bytes)), total: number(MB(total))}) : t('pagesDownloads.size', {done: number(MB(bytes))});
  const texts = [
    t('pagesDownloads.officeDownloading', {sizes, left: leftText}),
    t('pagesDownloads.genuine'),
    t('pagesDownloads.unpacking', {computer}),
    t('pagesDownloads.redrawing'),
  ];
  const share = step === 'download' ? (total ? bytes / total : null) : 1;
  return {
    title: t('pagesDownloads.officeGetting'),
    right: step === 'download' ? `${share === null ? '' : `${Math.floor(share * 100)}% · `}${sizes}` : '',
    share,
    steps: [{text: t('pagesDownloads.wordReady'), kind: 'done'},
      ...texts.map((text, i) => ({text, kind: i < at ? 'done' : i === at ? 'now' : 'next'}))],
    fine: t('pagesDownloads.officeOnce'),
    action: t('pagesCommon.cancel'),
  };
}

/** Draw a download's view (see officeView) into one box: head, bar, steps, the fine line with its one action. Shared with browser-progress.js. */
export function drawProgress(box, view, {start, cancel}) {
  box.hidden = !!view.hidden;
  if (view.hidden) return;
  const make = (tag, cls, text) => Object.assign(document.createElement(tag), cls ? {className: cls} : {}, text === undefined ? {} : {textContent: text});
  const head = make('div', 'progress-head'), bar = make('div', 'bar'), fill = make('span'), feed = make('ul', 'draft-feed'), fine = make('p', 'fine', `${view.fine} `);
  head.append(...(view.action === t('pagesCommon.cancel') ? [make('span', 'spinner')] : []), make('b', '', view.title), make('span', 'muted', view.right));
  fill.style.width = view.share === null ? '0' : `${Math.min(100, view.share * 100)}%`;
  bar.append(fill);
  bar.hidden = !view.steps.length;
  feed.append(...view.steps.map(s => make('li', s.kind, s.text)));
  feed.hidden = !view.steps.length;
  // Why (28 Oct 2026, owner 27 Oct "buttons are solid"): the line's one action (Download, Cancel, Try again) is a solid button, never a text link.
  const link = make('button', 'secondary', view.action);
  link.addEventListener('click', event => { event.preventDefault(); if (view.action === t('pagesCommon.cancel')) cancel(); else start(); });
  fine.append(link);
  box.replaceChildren(head, bar, feed, fine);
}

// One event drawn on every spot (also what a screenshot feeds it: npm run shot -- profile --js "...showOffice({...})").
export function showOffice(event) {
  const view = officeView(event, {platform: window.pilot.platform});
  for (const box of document.querySelectorAll('[data-office-progress]')) {
    box.classList.add('progress', 'office-progress'); box.setAttribute('role', 'status');
    drawProgress(box, view, {start: () => window.pilot.officeStart(), cancel: () => window.pilot.officeCancel()});
  }
}

export async function startOfficeProgress() {
  window.pilot.onOfficeProgress(showOffice);
  showOffice(await window.pilot.officeState());
}
