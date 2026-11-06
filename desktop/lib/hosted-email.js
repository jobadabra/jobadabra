// Always on uses the one e-mail address Settings → Notifications keeps (lib/notify-channel.js), never a second copy: #1711, owner 27 Oct 2026 ("One shared e-mail").
// The Settings card turns it on with that address; an address typed in the setup step becomes the Notifications address too; a changed address
// moves Always on with it while it is on (never turns it on by itself: that stores the profile on our servers, the person's own press). Guard: test/unit/main/hosted-email.test.js.
import * as channel from './notify-channel.js';
import * as hosted from './hosted-search.js';
import {consented} from './email-consent.js';

export const NO_ADDRESS = 'Add your e-mail in Settings → Notifications first: the matches go there.';

// -> {ok, error?, warning?}
export async function turnOnShared(storage, given = {}, {fetcher, turnOn = hosted.turnOn, save = channel.save} = {}) {
  const typed = String(given.email || '').trim();
  const email = typed || (consented(storage) ? channel.emailOf(storage) : '');   // a withdrawn consent leaves no address to use: the person adds one in Notifications
  if (!email) return {ok: false, error: NO_ADDRESS};
  const done = await turnOn(storage, {email}, fetcher ? {fetcher} : {});
  if (!done.ok || !typed || typed.toLowerCase() === channel.emailOf(storage)) return done;
  const kept = await save(storage, {email: typed}, fetcher);
  return kept.ok ? done : {...done, warning: 'On, but Notifications still shows your old address: save it there again.'};
}

// After Notifications saved. -> {ok, moved}
export async function followNotify(storage, {fetcher, turnOn = hosted.turnOn} = {}) {
  const now = hosted.state(storage), email = channel.emailOf(storage);
  if (!now.on || !email || email === String(now.email || '').toLowerCase()) return {ok: true, moved: false};
  const done = await turnOn(storage, {email}, fetcher ? {fetcher} : {});
  return {...done, moved: !!done.ok};
}
