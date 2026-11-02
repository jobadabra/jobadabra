// One chip for every value cell on the admin pages (owner, 27 Oct 2026: "this column values/cells should be displayed as chips"): a kind, a state, a result.
// chip(html, tone): html is already escaped by the caller; tone is good (green), warn (amber), bad (red), off or muted (grey), pro/credit (a promo code's kind),
// or none (a plain outline). A page that uses it puts CHIP_STYLE in its own <style> (not in withNav: pages like build-log and schedules keep their own .chip).
// Guard: test/shared/admin-chips.test.js (every page in CHIP_PAGES draws its value cells with it).
const TONES = {good: 'good', warn: 'warn', bad: 'bad', off: 'off', muted: 'off', pro: 'pro', credit: 'credit'};

/** One value chip: `html` must already be escaped; an unknown `tone` draws the plain outline. Returns the HTML string. */
export const chip = (html, tone = '') => `<span class="chip${TONES[tone] ? ` ${TONES[tone]}` : ''}">${html}</span>`;

export const CHIP_STYLE = '.chip{display:inline-block;border:1px solid #2a2f37;border-radius:999px;padding:1px 9px;font-size:12px;line-height:18px;white-space:nowrap;vertical-align:middle}'
  + '.chip.good,.chip.credit{border-color:#1f5a45;color:#3fb68b;background:#11261e}.chip.warn,.chip.pro{border-color:#4a3c1c;color:#f5b54a;background:#2a2312}'
  + '.chip.bad{border-color:#5a2326;color:#e5484d;background:#2a1213}.chip.off{color:#8d949c}';
