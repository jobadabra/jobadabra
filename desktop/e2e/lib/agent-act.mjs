// The hands of the AI user agent on the real app window: what the explorer loop (lib/explore.mjs) calls to read the page and to press, type, go. Playwright page in, `act` out.
// Job: report health
// Why (3 Nov 2026, AI user agents 6/12): the manual explorer suite waits a fixed time after a press; the agent waits for the app to settle (lib/app.mjs settle: no loader visible), so a slow runner
// makes a session slower, never different. No action has a clock of its own (Rule B): the step's hang cap is the only limit. Nothing here is a verdict about the page: it only finds controls and acts on one the explorer's own safety filter (isSafe) already allowed.
import {settle} from './app.mjs';
import {goView} from './go-view.mjs';
import {observePage} from './explore.mjs';

/**
 * The `act` object of explore(): observe, click, type, press, go. `page` is the app window; errors seen on the page are collected in `errors` for a console check.
 * Every action returns after the app settled. A control is found by the index the last observation gave it (data-explore), never by CSS written here.
 */
export function agentAct(page, errors = []) {
  const tagged = i => page.locator(`[data-explore="${i}"]`);
  return {
    observe: () => page.evaluate(observePage),
    click: async i => { await tagged(i).scrollIntoViewIfNeeded(); await tagged(i).click({noWaitAfter: true}); await settle(page); },
    type: async (i, text) => { await tagged(i).fill(String(text || '').slice(0, 200)); await settle(page); },
    press: async key => { await page.keyboard.press(key); await settle(page); },
    go: async view => { await goView(page, view); await settle(page); },
    readText: () => page.evaluate(() => (document.querySelector('.view:not([hidden])')?.innerText || document.body.innerText || '')),   // eslint-disable-line no-undef
    errorMark: () => errors.length,
    errorsSince: mark => errors.slice(mark),
  };
}

/** A screenshot of the window as base64 PNG, for the second opinion; '' when the window cannot be shot (the judge then reads the words only). */
export async function shootPage(page) {
  try { return (await page.screenshot({type: 'png'})).toString('base64'); } catch (error) { console.log(`  screenshot for the second opinion failed: ${String(error.message).split('\n')[0]}`); return ''; }
}
