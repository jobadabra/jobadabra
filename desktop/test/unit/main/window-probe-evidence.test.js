// Guard: privacy/release — preserve failed display-launch evidence without exposing environment values or dropping its CI artifact.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {test} from 'node:test';
import {probeWindow} from '../../../integration/app/window-probe.js';

test('actual failed probe records presence and complete stderr, never environment values, with one launch',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'probe-evidence-')),authority=path.join(dir,'private-authority');fs.writeFileSync(authority,'fictional credential');
  const stderr='first display failure\n'+'x'.repeat(700)+'\nlast display failure',calls=[];
  t.mock.method(childProcess,'spawnSync',(...args)=>{calls.push(args);return{status:1,signal:'SIGTRAP',stderr,stdout:''};});syncBuiltinESMExports();
  t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();fs.rmSync(dir,{recursive:true,force:true});});
  assert.throws(()=>probeWindow({script:()=>null,env:{DISPLAY:'private-display-value',XAUTHORITY:authority,SECRET_TOKEN:'private-secret-value'}}),error=>{
    assert.match(error.message,/exit 1, signal SIGTRAP/);assert.match(error.message,/DISPLAY-present=true/);assert.match(error.message,/XAUTHORITY-file-present=true/);assert.ok(error.message.includes(stderr),'retain first and last stderr lines');
    for(const value of ['private-display-value',authority,'private-secret-value','fictional credential'])assert.ok(!error.message.includes(value),'environment values and credential contents stay private');return true;
  });
  assert.equal(calls.length,1,'failure evidence never retries Electron');assert.equal(fs.existsSync(calls[0][2].env.JOBADABRA_USER_DATA),false,'fictional probe folder is cleaned');
});
test('actual failed probe reports absent display/authority without guessing their values',t=>{
  let calls=0;t.mock.method(childProcess,'spawnSync',()=>{calls++;return{status:2,signal:null,stderr:'display unavailable',stdout:''};});syncBuiltinESMExports();
  t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
  assert.throws(()=>probeWindow({script:()=>null,env:{DISPLAY:'',XAUTHORITY:''}}),error=>/DISPLAY-present=false/.test(error.message)&&/XAUTHORITY-file-present=false/.test(error.message)&&/exit 2, signal null/.test(error.message));assert.equal(calls,1);
});
test('app integration retains the Xvfb error file with its existing result artifact',()=>{
  const workflow=fs.readFileSync(new URL('../../../../.github/workflows/integration.yml',import.meta.url),'utf8');
  const app=workflow.slice(workflow.indexOf('  app:'),workflow.indexOf('\n  store:'));
  assert.match(app,/xvfb-run[^\n]*--error-file[= ]"\$RUNNER_TEMP\/xvfb-app\.log"/);
  assert.match(app,/name: integration-results-app-\$\{\{ matrix\.os \}\}/);
  assert.match(app,/path: \|\n\s+\$\{\{ runner\.temp \}\}\/integration-results\.json\n\s+\$\{\{ runner\.temp \}\}\/xvfb-app\.log/);
});
test('successful probe retains its result contract without failure diagnostics or another launch',t=>{
  let calls=0;t.mock.method(childProcess,'spawnSync',(_file,_args,options)=>{calls++;fs.writeFileSync(options.env.JOBADABRA_SMOKE+'.json',JSON.stringify({fictional:'unchanged'}));fs.mkdirSync(path.join(options.env.JOBADABRA_USER_DATA,'logs'));fs.writeFileSync(path.join(options.env.JOBADABRA_USER_DATA,'logs','app.log'),'fictional log');return{status:0,signal:null,stderr:'ignored on success',stdout:''};});syncBuiltinESMExports();
  t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
  assert.deepEqual(probeWindow({script:()=>null,env:{DISPLAY:'private-display-value',XAUTHORITY:'private-authority-value'}}),{result:{fictional:'unchanged'},host:[],log:['fictional log']});assert.equal(calls,1);
});
