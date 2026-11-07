// The words of the practice run's banner and "What would have been sent" (spec 2026-11-07-practice-jobs-design.md, PR 3/4). English only: the practice app is a developer / Claude Desktop tool started from the
// source checkout (npm run practice), never a person's app, so these are not in the translated catalogs. Pure: no DOM.
// Why (7 Nov 2026, Gitar on #3542): the banner claims the application, not the machine: the engine's page fetches and the AI answer do leave it.
export const PRACTICE_WORDS = {
  bannerTitle: 'Practice run',
  bannerText: 'No real application is sent. Each Submit lands on this computer; open a job → Application → Practice to see what would have been sent.',
  option: 'Practice',
  waitingTitle: 'Nothing caught yet',
  waitingText: 'When Full automation presses Submit on this job, the form as it was sent shows here.',
  caughtTitle: count => (count === 1 ? 'Caught 1 submission' : `Caught ${count} submissions`),
  caughtText: 'Caught by the practice server on this computer. It did not reach the employer.',
  at: 'Caught',
  how: 'Pressed through',
  posted: 'Form posted',
  yes: 'yes',
  no: 'no',
  fields: 'Fields as sent',
  empty: 'empty',
};

/** The fact pairs for one caught submission, in the order the drawer shows them: when, how Submit was caught, and whether the form posted. */
export function caughtFacts(entry, when) {
  return [[PRACTICE_WORDS.at, when], [PRACTICE_WORDS.how, entry.how === 'post' ? 'form post (no script report)' : entry.how], [PRACTICE_WORDS.posted, entry.posted ? PRACTICE_WORDS.yes : PRACTICE_WORDS.no]];
}
