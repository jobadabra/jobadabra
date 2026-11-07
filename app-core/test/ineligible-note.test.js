// "Didn't fill: <reason>" (extension/background.js ineligibleNote): the app's reply may carry no note (an error path); the extension must still show the note, not crash on an undefined script argument
// (10 Oct 2026, the Aldi replay: "Value is unserializable"). Source check, since the service worker cannot be loaded here; the recorded replays exercise it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {createI18n} from '../../extension/i18n.js';

test('an ineligible reply without a note still gets defined display text and the original Fill anyway controls', async () => {
  const background = fs.readFileSync(new URL('../../extension/background.js', import.meta.url), 'utf8');
  const source = background.match(/async function ineligibleNote\([^]*?\n\}/)[0];
  const ui = await createI18n({get:async()=>({})});
  const calls=[];
  const chrome={scripting:{executeScript:async request=>{calls.push(request);return[];}}};
  const note = new Function('displayText','tellPanel','chrome',source+'; return ineligibleNote;')((key,values)=>ui.t(key,values),async()=>false,chrome);
  for (const reason of [undefined,null,'','Employer reason <keep> {reason}']) for (const partly of [false,true]) {
    await note(7,reason,partly);
    const args=calls.at(-1).args;
    assert.ok(args.every(value=>typeof value==='string'),'Chrome receives only defined display strings');
    assert.deepEqual(args.slice(1),['Fill anyway','Close']);
    assert.equal(args[0],(partly?'Jobadabra filled only your details on this form: ':"Jobadabra didn't fill this form: ")+(reason || 'not eligible'));
  }
  const flow = ['../../extension/fill-tab-inputs.js', '../../extension/fill-tab-finish.js']
    .map(file => fs.readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n');
  assert.equal([...flow.matchAll(/note: ai\.eligibility_note,/g)].length, 0, 'every ineligible return has a fallback for the note');
});
