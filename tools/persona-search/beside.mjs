// run.mjs --beside: the person's own Find jobs as the app runs it, with the job boards that refuse plain reading read beside the press in Jobadabra's own headless Chrome.
// Why (12 Nov 2026, sa for #3883): the round tools' throwaway install has no background browser (in the app the person's first use downloads it) and run.mjs calls searchSteps
// directly, so without this a live proof of the headless board read would read no board. Wiring, not a second path: the app's own withBeside (desktop/lib/search-beside.js),
// boardsSeams (desktop/lib/headless-boards-beside.js) and light scoring (visitsArgs); Playwright's Chromium linked as the runtime (desktop/e2e/lib/background-proof.mjs linkRuntime).
// Its browser gets no flag beyond the app's own (honest user agent, --enable-automation) and talks only to a stand-in loopback server here, never the app's port 47111.
import http from 'node:http';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const lib = file => import(path.join(ROOT, 'desktop', 'lib', file));

/**
 * Ready the beside read for one throwaway install. `dir`: the install's folder (storage root), `exec`: run.mjs's engine runner (the press's own env).
 * -> {press(steps, onLine) -> steps' result, last() -> the boards step's result of the last press, close()}. Throws when Playwright's Chromium cannot be linked.
 */
export async function besideFor(storage, dir, exec) {
  const {linkRuntime} = await import(path.join(ROOT, 'desktop', 'e2e', 'lib', 'background-proof.mjs'));
  const why = linkRuntime(dir);
  if (why) throw new Error(`--beside: ${why}`);
  const {withBeside} = await lib('search-beside.js');
  const {boardsSeams} = await lib('headless-boards-beside.js');
  const {visitsArgs} = await lib('pipeline-args.js');
  // The owned browser's extension is told an app address: this stand-in answers it, so nothing of the read reaches the person's running app.
  const app = http.createServer((request, response) => { request.resume(); request.on('end', () => { response.writeHead(200, {'content-type': 'application/json', 'access-control-allow-origin': '*'}); response.end('{"ok":true,"jobs":[]}'); }); });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  const {step} = boardsSeams(storage, {run: exec, port: app.address().port});
  let result = null;
  const boards = async (signal, onLine) => (result = await step(signal, onLine));
  const score = (fits, onLine) => exec(storage, visitsArgs(storage, fits), onLine);
  return {
    press: (steps, onLine) => { result = null; return withBeside(storage, onLine, null, steps, {step: null, boards, score}); },
    last: () => result,
    close: () => new Promise(resolve => app.close(resolve)),
  };
}
