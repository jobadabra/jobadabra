// Actual review and location callbacks preserve write safety and raw values while localizing owned display instructions.
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {test,afterEach} from 'node:test';
import {setLocale,SUPPORTED_LOCALES} from '../../../i18n/index.js';
const lib=new URL('../../../lib/',import.meta.url).href;
const state=()=>globalThis.__detailNotices;
const forbidden=name=>(...args)=>{state().forbidden.push([name,args]);throw Error('Forbidden boundary: '+name);};
const pass=()=>{};
const modules={
  'store/index.js':{openStore:()=>({page:()=>({outline:async()=>[],setText:forbidden('page write'),remove:forbidden('page remove')})})},
  'profile-sections.js':{SECTIONS:{availability:'Availability'},read:async()=>state().sections,save:async(_s,home,lines)=>{state().writes.push([home,lines]);if(!state().failWrite)state().sections[home]=lines;}},
  'profile-move.js':{itemsOf:()=>[],openConflicts:forbidden('conflicts read'),resolve:async()=>state().delegated,unsureKey:JSON.stringify},
  'question-formats.js':{kept:()=>({})},'answer-home.js':{HOME_NAMES:{availability:'Availability & compensation'},homeOf:forbidden('AI routing'),writeHome:forbidden('home write')},
  'open-wording.js':{worded:forbidden('AI wording')},'missing-facts.js':{byId:()=>null},'fact-asks.js':{},
  'answer-clarity.js':{keepAsIs:(_s,ref)=>state().kept.push(ref)},'contact-review.js':{answer:async()=>state().delegated},'contact.js':{},'cv-queue.js':{answer:async()=>state().delegated},
  'eligibility-older.js':{folded:pass},'ai/anthropic-api.js':{anthropicApi:forbidden('paid AI')},'log.js':{log:pass},'profile-routing.js':{organize:forbidden('AI organize')},
  'locations-same.js':{settleSame:forbidden('AI same places')},'strategy-settings.js':{saveSettings:forbidden('shared settings write')},
  'backup.js':{run:forbidden('backup')},'set-aside.js':{keep:(_s,entries)=>state().aside.push(...entries),list:()=>[]},
  'question-ai.js':{claudeAi:forbidden('account AI')},'set-aside-undo.js':{undo:async()=>{throw Error(state().raw);}},
  'shared-read.js':{afterWrite:fn=>fn},
};
globalThis.__detailNoticeModules=modules;
const actual=new Set(['details-review.js','locations-store.js','locations-handlers.js','locations-move.js']);
// Why (7 Nov 2026): real exported callbacks run with every external dependency replaced; assertions after callbacks catch swallowed boundary failures.
registerHooks({load(url,context,next){
  if(!url.startsWith(lib)||actual.has(url.slice(lib.length)))return next(url,context);
  const name=url.slice(lib.length),exports=modules[name];
  if(!exports)throw Error('Unstubbed dependency: '+name);
  const source=Object.entries(exports).map(([key,value])=>typeof value==='function'?`export const ${key}=(...args)=>globalThis.__detailNoticeModules[${JSON.stringify(name)}][${JSON.stringify(key)}](...args);`:`export const ${key}=${JSON.stringify(value)};`).join('\n');
  return{format:'module',shortCircuit:true,source};
}});
const review=await import('../../../lib/details-review.js');
const locations=await import('../../../lib/locations-store.js');
const {registerLocationsHandlers}=await import('../../../lib/locations-handlers.js');
afterEach(()=>setLocale('en'));
function rig(t) {
  const s={forbidden:[],writes:[],aside:[],kept:[],sections:{availability:[{label:'原文 {count}',value:'Müller this Mac <keep>',kind:'text',note:'raw note'}]},settings:{locationsMovedAt:'already',locationsConflicts:[]},search:{locations:{country_wide:['old raw']}}};
  globalThis.__detailNotices=s;
  t.mock.method(globalThis,'fetch',forbidden('network'));
  t.after(()=>assert.deepEqual(s.forbidden,[],'caught callbacks cannot hide forbidden access'));
  const storage={settings:()=>s.settings,saveSettings:patch=>{s.writes.push(['settings',patch]);Object.assign(s.settings,patch);},
    secret:forbidden('secret'),readText:()=>JSON.stringify(s.search),writeText:(_file,text)=>{s.writes.push(['search',JSON.parse(text)]);if(!s.failWrite)s.search=JSON.parse(text);}};
  const handlers={};registerLocationsHandlers({ipcMain:{handle:(name,fn)=>handlers[name]=(...args)=>fn(null,...args)},storage,DEMO:false,needsNotion:()=>false,ai:()=>({}),log:pass});
  return{s,storage,handlers};
}
const key=(kind,ref={})=>'details:'+kind+':'+JSON.stringify(ref);
test('real review errors switch languages and stale choices never write',async t=>{
  const {s,storage}=rig(t);setLocale('de');
  assert.deepEqual(await review.answer(storage,key('which'),'raw'),{ok:false,error:'Wähle einen der Werte aus'});
  const cases=[['where',{},'raw'],['missing',{id:'gone'},'raw'],['taught',{page:'answers'},''],['taught',{page:'answers'},'raw'],['check',{kind:'language'},''],['check',{part:0},''],['unclear',{},'']];
  for(const [kind,ref,value] of cases){const de=await review.answer(storage,key(kind,ref),value);setLocale('en');const en=await review.answer(storage,key(kind,ref),value);assert.equal(de.ok,false);assert.notEqual(de.error,en.error,kind);setLocale('de');}
  assert.deepEqual(s.writes,[]);
});
test('actual section writes keep raw facts and failed read-back keeps flags',async t=>{
  const {s,storage}=rig(t);const raw='工程師 {count} this Mac <keep>';
  for(const locale of SUPPORTED_LOCALES){setLocale(locale);assert.deepEqual(await review.answer(storage,key('open',{home:'availability',label:'原文 {count}'}),raw),{ok:true,homeName:'Availability & compensation'});}
  assert.equal(s.writes.length,7);
  for(const [,lines] of s.writes)assert.deepEqual(lines,[{label:'原文 {count}',value:raw,kind:'text',note:'raw note'}]);
  s.failWrite=true;setLocale('ru');const result=await review.answer(storage,key('open',{home:'availability',label:'原文 {count}'}),'different');
  assert.equal(result.ok,false);assert.notEqual(result.error,'It did not save; nothing else changed');assert.equal(s.sections.availability[0].value,raw);
});
test('machine values and keep decisions remain canonical',async t=>{
  const {s,storage}=rig(t);setLocale('ro');assert.equal(review.KEEP,'Keep where it is');assert.equal(review.PREFIX,'details:');
  assert.deepEqual(review.KINDS,['which','check','open','unclear','missing','contact','cvcheck','taught','conflict']);
  assert.deepEqual(await review.answer(storage,key('where',{page:'profile'}),review.KEEP),{ok:true,homeName:'Profile'});
  const ref={home:'availability',label:'A fact',value:'Raw fact'};
  assert.deepEqual(await review.answer(storage,key('unclear',ref),review.KEEP_AS_IS),{ok:true,homeName:'Availability & compensation'});assert.deepEqual(s.kept,[ref]);
});
test('actual location IPC preserves choices, raw errors, write values and queue safety',async t=>{
  const {s,handlers}=rig(t);setLocale('fr');
  assert.deepEqual(await handlers.resolveLocationConflict('acceptable','nonsense'),{ok:false,error:'Unknown choice'});
  const stale=await handlers.resolveLocationConflict('acceptable','profile');assert.equal(stale.ok,false);assert.notEqual(stale.error,'That choice is no longer open');assert.deepEqual(s.writes,[]);
  const conflict={kind:'acceptable',strategy:['old raw'],strategyFragments:['old raw'],profile:['東京 {count} this Mac']};s.settings.locationsConflicts=[conflict];s.failWrite=true;
  const failed=await handlers.resolveLocationConflict('acceptable','profile');assert.equal(failed.ok,false);assert.notEqual(failed.error,'It did not save; nothing else changed');assert.deepEqual(s.settings.locationsConflicts,[conflict]);assert.equal(s.settings.searchChangedAt,undefined);
  s.failWrite=false;assert.deepEqual(await handlers.resolveLocationConflict('acceptable','profile'),{ok:true});assert.deepEqual(s.search.locations.country_wide,conflict.profile);assert.deepEqual(s.settings.locationsConflicts,[]);assert.ok(s.settings.searchChangedAt);
  s.raw='Provider 原文 {count} this Mac <keep>';assert.deepEqual(await handlers.undoSetAside('raw-id'),{ok:false,error:s.raw});
});
test('actual restore methods localize UI failures without changing restore values',async t=>{
  const {s,storage}=rig(t);setLocale('it');const missing=await locations.restoreLocation(storage,{});assert.equal(missing.ok,false);assert.notEqual(missing.error,'That list has no place to go back to');assert.deepEqual(s.writes,[]);
  const entry={restore:{key:'country_wide',list:['原文 {count}'],relocation:['yes']}};s.failWrite=true;
  const failed=await locations.restoreLocation(storage,entry);assert.equal(failed.ok,false);assert.notEqual(failed.error,'It did not save');
  s.failWrite=false;assert.deepEqual(await locations.restoreLocation(storage,entry),{ok:true});assert.deepEqual(s.search.locations.country_wide,entry.restore.list);assert.deepEqual(s.search.locations.relocation,['yes']);
});
test('seven catalogs have exact key, placeholder and plural parity at invocation time',async t=>{
  rig(t);const {catalogs,t:message}=await import('../../../i18n/detail-notices.js');
  const params=value=>[...new Set((typeof value==='string'?[value]:Object.values(value)).flatMap(text=>[...text.matchAll(/\{(\w+)\}/g)].map(match=>match[1])))].sort();
  for(const locale of SUPPORTED_LOCALES){
    assert.deepEqual(Object.keys(catalogs[locale]).sort(),Object.keys(catalogs.en).sort());setLocale(locale);
    for(const [key,value] of Object.entries(catalogs[locale])){
      assert.deepEqual(params(value),params(catalogs.en[key]),locale+'.'+key);
      if(typeof value==='object')for(const category of new Intl.PluralRules(locale).resolvedOptions().pluralCategories)assert.ok(value[category]||value.other);
      for(const count of [0,1,2,5,20])assert.equal(message('detailNotice.'+key,{count}),typeof value==='string'?value:value[new Intl.PluralRules(locale).select(count)]||value.other);
    }
  }
  assert.equal(Object.values(catalogs.en).every(value=>typeof value==='string'),true,'instructions have no numeric counts or plural templates');
});
test('all authored review guards use display catalogs while heading and line safety remain intact',async t=>{
  const {s,storage}=rig(t);const {t:message}=await import('../../../i18n/detail-notices.js');
  for(const locale of SUPPORTED_LOCALES){setLocale(locale);
    for(const [kind,ref,value,id] of [
      ['which',{},'x','pickValue'],['where',{},'x','pickHome'],['open',{page:'profile',label:'gone'},'x','alreadyAnswered'],
      ['missing',{id:'gone'},'x','questionClosed'],['invalid',{},'x','questionClosed'],['taught',{},'','typeAnswer'],
      ['conflict',{page:'answers'},'x','lineChanged'],['check',{},'','pickParts'],['check',{part:0},'','pickLevel'],
      ['check',{part:0,home:'availability',label:'gone',was:'English'},'C1','lineChanged'],
      ['unclear',{},'','typeOrKeep'],['unclear',{label:'Summary',value:'Summary'},review.KEEP_AS_IS,'heading'],
      ['unclear',{page:'profile',label:'gone',value:'x'},'new','lineChanged']]){
      assert.deepEqual(await review.answer(storage,key(kind,ref),value),{ok:false,error:message('detailNotice.'+id)},locale+'.'+id);
    }
  }
  assert.deepEqual(s.writes,[]);assert.deepEqual(s.kept,[]);
});
test('actual location errors preserve external failures and unknown validation text',async t=>{
  const {s,storage}=rig(t);s.settings.locationsConflicts=[{kind:'acceptable',strategy:['A'],profile:['B']}];setLocale('es');
  const raw='Provider 原文 {count} this Mac <keep>';
  await assert.rejects(locations.resolveLocation(storage,'acceptable','profile',{write:async()=>{throw Error(raw);}}),error=>error.message===raw);
  const invalid=await locations.resolveLocation(storage,'acceptable','invalid');setLocale('en');assert.deepEqual(await locations.resolveLocation(storage,'acceptable','invalid'),invalid);assert.equal(invalid.ok,false);assert.deepEqual(s.writes,[]);
});

test('delegated producer errors pass through unchanged pending their separate presentation pass',async t=>{
  const {s,storage}=rig(t);s.settings.profileConflicts=[{topic:'raw topic',home:'availability',choices:[{value:'raw pick'}]}];
  for(const locale of SUPPORTED_LOCALES){setLocale(locale);
    for(const [kind,ref,value,error] of [['which',{topic:'raw topic'},'raw pick','That choice is no longer open'],['contact',{field:'email'},'raw','That question is no longer open'],['cvcheck',{fact:'raw-id'},'raw','It did not save; nothing else changed']]){
      s.delegated={ok:false,error};assert.deepEqual(await review.answer(storage,key(kind,ref),value),s.delegated);
    }
  }
  assert.deepEqual(s.writes,[]);
});
