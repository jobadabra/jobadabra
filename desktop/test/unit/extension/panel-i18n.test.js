// Verify injected display localization never touches employer/applicant text or calls a filling action.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {registerHooks} from 'node:module';
import {test} from 'node:test';
const source = file => fs.readFileSync(new URL('../../../../extension/' + file, import.meta.url), 'utf8');

test('classic bootstrap shares formatter, refreshes selected bundle and only marks owned nodes', async () => {
  let change, bundle = {locale:'ru',messages:{hello:'Привет {name}',pages:{one:'{count} страница',few:'{count} страницы',many:'{count} страниц',other:'{count} страницы'}},english:{hello:'Hello {name}'}};
  const messages = [], listeners = [];
  const context = vm.createContext({Intl, console, chrome:{runtime:{sendMessage:async message=>{messages.push(message);return bundle;}},storage:{onChanged:{addListener:fn=>{change=fn;}}}}});
  context.window = context;
  vm.runInContext(source('i18n-format.js'),context);
  vm.runInContext(source('panel-i18n.js'),context);
  const ui = context.__jobadabraPanelI18n;
  await ui.ready;
  assert.equal(ui.locale(), 'ru');
  assert.equal(ui.t('hello','Hello {name}',{name:'<Candidate> {count}'}),'Привет <Candidate> {count}');
  assert.equal(ui.t('pages','{count} pages',{count:2}),'2 страницы');
  assert.equal(ui.t('unbundled','Keep {name}',{name:'Employer text'}),'Keep Employer text');
  ui.onChange(()=>listeners.push(ui.locale()));
  bundle = {locale:'ro',messages:{hello:'Salut {name}'},english:{hello:'Hello {name}'}};
  change({extensionLanguage:{newValue:'ro'}},'local');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(ui.t('hello','Hello {name}',{name:'Fictional'}),'Salut Fictional');
  assert.deepEqual(messages.map(x=>x.type),['panelLocale','panelLocale']);
  assert.deepEqual(listeners,['ro']);
});

test('classic fallback and malformed/offline bundle use English without any page data', async () => {
  const context = vm.createContext({Intl,chrome:{runtime:{sendMessage:async()=>{throw Error('offline');}}}});context.window=context;
  vm.runInContext(source('i18n-format.js'),context);vm.runInContext(source('panel-i18n.js'),context);
  await context.__jobadabraPanelI18n.ready;
  assert.equal(context.__jobadabraPanelI18n.t('hello','Hello {name}',{name:'Fictional'}),'Hello Fictional');
  assert.equal(context.__jobadabraPanelI18n.locale(),'en');
});

// Minimal owned report nodes model DOM reparenting: a node leaves its old parent when say() appends it to the dialog.
class OwnedNode {
  constructor(tag) { this.tagName=tag; this.children=[]; this.dataset={}; this.attributes={}; this.handlers={}; this.hidden=false; this.value=''; this.ownText=''; }
  append(...nodes) { for (const node of nodes) { if (node.parent) node.parent.children=node.parent.children.filter(child=>child!==node); node.parent=this; this.children.push(node); } }
  replaceChildren(...nodes) { for(const node of this.children) node.parent=null; this.children=[]; this.append(...nodes); }
  set textContent(text) { this.ownText=String(text); this.children=[]; }
  get textContent() { return this.ownText+this.children.map(node=>node.textContent).join(''); }
  get firstChild() { return this.children[0]; }
  get lastChild() { return this.children.at(-1); }
  set innerHTML(_html) { this.replaceChildren(new OwnedNode('p'),new OwnedNode('p')); }
  setAttribute(name,value) { this.attributes[name]=value; }
  getAttribute(name) { return this.attributes[name]; }
  addEventListener(type,fn) { this.handlers[type]=fn; }
  querySelector(selector) { return selector==='.jp' ? this : null; }
  querySelectorAll(selector) {
    const key=selector.slice(6,-1).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());
    const all=this.children.flatMap(node=>[node,...node.querySelectorAll('*')]);
    return selector==='*'?all:all.filter(node=>Object.hasOwn(node.dataset,key));
  }
}

test('an open report changes summary language and retains the note without repeating prepare or send', async () => {
  const {catalogs}=await import('../../../../extension/i18n.js');
  let locale='ru',change,finishSend; const requests=[];
  const root=new OwnedNode('root');
  const context=vm.createContext({Intl,console,document:{createElement:tag=>new OwnedNode(tag)},chrome:{storage:{onChanged:{addListener:fn=>{change=fn;}}},runtime:{sendMessage:async message=>{
    requests.push(message.type);
    if(message.type==='panelLocale')return{locale,messages:catalogs[locale],english:catalogs.en};
    if(message.type==='report-state')return{enabled:true,has:true};
    if(message.type==='report-send')return{ok:true,preview:{responses:2,hosts:['fictional.example'],removed:{email:1}}};
    if(message.type==='report-confirm')return new Promise(resolve=>{finishSend=resolve;});
    throw Error('Unexpected action: '+message.type);
  }}}});context.window=context;
  for(const file of ['i18n-format.js','panel-i18n.js','panel-report.js'])vm.runInContext(source(file),context);
  const ui=context.__jobadabraPanelI18n;await ui.ready;
  context.__jobadabraReport.mount(root,context.chrome.runtime.sendMessage);ui.bind(root);
  await context.__jobadabraReport.open();
  const note=root.querySelectorAll('*').find(node=>node.tagName==='textarea');
  note.value='Candidate note <keep> {count}';
  assert.ok(root.textContent.includes('2 ответа страницы'));
  const before=requests.length;
  locale='ro';change({extensionLanguage:{newValue:'ro'}},'local');
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(root.textContent.includes('2 răspunsuri de pagină de pe 1 site. Date personale eliminate: 1.'));
  assert.equal(note.value,'Candidate note <keep> {count}');
  assert.equal(requests.length,before+1,'only the display bundle refreshes; report preparation/upload never repeats');
  assert.equal(requests.at(-1),'panelLocale');
  const sendButton=root.querySelectorAll('*').find(node=>node.tagName==='button' && node.textContent==='Trimite');
  sendButton.handlers.click({isTrusted:true});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(sendButton.disabled,true);
  locale='ru';change({desktopDisplayLocale:{newValue:'ru'}},'local');
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(root.querySelectorAll('*').includes(sendButton),'language change cannot recreate an enabled Send while upload is pending');
  assert.equal(sendButton.disabled,true);
  assert.equal(requests.filter(type=>type==='report-confirm').length,1);
  finishSend({ok:true});await new Promise(resolve=>setImmediate(resolve));
  assert.ok(root.textContent.includes('Отправлено'));
});

test('the app-authored AI tooltip is localized while original employer title and candidate value are preserved', async () => {
  const {catalogs}=await import('../../../../extension/i18n.js');
  let inputListener;
  const field={title:'Employer tooltip {count}',value:'Fictional Candidate <keep>',parentElement:null,classList:{add(){},remove(){}},
    setAttribute(){},removeAttribute(){},addEventListener(_type,listener){inputListener=listener;},removeEventListener(){}};
  const context=vm.createContext({getComputedStyle:()=>({borderBottomWidth:'1'}),document:{getElementById:id=>id==='fictional'?field:null,createElement:()=>({}),head:{append(){}}}});context.window=context;
  context.__jobadabraFillKit={clean:value=>value,isCombo:()=>false};
  context.__jobadabraDisplayWords={writtenByAI:catalogs.ro['tooltip.written']};
  vm.runInContext(source('page/fill-marks.js'),context);
  context.__jobadabraFillKit.markAttention('fictional','Employer label unchanged');
  assert.equal(field.title,catalogs.ro['tooltip.written']);
  assert.equal(field.value,'Fictional Candidate <keep>');
  inputListener({isTrusted:true});
  assert.equal(field.title,'Employer tooltip {count}');
  assert.equal(field.value,'Fictional Candidate <keep>');
});

test('a missing shared formatter leaves the panel helper absent for the existing hard-helper guard', () => {
  const context=vm.createContext({chrome:{runtime:{sendMessage(){throw Error('No request before dependencies exist');}}}});context.window=context;
  vm.runInContext(source('panel-i18n.js'),context);
  assert.equal(context.__jobadabraPanelI18n,undefined);
});

test('locale-message wrapper delegates every application request unchanged and returns bundled display data only', async () => {
  const {withDisplayLocale}=await import('../../../../extension/panel-locale-message.js');
  const calls=[],message={type:'panelFill',url:'https://fictional.example',force:false},sender={tab:{id:8}},callback=()=>{};
  const handler=withDisplayLocale((...args)=>{calls.push(args);return 'delegated';},()=>({get:async()=>({extensionLanguage:'ro'})}));
  assert.equal(handler(message,sender,callback),'delegated');
  assert.equal(calls[0][0],message);assert.equal(calls[0][1],sender);assert.equal(calls[0][2],callback);
  let pending;
  const answer=await new Promise(resolve=>{pending=handler({type:'panelLocale'},sender,resolve);});
  assert.equal(pending,true);assert.equal(answer.locale,'ro');
  assert.deepEqual(Object.keys(answer).sort(),['english','locale','messages']);
  assert.equal(calls.length,1,'display query never reaches application actions');
  const offline=withDisplayLocale(()=>{throw Error('No action delegation');},()=>({get:async()=>{throw Error('fictional offline');}}));
  const fallback=await new Promise(resolve=>offline({type:'panelLocale'},sender,resolve));
  assert.equal(fallback.locale,'en');
});

test('permission handlers work before locale IO resolves and remain usable if locale IO rejects', async () => {
  const base=new URL('../../../../extension/',import.meta.url);
  registerHooks({load(url,context,next){
    if(url===new URL('flow.js',base).href)return{format:'module',shortCircuit:true,source:'export const api=async()=>({});export const settings=async()=>({});'};
    if(url===new URL('linkedin-session.js',base).href)return{format:'module',shortCircuit:true,source:'export const connect=async()=>{globalThis.__permissionLocaleCalls++;return{ok:false,why:"denied"};};'};
    return next(url,context);
  }});
  for(const file of ['allow.js','linkedin.js']) {
    let started;const readStarted=new Promise(resolve=>{started=resolve;});const pendingReads=[];
    const button={handlers:{},addEventListener(type,fn){this.handlers[type]=fn;}},said={dataset:{},textContent:''};
    globalThis.__permissionLocaleCalls=0;
    globalThis.document={documentElement:{},getElementById:id=>id==='allow'?button:said,querySelectorAll:()=>[]};
    globalThis.chrome={storage:{local:{get:()=>new Promise((resolve,reject)=>{pendingReads.push({resolve,reject});started();})},onChanged:{addListener(){}}},permissions:{request:async()=>{globalThis.__permissionLocaleCalls++;return false;}}};
    globalThis.window={close(){}};
    const loaded=import(new URL(file+'?permission-locale-regression',base));
    await readStarted;
    try {
      assert.equal(typeof button.handlers.click,'function',file+': permission handler must not wait for locale settings');
      await button.handlers.click();
      assert.equal(globalThis.__permissionLocaleCalls,1,file+': click reaches only the existing mocked permission/connect action');
      assert.ok(said.textContent.length>0);
    } finally {
      for(const pending of pendingReads)pending.reject(Error('fictional locale storage unavailable'));
      await loaded.catch(()=>{});
    }
    await button.handlers.click();
    assert.equal(globalThis.__permissionLocaleCalls,2,file+': locale failure cannot disable the permission action');
  }
});
