// The port a test app listens on: never the production one, so a test app can't take it from the owner's Jobadabra (owner, 29 Oct 2026).
// Job: wait on state
import net from 'node:net';

export const DEFAULT_APP_PORT = 47111;   // the extension's built-in address for the app (extension/flow.js APP)

// A port nothing listens on. The test app and its extension use it, so the suite runs next to the user's own Jobadabra, which keeps 47111: the extension
// under test can never pair with a live app.
export async function freePort() {
  for (;;) {
    const port = await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => { const {port: got} = server.address(); server.close(() => resolve(got)); });
    });
    if (port !== DEFAULT_APP_PORT) return port;
  }
}

/**
 * Starts `server` listening on a port the OS picks and -> that port. Never the production one (a server that got it is closed and asked again).
 * Invariant: the port is bound the moment it is known, so nothing can take it in between. Use this for a server the test starts itself; freePort() leaves a gap
 * between choosing the number and binding it, and is only for a port handed to another process (the app's JOBADABRA_PORT, a browser's debugging port).
 * Why (4 Nov 2026, run 41859921107): a stand-in app listened on a freePort() number it had chosen earlier (the extension copy was made in between); by then the port
 * was taken, and the extension test died with "listen EADDRINUSE 127.0.0.1:40371" on code its PR did not touch.
 */
export async function listenOnFreePort(server, host = '127.0.0.1') {
  for (;;) {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, host, () => { server.off('error', reject); resolve(); });
    });
    const {port} = server.address();
    if (port !== DEFAULT_APP_PORT) return port;
    await new Promise(resolve => server.close(resolve));
  }
}

/** -> the env entry that gives a launched test app its own port: the suite's, else a free one. */
export async function ownPortEnv(env = {}) {
  return {JOBADABRA_PORT: env.JOBADABRA_PORT || String(await freePort())};
}
