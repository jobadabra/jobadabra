// The words of "How we protect your data": the privacy line in the Always on card and the popup behind its link (owner, 5 Nov 2026: "have a button/link when the user activates this option,
// where a Popup opens and we explain all the security measurements we're taking"). Pure: renderer/pages/always-on-protect.js draws it.
// Why (5 Nov 2026): every line below was checked against the code on the day it shipped, and the popup never claims more than it. Where each is true: docs/superpowers/specs/2026-11-04-always-on-one-choice.md
// (the "How we protect your data" table). The CV file is not sent to our servers (lib/hosted-search.js config: cv ''), so no line says we store it. Found jobs and the schedule are NOT encrypted with the person's key, so nothing here says "everything is encrypted". Guard: test/unit/renderer/always-on-protect-words.test.js.
export const LINK = 'How we protect your data';
export const TITLE = 'How we protect your data';
// The owner's exact line (5 Nov 2026), shown in the card while "on our servers" is the picked way.
export const NOTE = 'Your profile is stored encrypted on our servers, kept apart per account, and deleted when you turn this off.';
export const LEAD = 'Your profile and search settings are encrypted, kept apart and deleted when you turn Always on off. Here is every measure, and what it is not.';

const IN_PLACE = ['In place', 'good', 'check-circle'], KNOW = ['Good to know', 'info', 'info'], NOT = ['What it is not', 'warn', 'info'];

/** The measures, in the order the popup shows them: six protections, one thing to know, then what it is not. `chip` = [word, tone, icon]. */
export const MEASURES = [
  {id: 'rest', title: 'Encrypted when stored', chip: IN_PLACE,
    text: 'Your profile, search settings and the search\'s saved state are stored encrypted, with a separate key for each account.'},
  {id: 'transit', title: 'Encrypted on the way', chip: IN_PLACE,
    text: 'Your Mac talks to our site over HTTPS only, and so does the search that runs for you.'},
  {id: 'apart', title: 'Kept apart', chip: IN_PLACE,
    text: 'Each account runs in its own container. Results are saved only to the account the search was started for.'},
  {id: 'nothing', title: 'Nothing stays in the container', chip: IN_PLACE,
    text: 'Each search runs in a fresh folder that is deleted when it ends, and the container shuts down when it is idle. Between searches your profile waits encrypted in storage.'},
  {id: 'secret', title: 'No password left lying around', chip: IN_PLACE,
    text: 'The search holds no key of yours, only a run pass that works for one search and for 30 minutes at most.'},
  {id: 'delete', title: 'Delete your data, any time', chip: IN_PLACE,
    text: 'Turn off Always on and your files, schedule, searches and found jobs are deleted from our servers. "Download my data" gives you a copy first.'},
  {id: 'ai', title: 'The AI reads your data', chip: KNOW,
    text: 'The AI that scores jobs reads your profile and the job pages. It runs through our AI service (your Free AI or Pro plan), not a key of yours.'},
  {id: 'not', title: 'Not end-to-end encrypted', chip: NOT,
    text: 'Our server decrypts your profile to run the search for you: the price of "we run it". The jobs we found and your e-mail address are kept to send your matches, not encrypted with your key. "On your own accounts" keeps everything on your Mac and in your own accounts.'},
];
