// Verify app-owned labels refresh without restarting takeover or rewriting external answer text.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {loadJsdom} from './helpers/page.js';
const read=file=>fs.readFileSync(new URL('../../extension/'+file,import.meta.url),'utf8');
test('countdown locale refresh repaints static copy without resetting timer or action',async()=>{
  const JSDOM=await loadJsdom();assert.ok(JSDOM);
  const dom=new JSDOM('<div id="root"><div class="claude-offer"></div></div>',{url:'https://fictional.example',runScripts:'outside-only'});
  const w=dom.window;let locale='en',change,tick,timers=0;const sent=[];
  w.__jobadabraPanelI18n={t:(_key,fallback,values={})=>locale+':'+fallback.replace('{count}',values.count),onChange:fn=>{change=fn;}};
  w.setInterval=fn=>{tick=fn;timers++;return 1;};w.clearInterval=()=>{};
  try {
    w.eval(read('panel-claude.js'));const root=w.document.getElementById('root');
    w.__jobadabraClaude.mount(root,async message=>{sent.push(message);return{ok:true};});
    w.__jobadabraClaude.render({on:true,stuck:true,auto:true,consent:true});
    tick();tick();assert.match(root.textContent,/3 s/);
    locale='ro';change();
    assert.equal(root.querySelector('button').textContent,'ro:Cancel');
    assert.equal(root.querySelector('.co-muted').textContent,'ro:It works in this tab and stops before Submit.');
    assert.match(root.querySelector('b').textContent,/ro:.*3 s/);
    assert.equal(timers,1,'locale cannot start another timer');assert.equal(sent.length,0);
    tick();assert.match(root.querySelector('b').textContent,/2 s/);
    root.querySelector('button').click();assert.equal(sent.length,0,'Cancel never starts takeover');
  } finally {w.close();}
});
test('tip evidence labels can be repainted from current locale independently of generated advice',async()=>{
  const JSDOM=await loadJsdom();assert.ok(JSDOM);
  const dom=new JSDOM('<span class="tip-chip"></span><p class="tip-text">Generated advice {keep}</p>',{runScripts:'outside-only'});
  const w=dom.window;let locale='en';w.__jobadabraPanelI18n={t:(_key,fallback)=>locale+':'+fallback};
  try {
    w.eval(read('panel-review-view.js'));
    const view=w.__jobadabraPanelView({$:selector=>w.document.querySelector(selector)});
    assert.equal(typeof view.renderTipLabel,'function');
    view.renderTipLabel('research');assert.equal(w.document.querySelector('.tip-chip').textContent,'en:Fact');
    locale='ro';view.renderTipLabel('research');assert.equal(w.document.querySelector('.tip-chip').textContent,'ro:Fact');
    assert.equal(w.document.querySelector('.tip-text').textContent,'Generated advice {keep}');
  } finally {w.close();}
});
test('connection tooltip resolves typed owned errors and preserves untyped external reasons',async()=>{
  const {catalogs}=await import('../../extension/i18n.js');
  const JSDOM=await loadJsdom();assert.ok(JSDOM);
  const dom=new JSDOM('<div class="foot"><span class="state"></span></div>',{runScripts:'outside-only'}),w=dom.window;
  let locale='ro';w.chrome={runtime:{getManifest:()=>({version:'0.9.test'})}};
  w.__jobadabraPanelI18n={t:(key,fallback,values)=>globalThis.__jobadabraFormatDisplayMessage(catalogs[locale],catalogs.en,locale,key,values,fallback)};
  try {
    w.eval(read('panel-review-view.js'));const view=w.__jobadabraPanelView({$:selector=>w.document.querySelector(selector)});
    view.renderFooter({connection:{connected:false,why:'Original English fallback',whyKey:'error.noApp'}});
    assert.ok(w.document.querySelector('.foot').title.includes(catalogs.ro['error.noApp']));
    locale='ru';view.renderFooter({connection:{connected:false,why:'Employer/Worker reason {reason} <keep>'}});
    assert.ok(w.document.querySelector('.foot').title.includes('Employer/Worker reason {reason} <keep>'));
  } finally {w.close();}
});
