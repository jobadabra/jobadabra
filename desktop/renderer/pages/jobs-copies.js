// A merged Jobs row stands for every copy of its posting: a change made on the row reaches them all (owner, 5 Nov 2026: "marks every copy").

/**
 * Runs `run(url)` (an app call answering {ok, ...}) on every copy of the row's posting, the row's own link first, and stops at the first refusal.
 * -> the row's own answer when all went through; else the refusal, saying how many links were already changed (a half-done change is never "not changed").
 */
import '../../i18n/screens-pages.js';
import {t} from '../../i18n/index.js';
export async function onEveryCopy(job, run) {
  const urls = job.copies?.length ? job.copies : [job.url];
  let own;
  for (const [done, url] of urls.entries()) {
    const result = await Promise.resolve(run(url)).catch(error => ({ok: false, error: error.message})) || {ok: false};
    if (!result.ok) return done ? {...result, error: t('pagesDynamicJobs.m219', {"done": done, "length": urls.length, "value3": result.error || t('pagesControlStatus.somethingWrong')})} : result;
    own ??= result;   // the first answer is the row's own: its stage is what the row shows
  }
  return own;
}

/** Sets `next` on every copy; `setStatus(url, status)` is the app's IPC. */
export const setStatusOnCopies = (job, next, setStatus) => onEveryCopy(job, url => setStatus(url, next));

/** Every link a list of rows stands for (a merged row has several): what "is this job in Jobs?" asks. */
export const linksOf = jobs => (jobs || []).flatMap(job => (job.copies?.length ? job.copies : [job.url]));

/** Does this row stand for one of these links (a Set of keys)? A merged row matches by any of its copies, so a counter's list and the rows it opens agree. */
export const holdsAny = (job, keys, key) => linksOf([job]).some(url => keys.has(key(url)));

/**
 * What a run's card counts, in postings: `urls` are the links of the jobs a run found, `jobs` the list's rows, `key` the link key.
 * -> {postings: how many distinct postings the run found (two links of one merged row are one), inJobs: how many of them a row holds}.
 */
export function countPostings(urls, jobs, key) {
  const rowOf = new Map();
  for (const job of jobs || []) for (const url of linksOf([job])) rowOf.set(key(url), job);
  const postings = new Set(urls.map(url => rowOf.get(key(url)) || key(url)));
  return {postings: postings.size, inJobs: rowOf.size ? [...postings].filter(one => typeof one !== 'string').length : postings.size};
}

/** The "Also on jobup.ch" tag texts of a merged row (the other sites that list the same posting), none for a row that is not merged. */
export const alsoOnTags = job => (job.also_on || []).map(site => ({text: t('pagesDynamicJobs.m220', {"site": site}), title: t('pagesDynamicJobs.m221', {"site": site})}));
