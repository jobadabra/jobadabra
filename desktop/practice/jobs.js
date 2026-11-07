// The practice job list: about a dozen recorded form shapes, each one a job in the practice app's Jobs list (spec 2026-11-07-practice-jobs-design.md).
// Why (7 Nov 2026, owner: "About 12, one per shape (Recommended)"): one job per shape of form keeps the list quick to read; each case is picked because its page has a form
// and a submit control, so the catcher can see the Submit (a case with no form could never be caught).
import fs from 'node:fs';
import path from 'node:path';
import {RECORDED} from './server.js';

/** [recorded case name, the job's title after "Practice · "]: one per form shape. */
export const PRACTICE_CASES = [
  ['yes-no-pair-counted-once-1', 'Yes/No toggle buttons'],
  ['cv-to-required-slot-1', 'Two CV upload slots'],
  ['education-menus-first-page-1', 'Education menus (react-select)'],
  ['flatpickr-real-library-1', 'Date picker (flatpickr)'],
  ['country-picker-shows-code-1', 'Country menu that names its code'],
  ['phone-country-real-library-1', 'Phone country picker'],
  ['picklist-hidden-key-1', 'Type-to-search picklists'],
  ['upload-widget-counted-once-1', 'Upload group: Attach, Dropbox, Enter manually'],
  ['suggest-only-place-input-1', 'Place box that takes a suggestion'],
  ['upload-rerender-clears-typed-1', 'Form redrawn after an upload'],
  ['cookie-bar-beside-form-1', 'Posting, a cookie bar, then a form'],
  ['consent-control-shapes-1', 'Consent as a menu or a combobox'],
];

// Why (7 Nov 2026, pj 2/4): only names the IANA reserves can never be an employer. The hidden browser cannot reach a real host (the host rule), but the app's engine fetches job pages
// by itself, outside that browser, and a vendor's real name (jobs.lever.co) would reach the real site. So a practice job lives on example.com/.org/.net, *.example, *.test or *.invalid.
/** True for a host name the IANA keeps for examples and tests: it can never be a real employer's. */
export const reservedHost = host => /(^|\.)(example|test|invalid)$/i.test(host) || /(^|\.)example\.(com|org|net)$/i.test(host);

/**
 * -> [{name, title, company, location, url}] for the practice list, from the recorded cases in `dir`. Throws when a listed case is missing or its pages hold no form with a
 * submit control: the list is checked, so a recorded case that changes cannot turn a practice job into one the catcher can never see.
 */
export function practiceJobs(dir = RECORDED, cases = PRACTICE_CASES) {
  const seen = new Map();   // Why (7 Nov 2026, pj 2/4): recorded cases replay one at a time, so two can share an address; served together the later page would hide the earlier
  return cases.map(([name, label]) => {
    const file = path.join(dir, name, 'case.json');
    if (!fs.existsSync(file)) throw new Error(`practice job ${name}: no such recorded case`);
    const item = JSON.parse(fs.readFileSync(file, 'utf8'));
    const html = item.pages.map(page => fs.readFileSync(path.join(dir, name, page.file), 'utf8')).join('\n');
    for (const page of item.pages) {
      const url = new URL(page.url), key = `${url.host}${url.pathname}`.replace(/\/+$/, '');
      if (seen.has(key)) throw new Error(`practice job ${name}: ${key} is also served for ${seen.get(key)}`);
      seen.set(key, name);
    }
    for (const page of item.pages) if (!reservedHost(new URL(page.url).host)) throw new Error(`practice job ${name}: ${new URL(page.url).host} is not a reserved example host`);
    if (!/<form/i.test(html) || !/type="submit"|<button(?![^>]*type="button")|<input[^>]*type="submit"/i.test(html)) throw new Error(`practice job ${name}: no form with a submit control`);
    return {name, title: `Practice · ${label}`, company: 'Practice Co', location: 'Zurich, Switzerland', url: item.pages[0].url};
  });
}
