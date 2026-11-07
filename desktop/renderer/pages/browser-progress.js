// Jobadabra's browser for Background automation (spec 2026-10-27-background-apply-execution, step B): offered on every spot marked
// data-browser-progress="offer" (the Applying page while the saved mode needs it, the Apply dialog after "Download Jobadabra's browser first"),
// downloaded only on the person's press, its progress with Cancel. Drawn with the LibreOffice download's block (office-progress.js drawProgress);
// fed by main's 'backgroundBrowserProgress' event (lib/background-browser-download.js). Guard: test/unit/renderer/browser-progress.test.js.
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
import {number} from '../../i18n/format.js';
import {Eta} from '../eta.js';
import {computerOf, drawProgress} from './office-progress.js';

const MB = bytes => Math.round(bytes / 1048576);
const etas = new Map();
const etaOf = started => { if (!etas.has(started)) etas.set(started, new Eta(0)); return etas.get(started); };
const AT = {checking: 0, download: 0, unpack: 2};
// Why (1 Nov 2026, #2485): Localized display keys preserve this rule: Background and Full automation both run in this browser, so the offer names neither mode and promises nothing about who presses Submit.
const OFFER = {title: t('pagesDownloads.browserOffer'), right: '', share: null, steps: [],
  fine: t('pagesDownloads.browserSize'), action: t('pagesDownloads.download')};

/** One event -> what a spot shows: {hidden} or {title, right, share, steps: [{text, kind: done|now|next}], fine, action}. offer: this spot may offer the download. */
export function browserView(event = {}, {offer = false, platform = 'darwin', now = Date.now()} = {}) {
  const {step = 'none', bytes = 0, total = 0, started = now, error = ''} = event;
  if (step === 'ready') return {hidden: true};
  if (step === 'none') return offer ? OFFER : {hidden: true};
  if (step === 'failed' || step === 'cancelled') {
    return {title: step === 'failed' ? t('pagesDownloads.browserFailed') : t('pagesDownloads.browserCancelled'), right: '', share: null, steps: [],
      fine: `${step === 'failed' ? `${error} ` : ''}${t('pagesDownloads.standardWorks')}`, action: t('pagesCommon.tryAgainShort')};
  }
  const at = AT[step] ?? 0, seconds = (now - started) / 1000, speed = seconds > 2 ? bytes / seconds : 0;
  const leftText = step === 'download' && total && speed ? etaOf(started).text(seconds, bytes, total).replace(/^ · /, ', ') : '';
  const sizes = total ? t('pagesDownloads.sizes', {done: number(MB(bytes)), total: number(MB(total))}) : t('pagesDownloads.size', {done: number(MB(bytes))});
  const share = step === 'download' ? (total ? bytes / total : null) : step === 'unpack' ? 1 : null;
  const texts = [step === 'checking' ? t('pagesDownloads.rightVersion') : t('pagesDownloads.downloading', {sizes, left: leftText}),
    t('pagesDownloads.genuine'), t('pagesDownloads.unpacking', {computer: computerOf(platform)})];
  return {title: t('pagesDownloads.browserGetting'), right: step === 'download' ? `${share === null ? '' : `${Math.floor(share * 100)}% · `}${sizes}` : '', share,
    steps: texts.map((text, i) => ({text, kind: i < at ? 'done' : i === at ? 'now' : 'next'})), fine: t('pagesDownloads.browserOnce'), action: t('pagesCommon.cancel')};
}

let last = {step: 'none'};
/** Draw the latest event on every marked spot; a spot offers the download only when it says data-browser-progress="offer". */
export function showBrowserProgress(event = last) {
  last = event;
  for (const box of document.querySelectorAll('[data-browser-progress]')) {
    box.classList.add('progress', 'office-progress'); box.setAttribute('role', 'status');
    drawProgress(box, browserView(event, {offer: box.dataset.browserProgress === 'offer', platform: window.pilot.platform}),
      {start: () => window.pilot.backgroundBrowserStart().then(showBrowserProgress), cancel: () => window.pilot.backgroundBrowserCancel()});
  }
}
/** Offer (or stop offering) the download on one spot, then draw it. */
export function offerBrowser(box, offer) {
  if (!box) return;
  box.dataset.browserProgress = offer ? 'offer' : 'quiet';
  showBrowserProgress();
}
/** Listen for main's download events and draw the current state once at start-up; a failed state read leaves the spots quiet (the caller catches). */
export async function startBrowserProgress() {
  window.pilot.onBackgroundBrowserProgress(showBrowserProgress);
  showBrowserProgress(await window.pilot.backgroundBrowserState());
}
