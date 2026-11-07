// Drawer → Messages (owner's board 07): all linked communication about the job, newest email first, then what you logged. A filter with counts
// (All / Email / Notes) kept per job; each email a card that folds (from, what it said, "Open in Gmail"); Gmail not connected says so with
// the way to connect it (existing messages still show); "Add note" opens the Log box on this job. Screenshots of a logged message are listed
// below. Words and data: renderer/job-page-view.js messagesOf, gmailUrl.
import {t} from '../../i18n/index.js';
import {el} from '../components.js';
import {messagesOf, waitingEmails} from '../job-page-view.js';
import {gmailConnected} from '../pages/activity-basics.js';
import {focusItems} from '../pages/focus.js';
import {openLogFor} from '../pages/jobs-lead.js';
import {moveEmail, whichJob} from '../pages/reassign.js';
import {openSetting} from '../pages/settings.js';
import {button, choice, foldCard, group, lineView, stateCard} from './parts.js';

const chosen = new Map();   // job url → 'all' | 'email' | 'note'

// The job's screenshots (lib/store/files.js): View shows one at full width in the drawer.
function shotsView(shots) {
  if (!shots.length) return [];
  return [group(t('helpers.screenshots'), shots.map(shot => {
    const row = el('div', 'attachment');
    const view = Object.assign(el('button', 'soft-button', shot.url ? t('helpers.view') : t('helpers.largeShow')), {type: 'button', disabled: !shot.url});
    view.addEventListener('click', () => {
      const open = row.nextElementSibling?.classList.contains('job-panel-shot');
      if (open) { row.nextElementSibling.remove(); view.textContent = t('helpers.view'); return; }
      row.after(Object.assign(el('img', 'job-panel-shot'), {src: shot.url, alt: shot.name}));
      view.textContent = t('helpers.hide');
    });
    row.append(...(shot.url ? [Object.assign(el('img'), {src: shot.url, alt: ''})] : []), el('span', 'attachment-name', shot.name), view);
    return row;
  }))];
}

function emailCard(email, first) {
  const body = [];
  if (email.from) body.push(el('p', 'muted small', t('helpers.from', {name: email.from})));
  body.push(el('p', '', email.text || t('helpers.noSummary')));
  body.push(button(t('helpers.openGmail'), () => window.pilot.openExternal(email.url), 'soft-button'));
  return foldCard({title: email.title, tag: email.outcome, when: email.when, open: first}, ...body);
}

// An email the Gmail check could not place for certain, which it would put on this job: your answer places it (the Focus question, here).
function waitingCard(email, job, reload) {
  const link = button(t('helpers.linkJob'), async event => {
    event.currentTarget.disabled = true;
    if (await moveEmail(email.eventId, job.url, email.item)) reload();
    else event.currentTarget.disabled = false;
  }, 'primary');
  const other = button(t('helpers.chooseJob'), () => whichJob(email.item, () => reload()), 'soft-button');
  return stateCard({icon: 'alert', tone: 'warn', title: t('helpers.emailBelongs'), text: t('helpers.emailUnlinked', {subject: `“${email.subject}”${email.note ? `: ${email.note}` : ''}`}), actions: [link, other]});
}

const noteCard = (note, first) => foldCard({iconName: 'chat', title: note.title, open: first}, ...note.lines.map(lineView));

export function messagesTab({job, page, parts, close, reload}, redraw) {
  const {emails, notes, counts} = messagesOf(parts, page?.events);
  const add = button(t('helpers.addNote'), () => openLogFor(job.url, job.title), 'soft-button');
  const nodes = waitingEmails(focusItems(), job.url).map(email => waitingCard(email, job, reload));   // first: it needs an answer
  if (gmailConnected() === false) {   // known not connected (null = not known yet: say nothing)
    nodes.push(stateCard({icon: 'alert', tone: 'warn', title: t('helpers.connectMessages'), text: t('helpers.linkedStill'),
      actions: [button(t('helpers.connectGmail'), () => { close(); openSetting('google'); }, 'primary')]}));
  }
  if (!counts.all && !parts.shots.length) {
    nodes.push(stateCard({icon: 'mail', title: t('helpers.noMessages'), text: t('helpers.messagesEmpty'), actions: [add]}));
    return nodes;
  }
  const active = chosen.get(job.url) || 'all';
  const row = el('div', 'jd-filter');
  row.append(choice([['all', t('helpers.allCount', {count: counts.all})], ['email', t('helpers.emailCount', {count: counts.email})], ['note', t('helpers.notesCount', {count: counts.note})]], active, key => { chosen.set(job.url, key); redraw(); }, t('helpers.messages')), add);
  nodes.push(row);
  const shown = [...(active === 'note' ? [] : emails.map((email, n) => emailCard(email, n === 0 && active !== 'note'))),
    ...(active === 'email' ? [] : notes.map((note, n) => noteCard(note, !emails.length && active !== 'email' && n === 0)))];
  if (shown.length) nodes.push(...shown);
  else nodes.push(stateCard({icon: 'search', title: active === 'email' ? t('helpers.noEmails') : t('helpers.noNotes'), text: t('helpers.chooseAll')}));
  if (active !== 'email') nodes.push(...shotsView(parts.shots));
  return nodes;
}
