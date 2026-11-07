// Guard: privacy/release — preserve failed display-launch evidence without exposing environment values or dropping its CI artifact.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {test} from 'node:test';
import {probeWindow} from '../../../integration/app/window-probe.js';
import {xServerNow} from '../../../integration/app/x-server-now.js';

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
test('the X server line counts processes and connected clients of the failed display only',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'x-now-')),proc=path.join(dir,'proc'),sockets=path.join(dir,'x11');
  try{
    fs.mkdirSync(path.join(proc,'net'),{recursive:true});fs.mkdirSync(path.join(proc,'self'));fs.mkdirSync(sockets);fs.writeFileSync(path.join(proc,'self','limits'),'Max open files            1024                 524288               files\n');
    for(const [pid,comm] of [['11','Xvfb'],['12','electron'],['13','electron'],['14','bash']]){fs.mkdirSync(path.join(proc,pid));fs.writeFileSync(path.join(proc,pid,'comm'),comm+'\n');}
    fs.mkdirSync(path.join(proc,'15'));   // a process that ended before its name was read
    fs.writeFileSync(path.join(proc,'net','unix'),['Num RefCount Protocol Flags Type St Inode Path',
      '0: 00000002 00000000 00010000 0001 01 1 /tmp/.X11-unix/X99','0: 00000003 00000000 00000000 0001 03 2 /tmp/.X11-unix/X99','0: 00000003 00000000 00000000 0001 03 3 /tmp/.X11-unix/X99',
      '0: 00000003 00000000 00000000 0001 03 4 /tmp/.X11-unix/X100','0: 00000003 00000000 00000000 0001 03 5'].join('\n'));
    assert.equal(xServerNow(':99',{proc,socketDir:sockets}),'X server now: socket file no, Xvfb 1, electron 2, xkbcomp 0, clients connected 2, open-files limit 1024');
    fs.writeFileSync(path.join(sockets,'X99'),'');assert.match(xServerNow(':99.0',{proc,socketDir:sockets}),/socket file yes/);
    assert.equal(xServerNow('private-display-value',{proc,socketDir:sockets}),'','a display with no number reports nothing');assert.equal(xServerNow(':99',{proc:path.join(dir,'none')}),'','no /proc (macOS, Windows) reports nothing');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
