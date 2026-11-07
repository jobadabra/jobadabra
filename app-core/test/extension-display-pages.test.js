// Extension-owned page actions must register even when locale storage is pending or rejected.
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
test('options and popup action handlers do not wait for locale storage',async()=>{
  const JSDOM=await loadJsdom();assert.ok(JSDOM);
  for(const file of ['options','popup']) {
    const dom=new JSDOM(fs.readFileSync(new URL(file+'.html',base),'utf8'),{url:'https://fictional.example'});
    const nodes=dom.window.document,registered=new Set(),pending=[],actions=[];let began;
    const started=new Promise(resolve=>{began=resolve;});
    const original=dom.window.EventTarget.prototype.addEventListener;
    dom.window.EventTarget.prototype.addEventListener=function(type,fn,...args){if(this.id)registered.add(this.id+':'+type);return original.call(this,type,fn,...args);};
    globalThis.window=dom.window;globalThis.document=nodes;
    globalThis.chrome={storage:{local:{get:()=>new Promise((resolve,reject)=>{pending.push({resolve,reject});began();}),set:async value=>{actions.push(value);}},onChanged:{addListener(){}}},permissions:{contains:async()=>false,request:async()=>false,remove:async()=>true},runtime:{openOptionsPage(){},sendMessage(message,reply){actions.push(message);reply?.({ok:true});}},tabs:{query:async()=>[{id:1,url:'https://fictional.example'}]}};
    const loaded=import(new URL(file+'.js?nonblocking-locale',base));
    await started;for(let i=0;i<20;i++)await Promise.resolve();
    try {
      for(const key of file==='options'?['displayLanguage:change','save:click','pair:click','anySite:change','carryLogins:change']:['stop:click','settings:click'])assert.ok(registered.has(key),file+': '+key+' registers before locale storage resolves');
    } finally {
      for(const read of pending)read.reject(Error('fictional storage unavailable'));
      await loaded.catch(()=>{});for(let i=0;i<20;i++)await Promise.resolve();
      const originalTimeout=globalThis.setTimeout;
      try {
        globalThis.setTimeout=()=>1; // The saved-message clear is unrelated to locale initialization.
        nodes.getElementById(file==='options'?'save':'stop').click();for(let i=0;i<20;i++)await Promise.resolve();
      } finally {globalThis.setTimeout=originalTimeout;}
      assert.ok(actions.some(value=>file==='options'?Object.hasOwn(value,'workerUrl'):value.type==='stop'),'existing action remains usable after storage rejects');
      dom.window.close();
    }
  }
});
