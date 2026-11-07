// App-owned wrapper translations preserve applicant/employer values and typed errors keep external reasons verbatim.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {catalogs} from '../../../../extension/i18n.js';
import {panelJobFailure} from '../../../../extension/display-errors.js';
const read=file=>fs.readFileSync(new URL('../../../../extension/'+file,import.meta.url),'utf8');
test('suggestion and popup wrappers interpolate external values once in seven languages',()=>{
  const expression=read('page/fill-menus.js').match(/const suggested = (.*);/)[1];
  const external='<Candidate> {banner} $& {answer}';
  for(const [locale,messages] of Object.entries(catalogs)) {
    const suggested=new Function('window',`return (${expression});`)({__jobadabraDisplayWords:{suggested:messages['menu.suggested']}});
    assert.equal(suggested(external),messages['menu.suggested'].replace('{answer}',()=>external));
    assert.ok(suggested(external).includes(external));
    const closed=globalThis.__jobadabraFormatDisplayMessage(messages,catalogs.en,locale,'step.closedPopup',{banner:external});
    assert.equal(closed,messages['step.closedPopup'].replace('{banner}',()=>external));
    assert.ok(closed.includes(external));
  }
  assert.equal((read('page/fill-menus.js').match(/badge.textContent = suggested\(/g)||[]).length,2);
  assert.match(read('fill-flow-read.js'),/displayText\('step.closedPopup',\{banner:banner.slice\(0,30\)\}\)/);
});
test('only extension-authored error wrappers carry display identifiers',()=>{
  const external='Employer failure {reason} <keep>';
  assert.deepEqual(panelJobFailure(Error(external),false),{why:external});
  assert.deepEqual(panelJobFailure(Error(external),true),{why:catalogs.en['error.noApp'],whyKey:'error.noApp'});
  assert.deepEqual(panelJobFailure({status:404,message:external},true),{why:''});
  const retry=panelJobFailure({status:503,message:external},true);
  assert.equal(retry.whyKey,'error.jobLoad');assert.equal(retry.whyValues.reason,external);
  for(const [locale,messages] of Object.entries(catalogs)) {
    const display=globalThis.__jobadabraFormatDisplayMessage(messages,catalogs.en,locale,retry.whyKey,retry.whyValues);
    assert.ok(display.includes(external),locale);
  }
});
