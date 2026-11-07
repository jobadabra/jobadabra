// Guard: release — without it the design check's "one primary" verdict (the PR table's ❌) drifts: it flags a list of peer rows (Focus "Up next", Suggestions) as 4 primaries in one card, or lets a form with two amber buttons through.
// The rule (owner, 7 Nov 2026, "One amber per row (Recommended)"): the rows of a list inside a card each have one primary; any other card (a form, a dialog) has one. Real Chrome, the evaluator's own source (scripts/design-evaluator.mjs), never a copy.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {designEval} from '../../scripts/design-evaluator.mjs';
import {chromium} from '../../e2e/lib/visit-page.mjs';
import {CLOSE_MS, at, clocked, onHang} from '../../e2e/lib/test-clock.mjs';

const row = (name, extra = '') => `<li><span>${name}</span><button class="primary">Open ${name}</button>${extra}<button class="secondary">Done</button></li>`;
const PAGES = {
  'a list of 4 rows with one primary each': `<section class="card"><h3>Up next</h3><ul>${['A', 'B', 'C', 'D'].map(name => row(name)).join('')}</ul></section>`,
  'a form card with 2 primaries': '<section class="card"><h3>Details</h3><button class="primary">Save</button><button class="primary">Apply</button></section>',
  'a list row with 2 primaries': `<section class="card"><ul>${row('A', '<button class="primary">Also</button>')}${row('B')}</ul></section>`,
  'a card head primary beside a list of rows with one each': `<section class="card"><button class="primary">Find jobs</button><ul>${row('A')}${row('B')}</ul></section>`,
};
const WANT = {'a list of 4 rows with one primary each': 0, 'a form card with 2 primaries': 1, 'a list row with 2 primaries': 1, 'a card head primary beside a list of rows with one each': 0};

const TEST_MS = 30000, TEST_CAP = {timeout: TEST_MS + CLOSE_MS + 5000};
test('the check counts one primary per row in a list of peer rows, one per card elsewhere', TEST_CAP, clocked(TEST_MS, async () => {
  at('starting Chromium');
  const browser = await chromium.launch({headless: true});
  onHang(() => browser.close());
  try {
    const page = await browser.newPage();
    for (const [name, html] of Object.entries(PAGES)) {
      at(`evaluating: ${name}`);
      await page.setContent(`<body>${html}</body>`);
      const hits = (await page.evaluate(designEval)).out.filter(hit => hit.rule === 'primary');
      assert.equal(hits.length, WANT[name], `${name}: expected ${WANT[name]} primary finding(s), got ${JSON.stringify(hits)}`);
    }
  } finally { await browser.close(); }
}));
