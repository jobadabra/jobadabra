// Real kit callbacks localize owned notices while fake boundaries record safety tripwires outside caught callbacks.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {registerHooks} from 'node:module';
import {test,afterEach} from 'node:test';
import {setLocale,SUPPORTED_LOCALES} from '../../../i18n/index.js';
import {catalogs,t as noticeText} from '../../../i18n/kit-notices.js';
const lib=new URL('../../../lib/',import.meta.url).href;
const root=()=>globalThis.__kitNoticeTest;
const record=(name,value)=>(...args)=>{root().calls.push([name,...args]);return typeof value==='function'?value(...args):value;};
const forbidden=name=>(...args)=>{root().forbidden.push([name,args]);throw Error('Forbidden real boundary: '+name);};
const modules={
  'apply.js':{pickUntailored:record('pick',jobs=>jobs),nothingToTailor:()=> 'canonical empty result'},
  'cv-import-at-upload.js':{ensure:forbidden('import CV')},
  'claude-code.js':{client:()=>root().missingAI?null:{fake:true}},
  'cv.js':{MODEL:'fake-model',baseCv:()=>root().missingCV?null:{source:'Fake base'},aboutFor:async()=>({fake:true}),
    tailor:async(_storage,_job,_key,options)=>{root().calls.push(['fake-tailor',options]);if(root().providerError)throw Error(root().providerError);return{usd:0.1,result:{changes:root().changes || ['one','two']}};},
    applyTailoring:()=>({cv:{name:'Candidate <keep>'},warnings:root().warnings,review:[]}),writeHtml:record('fake-html',()=>'/fictional/render.html'),
    save:record('fake-save'),savePages:record('fake-pages'),pdfPath:()=>'/fictional/result.pdf'},
  'cv-inplace-run.js':{prepare:forbidden('read real CV'),make:forbidden('edit real CV')},
  'experience.js':{withExtras:(_storage,base)=>base,knownText:()=> 'Canonical facts'},
  'files.js':{tailoredToApplication:async(...args)=>{root().calls.push(['fake-notion',...args]);return root().inNotion;}},
  'github.js':{syncDatabase:forbidden('cloud')},
  'store/files.js':{attachToJob:async(...args)=>{root().calls.push(['fake-store',...args]);return true;}},
  'notion-gate.js':{notionInUse:()=>root().notion},
  'job-letter-handlers.js':{registerJobLetterHandlers:()=>({makeFor:async()=>root().letter})},
  'ready-handlers.js':{registerReadyHandlers:ctx=>{root().ready=ctx;}},
  'strategy.js':{profileTexts:async()=>({profile:'Canonical profile'})},
  'log.js':{log:record('diagnostic')},
  'cv-docx.js':{currentDocx:forbidden('read DOCX')},'cv-docx-tailor.js':{makeDocx:forbidden('edit DOCX')},'office.js':{findOffice:forbidden('Office')},
  'pipeline.js':{JOB_STOPPED:77,dailyArgs:record('dailyArgs',(_storage,options)=>['prepare',options.job]),triggerEnv:record('triggerEnv',()=>({TRIGGER:'you'})),
    run:forbidden('real engine'),posting:async()=>root().job,jobs:async()=>({jobs:[root().job]}),
    work:(_storage,kind,_log,run)=>{root().work=Promise.resolve().then(()=>run(text=>root().tee.push(text),{aborted:false}));return root().work;}},
};
registerHooks({load(url,context,next){
  if(!url.startsWith(lib)||url===lib+'kit-handlers.js')return next(url,context);
  const name=url.slice(lib.length),exports=modules[name];
  if(!exports)throw Error('Unstubbed kit dependency: '+name);
  const functions=Object.entries(exports).map(([key,value])=>typeof value==='function'?`export const ${key}=(...args)=>globalThis.__kitNoticeModules[${JSON.stringify(name)}][${JSON.stringify(key)}](...args);`:`export const ${key}=${JSON.stringify(value)};`).join('\n');
  return{format:'module',shortCircuit:true,source:functions};
}});
globalThis.__kitNoticeModules=modules;
const {registerKitHandlers,stoppedWith}=await import('../../../lib/kit-handlers.js');
afterEach(()=>setLocale('en'));
function rig(t,options={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kit-notices-'));
  const state={calls:[],forbidden:[],tee:[],notes:[],opened:[],tracked:[],warnings:['Canonical warning'],letter:{ok:true,usd:0},job:{ok:true,code:'J1',title:'工程師 {count}',company:'Müller this Mac <keep>',url:'https://fictional.test'},notion:false,inNotion:false,...options};
  globalThis.__kitNoticeTest=state;
  t.mock.method(globalThis,'fetch',forbidden('network'));
  t.after(()=>{assert.deepEqual(state.forbidden,[],'caught callbacks must not hide live AI/network/store access');fs.rmSync(dir,{recursive:true,force:true});});
  const handlers=new Map(),storage={settings:()=>({}),secret:key=>key==='ANTHROPIC_API_KEY'?(state.missingAI?'':'fake-key'):'fake-token',path:(...parts)=>path.join(dir,...parts),saveSettings:forbidden('real settings write')};
  const api=registerKitHandlers({DEMO:true,ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},storage,app:{on(){}},powerMonitor:{on(){}},
    aiReady:()=>!state.missingAI,allowanceBlock:async()=>state.blocked||null,needsNotion:()=>state.gate||null,notify:(...args)=>state.notes.push(args),
    openTailoredCv:code=>state.opened.push(code),log:text=>state.calls.push(['log',text]),track:(...args)=>state.tracked.push(args),
    printPdf:async()=>({pdf:Buffer.from('fictional'),overflow:state.overflow?.shift() || []}),keepLook(){},shell:{},
    engineRun:async(_storage,args,onLine,env)=>{state.calls.push(['fake-engine',args,env]);for(const line of state.lines||[])onLine(line);return{code:state.exit||0};}});
  return{...api,state,handlers};
}
test('real prepare callback uses selected language and preserves non-English personal names',async t=>{
  const p=rig(t);setLocale('ru');const name='工程師 · Müller {count} <keep>';
  const result=await p.handlers.get('prepareKit')({},'J1',name);
  assert.deepEqual(result,{ok:true,ineligible:''});assert.match(p.state.notes[0][0],/подготов/);
  assert.ok(p.state.notes[0][1].includes(name));assert.deepEqual(p.state.notes[0].slice(2),[{view:'jobs',job:'J1'},'good']);
  assert.deepEqual(p.state.tracked,[['kit_prepared',{}]]);assert.deepEqual(p.state.calls.find(call=>call[0]==='fake-engine').slice(1),[['prepare','J1'],{TRIGGER:'you'}]);
});
test('real tailoring callback keeps provider text, filenames, quiet/show flags and fake save records',async t=>{
  const p=rig(t,{letter:{ok:false,error:'Provider {count} this Mac <keep>',usd:0}});setLocale('ro');
  const result=await p.tailorCv('J1','工程師 · Müller this Mac {count}',{show:false});
  assert.deepEqual(result,{ok:true,usd:0.1,letter:false});assert.equal(p.state.opened.length,0);assert.equal(p.state.notes.length,1);
  assert.ok(p.state.notes[0][1].includes('Provider {count} this Mac <keep>'));assert.ok(p.state.notes[0][1].includes('工程師 · Müller this Mac {count}'));
  assert.deepEqual(p.state.notes[0].slice(2),[{view:'jobs',job:'J1'},'good']);
  assert.equal(p.state.calls.find(call=>call[0]==='fake-store').at(-1).name,'CV · Müller this Mac <keep> · 工程師 {count}.pdf');
  const record=p.state.calls.find(call=>call[0]==='fake-save')[3];assert.deepEqual(record.warnings,['Canonical warning']);assert.equal(record.job.company,p.state.job.company);
  p.state.notes.length=0;await p.tailorCv('J1','Raw name',{show:true,quiet:true});assert.equal(p.state.notes.length,0);assert.deepEqual(p.state.opened,['J1']);
});
test('quiet errors and stopped/eligibility parsing remain canonical',async t=>{
  const p=rig(t,{missingAI:true});setLocale('ru');
  const raw='Choose your AI in Settings → Connections → AI first.';
  assert.deepEqual(await p.prepareKitFor('J1','Raw',{quiet:true}),{ok:false,error:raw});assert.deepEqual(await p.tailorCv('J1','Raw',{quiet:true}),{ok:false,error:raw});
  p.state.missingAI=false;p.state.exit=77;p.state.lines=['⚠️ Provider {count} this Mac <keep>'];
  assert.deepEqual(await p.prepareKitFor('J1','Raw',{quiet:true}),{ok:false,stopped:true,error:'Raw: Provider {count} this Mac <keep>'});
  assert.equal(stoppedWith(77,p.state.lines),'Provider {count} this Mac <keep>');
  p.state.exit=0;p.state.lines=['Not eligible: 原文 {count}'];assert.deepEqual(await p.prepareKitFor('J1','Raw',{quiet:true}),{ok:true,ineligible:'Not eligible: 原文 {count}'});
});
// Why (8 Nov 2026, owner screenshot: three drafted jobs each ended "Kit prepared", nothing started): the lines are the engine's real printed kit (src/ai/kit.py telegram_messages: a bold "Not eligible" header, the reason on the next line, no colon); the old test fed "Not eligible: ..." which the engine stopped printing on 5 Oct 2026.
test('a kit the engine marks not eligible is reported as ineligible, from the lines it really prints',async t=>{
  const p=rig(t);p.state.exit=0;
  p.state.lines=['\ud83d\udcdd <b>Your application</b>','<b>Job</b>','<b>Not eligible</b>','Required aviation credential missing.','','<b>Cover letter</b>'];
  assert.deepEqual(await p.prepareKitFor('J1','Raw',{quiet:true}),{ok:true,ineligible:'Not eligible: Required aviation credential missing.'});
  p.state.lines=['\ud83d\udcdd <b>Your application</b>','<b>Job</b>','<b>Cover letter</b>'];
  assert.deepEqual(await p.prepareKitFor('J1','Raw',{quiet:true}),{ok:true,ineligible:''},'an eligible kit stays unmarked');
});
test('seven catalogs have exact key/parameter parity and count categories',()=>{
  const params=value=>[...new Set((typeof value==='string'?[value]:Object.values(value)).flatMap(text=>[...text.matchAll(/\{(\w+)\}/g)].map(match=>match[1])))].sort();
  for(const locale of SUPPORTED_LOCALES) {
    assert.deepEqual(Object.keys(catalogs[locale]).sort(),Object.keys(catalogs.en).sort(),locale);
    for(const key of Object.keys(catalogs.en))assert.deepEqual(params(catalogs[locale][key]),params(catalogs.en[key]),locale+'.'+key);
    if(['ru','ro'].includes(locale))for(const key of ['changesCount','warningsSuffix'])for(const category of new Intl.PluralRules(locale).resolvedOptions().pluralCategories)assert.ok(catalogs[locale][key][category],locale+'.'+key+'.'+category);
  }
  setLocale('ru');assert.equal(noticeText('kitNotice.changesCount',{count:1}),'1 изменение');assert.equal(noticeText('kitNotice.changesCount',{count:2}),'2 изменения');assert.equal(noticeText('kitNotice.changesCount',{count:5}),'5 изменений');
  setLocale('ro');assert.equal(noticeText('kitNotice.changesCount',{count:20}),'20 de modificări');
});
test('UI-only AI and missing-CV errors resolve at invocation while quiet error contracts stay English',async t=>{
  const p=rig(t,{missingAI:true});
  const canonical='Choose your AI in Settings → Connections → AI first.';
  assert.deepEqual(await p.prepareKitFor('J1','name'),{ok:false,error:canonical});
  setLocale('ru');assert.deepEqual(await p.prepareKitFor('J1','name'),{ok:false,error:noticeText('kitNotice.needsAI')});
  assert.deepEqual(await p.tailorCv('J1','name'),{ok:false,error:noticeText('kitNotice.needsAI')});
  assert.deepEqual(await p.tailorCv('J1','name',{quiet:true}),{ok:false,error:canonical});
  p.state.missingAI=false;p.state.missingCV=true;setLocale('ro');
  assert.deepEqual(await p.tailorCv('J1','name'),{ok:false,error:noticeText('kitNotice.addCV')});
  assert.deepEqual(await p.tailorCv('J1','name',{quiet:true}),{ok:false,error:'Add your CV (PDF or Word) in Settings first.'});
  assert.equal(p.state.calls.some(call=>call[0]==='fake-engine'||call[0]==='fake-tailor'),false);
});
test('all real tailoring notice paths retain external provider/name values and Notion/show flags',async t=>{
  const external='供給者 this Mac {count} <keep>',name='工程師 · Müller this Mac {location}';
  const p=rig(t,{letter:{ok:false,error:external,usd:0},notion:true});
  for(const locale of SUPPORTED_LOCALES)for(const saved of [false,true]) {
    setLocale(locale);p.state.inNotion=saved;
    const result=await p.tailorCv('J1',name,{show:false});assert.equal(result.ok,true);
    const note=p.state.notes.at(-1);assert.ok(note[1].includes(external));assert.ok(note[1].includes(name));
    assert.ok(note[1].includes(noticeText(saved?'kitNotice.savedNotion':process.platform==='win32'?'kitNotice.onlyPC':'kitNotice.onlyMac')));
    assert.deepEqual(note.slice(2),[{view:'jobs',job:'J1'},'good']);
  }
  assert.equal(p.state.opened.length,0);
  p.state.providerError=external;const failed=await p.tailorCv('J1',name,{show:false});assert.deepEqual(failed,{ok:false,error:external});
  assert.deepEqual(p.state.notes.at(-1),[noticeText('kitNotice.cvFailedTitle'),noticeText('kitNotice.nameReason',{name,reason:external}),{view:'jobs',job:'J1'},'bad']);
});
test('Windows location copy cannot rewrite a personal name or provider text containing this Mac',async t=>{
  const p=rig(t,{notion:true,inNotion:false,letter:{ok:false,error:'Provider this Mac',usd:0}});
  const descriptor=Object.getOwnPropertyDescriptor(process,'platform');
  try {
    Object.defineProperty(process,'platform',{...descriptor,value:'win32'});setLocale('en');
    await p.tailorCv('J1','Person this Mac',{show:false});const text=p.state.notes.at(-1)[1];
    assert.ok(text.includes('Person this Mac'));assert.ok(text.includes('Provider this Mac'));assert.ok(text.includes(' On this PC only:'));
  } finally {Object.defineProperty(process,'platform',descriptor);}
});
test('real batch callback keeps all tee/marker/record text canonical and suppresses per-CV notices',async t=>{
  const p=rig(t);setLocale('ru');
  assert.deepEqual(await p.handlers.get('tailorTop')({},2),{ok:true,started:true,text:'Tailoring started.'});
  await p.state.work;assert.equal(p.state.notes.length,0);assert.equal(p.state.opened.length,0);
  assert.deepEqual(p.state.tee,[
    'Finding your 2 best matches without a tailored CV…','Tailoring 1 CV for your best matches (1-2 minutes each)',
    'Tailoring 1 of 1: 工程師 {count} · Müller this Mac <keep>','  ✓ 工程師 {count} · Müller this Mac <keep>',
    "Tailored 1 of 1 CV. Open each job's 📄 Tailored CV and cover letter to check them before you apply.",
    '<<<message','✂️ Tailored CVs + cover letters ready','1 of 1 tailored · check each before you apply','',
    '工程師 {count} (https://fictional.test)','Müller this Mac <keep>','message>>>'
  ]);
  const options=p.state.calls.find(call=>call[0]==='fake-tailor')[1];assert.equal(options.feedback,'');
  assert.deepEqual(p.state.calls.filter(call=>call[0]==='diagnostic').map(call=>call[2]),['tailor top matches','tailor top matches picked','tailored CV from the template','tailored CV kept on the job','tailor top matches done']);
});
test('real overflow retry preserves prompt feedback and stored warning prose',async t=>{
  const p=rig(t,{warnings:[],overflow:[[2],[2]]});setLocale('ru');
  assert.equal((await p.tailorCv('J1','Raw',{show:false})).ok,true);
  const asks=p.state.calls.filter(call=>call[0]==='fake-tailor');
  assert.equal(asks[0][1].feedback,'');assert.equal(asks[1][1].feedback,"Your last version didn't fit on page 2: make the bullets on that page shorter or drop one, so it fits.");
  const saved=p.state.calls.find(call=>call[0]==='fake-save')[3];
  assert.deepEqual(saved.warnings,['Page 2 is too full and its end is cut off: tailor again, or shorten it by hand.']);
});
test('real preparation gates and failure fallbacks preserve quiet contracts and raw upstream reasons',async t=>{
  const blocked={ok:false,error:'Provider {count} <keep>',credit:true};const p=rig(t,{blocked});setLocale('ro');
  assert.equal(await p.prepareKitFor('J1','Raw'),blocked);assert.equal(await p.handlers.get('tailorTop')({},2),blocked);
  assert.equal(p.state.calls.some(call=>call[0]==='fake-engine'),false);
  p.state.blocked=null;p.state.exit=1;p.state.lines=[];
  assert.deepEqual(await p.prepareKitFor('J1','Raw',{quiet:true}),{ok:false,ineligible:'',error:'Application kit could not be prepared.'});
  await p.prepareKitFor('J1','Raw');assert.equal(p.state.notes.at(-1)[1],noticeText('kitNotice.nameReason',{name:'Raw',reason:noticeText('kitNotice.unexpected')}));
  p.state.lines=['上流 Provider {count} this Mac'];await p.prepareKitFor('J1','Raw');assert.ok(p.state.notes.at(-1)[1].includes(p.state.lines[0]));
});
test('real ready notice keeps English defaults and uses Russian/Romanian count forms',async t=>{
  const p=rig(t);await p.tailorCv('J1','Raw',{show:false});
  assert.deepEqual(p.state.notes.at(-1),['Tailored CV + cover letter ready ✓','Raw: 2 changes, 1 to check, cover letter made.',{view:'jobs',job:'J1'},'good']);
  p.state.warnings=[];
  for(const locale of ['ru','ro'])for(const count of [1,2,5,20]) {
    setLocale(locale);p.state.changes=Array.from({length:count},()=> 'Canonical change');
    await p.tailorCv('J1','Raw',{show:false});const text=p.state.notes.at(-1)[1];
    assert.ok(text.includes(noticeText('kitNotice.changesCount',{count})));assert.ok(!text.includes(noticeText('kitNotice.warningsSuffix',{count:0})));
  }
});
