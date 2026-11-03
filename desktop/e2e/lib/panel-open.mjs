/* global document */
// Opens the extension's panel on a form tab and returns once it is seen open. Used by suites/apply.mjs (panelOf).
// Job: wait on state
import {stepWait} from './wait-on-state.mjs';

/**
 * In-page, run on every poll: true only when the panel's card is seen open; a card seen closed gets one press of the pill and is read again on the next poll.
 * Why (3 Nov 2026, main bef02c2 run 41568088547, apply-3of3 safety step: `locator.click: Timeout 15000ms exceeded`, "element is not visible" for 15 s on the panel's Fill button):
 * the pill TOGGLES the panel, and the extension also opens it by itself when the worker pushes a step (extension/review.js setOpen). A read of "closed" followed by one press
 * raced that push: the press closed the panel the extension had just opened, and a person-closed panel is never opened by the extension again (userMoved). The press is
 * therefore judged by the next read of the card's state, never assumed to have opened it.
 */
export const PANEL_OPEN = () => {
  const root = document.getElementById('jobadabra-review-host')?.shadowRoot, card = root?.querySelector('.card');
  if (!card) return false;
  if (card.hidden) { root.querySelector('.pill')?.click(); return false; }
  return true;
};

/** What the page shows of the panel, for a failure: no host, no card, closed or hidden by its X, or open. */
export const PANEL_SEEN = () => {
  const host = document.getElementById('jobadabra-review-host'), card = host?.shadowRoot?.querySelector('.card');
  return !host ? 'no panel on the page' : host.hidden ? 'the panel was closed with its X' : !card ? 'the panel has no card' : card.hidden ? 'the panel stayed minimised to its pill' : 'the panel is open';
};

/** Wait, within the running step's clock, until the panel on `tab` is open; a failure says what the page showed of it. */
export async function openPanel(tab) {
  try { await stepWait('the Jobadabra panel opened on the form', timeout => tab.waitForFunction(PANEL_OPEN, null, {timeout, polling: 250})); }
  catch (error) {
    const seen = await tab.evaluate(PANEL_SEEN).catch(readError => `its state could not be read (${String(readError?.message || readError).split('\n')[0].slice(0, 100)})`);
    throw new Error(`${error.message}; last seen: ${seen}`);
  }
}
