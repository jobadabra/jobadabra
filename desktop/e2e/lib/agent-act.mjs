// The hands of the AI user agent on the real app window: what the explorer loop (lib/explore.mjs) calls to read the page and to press, type, go. Playwright page in, `act` out.
// Job: report health
// Why (3 Nov 2026, AI user agents 6/12): the manual explorer suite waits a fixed time after a press; the agent waits for the app to settle (lib/app.mjs settle: no loader visible for up to its own 20 s, then a short pause), so a slow runner
// mostly makes a session slower; a loader still showing after 20 s is observed as it is. No action adds a clock of its own (Rule B): the step's hang cap is the only other limit. Nothing here is a verdict about the page: it only finds controls and acts on one the explorer's own safety filter (isSafe) already allowed.
import {settle} from './app.mjs';
import {goView} from './go-view.mjs';
import {observePage} from './explore.mjs';
import {VIEWS} from './uicheck.mjs';

/** The pages `go` may open: the Finder's views plus Reports and Employers (menu pages the Finder does not walk; "Reports: Weekly report" was refused as a page that does not exist in 3 runs, pz 3/5) plus Profile, which the menu draws as a button of the settings view (`data-settings="profile"`), so no view name of the Finder's list reaches it. */
export const AGENT_VIEWS = [...VIEWS, 'reports', 'employers', 'profile'];
const PROFILE_NAV = '.nav[data-settings="profile"]';

/**
 * The `act` object of explore(): observe, click, type, press, go. `page` is the app window. Only what a session needs: the replay without AI (8/12) adds its text and console helpers when it uses them.
 * Every action returns after the app settled. A control is found by the index the last observation gave it (data-explore), never by CSS written here.
 */
export function agentAct(page) {
  const tagged = i => page.locator(`[data-explore="${i}"]`);
  let pressed = null;   // where the last pressed control sat in the window, for the admin tab to box it in a note's screenshot (9/12 part 2b)
  return {
    // Why (7 Nov 2026, pz, code review): choosing a language reloads the window right after the pick, so the read that follows can land in the old page; that one error waits for the new page's first screen and reads again, any other error stays one.
    observe: async () => {
      try { return await page.evaluate(observePage); } catch (error) {
        if (!/context was destroyed|navigat/i.test(error.message)) throw error;
        await page.waitForSelector('.view:not([hidden])');
        return page.evaluate(observePage);
      }
    },
    lastPress: () => pressed,
    click: async i => {
      await tagged(i).scrollIntoViewIfNeeded();
      const box = await tagged(i).boundingBox(), window = await page.evaluate(() => ({w: window.innerWidth, h: window.innerHeight}));
      pressed = box ? {x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height), window} : null;
      await tagged(i).click({noWaitAfter: true}); await settle(page);
    },
    // Why (7 Nov 2026, pz): a native dropdown cannot be opened by a click in a test window, so typing its option's words picks that option (the first whose text holds them, case apart); no option with those words says which exist, never a guess.
    type: async (i, text) => {
      pressed = null;
      const word = String(text || '').slice(0, 200), control = tagged(i);
      if (await control.evaluate(node => node.tagName === 'SELECT')) {
        const options = await control.evaluate(node => [...node.options].map(option => option.textContent.replace(/\s+/g, ' ').trim()));
        const at = options.findIndex(option => option.toLowerCase().includes(word.trim().toLowerCase()));
        if (at < 0 || !word.trim()) throw new Error(`no option holds "${word}"; the options are ${options.join(' | ')}`);
        await control.selectOption({index: at}, {noWaitAfter: true});
      } else await control.fill(word);
      await settle(page);
    },
    /** The app back in English when a goal left it in another language (the page's `lang`): saves the choice the way Settings does and reloads. -> true when it switched. */
    english: async () => {
      if (/^en\b/i.test(await page.evaluate(() => document.documentElement.lang || 'en'))) return false;
      await page.evaluate(() => window.pilot.setLocale('en'));
      await page.reload(); await page.waitForSelector('.view:not([hidden])'); await settle(page);
      return true;
    },
    press: async key => { pressed = null; await page.keyboard.press(key); await settle(page); },
    /** Scrolls the first visible element showing one of `quotes` into view, so the screenshot taken next shows what a note is about; false when none is on the page. */
    reveal: async quotes => {
      for (const quote of quotes) {
        const spot = page.getByText(quote).filter({visible: true}).first();
        if (await spot.count()) { await spot.scrollIntoViewIfNeeded(); return true; }
      }
      return false;
    },
    go: async view => { pressed = null; if (view === 'profile') await page.click(PROFILE_NAV); else await goView(page, view); await settle(page); },
  };
}

/** A screenshot of the window as base64 PNG, for the second opinion; '' when the window cannot be shot (the judge then reads the words only). */
export async function shootPage(page) {
  try { return (await page.screenshot({type: 'png'})).toString('base64'); } catch (error) { console.log(`  screenshot for the second opinion failed: ${String(error.message).split('\n')[0]}`); return ''; }
}
