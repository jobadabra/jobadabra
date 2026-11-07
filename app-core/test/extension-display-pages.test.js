// Extension actions do not wait for locale IO; settings writes require successfully loaded fields.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {registerHooks} from 'node:module';
import {test} from 'node:test';
import {loadJsdom} from './helpers/page.js';
const base=new URL('../../extension/',import.meta.url);
registerHooks({load(url,context,next){
  if(url===new URL('flow.js',base).href)return{format:'module',shortCircuit:true,source:'export const api=async()=>({});export const pair=async()=>({workerUrl:"http://fictional",token:"test"});export const settings=async()=>({workerUrl:"http://fictional",token:"test"});'};
  return next(url,context);
}});
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
let serial=0;
async function page(file,blocked='locale') {
  const JSDOM=await loadJsdom();assert.ok(JSDOM);
  const dom=new JSDOM(fs.readFileSync(new URL(file+'.html',base),'utf8'),{url:'https://fictional.example'});
  const registered=new Set(),pending=[],actions=[];let began;
  const started=new Promise(resolve=>{began=resolve;});
  const original=dom.window.EventTarget.prototype.addEventListener;
  dom.window.EventTarget.prototype.addEventListener=function(type,fn,...args){if(this.id)registered.add(this.id+':'+type);return original.call(this,type,fn,...args);};
  globalThis.window=dom.window;globalThis.document=dom.window.document;
  globalThis.chrome={storage:{local:{get:keys=>{
    const locale=Array.isArray(keys)&&keys.includes('extensionLanguage');
    if((blocked==='locale')===locale)return new Promise((resolve,reject)=>{pending.push({resolve,reject});began();});
    return Promise.resolve({workerUrl:'http://fictional',token:'test',extensionLanguage:'ro',testMode:true});
  },set:async value=>{actions.push(value);}},onChanged:{addListener(){}}},permissions:{contains:async()=>false,request:async()=>false,remove:async()=>true},runtime:{openOptionsPage(){},sendMessage(message,reply){actions.push(message);reply?.({ok:true});}},tabs:{query:async()=>[{id:1,url:'https://fictional.example'}]}};
  const loaded=import(new URL(file+'.js?display-pages-'+serial++,base));
  await started;await flush();
  return{dom,nodes:dom.window.document,registered,pending,actions,loaded};
}
// Capture only the Save message's delayed clear; no timer wait is needed for the persistence assertion.
async function press(p,id) {
  const original=globalThis.setTimeout;
  try {globalThis.setTimeout=()=>1;p.nodes.getElementById(id).click();await flush();}
  finally {globalThis.setTimeout=original;}
}
test('options and popup handlers do not wait for pending or rejected locale storage',async()=>{
  for(const file of ['options','popup']) {
    const p=await page(file);
    try {
      for(const key of file==='options'?['displayLanguage:change','save:click','pair:click','anySite:change','carryLogins:change']:['stop:click','settings:click'])assert.ok(p.registered.has(key),file+': '+key+' registers before locale resolves');
      for(const read of p.pending)read.reject(Error('fictional locale unavailable'));
      await p.loaded;await flush();await press(p,file==='options'?'save':'stop');
      assert.ok(p.actions.some(value=>file==='options'?value.workerUrl==='http://fictional'&&value.token==='test':value.type==='stop'),'existing action uses loaded settings after locale rejection');
    } finally {p.dom.window.close();}
  }
});
test('unloaded or rejected settings cannot write blank credentials or accept early edits',async()=>{
  for(const reject of [false,true]) {
    const p=await page('options','settings');
    try {
      for(const id of ['workerUrl','token','save','acceptConsents','clickDropdowns','testMode','checkEligibility'])assert.equal(p.nodes.getElementById(id).disabled,true,id+': unavailable until settings load');
      // Even a synthetic event cannot bypass the handler's data guard.
      p.nodes.getElementById('save').dispatchEvent(new p.dom.window.Event('click'));await flush();
      assert.equal(p.actions.length,0);
      for(const read of p.pending)if(reject)read.reject(Error('fictional settings unavailable'));else read.resolve({workerUrl:'http://saved-worker',token:'saved-token',testMode:true});
      await p.loaded;await flush();
      if(reject) {
        await press(p,'save');assert.equal(p.actions.length,0);assert.equal(p.nodes.getElementById('workerUrl').disabled,true);
      } else {
        assert.equal(p.nodes.getElementById('workerUrl').value,'http://saved-worker');assert.equal(p.nodes.getElementById('testMode').checked,true);
        p.nodes.getElementById('workerUrl').value='http://edited-worker';await press(p,'save');
        assert.deepEqual(p.actions.at(-1),{workerUrl:'http://edited-worker',token:'saved-token'});
      }
    } finally {p.dom.window.close();}
  }
});
