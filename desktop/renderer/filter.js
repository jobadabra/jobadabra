// The Jobs filter box: words match title, company, place, and who wrote (the agency and the recruiter's name or address); a pasted link matches the job's own link,
// with or without https://, www., a trailing slash, tracking parameters or #anchor.
export const linkKey = url => String(url || '').trim().toLowerCase()
  .replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').replace(/[?#].*$/, '').replace(/\/+$/, '');

// A link, not words: has a dot before a slash and no spaces ("jobs.ch/en/vacancies/detail/…").
export const looksLikeLink = text => /^\S*\.[a-z]{2,}\/\S*$/i.test(String(text || '').trim()) || /^https?:\/\//i.test(String(text || '').trim());

export function matches(job, text) {
  text = String(text || '').trim();
  if (!text) return true;
  if (looksLikeLink(text)) return linkKey(job.url) === linkKey(text) || linkKey(job.url).startsWith(`${linkKey(text)}/`);
  const words = text.toLowerCase();
  // Why (4 Nov 2026, gv's Google film: a recruiter's name under Inbound found 0 rows): an opportunity that found you keeps who wrote in the contact and via fields
  // (its employer is often hidden, company empty), and the row shows them; the box looks where the row looks.
  return `${job.title} ${job.company} ${job.location} ${job.via || ''} ${job.contact || ''}`.toLowerCase().includes(words) || String(job.url || '').toLowerCase().includes(words);
}
