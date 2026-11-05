// A merged Jobs row stands for every copy of its posting: a change made on the row reaches them all (owner, 5 Nov 2026: "marks every copy").

/**
 * Runs `run(url)` (an app call answering {ok, ...}) on every copy of the row's posting, the row's own link first, and stops at the first refusal.
 * -> the row's own answer when all went through; else the refusal, saying how many links were already changed (a half-done change is never "not changed").
 */
export async function onEveryCopy(job, run) {
  const urls = job.copies?.length ? job.copies : [job.url];
  let own;
  for (const [done, url] of urls.entries()) {
    const result = await Promise.resolve(run(url)).catch(error => ({ok: false, error: error.message})) || {ok: false};
    if (!result.ok) return done ? {...result, error: `Changed on ${done} of ${urls.length} links, then: ${result.error || 'something went wrong'}`} : result;
    own ??= result;   // the first answer is the row's own: its stage is what the row shows
  }
  return own;
}

/** Sets `next` on every copy; `setStatus(url, status)` is the app's IPC. */
export const setStatusOnCopies = (job, next, setStatus) => onEveryCopy(job, url => setStatus(url, next));

/** Every link a list of rows stands for (a merged row has several): what "is this job in Jobs?" asks. */
export const linksOf = jobs => (jobs || []).flatMap(job => (job.copies?.length ? job.copies : [job.url]));

/** The "Also on jobup.ch" tag texts of a merged row (the other sites that list the same posting), none for a row that is not merged. */
export const alsoOnTags = job => (job.also_on || []).map(site => ({text: `Also on ${site}`, title: `The same posting is also listed on ${site}`}));
