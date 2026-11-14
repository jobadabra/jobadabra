// Guard: release — the after-merge e2e verdict and every PR the settings suite reaches went red when another program took the port a restart step had chosen for the app (run 43607466981: the app logged EADDRINUSE, the port answered HTTP 400 for 45 s).
// The helper replaces a port the app says is taken; these tests play that race with a real squatter on the first port and a real stand-in for the app on the second, with no clock of their own.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import http from 'node:http';
import {askPair, relaunchOnOwnPort, socketVerdict} from '../../lib/relaunch-own-port.mjs';
import {listenOnFreePort} from '../../lib/own-port.mjs';

const close = server => new Promise(resolve => server.close(resolve));

// A server answering GET /extension/pair with `status`, on a port the OS gave it (held from the start).
async function serve(status) {
  const server = http.createServer((request, response) => { response.writeHead(status); response.end(status === 200 ? '{}' : 'Bad Request'); });
  return {server, port: await listenOnFreePort(server)};
}

// A fake app: relaunch() "starts" it on env.JOBADABRA_PORT. It owns the port it can bind (a stand-in answering 200); on a port a squatter holds it reports EADDRINUSE, as lib/server-listen.js does.
function fakeApp(squattedPorts, {code = 'EADDRINUSE'} = {}) {
  const app = {starts: [], servers: [], linkOff: '', page: null};
  app.page = {evaluate: async () => true};
  app.relaunch = async env => {
    const port = Number(env.JOBADABRA_PORT);
    app.starts.push(port);
    if (squattedPorts.includes(port)) { app.linkOff = code; return; }
    app.linkOff = '';
    const server = http.createServer((request, response) => { response.writeHead(200, {'Content-Type': 'application/json'}); response.end('{}'); });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    app.servers.push(server);
  };
  return app;
}

const options = (app, ports) => ({extensionId: 'x', capMs: 3000, say: () => {}, pickPort: async () => ports.shift(), readLinkOff: async () => app.linkOff});
const settle = app => Promise.all(app.servers.map(close));

test('a port the app says is taken is replaced: the second start listens and its port is returned', async () => {
  const squatter = await serve(400);   // answers HTTP 400 like whatever held 34707 in run 43607466981
  const free = await serve(200); await close(free.server);   // a free number for the second start
  const app = fakeApp([squatter.port]);
  try {
    const port = await relaunchOnOwnPort(app, options(app, [squatter.port, free.port]));
    assert.equal(port, free.port);
    assert.deepEqual(app.starts, [squatter.port, free.port], 'started twice, on the squatter\'s port first');
  } finally { await settle(app); await close(squatter.server); }
});

test('a port that stays taken for every try ends red naming the app\'s word and the port\'s answer', async () => {
  const squatter = await serve(400);
  const app = fakeApp([squatter.port]);
  try {
    await assert.rejects(() => relaunchOnOwnPort(app, {...options(app, [squatter.port, squatter.port]), tries: 2}), /port \d+ is busy \(EADDRINUSE\), the port answers HTTP 400 after 2 start\(s\)/);
    assert.equal(app.starts.length, 2);
  } finally { await settle(app); await close(squatter.server); }
});

test('another code (EACCES) is named at once: a new port would not help', async () => {
  const squatter = await serve(400);
  const app = fakeApp([squatter.port], {code: 'EACCES'});
  try {
    await assert.rejects(() => relaunchOnOwnPort(app, options(app, [squatter.port, squatter.port])), /is other \(EACCES\)/);
    assert.equal(app.starts.length, 1);
  } finally { await settle(app); await close(squatter.server); }
});

test('a socket that never opens and is never called taken ends red with the last state seen, not a wrong port', async () => {
  const app = fakeApp([]);
  app.relaunch = async env => { app.starts.push(Number(env.JOBADABRA_PORT)); };   // the app starts but nothing listens
  await assert.rejects(() => relaunchOnOwnPort(app, {...options(app, [49999]), capMs: 600}), /port 49999 is waiting, the port answers no answer/);
});

test('socketVerdict: the app\'s own word on a taken port outranks whatever answers there', () => {
  assert.equal(socketVerdict({linkOffCode: 'EADDRINUSE', answered: true}).state, 'busy');
  assert.equal(socketVerdict({answered: true}).state, 'listening');
  assert.equal(socketVerdict({}).state, 'waiting');
});

test('askPair says 200 is the app and anything else is not, with the number it answered', async () => {
  const bad = await serve(400), good = await serve(200);
  try {
    assert.deepEqual(await askPair(bad.port, 'x'), {answered: false, note: 'HTTP 400'});
    assert.deepEqual(await askPair(good.port, 'x'), {answered: true, note: ''});
  } finally { await close(bad.server); await close(good.server); }
});
