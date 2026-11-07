// "Connect with Notion": Notion's own consent page instead of a token to create and paste. The app opens the Jobadabra website's /api/notion/start with a random `state` it made; after the
// user approves in Notion (picking a page, or letting Notion copy the Jobadabra template), the website trades Notion's code for the token (it holds the connection's secret) and redirects the
// person's own browser to this app's socket, where lib/oauth-handoff.js takes it for that state only. The website keeps nothing and nothing is polled (Why 3 Nov 2026: a poll gave the token to
// whoever knew the id). Guarded by test/unit/main/notion-oauth.test.js.
import '../i18n/setup-notices.js';
import '../i18n/linkedin-notices.js';
import {withDisplay} from '../i18n/display-values.js';
import {begin, cancel as cancelFlow, fail} from './oauth-handoff.js';

export const SITE = process.env.JOBADABRA_SITE || 'https://www.jobadabra.top';
const FLOW = 'notion-connect';
const FAILURE_KEYS = {timeout: 'setupNotice.notionTimeout', open: 'linkedinNotice.browserOpenFailed'};

// The page Notion copied the Jobadabra template into ("Use a template provided by the developer" on its
// consent page; the connection's settings must offer it), as a plain 32-character id; null when the user picked
// their own page instead ("Select pages") or Notion sent something that isn't a page id.
export function templateRoot(signedIn) {
  const id = String(signedIn?.duplicated_template_id || '').replace(/-/g, '').toLowerCase();
  return /^[0-9a-f]{32}$/.test(id) ? id : null;
}

export const cancel = () => cancelFlow(FLOW);   // a new click cancels the previous wait too

// -> {ok: true, access_token, workspace_name, workspace_id, duplicated_template_id} | {ok: false, error}
export async function connect(openExternal, {timeout = 5 * 60 * 1000, site = SITE} = {}) {
  let openingFailed = false;
  const {state, result} = begin(FLOW, {timeout, timeoutError: 'Notion didn\'t answer in 5 minutes. Try again, or use "Having trouble? Use a token instead" below.',
    // Why (7 Nov 2026): only this caller's authored browser failure receives display metadata; unrelated failure text stays raw.
    onFailureResult: (answer, reason) => { if (reason === 'timeout' || openingFailed) withDisplay(answer, FAILURE_KEYS[reason]); }});
  try { await openExternal(`${site}/api/notion/start?state=${state}`); } catch { openingFailed = true; fail(FLOW, 'Your browser could not be opened.'); }
  const answer = await result;
  if (!answer.ok) return answer;
  const {access_token: token, workspace_name: name = '', workspace_id: id = '', duplicated_template_id: template = '', refresh_token: refresh = ''} = answer.fields;
  if (!token) return withDisplay({ok: false, error: 'Notion did not send a token. Try again.'}, 'setupNotice.notionMissingToken');
  return {ok: true, access_token: token, workspace_name: name, workspace_id: id, duplicated_template_id: template || null, ...(refresh ? {refresh_token: refresh} : {})};
}
