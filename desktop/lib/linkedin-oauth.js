// "Connect with LinkedIn": LinkedIn's own consent page (Sign In with LinkedIn using OpenID Connect). Same shape as lib/notion-oauth.js: the app opens the website's /api/linkedin/start with a
// random `state` it made; the website (which holds the secret) trades LinkedIn's code for the member's OpenID profile (name, email, LinkedIn id) and redirects the person's own browser to this
// app's socket with only that (lib/oauth-handoff.js takes it for that state only; the website keeps nothing and nothing is polled). LinkedIn gives positions and skills only to registered
// companies, so this is identity: the Experience tab's data comes from the CVs, the data-export ZIP and the profile import. Guarded by test/linkedin-oauth.test.js.
import {begin, cancel as cancelFlow, fail} from './oauth-handoff.js';

export const SITE = process.env.JOBADABRA_SITE || 'https://www.jobadabra.top';
const FLOW = 'linkedin-signin';

export const cancel = () => cancelFlow(FLOW);   // a new click cancels the previous wait too

// -> {ok: true, sub, name, given_name, family_name, email, locale} | {ok: false, error}
export async function connect(openExternal, {timeout = 5 * 60 * 1000, site = SITE} = {}) {
  const {state, result} = begin(FLOW, {timeout, timeoutError: 'LinkedIn didn\'t answer in 5 minutes. Try again.'});
  try { await openExternal(`${site}/api/linkedin/start?state=${state}`); } catch { fail(FLOW, 'Your browser could not be opened.'); }
  const answer = await result;
  if (!answer.ok) return answer;
  const {sub = '', name = '', given_name: givenName = '', family_name: familyName = '', email = '', locale = ''} = answer.fields;
  if (!sub) return {ok: false, error: 'LinkedIn did not send your profile. Try again.'};
  return {ok: true, sub, name, given_name: givenName, family_name: familyName, email, locale};
}

// What the app keeps of a connection: who it is, never a token (the website did not keep one either).
export const kept = (profile, now = new Date()) => ({sub: String(profile.sub), name: profile.name || '', givenName: profile.given_name || '',
  familyName: profile.family_name || '', email: profile.email || '', connectedAt: now.toISOString()});
