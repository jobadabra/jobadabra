// Ready to send's "Watch the fill" popup (owner, 18 Oct 2026: "not inline, but rather in a popup"): the night's video of one form in the app's dialog parts
// (the board dialog's head, icon and close button), named for its form; closing it (the button or Escape) removes it and lets the video's memory go. Guard: test/unit/renderer/ready-card.test.js.
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
import {el} from '../components.js';
import {icon} from '../icons.js';

// bytes: the WebM the site kept; name: "Title · Company". One popup at a time: a second one replaces the first.
let closeShown = () => {};
export function showFillVideo(bytes, name) {
  closeShown();
  const dialog = el('dialog', 'save-dialog panel-dialog cv-dialog ready-video-dialog');
  dialog.id = 'ready-video-dialog';
  const head = el('div', 'dialog-head'), lead = el('div', 'cv-head'), tile = el('span', 'dialog-icon');
  tile.append(icon('eye'));
  lead.append(el('h2', '', t('pagesReadyReports.watch')), el('p', 'muted', name));
  const close = el('button', 'ghost icon-btn', '');
  close.id = 'ready-video-close'; close.type = 'button';
  close.setAttribute('aria-label', t('pagesCommon.close'));
  close.append(icon('close'));
  head.append(tile, lead, close);
  const video = document.createElement('video');
  video.controls = true; video.autoplay = true; video.muted = true;
  video.src = URL.createObjectURL(new Blob([bytes], {type: 'video/webm'}));
  const note = el('p', 'muted small field-hint', t('pagesReadyReports.videoHelp'));   // a line, not a foot: a foot without buttons is hidden (style.css)
  dialog.append(head, video, note);
  let gone = false;
  const done = () => { if (gone) return; gone = true; URL.revokeObjectURL(video.src); dialog.remove(); };
  closeShown = () => { if (dialog.open) dialog.close?.(); done(); };
  dialog.addEventListener('close', done);   // Escape closes a modal dialog by itself
  close.addEventListener('click', () => closeShown());
  document.body.append(dialog);
  if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
  return dialog;
}
