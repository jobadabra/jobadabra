// Settings → Notifications over IPC: read and save "Tell me by" and the e-mail address (lib/notify-channel.js). Demo mode never reaches our site.
// Guarded by test/unit/main/notify-channel.test.js and test/guards/rules/ipc.test.js.
import * as channel from './notify-channel.js';
import {followNotify} from './hosted-email.js';
import {createNotifyMoments} from './notify-moments.js';
import {waitingMessageFor} from './waiting-message.js';
import * as consent from './email-consent.js';
import * as mail from './mail-choices.js';
import {cvAddress, view as consentView} from './email-from-cv.js';
import {LINE, FAILED} from '../renderer/email-consent-words.js';

// Demo mode's rows: the real views over the built-in rows, never the website. JOBADABRA_DEMO_MAIL picks the state a preview shows: `off` = switches hidden, `suggested` = e-mail not on yet (all off, with the Suggested tag), else e-mail on.
// Fictional rows for demo mode only (the real ones come from the website, never a copy in the app).
const DEMO_ROWS = [
  {id: 'app-matches', name: 'New matches', when: 'a search finds new jobs', suggested: {mac: 'digest', always: 'digest'}}, {id: 'app-needs-you', name: 'An application needs you', when: 'an application waits', suggested: {mac: 'no', always: 'mail'}},
  {id: 'app-applied', name: 'Applied for you', when: 'Full automation sent an application', suggested: {mac: 'no', always: 'no'}}, {id: 'app-weekly', name: 'Weekly summary', when: 'Mondays', suggested: {mac: 'mail', always: 'mail'}},
  {id: 'app-stopped', name: 'Always on stopped working', when: 'a run fails', suggested: {mac: 'hidden', always: 'mail'}}, {id: 'app-nothing', name: 'Nothing found for days', when: 'days with no new match', suggested: {mac: 'hidden', always: 'mail'}},
].map(row => ({...row, choice: ''}));
// The two news mails, fictional like the rows; both start off (owner, 6 Nov 2026: nobody is signed up before saying yes).
const DEMO_NEWS = [{id: 'releases', name: "What's new", when: 'a new version and what changed', on: false}, {id: 'tips', name: 'News and tips', when: 'offers, tips, and a reminder if you have been away', on: false}];
const demoRows = (storage, state = process.env.JOBADABRA_DEMO_MAIL || '') => {
  if (state === 'off') return {ok: true, hidden: true, rows: []};
  const mode = state === 'suggested' ? 'mac' : mail.modeOf(storage), going = state !== 'suggested';   // the demo profile has Always on: its rows follow it, so the status beside Find jobs and the switch agree
  return {ok: true, mode, where: mail.viewOf(DEMO_ROWS[0], mode).where, macWhere: mail.viewOf(DEMO_ROWS[0], 'mac').where, emailing: going, news: DEMO_NEWS.map(item => ({...item})), rows: DEMO_ROWS.map(row => mail.viewOf(row, mode, going)).filter(row => row.shown)};
};

const MOMENTS = ['day3', 'day10', 'stopped', 'waited', 'lost', 'match', 'reply', 'recruiter'];

export function registerNotifyHandlers({ipcMain, storage, DEMO, log}) {
  const moments = createNotifyMoments(storage);
  if (!DEMO) setTimeout(() => mail.settle(storage).catch(() => {}), 20000).unref?.();   // once, for someone who already has e-mail on (lib/mail-choices.js settle); after start-up has made the install key
  ipcMain.handle('notifyState', async () => {
    if (DEMO && process.env.JOBADABRA_DEMO_MAIL === 'suggested') return {by: ['app'], chosen: ['app'], telegram: channel.telegramReady(storage), email: '', confirmed: false, cadence: 'daily', reached: true};   // a preview of the first run: e-mail is not on yet, no address on our site
    if (DEMO) return {by: ['email', 'app'], chosen: ['email', 'app'], telegram: channel.telegramReady(storage), email: 'alex@example.com', confirmed: true, cadence: 'daily', reached: true};
    return channel.state(storage);
  });
  // The pop-ups (lib/notify-moments.js): `moment` is the next one the main process knows (an application that waited, an address reminder, Full automation with nobody to tell) or null; `seenAt`/`backAt`
  // (lib/window-seen.js) and `done` are what the window needs to judge the moments it detects itself (a match or Gmail update while the person was away, a recruiter waiting). Demo mode shows none.
  ipcMain.handle('notifyMoment', async () => {
    if (DEMO) return null;
    const state = await channel.state(storage).catch(() => null), settings = storage.settings();
    return {allowed: moments.allowed(state), moment: moments.next(state, Date.now(), {waited: waitingMessageFor(storage).waitedFor()}), seenAt: settings.windowSeenAt || '', backAt: settings.windowBackAt || '', done: moments.done(), state};
  });
  ipcMain.handle('notifyMomentShown', async (_, moment) => { if (!DEMO && MOMENTS.includes(moment)) moments.shown(moment); });
  // The card's Resend: the confirm mail again (jobadabra-web #333). Demo mode never reaches our site.
  ipcMain.handle('notifyResend', async () => {
    if (DEMO) return {ok: true};
    const result = await channel.resend(storage);
    log('notify', result.ok ? 'confirm mail sent again' : 'confirm mail not sent again', {code: result.code || ''});
    return result;
  });
  // The person's switch per e-mail (lib/mail-choices.js): both screens (Notifications, Automation) read and write the one value the website keeps. `hidden` only if MAIL_SWITCHES_SHOWN is turned off.
  // Demo mode shows fictional rows and never reaches our site.
  ipcMain.handle('mailChoices', async () => {
    if (DEMO) return demoRows(storage);
    if (!mail.MAIL_SWITCHES_SHOWN) return {ok: true, hidden: true, rows: []};
    return mail.read(storage);
  });
  // A press: off stores the choice; on, for a person whose e-mail is not on yet, is also the act that sends the address (the typed one, else the saved one, else the CV's) and turns the Email channel on (lib/mail-choices.js turnOn).
  ipcMain.handle('mailChoiceSet', async (_, row, on, {address = '', name = ''} = {}) => {
    if (DEMO) return {ok: true};
    const result = typeof on !== 'boolean' ? {ok: false, error: 'That e-mail is not one of the switches.'}
      : await mail.choose(storage, row, on, {address: on ? String(address).trim().toLowerCase() || channel.emailOf(storage) || await cvAddress(storage) : '', name: String(name), save});
    log('notify', result.ok ? 'mail switch saved' : 'mail switch not saved', {row: String(row), on: !!on, addressSaved: !!result.addressSaved, error: result.error || ''});
    return result;
  });
  // The e-mail consent line (lib/email-consent.js): the CV's address and where it is still asked; giving it saves the CV's address through the one way to the site (channel.save), which stores the consent.
  ipcMain.handle('emailConsentView', async () => DEMO ? {address: 'alex.example@example.com', consented: false, wording: LINE, askCv: true, askAlwaysOn: true} : consentView(storage));
  ipcMain.handle('emailConsentAsked', async (_, place) => { if (!DEMO) consent.asked(storage, place); });
  ipcMain.handle('emailConsentGive', async (_, {where, given} = {}) => {
    if (DEMO) return {ok: true};
    const address = await cvAddress(storage);
    if (!address || !consent.PLACES.includes(where)) return {ok: false, error: FAILED};
    const result = await save({by: [...new Set([...channel.channelsOf(storage), 'email'])], email: address, consentVia: where, consentGiven: consent.GIVEN.includes(given) ? given : 'switched'});
    if (result.ok && where === 'cv') {   // Continue with the switch on = "e-mail me app notifications": the suggested rows of the person's mode turn on, stored as their choices (a refusal here never fails the step)
      const rows = await mail.turnOnSuggested(storage).catch(error => ({ok: false, error: error.message}));
      log('notify', rows.ok ? 'CV step turned on the suggested mails' : 'CV step could not store the suggested mails', {rows: (rows.turned || []).join(','), error: rows.error || ''});
    }
    return result.ok ? {ok: true} : {ok: false, error: FAILED, why: result.error || ''};
  });
  async function save(choice) {
    const result = await channel.save(storage, choice);
    log('notify', result.ok ? 'saved' : 'not saved', {by: (choice.by || []).join(','), email: !!choice.email, error: result.error || '', consent: choice.consentVia || ''});
    if (result.ok) await followNotify(storage).catch(error => log('notify', 'Always on did not follow the new address', {error: error.message}));
    return result;
  }
  ipcMain.handle('notifySave', async (_, choice) => {
    if (DEMO) return {ok: true};
    const result = await channel.save(storage, {...(choice || {}), consentVia: undefined, consentGiven: undefined});
    log('notify', result.ok ? 'saved' : 'not saved', {by: (choice?.by || []).join(','), email: !!choice?.email, error: result.error || ''});
    if (result.ok) {   // Always on, when on, follows a changed address or news choice (#1711: one shared e-mail)
      const moved = await followNotify(storage).catch(error => ({ok: false, error: error.message}));
      if (moved.moved || !moved.ok) log('notify', moved.ok ? 'Always on follows the new address' : 'Always on did not follow the new address', {error: moved.error || ''});
      if (!moved.ok) return {...result, warning: 'Saved, but Always on still sends to your old address. Try again in a moment.'};
    }
    return result;
  });
}
