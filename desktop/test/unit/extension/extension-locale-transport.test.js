// Guard: privacy — display-language transport must preserve auth, external responses and applicant-owned data.
import assert from 'node:assert/strict';
import {test} from 'node:test';
const saved = {profile:{name:'Fictional <Candidate>'},extensionLanguage:'it'};
globalThis.chrome = {storage:{local:{get:async()=>({...saved}),set:async values=>Object.assign(saved,values)}}};
const {pair, api, APP} = await import('../../../../extension/flow.js');
const requests = [];
let answer, status = 200, offline = false;
globalThis.fetch = async (url, init) => {
  requests.push({url,init});
  if (offline) throw Error('fictional offline');
  return {ok:status===200,status,json:async()=>answer};
};

test('pair caches locale and keeps the original connection return contract', async () => {
  answer = {url:APP,token:'fictional',displayLocale:'ro'};
  assert.deepEqual(await pair(), {workerUrl:APP,token:'fictional'});
  assert.equal(saved.desktopDisplayLocale,'ro');
  assert.equal(requests.at(-1).url,APP+'/extension/pair');
  assert.equal(saved.extensionLanguage,'it');
});

test('authenticated review refreshes locale, preserving applicant and employer text byte for byte', async () => {
  const config = {workerUrl:APP,token:'fictional'};
  answer = {displayLocale:'ru',matched:{question:'Employer <wording>',answer:'Candidate {pages}'}};
  assert.deepEqual(await api(config,'/extension/review',{method:'POST',body:'{}'}),answer);
  assert.equal(saved.desktopDisplayLocale,'ru');
  assert.equal(requests.at(-1).init.headers.Authorization,'Bearer fictional');
  answer = {matched:false}; await api(config,'/extension/review',{method:'POST',body:'{}'});
  assert.equal(saved.desktopDisplayLocale,'en');
  answer = {displayLocale:'de'}; await api(config,'/extension/review',{method:'POST',body:'{}'});
  offline = true;
  await assert.rejects(api(config,'/extension/review',{method:'POST',body:'{}'}));
  assert.equal(saved.desktopDisplayLocale,'de');
  offline = false; status = 403; answer = {displayLocale:'fr',error:'denied'};
  await assert.rejects(api(config,'/extension/review',{method:'POST',body:'{}'}));
  assert.equal(saved.desktopDisplayLocale,'de');
  status = 200; answer = {displayLocale:'es'};
  await api({workerUrl:'https://worker.invalid',token:'fictional'},'/extension/review',{method:'POST',body:'{}'});
  assert.equal(saved.desktopDisplayLocale,'de');
  assert.deepEqual(saved.profile,{name:'Fictional <Candidate>'});
});
