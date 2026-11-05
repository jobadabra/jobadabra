// One status change for a posting listed under several links: the row stands for every copy, so the change reaches them all (owner, 5 Nov 2026: "marks every copy").

/**
 * Sets `next` on every copy of the row's posting, the row's own link first, and stops at the first refusal.
 * `setStatus(url, status)` is the app's IPC. -> the row's own result when all went through, else the refusal ({ok: false, error}).
 */
export async function setStatusOnCopies(job, next, setStatus) {
  const urls = job.copies?.length ? job.copies : [job.url];
  let own;
  for (const url of urls) {
    const result = await Promise.resolve(setStatus(url, next)).catch(error => ({ok: false, error: error.message}));
    if (!result?.ok) return result || {ok: false};
    own ??= result;   // the first answer is the row's own: its stage is what the row shows
  }
  return own;
}

/** The "Also on jobup.ch" tag texts of a merged row (the other sites that list the same posting), none for a row that is not merged. */
export const alsoOnTags = job => (job.also_on || []).map(site => ({text: `Also on ${site}`, title: `The same posting is also listed on ${site}`}));
