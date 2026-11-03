// The hands of the AI user agent on the real app window: what the explorer loop (lib/explore.mjs) calls to read the page and to press, type, go. Playwright page in, `act` out.
// Job: report health
// Why (3 Nov 2026, AI user agents 6/12): the manual explorer suite waits a fixed time after a press; the agent waits for the app to settle (lib/app.mjs settle: no loader visible for up to its own 20 s, then a short pause), so a slow runner
// mostly makes a session slower; a loader still showing after 20 s is observed as it is. No action adds a clock of its own (Rule B): the step's hang cap is the only other limit. Nothing here is a verdict about the page: it only finds controls and acts on one the explorer's own safety filter (isSafe) already allowed.
import {settle} from './app.mjs';
import {goView} from './go-view.mjs';
import {observePage} from './explore.mjs';
import {VIEWS} from './uicheck.mjs';

/** The pages `go` may open: the Finder's views plus Profile, which the menu draws as a button of the settings view (`data-settings="profile"`), so no view name of the Finder's list reaches it. */
export const AGENT_VIEWS = [...VIEWS, 'profile'];
const PROFILE_NAV = '.nav[data-settings="profile"]';

/**
 * The `act` object of explore(): observe, click, type, press, go. `page` is the app window. Only what a session needs: the replay without AI (8/12) adds its text and console helpers when it uses them.
 * Every action returns after the app settled. A control is found by the index the last observation gave it (data-explore), never by CSS written here.
 */
export function agentAct(page) {
  const tagged = i => page.locator(`[data-explore="${i}"]`);
  return {
    observe: () => page.evaluate(observePage),
    click: async i => { await tagged(i).scrollIntoViewIfNeeded(); await tagged(i).click({noWaitAfter: true}); await settle(page); },
    type: async (i, text) => { await tagged(i).fill(String(text || '').slice(0, 200)); await settle(page); },
    press: async key => { await page.keyboard.press(key); await settle(page); },
    go: async view => { if (view === 'profile') await page.click(PROFILE_NAV); else await goView(page, view); await settle(page); },
  };
}

/** A screenshot of the window as base64 PNG, for the second opinion; '' when the window cannot be shot (the judge then reads the words only). */
export async function shootPage(page) {
  try { return (await page.screenshot({type: 'png'})).toString('base64'); } catch (error) { console.log(`  screenshot for the second opinion failed: ${String(error.message).split('\n')[0]}`); return ''; }
}
