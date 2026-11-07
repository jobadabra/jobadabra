// Locale-read failures fall back to English and surface the existing restart notice after the app has loaded.

/** Apply the saved language before importing pages; unavailable IPC must never prevent application startup. */
export async function startWithLocale({read, apply, start, onUnavailable = () => {}}) {
  let state, unavailable = false;
  try { state = await read(); unavailable = !state; }
  catch { unavailable = true; }
  await apply(state || {choice: 'en', locale: 'en'});
  const result = await start();
  // The preload's first outdated event can precede page listeners; announce again only after those listeners exist.
  if (unavailable) onUnavailable();
  return result;
}
