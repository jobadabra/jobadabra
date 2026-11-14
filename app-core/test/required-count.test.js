// The page panel's "N of M" counts the required questions the page marks (extension/required-count.js), played on the real Canonical Greenhouse fill (14 Nov 2026, the twin's trace; labels cut to 50 characters).
// Why (14 Nov 2026): the same form read 14 of 25 in the panel and 11 of 19 elsewhere; the panel counted optional fields Claude filled as required. The fill card (fill-card.js) is the learning digest's own measure and keeps its own count (fill-card.test.js).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
globalThis.window = globalThis;   // a content script's world
await import('../../extension/required-count.js');
import { PANEL_FILES } from '../../extension/panel-files.js';

// [label, type, required, filled, reason]
const CANONICAL = [
  ["First Name","text",1,1,"your details"],
  ["Last Name","text",1,1,"your details"],
  ["Email","text",1,1,"your details"],
  ["Country","combobox",0,1,"Claude (on the page)"],
  ["Phone","tel",0,1,"your details"],
  ["School","combobox",0,0,"dropdown clicked, but no option matched"],
  ["Degree","combobox",0,1,"dropdown clicked for you"],
  ["Discipline","combobox",0,1,"dropdown clicked for you"],
  ["During this application process I agree to use onl","combobox",1,0,"legal/consent: always your choice"],
  ["Where did you gain your most notable site reliabil","textarea",1,1,"drafted: review it"],
  ["Where did you gain your most notable software deve","textarea",1,1,"outline: add your own details"],
  ["Describe your homelab or any self-hosted services ","combobox",0,0,"written: your own words to write"],
  ["How did you perform in mathematics at high school?","combobox",1,0,"no answer in the kit, Profile or your details"],
  ["How did you perform in your native language at hig","combobox",1,0,"no answer in the kit, Profile or your details"],
  ["Please share your rationale or evidence for the hi","textarea",1,0,"written: your own words to write"],
  ["What was your bachelor's university degree result,","text",1,0,"no answer in the kit, Profile or your details"],
  ["We require all colleagues to meet in person 2-4 ti","combobox",1,0,"proposed for you to confirm"],
  ["Which region/timezone will you be working from?","text",1,0,"proposed for you to confirm"],
  ["In which country do you currently work?","combobox",1,1,"dropdown clicked for you"],
  ["Website","text",0,0,"a detail of yours not saved yet (website)"],
  ["LinkedIn Profile","text",0,1,"Claude (on the page)"],
  ["Please confirm that you have read and agree to Can","combobox",1,0,"dropdown clicked, but no option matched"],
  ["In the past ten years, looking only at the time si","combobox",1,1,"dropdown clicked for you"],
  ["Which gender do you identify as?","combobox",1,1,"Claude (on the page)"],
  ["Please indicate your nationality","combobox",1,0,"demographic: your own choice"],
  ["Please indicate your race or ethnicity","combobox",1,1,"Claude (on the page)"],
  ["Gender","combobox",0,1,"Claude (on the page)"],
  ["Are you Hispanic/Latino?","combobox",0,0,"dropdown clicked, but no option matched"],
  ["Veteran Status","combobox",0,1,"Claude (on the page)"],
  ["Disability Status","combobox",0,1,"Claude (on the page)"],
  ["CV","file",1,1,"your CV"]
];
const trace = CANONICAL.map(([label, type, required, filled, reason]) => ({ label, type, required: !!required, outcome: filled ? 'filled' : 'left', reason }));
// The panel reads the same page as entries: {required, filled, el.type}; every control is there, optional ones too.
const entries = trace.map((row) => ({ required: row.required, filled: row.outcome === 'filled', ai: row.reason.startsWith('Claude'), el: { type: row.type } }));
const panelCount = () => window.__jobadabraRequiredCount(entries.map((entry) => ({ required: entry.required, filled: entry.filled, type: entry.el.type })));

test('the panel counts every required question the page marks, consents and own-words included, the upload slot aside', () => {
  assert.deepEqual(panelCount(), { required: 18, filled: 9, left: 9 });
});

test('optional fields Claude filled are never counted as required', () => {
  const optionalAi = entries.filter((entry) => !entry.required && entry.ai);
  assert.ok(optionalAi.length > 0, 'the form has optional fields Claude filled: the old panel count added them');
  const required = entries.filter((entry) => entry.required && entry.el.type !== 'file');
  assert.equal(panelCount().required, required.length);
});

test('the panel loads the shared count before review.js and review.js reads it', () => {
  assert.ok(PANEL_FILES.indexOf('required-count.js') >= 0 && PANEL_FILES.indexOf('required-count.js') < PANEL_FILES.indexOf('review.js'));
  const review = fs.readFileSync(new URL('../../extension/review.js', import.meta.url), 'utf8');
  assert.match(review, /__jobadabraRequiredCount/);
  assert.match(review, /\['PanelI18n', 'RequiredCount'/, 'a partial injection is named, not thrown (the helper guard lists it)');
});
