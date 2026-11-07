// Verify extension display boundaries preserve canonical diagnostics and raw site/user values without network or browser access.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import {createI18n,catalogs,locales} from '../../../../extension/i18n.js';
import {readWords,renderRead,setReadReason,readStateReason,readProtocolState,readFilterSummary,readNoCards,readAIWay,readBlockedReason,readEmptyReason,readFailureReason} from '../../../../extension/read-display.js';
import {authoredError,displayError} from '../../../../extension/display-errors.js';
import {plainWhy} from '../../../../extension/ai-reply.js';
import {TIPS} from '../../../../extension/tips-pool.js';
const uiFor=locale=>createI18n({get:async()=>({extensionLanguage:locale}),set:async()=>{}});

test('read display translates typed frames while canonical reasons and external braces stay unchanged',async()=>{
  const raw='<site> {count}', state={stopped:''};
  setReadReason(state,'the site needs you: '+raw,'read.needsPerson',{reason:raw});
  assert.equal(state.stopped,'the site needs you: '+raw);
  for(const locale of locales){const ui=await uiFor(locale);assert.ok(readStateReason(state,ui.t).includes(raw));assert.equal(renderRead(raw,ui.t),raw);}
  const ui=await uiFor('de');
  assert.equal(renderRead(readWords('reading page 2…','read.page',{page:2}),ui.t),'Seite 2 wird gelesen…');
  assert.equal(readStateReason({stopped:raw},ui.t),raw);
  setReadReason(state,'no next page','read.noNext');
  assert.deepEqual(readProtocolState(state),{stopped:'no next page'});
  assert.equal(state.stopped,'no next page');assert.equal(readStateReason(state,ui.t),'Keine nächste Seite');
});

test('authored error metadata translates display only and unknown reasons remain raw',async()=>{
  const ui=await uiFor('de'),raw='External {count} <reason>';
  const error=authoredError('the app answered 503','error.appStatus',{status:503});
  assert.equal(error.message,'the app answered 503');assert.equal(plainWhy(error),'the app answered 503');
  assert.equal(displayError(error,ui.t),'Die App antwortete mit 503');
  assert.equal(displayError(new Error(raw),ui.t),raw);
  assert.equal(displayError(new TypeError('Cannot read properties of undefined'),ui.t),ui.t('error.unexpected'));
});

test('all45 extension tips have translated bodies and callback locale redraw keeps selected ID without another request',async()=>{
  const tips=TIPS.filter(tip=>!tip.for);assert.equal(tips.length,45);
  for(const locale of locales)for(const tip of tips){assert.equal(typeof catalogs[locale]['tip.'+tip.id],'string',locale+tip.id);if(locale==='en')assert.equal(catalogs.en['tip.'+tip.id],tip.text);}
  let locale='de',change,requests=0;const text={},box={},label=[];
  const context=vm.createContext({window:{},console});
  context.window.__jobadabraPanelI18n={t:(key,fallback)=>catalogs[locale][key]??fallback,onChange:fn=>{change=fn;}};
  vm.runInContext(fs.readFileSync(new URL('../../../../extension/panel-tips.js',import.meta.url),'utf8'),context);
  const ask=context.window.__jobadabraPanelTips({send:async()=>{requests++;return{ok:true,id:'tailor',text:catalogs.en['tip.tailor'],evidence:'advice'};},host:'fictional.example',prefer:()=>'',text,box,label:e=>label.push(e)});
  await ask();assert.equal(text.textContent,catalogs.de['tip.tailor']);assert.equal(box.hidden,false);
  locale='ro';change();assert.equal(text.textContent,catalogs.ro['tip.tailor']);assert.equal(requests,1);assert.deepEqual(label,['advice','advice']);
});

test('Chrome manifest description has seven native catalogs and unchanged build base',()=>{
  const manifest=JSON.parse(fs.readFileSync(new URL('../../../../extension/manifest.json',import.meta.url)));
  assert.equal(manifest.version,'0.9');assert.equal(manifest.default_locale,'en');assert.equal(manifest.description,'__MSG_description__');
  for(const locale of locales){const data=JSON.parse(fs.readFileSync(new URL(`../../../../extension/_locales/${locale}/messages.json`,import.meta.url)));assert.ok(data.description.message.length>20);}
});

test('actual read banner callback localizes the display but sends identical canonical protocol words',async()=>{
  // Fake Chrome only: no browser profile, live app route, AI or network is reachable.
  globalThis.chrome={storage:{local:{get:async()=>({extensionLanguage:'de'})},session:{get:async()=>({}),set:async()=>{}},onChanged:{addListener:()=>{}}},runtime:{onMessage:{addListener:()=>{}}},tabs:{onUpdated:{addListener:()=>{}},onRemoved:{addListener:()=>{}}}};
  const {tellStep,startBoard}=await import('../../../../extension/visit.js');
  await new Promise(resolve=>setImmediate(resolve));
  const banners=[],payloads=[];
  const raw='reading page 2…';
  await tellStep(7,{},'fictional',readWords(raw,'read.page',{page:2}),async(_id,_fn,args)=>{banners.push(args[0]);},async(_config,path,init)=>{payloads.push({path,body:JSON.parse(init.body)});});
  assert.deepEqual(banners,['Jobadabra: Seite 2 wird gelesen…']);
  assert.deepEqual(payloads,[{path:'/extension/visit-state',body:{ticket:'fictional',words:raw}}]);
  const external='<employer> {page}';
  await tellStep(7,{},'',external,async(_id,_fn,args)=>{banners.push(args[0]);},async()=>assert.fail('unmanaged path must not send'));
  assert.equal(banners.at(-1),'Jobadabra: '+external);
  globalThis.chrome.tabs.get=async()=>({url:'https://fictional.example/own-tab'});
  const refusal=await startBoard(7,false);assert.equal(refusal.error,'this is not a tab the app opened to read');assert.equal(refusal.errorKey,'read.notManaged');
});

test('actual pair failure retains canonical status text and supplies typed localized display',async()=>{
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>({ok:false,status:503});
  try {
    const {pair}=await import('../../../../extension/flow.js');
    await assert.rejects(pair(),error=>{assert.equal(error.message,'the app answered 503');assert.equal(error.displayKey,'error.appStatus');assert.deepEqual(error.displayValues,{status:503});return true;});
  }finally{globalThis.fetch=originalFetch;}
});


test('read display builders preserve canonical branches and isolate authored suffixes from external text',async()=>{
  const ui=await uiFor('de'),raw='<site> {count}';
  assert.equal(readBlockedReason(true).raw,'the site asks you to sign in: do it, then click again');
  assert.equal(readBlockedReason(false).key,'read.check');
  assert.equal(readAIWay(raw).raw,'AI: '+raw);assert.ok(renderRead(readAIWay(raw),ui.t).includes(raw));
  const state={filters:[raw]};assert.equal(readFilterSummary(state,ui.t).raw,'filters set: '+raw);
  assert.equal(readEmptyReason(state,false,ui.t).raw,'no jobs on this list with your place filter ('+raw+')');
  assert.equal(readFailureReason(new Error(raw)).raw,raw);assert.equal(readFailureReason(new Error(raw)).key,null);
  const message=readNoCards({knownList:false,seen:{cards:[{},{}]},asked:true,banner:raw});
  assert.equal(message.raw,'no job cards on this page (2 repeated items seen, none of them jobs by Claude\'s reading; a cookie banner was still open, closed with "'+raw+'")');
  assert.ok(renderRead(message,ui.t).includes(raw));assert.ok(!renderRead(message,ui.t).includes('repeated items'));
});
