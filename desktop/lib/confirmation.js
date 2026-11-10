// A submit press, then a change: a redirect, or new content on the same page. This file turns that page into
// a yes or no: a short read by the user's own AI, never a hardcoded /confirmation or /thanks path. A path
// like that is only a hint the model may see. Page text such as "thank you for applying", on its own, is not
// a submission (1 Oct 2026). The URL helpers below are for the log line when such a page shows up with no submit press.
import * as ai from './ai/index.js';

// The judge itself lives in lib/confirmation-judge.js (moved 10 Nov 2026, cs 1/4) so the cloud night can carry it without the app's AI clients.
export {MODEL, judgePage, pageBrief} from './confirmation-judge.js';

// options.lane 'page': the extension's questions while a form is open go ahead of side work (lib/ai/cli-base.js slots).
export function aiClient(storage, options = {}) {
  return ai.client(storage, options);
}

export function jobId(url) {
  let path = '';
  try { path = new URL(String(url)).pathname; } catch { return ''; }
  const parts = path.replace(/\/+$/, '').split('/').filter(Boolean);
  if (['confirmation', 'thanks', 'application', 'apply'].includes(parts.at(-1))) parts.pop();
  return parts.at(-1) || '';
}

// The tab is this job's own confirmation page: same site, same job id, and the path ends
// in /confirmation (Greenhouse) or /thanks (Lever). The form page itself does not count.
export function confirmsJob(tabUrl, jobUrl) {
  if (!tabUrl || !jobUrl) return false;
  let tab;
  let job;
  try { tab = new URL(String(tabUrl)); job = new URL(String(jobUrl)); } catch { return false; }
  if (tab.origin !== job.origin) return false;
  const id = jobId(jobUrl);
  if (!id || jobId(tabUrl) !== id) return false;
  const last = tab.pathname.replace(/\/+$/, '').split('/').filter(Boolean).at(-1);
  return last === 'confirmation' || last === 'thanks';
}

// Confirmation pages in a tab report, each once: whether an open session owns it. host, id and path
// only — a query string can carry a token, and the page's text is not evidence.
export function reportedConfirmations(tabUrls, sessions) {
  const seen = new Set();
  const pages = [];
  for (const tab of tabUrls || []) {
    let host = '';
    let path = '';
    try {
      const url = new URL(String(tab));
      const parts = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
      path = parts.at(-1) || '';
      if (path !== 'confirmation' && path !== 'thanks') continue;
      host = url.hostname;
    } catch { continue; }
    const id = jobId(tab);
    const key = `${host}/${id}/${path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const matched = (sessions || []).some(session => session?.url && confirmsJob(tab, session.url));
    pages.push({host, id, path, matched});
  }
  return pages;
}


