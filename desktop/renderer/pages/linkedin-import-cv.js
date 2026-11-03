// The decision behind "no main CV: the ticked LinkedIn rows become it" (pages/linkedin-import.js draws it), kept free of the window so a test plays every outcome with fakes.
/**
 * Saves the picked CV as the main CV. `save(cv)` is the buildCvSave IPC, `saved(name)` what follows a saved CV (the setup step and the Profile card read it).
 * -> {kind: 'none'} no position was ticked, nothing is made; {kind: 'failed', error} the CV was not saved; {kind: 'ready', name} it is saved, even when the follow-up threw (the file exists).
 * Invariant: `saved` runs only after a successful save, once.
 */
export async function makeMainCv(cv, {save, saved}) {
  if (!cv?.jobs?.length) return {kind: 'none'};
  const result = await Promise.resolve().then(() => save(cv)).catch(error => ({ok: false, error: error?.message}));
  if (!result?.ok) return {kind: 'failed', error: result?.error};
  await Promise.resolve().then(() => saved(result.name)).catch(() => {});
  return {kind: 'ready', name: result.name};
}
