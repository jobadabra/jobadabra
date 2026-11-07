// Guard: safety — without it the capture script could miss a Submit that the page stops itself, or write a typed password into the ledger the person reads.
// A real Chromium with the practice host rule opens recorded pages from the practice server, fills and presses Submit; the catcher must hold what the page held.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {chromium} from '../../e2e/lib/visit-page.mjs';
import {CLOSE_MS, at, clocked, onHang} from '../../e2e/lib/test-clock.mjs';
import {loadCases, startPractice} from '../../practice/server.js';

const TEST_MS = 40000, TEST_CAP = {timeout: TEST_MS + CLOSE_MS + 5000};
const waitFor = async (read, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { const got = read(); if (got) return got; await new Promise(resolve => setTimeout(resolve, 50)); } return read(); };
function ownCase(name, html) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-practice-int-'));
  fs.writeFileSync(path.join(dir, 'form.html'), html);
  return {name, dir, pages: [{url: `https://jobs.example.com/${name}/apply`, file: 'form.html'}]};
}

test('a form that stops its own submit and a form that posts are both caught; a password stays hidden; nothing outside the rule resolves', TEST_CAP, clocked(TEST_MS, async () => {
  const cases = [
    ownCase('stops', '<body><form onsubmit="return false"><input name="email" value="x@y.test"><input name="secret" type="password" value="hunter2"><button type="submit">Send</button></form></body>'),
    ownCase('posts', '<body><form action="/receive" method="post"><input name="email" value="p@q.test"><button type="submit">Send</button></form></body>'),
    loadCases(['aldi-apply-outside-sketch-1'])[0],
  ];
  const server = await startPractice({cases});
  at('starting Chromium with the practice host rule');
  const browser = await chromium.launch({headless: true, args: [`--host-resolver-rules=${server.hostRules()}`, '--ignore-certificate-errors']});
  onHang(() => browser.close());
  try {
    const page = await browser.newPage();
    at('the form that stops its own submit');
    await page.goto('https://jobs.example.com/stops/apply');
    await page.click('button[type=submit]');
    const first = await waitFor(() => server.caught().find(e => e.path === '/stops/apply'));
    assert.deepEqual(first.fields, [['email', 'x@y.test'], ['secret', '[hidden]']]);
    at('the form that posts');
    await page.goto('https://jobs.example.com/posts/apply');
    await page.click('button[type=submit]');
    const second = await waitFor(() => server.caught().find(e => e.path === '/posts/apply' && e.posted));
    assert.deepEqual([second.postedTo, second.fields], ['/receive', [['email', 'p@q.test']]]);
    assert.equal(server.caught().filter(e => e.path === '/posts/apply').length, 1, 'the script and the post are one submission');
    at('a recorded case with a real action');
    await page.goto(cases[2].pages.find(entry => entry.file === 'form.html').url);
    await page.fill('#first', 'Test'); await page.fill('#last', 'Person'); await page.fill('#mail', 'a@b.test');
    await page.click('button[type=submit]');
    const third = await waitFor(() => server.caught().find(e => e.fields.some(([, v]) => v === 'a@b.test')));
    assert.ok(third, 'a recorded form is caught too');
    at('the positive control: a real public name does not resolve');
    const outside = await page.goto('https://example.org/', {timeout: 8000}).then(() => 'loaded', () => 'refused');
    assert.equal(outside, 'refused');
  } finally { await browser.close(); await server.close(); }
}));
