// Real delegated answer/resolve callbacks use isolated stores and prove localized instructions do not alter raw writes or safety.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test,afterEach} from 'node:test';
import {createStorage} from '../../../lib/storage.js';
import {openStore} from '../../../lib/store/index.js';
import * as contact from '../../../lib/contact.js';
import * as contactReview from '../../../lib/contact-review.js';
import * as cvQueue from '../../../lib/cv-queue.js';
import * as profile from '../../../lib/profile-move.js';
import * as sections from '../../../lib/profile-sections.js';
import {HOME_NAMES} from '../../../lib/answer-home.js';
import {setLocale,SUPPORTED_LOCALES} from '../../../i18n/index.js';
import {t as message} from '../../../i18n/detail-notices.js';
afterEach(()=>setLocale('en'));
function rig(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'delegated-notices-')),trips=[],writes=[];
  const fail=name=>(...args)=>{trips.push([name,args]);throw Error('Forbidden '+name);};
  const storage=createStorage(dir,{encrypt:fail('encryption'),decrypt:fail('decryption')});
  storage.saveSettings({store:'sqlite',telemetry:false});
  storage.secret=fail('secret');t.mock.method(globalThis,'fetch',fail('network/AI'));
  const write=storage.writeText.bind(storage);let dropping=false;
  storage.writeText=(file,value)=>{writes.push([file,value]);if(!dropping)write(file,value);};
  t.after(()=>{assert.deepEqual(trips,[],'assert outside caught callbacks: no accounts, secret or network/AI access');fs.rmSync(dir,{recursive:true,force:true});});
  return{storage,writes,drop:value=>{dropping=value;}};
}
test('real delegated validation errors use the active locale without any writes',async t=>{
  const {storage,writes}=rig(t);
  for(const locale of SUPPORTED_LOCALES){setLocale(locale);
    const result=await contactReview.answer(storage,'email','');assert.deepEqual(result,{ok:false,error:message('detailNotice.typeAnswerNow')});
    if(locale==='de')assert.equal(result.error,'Gib die Antwort ein');
    for(const [run,key] of [
      [()=>contactReview.answer(storage,'not-a-field','raw'),'questionClosed'],
      [()=>contactReview.answer(storage,'full_name','raw'),'questionClosed'],
      [()=>cvQueue.answer(storage,{fact:'notice'},''),'typeAnswerNow'],
      [()=>cvQueue.answer(storage,{contact:'not-a-field'},'raw'),'questionClosed'],
      [()=>cvQueue.answer(storage,{fact:'gone'},'raw'),'questionClosed'],
      [()=>profile.resolve(storage,'gone',0),'choiceClosed'],
      [()=>profile.restoreFact(storage,{restore:{home:'gone'}}),'restoreFactMissing']])assert.deepEqual(await run(),{ok:false,error:message('detailNotice.'+key)},locale+'.'+key);
  }
  assert.deepEqual(writes,[]);
});
test('real contact and CV contact answers preserve normalization, Home names and raw values in every locale',async t=>{
  const {storage,writes}=rig(t);await contact.save(storage,{email:'fictional@example.test',phone:'raw phone'});
  for(const locale of SUPPORTED_LOCALES){setLocale(locale);
    const before=writes.length,fields=Object.keys(await contact.read(storage)).length;assert.deepEqual(await contactReview.answer(storage,'first_name','  Müller\n  this Mac {count} <keep>  '),{ok:true,homeName:'Your details → Contact details'});
    assert.equal((await contact.read(storage)).first_name,'Müller this Mac {count} <keep>');assert.equal((await contact.read(storage)).phone,'raw phone');assert.equal(writes.length-before,fields+1,'remove each saved field once, then one insert');
    const cvBefore=writes.length,cvFields=Object.keys(await contact.read(storage)).length;
    assert.deepEqual(await cvQueue.answer(storage,{contact:'first_name'},'  工程師 {count} this Mac  '),{ok:true,homeName:'Your details → Contact details'});
    assert.equal((await contact.read(storage)).first_name,'工程師 {count} this Mac');assert.equal(writes.length-cvBefore,cvFields+1);
  }
});
test('actual failed contact read-back localizes errors and preserves stored facts',async t=>{
  const {storage,writes,drop}=rig(t);await openStore(storage).page('profile').write('## 📇 Contact details\n');writes.length=0;drop(true);
  setLocale('ru');for(const run of [()=>contactReview.answer(storage,'email','fictional@example.test'),()=>cvQueue.answer(storage,{contact:'email'},'fictional@example.test')])assert.deepEqual(await run(),{ok:false,error:message('detailNotice.saveFailed')});
  assert.equal(writes.length,2,'one attempted insert per answer, existing heading retained');assert.deepEqual(await contact.read(storage),{});
});
test('actual CV fact write and failed verification keep kind, label, raw value and exact save count',async t=>{
  const {storage}=rig(t),calls=[];
  const save=async(...args)=>{calls.push(args.slice(1,3));return sections.save(...args);};
  setLocale('fr');assert.deepEqual(await cvQueue.answer(storage,{fact:'notice'},'  2 months  ',{save}),{ok:true,homeName:HOME_NAMES.availability});
  assert.deepEqual(calls, [['availability',[{label:'Notice period',value:'2 months',kind:'duration'}]]]);
  let failures=0;assert.deepEqual(await cvQueue.answer(storage,{fact:'notice'},'3 months',{save:async()=>{failures++;}}),{ok:false,error:message('detailNotice.saveFailed')});assert.equal(failures,1);assert.equal((await sections.read(storage)).availability[0].value,'2 months');
});
test('actual profile conflict guards never remove sources before destination verification',async t=>{
  const {storage,writes}=rig(t);const raw='工程師 {count} this Mac <keep>';
  await openStore(storage).page('profile').write('- Raw fact: '+raw+'\n');await openStore(storage).page('answers').write('- Raw fact: Other raw\n');
  const conflict={topic:'raw topic',home:'availability',choices:[{label:'Raw fact',value:raw,page:'profile'},{label:'Raw fact',value:'Other raw',page:'answers'}]};
  storage.saveSettings({profileConflicts:[conflict]});const before=await openStore(storage).page('profile').text(),answers=await openStore(storage).page('answers').text();writes.length=0;let attempted=0;
  setLocale('ro');assert.deepEqual(await profile.resolve(storage,'raw topic',0,{save:async()=>{attempted++;}}),{ok:false,error:message('detailNotice.saveFailed')});assert.equal(attempted,1);assert.deepEqual(writes,[]);assert.deepEqual(storage.settings().profileConflicts,[conflict]);
  assert.equal(await openStore(storage).page('profile').text(),before);assert.equal(await openStore(storage).page('answers').text(),answers);
  const saves=[];assert.deepEqual(await profile.resolve(storage,'raw topic',0,{save:async(...args)=>{saves.push(args.slice(1,3));return sections.save(...args);}}),{ok:true});assert.deepEqual(saves,[['availability',[{label:'Raw fact',value:raw}]]]);assert.deepEqual(storage.settings().profileConflicts,[]);assert.equal((await sections.read(storage)).availability[0].value,raw);
});
test('actual fact restore preserves raw values and reports verification failures without changing flags',async t=>{
  const {storage}=rig(t);const raw='原文 this Mac {count} <keep>',entry={restore:{home:'availability',label:'Raw label',value:raw}};
  setLocale('it');let attempts=0;assert.deepEqual(await profile.restoreFact(storage,entry,{save:async()=>{attempts++;}}),{ok:false,error:message('detailNotice.restoreFailed')});assert.equal(attempts,1);
  assert.deepEqual(await profile.restoreFact(storage,entry),{ok:true});assert.deepEqual((await sections.read(storage)).availability,[{label:'Raw label',value:raw}]);
  attempts=0;assert.deepEqual(await profile.restoreFact(storage,entry,{save:async()=>{attempts++;}}),{ok:true});assert.equal(attempts,0,'existing fact does not write twice');
});
test('delegated methods preserve raw upstream write errors instead of translating arbitrary text',async t=>{
  const {storage}=rig(t),raw='Provider 原文 this Mac {count} <keep>',failure=Error(raw);let attempts=0;
  setLocale('ru');const save=async()=>{attempts++;throw failure;};
  storage.saveSettings({profileConflicts:[{topic:'raw',home:'availability',choices:[{label:'Label',value:'Raw answer',page:'profile'}]}]});
  for(const run of [()=>cvQueue.answer(storage,{fact:'notice'},'2 months',{save}),()=>profile.resolve(storage,'raw',0,{save}),()=>profile.restoreFact(storage,{restore:{home:'availability',label:'Raw',value:'Raw'}},{save})])await assert.rejects(run(),error=>error===failure&&error.message===raw);
  assert.equal(attempts,3);storage.writeText=()=>{throw failure;};
  for(const run of [()=>contactReview.answer(storage,'email','fictional@example.test'),()=>cvQueue.answer(storage,{contact:'email'},'fictional@example.test')])await assert.rejects(run(),error=>error===failure&&error.message===raw);
});
