// Preserve the early Apply overlay when locale and initial worker-state callbacks resolve in either order.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
const source=file=>fs.readFileSync(new URL('../../extension/'+file,import.meta.url),'utf8');

test('locale redraw waits for the first worker state in either callback order', async () => {
  const {loadJsdom,openPage}=await import('./helpers/page.js');
  const {PANEL_FILES}=await import('../../extension/panel-files.js');
  const {catalogs}=await import('../../extension/i18n.js');
  const JSDOM=await loadJsdom();assert.ok(JSDOM,'callback regression requires the real DOM');
  const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
  for(const localeFirst of [true,false])for(const state of ['working','done']) {
    const window=openPage(JSDOM,'<h1>Fictional posting</h1>');
    try {
      let localeReply,applyReply,localeChange;
      const requests=[];
      window.setInterval=()=>1;window.setTimeout=()=>1;
      window.MutationObserver=class{observe(){}disconnect(){}};
      window.chrome={runtime:{id:'fictional',getManifest:()=>({version:'0.9.test'}),onMessage:{addListener(){}},sendMessage:message=>{
        requests.push(message.type);
        if(message.type==='panelLocale')return new Promise(resolve=>{localeReply=resolve;});
        if(message.type==='panelApply')return new Promise(resolve=>{applyReply=resolve;});
        return Promise.resolve({ok:true});
      }},storage:{onChanged:{addListener:fn=>{localeChange=fn;}},local:{get:async()=>({}),set:async()=>{}}}};
      for(const name of ['Required','ReadBack','TitleAbove','GroupTitle'])window['__jobadabra'+name]={};
      window.__jobadabraPanelForm={KNOCKOUT:/permit/i,AGREE:/agree/i,fields:()=>[],find:()=>null,flash(){}};
      window.__jobadabraPanelWritten={start:()=>({update(){},review(){}})};
      window.__jobadabraPanelLearn={start:()=>({reportMisses(){},showMine(){}})};
      window.__jobadabraClaude={mount(){},render(){}};
      window.eval(source('panel-overlay.js'));
      window.__jobadabraOverlay.on();
      const overlay=window.document.getElementById('jobadabra-fill-overlay');
      const mocked=['panel-form.js','panel-learn.js','panel-written.js','panel-overlay-fx.js','panel-overlay.js','panel-report.js'];
      for(const file of PANEL_FILES.filter(file=>!mocked.includes(file)))window.eval(source(file));
      await flush();
      assert.equal(typeof applyReply,'function','review asks for its initial worker state');
      const answerLocale=()=>localeReply({locale:'ro',messages:catalogs.ro,english:catalogs.en});
      if(localeFirst) {
        answerLocale();await flush();
        assert.equal(overlay.isConnected,true,'locale reply before worker state cannot lift the early overlay');
        assert.equal(requests.includes('review'),false,'locale redraw cannot start application sync before worker state');
        applyReply({state});
      } else {
        applyReply({state});await flush();answerLocale();
      }
      await flush();
      const host=window.document.getElementById('jobadabra-review-host');
      assert.equal(overlay.isConnected,state==='working',`final overlay: localeFirst=${localeFirst}, state=${state}`);
      assert.equal(!!host,state==='working','only a working zero-field posting keeps its panel');
      if(host) {
        assert.match(host.style.cssText,/translate/);
        assert.ok(host.shadowRoot.querySelector('.fill.is-busy'));
        assert.equal(host.lang,'ro');
      }
      localeChange({extensionLanguage:{newValue:'en'}},'local');
      localeReply({locale:'en',messages:catalogs.en,english:catalogs.en});await flush();
      assert.equal(overlay.isConnected,state==='working','later locale changes preserve initialized working state');
    } finally {window.close();}
  }
});
