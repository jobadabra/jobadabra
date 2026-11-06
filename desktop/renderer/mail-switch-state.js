// The state behind every per-mail switch on screen (pages/mail-switches.js draws it): the last read of the person's choices, and a press that shows at once, saves, and puts the switch back with the website's words when the save fails.
// One state for all places (Notifications, Automation, Apply), so two switches for a row never disagree. No DOM here, so test/unit/renderer/mail-switch-state.test.js runs it in Node.
const NOT_SAVED = 'Could not save it just now. The switch is back where it was.';

/** `pilot`: window.pilot (mailChoices, mailChoiceSet); `redraw`: called after every change; `extra(row)`: what the main process needs with a press (the typed address, the row's name); `saved(result)`: after a press the website took.
 *  -> {read(), press(row, on), state(), note(row)}. */
export function createMailState(pilot, redraw, {extra = () => ({}), saved = () => {}} = {}) {
  let current = null;   // {ok, hidden?, mode, where, rows: [{id, name, when, on}]} or {ok: false, error}, null before the first read
  const failed = new Map();   // row id -> the words of its last refused save, kept until that row is pressed again
  const confirmed = new Map(), chain = new Map(), open = new Map();   // per row: the last value the website took, the presses in order, how many are still running
  return {
    state: () => current,
    note: row => failed.get(row) || '',
    // Why (6 Nov 2026, review): a read that finished while a press was saving put the old value back, and two quick presses on one row could leave the screen on the opposite of what is stored. Presses on a row
    // run one after the other, a read waits for them, and when the last one ends the switch shows the last value the website took.
    async read() { await Promise.all([...chain.values()]); current = await pilot.mailChoices().catch(() => null); redraw(); },
    async press(id, on) {
      const row = current?.rows?.find(entry => entry.id === id);
      if (!row) return;
      if (!confirmed.has(id)) confirmed.set(id, row.on);
      failed.delete(id);
      row.on = on;   // at once, in every place that shows it
      redraw();
      open.set(id, (open.get(id) || 0) + 1);
      const run = (chain.get(id) || Promise.resolve()).then(async () => {
        const result = await pilot.mailChoiceSet(id, on, extra(row)).catch(error => ({ok: false, error: error.message}));
        if (result?.ok) { confirmed.set(id, on); saved(result); } else failed.set(id, result?.error || NOT_SAVED);
        open.set(id, open.get(id) - 1);
        if (open.get(id) === 0) { const shown = current?.rows?.find(entry => entry.id === id); if (shown) shown.on = confirmed.get(id); open.delete(id); confirmed.delete(id); chain.delete(id); redraw(); }
      });
      chain.set(id, run);
      await run;
    },
  };
}
