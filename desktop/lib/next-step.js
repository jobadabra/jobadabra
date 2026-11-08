// Display-only: it asks the engine for the saved plan's first steps and keeps them as a setting for the run card; it fills, judges and decides nothing on a page.
// What a finished Find jobs run's card says comes next (plan P3; owner, 8 Nov 2026, asked via AskUserQuestion: "Yes, as drawn"): the engine's saved plan, its first
// two steps, kept in settings.nextStep = {steps: [{step, left}], at} when the run ends and cleared when there is none (renderer/pages/next-step-line.js draws it).
// Like lib/refused-offer.js the engine is asked through run(); the plan itself is the engine's (src/press/plan.py), never read from its file here. [] / null on any failure.
export async function steps(storage, run) {
  try {
    const {stdout} = await run(storage, ['src.desktop', 'next-step']);
    const answer = JSON.parse(String(stdout).trim().split('\n').pop());
    return Array.isArray(answer.steps) && answer.steps.length ? {steps: answer.steps, at: answer.planned_at} : null;
  } catch { return null; }
}

/** Ask the engine what comes next (steps) and keep it as settings.nextStep for the run card; resolves to the answer, null (and clears the setting) when the engine says nothing or fails. */
export async function save(storage, run) {
  const next = await steps(storage, run);
  storage.saveSettings({nextStep: next});
  return next;
}
