// The person's LinkedIn sign-in in and out of one of the app's own hidden browsers: the two cookies set, and every LinkedIn cookie the browser holds expired again. Shared by the
// signed-in read (lib/linkedin-headless.js) and Easy Apply's batches (lib/easy-apply-batch.js). Invariant: the session value is only ever in the `Storage.setCookies` call.
// Moved as is from lib/linkedin-headless.js (plan 4a-2b, 13 Nov 2026).

/** The two cookies as CDP cookies for `.linkedin.com`; `clear` gives the same cookies empty and expired an hour before `now` (ms). */
export const jar = (cookies, now, clear) => cookies.map(([name, value]) => ({name, value: clear ? '' : value, domain: '.linkedin.com', path: '/', secure: true, httpOnly: name === 'li_at', sameSite: 'None',
  ...(clear ? {expires: Math.floor(now / 1000) - 3600} : {})}));
const onLinkedin = domain => /(^|\.)linkedin\.com$/.test(String(domain).replace(/^\./, ''));
// Why (31 Oct 2026, Gitar on #2699): LinkedIn rotates li_at and sets its own cookies (JSESSIONID on the www host, trackers) during the read; expiring only the two that were set would leave those
// in the profile. So the clean-up expires every LinkedIn cookie the browser actually holds, each with its own domain and path (never another site's), and the two that were set as the floor.
// Why (31 Oct 2026, Gitar on #2699, 2nd round): a CDP cookie given a `domain` is always a DOMAIN cookie, so expiring a host-only cookie ("www.linkedin.com", no leading dot) by domain would
// write a different cookie and leave the original; a host-only one is addressed by `url` with no domain.
const expiredCopy = (c, now) => {
  const base = {name: c.name, value: '', path: c.path || '/', secure: c.secure !== false, expires: Math.floor(now / 1000) - 3600};
  return String(c.domain).startsWith('.') ? {...base, domain: c.domain} : {...base, url: `https://${c.domain}${base.path}`};
};
/** Expire every LinkedIn cookie `browser` ({send}) holds, each by its own domain and path, plus the two that were set; another site's cookies stay. */
export async function clearJar(browser, cookies, now) {
  const held = await browser.send('Storage.getCookies', {}).then(answer => answer?.cookies || []).catch(() => []);
  const gone = new Map();
  for (const c of [...jar(cookies, now, true), ...held.filter(c => onLinkedin(c.domain)).map(c => expiredCopy(c, now))]) gone.set(`${c.name}@${c.domain || c.url}${c.path}`, c);
  await browser.send('Storage.setCookies', {cookies: [...gone.values()]});
}
