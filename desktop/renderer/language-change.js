// A language switch preserves unsaved drafts and reloads only after the preference was saved successfully.
/** Resume the existing wizard without adding a language step; Welcome offers an optional dropdown. */
export function firstWizardStep(settings) {
  const saved = settings.wizardStep;
  if (['letter', 'hosted', 'extras'].includes(saved)) return 'draft';
  if (['goals', 'notion'].includes(saved)) return 'cv';
  return ['welcome', 'ai', 'cv', 'draft'].includes(saved) ? saved : 'welcome';
}

/** Change display language through injected UI actions; callers restore their selector on a refused/failed change. */
export async function changeLanguage(choice, {hasUnsaved, save, reload}) {
  if (hasUnsaved()) return {ok: false, reason: 'unsaved'};
  try {
    const state = await save(choice);
    reload();
    return {ok: true, state};
  } catch { return {ok: false, reason: 'save'}; }
}
