// "Send feedback…" (sidebar and Help menu): the user's own words to the owner, through the website
// (site/src/feedback.js → the owner's Jobadabra Brain bot). Stage 1's exit criterion is feedback from real users.
// Sends: the text, an optional contact the user typed, the app version and platform, the random install id, and (each only when the person left it on in the dialog) the window's
// screenshot and the redacted logs (lib/feedback-bundle.js, held by lib/feedback-handlers.js), plus the name of the page it was sent from.
export const ENDPOINT = 'https://www.jobadabra.top/api/feedback';

export function installId(storage) {
  let id = storage.settings().telemetryId;  // the same random id as technical reports
  if (!id) { id = crypto.randomUUID(); storage.saveSettings({telemetryId: id}); }
  return id;
}

/** Posts one feedback to the website. Takes the words, an optional contact, and (only when the person left them on) the page name, the window's JPEG data URL and the redacted logs text;
 *  `storage` gives the install id. -> {ok: true, skipped?: [parts the site left out as too big]} | {ok: false, error: <words for the person>}; a 429, a bad status and being offline each have their own error. */
export async function send({text, contact = '', screen = '', screenshot = '', logs = ''}, {storage, version, platform = process.platform, fetcher = globalThis.fetch, endpoint = ENDPOINT}) {
  const words = String(text || '').trim();
  if (!words) return {ok: false, error: 'Write a few words first.'};
  if (words.length > 2000) return {ok: false, error: 'Please keep it under 2000 characters.'};
  try {
    const response = await fetcher(endpoint, {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({text: words, contact: String(contact || '').trim().slice(0, 200), install: installId(storage), version, platform,
        ...(screen ? {screen} : {}), ...(screenshot ? {screenshot} : {}), ...(logs ? {logs} : {})})});
    if (response.status === 429) return {ok: false, error: 'That\'s a lot of feedback today: thank you! Try again tomorrow.'};
    if (!response.ok) return {ok: false, error: `Couldn't send it (${response.status}). Try again in a moment.`};
    const answer = await response.json().catch(() => ({}));
    return {ok: true, ...(answer.skipped?.length ? {skipped: answer.skipped} : {})};   // the site keeps the words even when a file is over its cap and says which part it skipped
  } catch (error) {
    return {ok: false, error: `Couldn't send it: ${error.message}. Check your connection.`};
  }
}
