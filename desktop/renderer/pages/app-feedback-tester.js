// Send feedback in AI tester mode (lib/tester-mode.js): the dialog shows the tester's report fields instead of the contact and attachment choices, and Send files one bug bundle (lib/tester-bundle.js).
// A person's app never gets `tester` from the main process, so none of this shows for them. The words in the main box are the bug's title.
import {$} from './core.js';

const IDS = ['journey', 'expected', 'seen', 'steps'];
let person = null;   // the dialog's placeholder for a person, before a tester app changes it

/** Shows or hides the tester fields for this opening of the dialog: `tester` is the source word from feedbackPrepare ('persona', 'desktop-tester') or null. */
export function drawTester(tester) {
  $('app-feedback-tester').hidden = !tester;
  $('app-feedback-person').hidden = !!tester;
  person ??= $('app-feedback-text').placeholder;   // the person's own words stay in index.html, read once
  $('app-feedback-text').placeholder = tester ? 'A short title for the bug' : person;
  for (const id of IDS) $(`app-feedback-tester-${id}`).value = '';   // every open is a new bug (Gitar on #3406): the last one's words never ride on the next bundle
  $('app-feedback-tester-severity').value = 'medium';
}

/** The report the fields hold, in the shape `sendTesterBug` takes. */
export const readTester = () => ({title: $('app-feedback-text').value, journey: $('app-feedback-tester-journey').value, expected: $('app-feedback-tester-expected').value,
  seen: $('app-feedback-tester-seen').value, severity: $('app-feedback-tester-severity').value, steps: $('app-feedback-tester-steps').value});
