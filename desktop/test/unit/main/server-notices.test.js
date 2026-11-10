// Server-originated notices localize only owned copy, preserving external values and notification targets/actions.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test,afterEach} from 'node:test';
import '../../../i18n/server-notices.js';
import {setLocale,SUPPORTED_LOCALES,t} from '../../../i18n/index.js';
import {newer} from '../../../lib/updater.js';
const read=file=>fs.readFileSync(new URL('../../../lib/'+file,import.meta.url),'utf8');
afterEach(()=>setLocale('en'));
test('fill producer uses the current display locale and keeps raw job text, session targets and tones',()=>{
  const source=read('server.js').match(/function notifyFill\([\s\S]*?\n}\n/)[0];
  const notices=[],external='Employer {count} <keep> $&';
  const draw=new Function('notify','jobName','sessionOfJob','t',`${source};return notifyFill;`)((...args)=>notices.push(args),()=>external,()=> 'same-session',t);
  setLocale('ru');draw({type:'fill-started',url:'https://fictional.test'},{});
  assert.match(notices[0][0],/Заполня/,'Russian fill-start title comes from app copy');
  assert.ok(notices[0][1].includes(external));
  assert.deepEqual(notices[0].slice(2),[{view:'sessions',session:'same-session'},'info']);
});
test('catalogs have identical keys/parameters and valid Russian/Romanian plural forms',async()=>{
  const {catalogs}=await import('../../../i18n/server-notices.js');
  const params=value=>[...new Set((typeof value==='string'?[value]:Object.values(value)).flatMap(text=>[...text.matchAll(/\{(\w+)\}/g)].map(match=>match[1])))].sort();
  for(const locale of SUPPORTED_LOCALES) {
    assert.deepEqual(Object.keys(catalogs[locale]).sort(),Object.keys(catalogs.en).sort(),locale);
    for(const key of Object.keys(catalogs.en))assert.deepEqual(params(catalogs[locale][key]),params(catalogs.en[key]),locale+'.'+key);
    if(['ru','ro'].includes(locale))for(const [key,value] of Object.entries(catalogs[locale]))if(typeof value==='object')for(const category of new Intl.PluralRules(locale).resolvedOptions().pluralCategories)assert.ok(value[category],locale+'.'+key+'.'+category);
  }
});
test('filled counts use locale plural rules while preserving raw job values and left branches',()=>{
  const source=read('server.js').match(/function notifyFill\([\s\S]*?\n}\n/)[0];
  const notices=[],external='Candidate {remaining} <keep> $&';
  const draw=new Function('notify','jobName','sessionOfJob','t',`${source};return notifyFill;`)((...args)=>notices.push(args),()=>external,()=>'',t);
  for(const locale of SUPPORTED_LOCALES)for(const count of [0,1,2,5,20,21,22])for(const left of [0,2]) {
    setLocale(locale);draw({type:'fill-done',filled:count,left},{});const notice=notices.at(-1);
    assert.ok(notice[1].includes(external),locale);assert.deepEqual(notice.slice(2),[{view:'sessions'},left?'warn':'good']);
    assert.equal(notice[0],t('serverNotice.'+(left?'fillLeftTitle':'fillDoneTitle')));
    assert.equal(notice[1],t('serverNotice.fillDoneBody',{job:external,count,remaining:left?t('serverNotice.fillRemaining',{count:left}):''}));
  }
  setLocale('ru');draw({type:'fill-done',filled:1,left:0},{});assert.match(notices.at(-1)[1],/1 поле/);
  draw({type:'fill-done',filled:2,left:0},{});assert.match(notices.at(-1)[1],/2 поля/);
  draw({type:'fill-done',filled:5,left:0},{});assert.match(notices.at(-1)[1],/5 полей/);
  setLocale('ro');draw({type:'fill-done',filled:20,left:0},{});assert.match(notices.at(-1)[1],/20 de câmpuri/);
});
test('local launcher fallback translates while raw message/job and authorization response stay unchanged',async()=>{
  const source=read('server-routes.js').match(/async function handleClaudeNotify\([\s\S]*?\n}\n/)[0];
  const notices=[],headers=[],bodies=[];
  const handle=new Function('notify','t','jsonHeaders','jsonBody',`${source};return handleClaudeNotify;`)((...args)=>notices.push(args),t,(_res,status)=>headers.push(status),(_res,value)=>bodies.push(value));
  const message='Provider {count} <keep> $&',job='Employer {where}';
  for(const locale of SUPPORTED_LOCALES) {
    setLocale(locale);await handle({method:'POST',headers:{'x-jobadabra':'launcher'}},{},Buffer.from(new URLSearchParams({message}).toString()));
    assert.deepEqual(notices.at(-1),['Jobadabra · '+t('serverNotice.application'),message,{view:'sessions'},'info']);
    await handle({method:'POST',headers:{'x-jobadabra':'launcher'}},{},Buffer.from(new URLSearchParams({message,job}).toString()));
    assert.equal(notices.at(-1)[0],'Jobadabra · '+job);assert.equal(notices.at(-1)[1],message);
    assert.equal(headers.at(-1),200);assert.deepEqual(bodies.at(-1),{ok:true});
  }
  const before=notices.length;await handle({method:'POST',headers:{origin:'https://foreign.test'}},{},Buffer.from(new URLSearchParams({message}).toString()));
  assert.equal(notices.length,before);assert.equal(headers.at(-1),403);assert.deepEqual(bodies.at(-1),{ok:false});
});
test('waiting notice retains its once-per-run throttle and exact focus callback',()=>{
  const source=read('ext-server-handlers.js').match(/visits\.onWaiting\(\(\) => \{[\s\S]*?\n  \}\);/)[0];
  const notices=[],focus=[];let callback,now=1000000;
  new Function('notify','visits','t','Date',`let waitingSaid=0;${source}`)((...args)=>notices.push(args),{onWaiting:fn=>{callback=fn;},focusBrowser:()=>focus.push('same-browser')},t,{now:()=>now});
  setLocale('ru');callback();assert.equal(notices[0][0],t('serverNotice.waitingTitle'));assert.equal(notices[0][3],'warn');
  notices[0][2]();assert.deepEqual(focus,['same-browser']);callback();assert.equal(notices.length,1);
  now+=10*60000;setLocale('ro');callback();assert.equal(notices.length,2);assert.equal(notices[1][0],t('serverNotice.waitingTitle'));
});
test('learned notice plurals and fallback labels never reinterpret interpolated company text',()=>{
  const company='Company {count} <keep> $&';
  for(const locale of SUPPORTED_LOCALES)for(const count of [1,2,5,20]) {
    setLocale(locale);for(const key of ['rememberedBody','learnedBody','questionBody']) {
      const text=t('serverNotice.'+key,{count,company});assert.ok(text.includes(company),locale+'.'+key);assert.ok(text.includes(String(count)));
    }
  }
});
test('Applied display location changes only notice copy and keeps job target and successful response shape',()=>{
  const source=read('server-env.js').match(/const where = notionGate\.notionInUse\(storage\)[\s\S]*?return \{ok: true, message:[^\n]+/)[0];
  const job={title:'Role {where}',company:'Company <keep>',url:'https://fictional.test',code:'same-code'},notices=[];
  const display=new Function('notionGate','storage','notify','jobName','job','t',source);
  for(const locale of SUPPORTED_LOCALES)for(const notion of [false,true]) {
    setLocale(locale);const result=display({notionInUse:()=>notion},{},(...args)=>notices.push(args),()=>job.title+' · '+job.company,job,t);
    const where=t('serverNotice.'+(notion?'whereNotion':'whereApp'));
    assert.deepEqual(result,{ok:true,message:t('serverNotice.appliedMessage',{where})});
    const notice=notices.at(-1);assert.ok(notice[1].includes(job.title+' · '+job.company));assert.ok(notice[1].includes(where));
    assert.deepEqual(notice.slice(2),[{view:'jobs',job:'same-code'},'good']);
  }
});
test('learned/salary/question producer branches keep counts, targets and fallback inputs',()=>{
  const source=read('server-env.js').split('\n').filter(line=>/if \((taught|seeded|added)\) notify\(/.test(line)).join('\n');
  assert.equal(source.split('\n').length,3);
  const notices=[],draw=new Function('notify','t','job','taught','seeded','added',source);
  setLocale('ro');draw((...args)=>notices.push(args),t,{company:'Employer {count} <keep>'},2,1,20);
  assert.equal(notices.length,3);assert.ok(notices[0][1].includes('Employer {count} <keep>'));assert.ok(notices[2][1].includes('20 de întrebări'));
  assert.deepEqual(notices.map(notice=>notice.slice(2)),[[{view:'settings',section:'profile'},'good'],[{view:'settings',section:'profile'},'good'],[{view:'jobs'},'warn']]);
  draw((...args)=>notices.push(args),t,null,0,0,0);assert.equal(notices.length,3,'zero counts retain no-notification behavior');
});
test('version notices preserve store/folder decisions, exact versions and canonical diagnostic constant',()=>{
  const source=read('server-env.js');
  const token=source.match(/export const EXTENSION_CHANGED = ('[^\n]+');/)[1];
  const canonical=new Function('return '+token)();
  assert.equal(canonical,'extension changed: reload it (chrome://extensions → ↻ on Jobadabra); a development copy does not reload itself');
  const changedSource=source.match(/export function extensionChangedNote\([\s\S]*?\n}/)[0].replace('export ','');
  const changed=new Function('EXTENSION_CHANGED',changedSource+';return extensionChangedNote;')(canonical);
  const staleSource=source.match(/export function staleExtension\([\s\S]*?\n}/)[0].replace('export ','');
  const stale=new Function('t','STORE_EXTENSION_ID','checkedInId','newer',staleSource+';return staleExtension;')(t,'same-store','folder',newer);   // a copy is "stale" only when strictly older (10 Nov 2026), so the versions are real ones
  const version='0.9.100',latest='0.9.101';
  setLocale('en');const storeDiagnostic=stale(version,latest,'same-store'),folderDiagnostic=stale(version,latest,'folder');
  for(const locale of SUPPORTED_LOCALES) {
    setLocale(locale);
    assert.equal(stale(version,version),'');assert.equal(stale('',latest),'');
    assert.equal(stale(version,latest,'same-store'),storeDiagnostic);
    assert.equal(stale(version,latest,'folder'),folderDiagnostic);
    for(const key of ['versionStore','versionFolder']) { const display=t('serverNotice.'+key,{version,latest});assert.ok(display.includes(version));assert.ok(display.includes(latest)); }
    if(locale==='en') {assert.equal(t('serverNotice.versionStore',{version,latest}),storeDiagnostic);assert.equal(t('serverNotice.versionFolder',{version,latest}),folderDiagnostic);}
    const first=changed({boot:'same-boot',version:'0.9',at:100},null,{latest:'0.9',newest:()=>200});
    assert.deepEqual(first,{state:{boot:'same-boot',at:100,told:true},note:canonical});
    assert.equal(changed({boot:'same-boot',version:'0.9',at:100},first.state,{latest:'0.9',newest:()=>200}).note,'');
  }
});

test('Russian remembered-answer fallback agrees with the passive employer phrase',()=>{
  setLocale('ru');const company=t('serverNotice.secondEmployer');
  assert.equal(company,'другим работодателем');
  assert.match(t('serverNotice.rememberedBody',{count:2,company}),/запрошенных другим работодателем: сохранены как стандартные/);
  assert.match(t('serverNotice.rememberedBody',{count:1.5,company}),/Прежние ответы .* сохранены как стандартные/);
});
