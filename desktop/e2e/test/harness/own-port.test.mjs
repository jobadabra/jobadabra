// A launched test app always has its own port, never the production one (owner, 29 Oct 2026: a test app held 47111 for 27 h).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import http from 'node:http';
import {DEFAULT_APP_PORT, freePort, listenOnFreePort, ownPortEnv} from '../../lib/own-port.mjs';

// Guard: safety — a stand-in app that listens through the helper never holds the production port 47111, and its port is held by the server the moment the helper returns
// (a number chosen first and bound later was taken by another process in run 41859921107).
test('listenOnFreePort: the server holds the port it returns, which is not 47111', async () => {
  const servers = [];
  try {
    for (let tries = 0; tries < 5; tries++) {
      const server = http.createServer();
      servers.push(server);
      const port = await listenOnFreePort(server);
      assert.equal(server.address().port, port);
      assert.equal(server.listening, true);
      assert.notEqual(port, DEFAULT_APP_PORT);
    }
    assert.equal(new Set(servers.map(server => server.address().port)).size, servers.length, 'five servers, five different ports: none was handed out twice');
  } finally { await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve)))); }
});

test('a test app with no port named gets a free one that is not 47111; a named port is kept', async () => {
  for (let tries = 0; tries < 20; tries++) {
    const {JOBADABRA_PORT} = await ownPortEnv({});
    assert.match(JOBADABRA_PORT, /^\d+$/);
    assert.notEqual(Number(JOBADABRA_PORT), DEFAULT_APP_PORT);
  }
  assert.deepEqual(await ownPortEnv({JOBADABRA_PORT: '48123'}), {JOBADABRA_PORT: '48123'});
  assert.notEqual(await freePort(), DEFAULT_APP_PORT);
});
