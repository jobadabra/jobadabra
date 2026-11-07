// Send feedback in AI tester mode (lib/tester-mode.js): the dialog shows the tester's report fields instead of the contact and attachment choices, and Send files one bug bundle (lib/tester-bundle.js).
// A person's app never gets `tester` from the main process, so none of this shows for them. The words in the main box are the bug's title.
import {$} from './core.js';

const IDS = ['journey', 'expected', 'seen', 'steps'];

/** Shows or hides the tester fields for this opening of the dialog: `tester` is the source word from feedbackPrepare ('persona', 'desktop-tester') or null. */
export function drawTester(tester) {
  $('app-feedback-tester').hidden = !tester;
  $('app-feedback-person').hidden = !!tester;
  $('app-feedback-text').placeholder = tester ? 'A short title for the bug' : 'e.g. Setup took 20 minutes; the Notion step was unclear…';
  if (!tester) for (const id of IDS) $(`app-feedback-tester-${id}`).value = '';
}

/** The report the fields hold, in the shape `sendTesterBug` takes. */
export const readTester = () => ({title: $('app-feedback-text').value, journey: $('app-feedback-tester-journey').value, expected: $('app-feedback-tester-expected').value,
  seen: $('app-feedback-tester-seen').value, severity: $('app-feedback-tester-severity').value, steps: $('app-feedback-tester-steps').value});
