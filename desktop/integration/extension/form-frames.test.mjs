// Apply readiness's light read says "a check may be in the form" only for a frame among the form's own controls, never for a frame pinned to the screen (#4325).
// Why (14 Nov 2026, owner: "So it doesn't really work"): a Greenhouse board form's only visible frame is the invisible reCAPTCHA badge (256x60, position fixed,
// outside the form, asks nothing of the person); it alone made the read "a check may be in the form", so the form's questions were never matched.
// The SHAPE, not a site: a corner badge in a fixed box, and a checkbox-style check inside the form. A real Chrome runs the extension's own count (page-reads.js shapeOfPage).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chromium} from '../../e2e/lib/visit-page.mjs';
import {shapeOfPage} from '../../../extension/page-reads.js';
import {verdictOf} from '../../../extension/triage-verdict.js';

const FIELDS = '<label for="first">First Name *</label><input id="first" required><label for="cv">CV</label><input id="cv" type="file"><button type="submit">Submit application</button>';
const BADGE = `<body style="height:3000px"><form>${FIELDS}</form>
  <div style="position:fixed;right:0;bottom:14px;width:256px;height:60px"><iframe title="check" srcdoc="badge" style="width:256px;height:60px;border:0"></iframe></div></body>`;
const IN_FORM = `<body><form>${FIELDS}<iframe title="check" srcdoc="tick the box" style="width:304px;height:78px;border:0"></iframe></form></body>`;
const FORM = {role: 'form', botCheck: false};   // the page-kind AI's answer on both pages: a form, no check covering the page

async function countsOn(html) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html);
    return await page.evaluate(shapeOfPage);
  } finally { await browser.close(); }
}

test('a frame pinned to the screen corner is not a check among the form: the form stays simple', async () => {
  const counts = await countsOn(BADGE);
  assert.equal(counts.frames, 1, 'positive control: the badge frame is on the page and visible');
  assert.equal(counts.formFrames, 0, 'the pinned badge was counted among the form\'s controls');
  assert.deepEqual(verdictOf(FORM, counts), {simple: true, why: ''});
});

test('a frame among the form\'s controls still makes the form "may need a check"', async () => {
  const counts = await countsOn(IN_FORM);
  assert.equal(counts.formFrames, 1);
  assert.deepEqual(verdictOf(FORM, counts), {simple: false, why: 'check'});
});
