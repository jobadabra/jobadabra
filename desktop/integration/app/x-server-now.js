// What the X server looks like at the moment an Electron launch could not connect to it: counts read from /proc, never values from the environment.
// Why (7 Nov 2026, xv; app (Linux) runs 42334336670, 42345066531, 42386437125 died with "Missing X server or $DISPLAY" while DISPLAY and the auth file were set, Xvfb stayed alive and its
// own log held only keymap warnings): the red said the connect failed but not whether the server was gone, full or just busy, so the cause could not be named. This line says it.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Processes that vanish while /proc is read are normal; anything else is a real error and is thrown. */
const gone = error => ['ENOENT', 'ESRCH', 'EACCES'].includes(error.code);

/**
 * One line about the display `display` (":99"): does its socket file exist, how many Xvfb / electron / xkbcomp processes run, how many clients are connected to the socket right now,
 * and the open-files limit of this process. '' when this is not Linux (no /proc) or the display name has no number.
 * @param {string|undefined} display the DISPLAY the failed launch was given
 * @param {{proc?: string, socketDir?: string}} [where] test seam: the /proc and X socket folders
 * @returns {string} e.g. "X server now: socket file yes, Xvfb 1, electron 3, xkbcomp 0, clients connected 17, open-files limit 65536"
 */
export function xServerNow(display, {proc = '/proc', socketDir = '/tmp/.X11-unix'} = {}) {
  const number = /^:(\d+)/.exec(display || '')?.[1];
  if (!number || !fs.existsSync(path.join(proc, 'net', 'unix'))) return '';
  const counts = {Xvfb: 0, electron: 0, xkbcomp: 0};
  for (const entry of fs.readdirSync(proc).filter(name => /^\d+$/.test(name))) {
    try {
      const name = fs.readFileSync(path.join(proc, entry, 'comm'), 'utf8').trim();
      if (name in counts) counts[name]++;
    } catch (error) { if (!gone(error)) throw error; }   // Why (7 Nov 2026): a process that ended between the listing and the read is not a finding
  }
  const socket = new RegExp(`/\\.X11-unix/X${number}$`);
  let connected = 0;
  for (const line of fs.readFileSync(path.join(proc, 'net', 'unix'), 'utf8').split('\n')) {
    const fields = line.trim().split(/\s+/);
    if (fields.length >= 8 && fields[5] === '03' && socket.test(fields[7])) connected++;   // St 03 = a connected end; the listening socket is 01
  }
  let limit = 'unknown';
  try { limit = /Max open files\s+(\S+)/.exec(fs.readFileSync(path.join(proc, 'self', 'limits'), 'utf8'))?.[1] || limit; } catch (error) { if (!gone(error)) throw error; }
  return `X server now: socket file ${fs.existsSync(path.join(socketDir, `X${number}`)) ? 'yes' : 'no'}, Xvfb ${counts.Xvfb}, electron ${counts.electron}, xkbcomp ${counts.xkbcomp}, clients connected ${connected}, open-files limit ${limit}`;
}

// Why (7 Nov 2026, xv; run 42404365732 died with the display healthy afterwards: 1 Xvfb, 5 clients, no xkbcomp, and two server-side causes did not reproduce in plain Xvfb): a failed launch could not say what a
// new connection to the server gets, so the cause stayed unnamed. Runs in a child node process (the caller is synchronous). argv: socket path, how long to wait for a reply (ms). The X setup request is 12 bytes: little-endian, protocol 11.0, no authorization.
// A reply starts with 1 (accepted), 0 (refused, then the reason text) or 2 (more authentication needed).
const HANDSHAKE = `
const started = process.hrtime.bigint();
const took = () => Number((process.hrtime.bigint() - started) / 1000000n);
const done = text => { console.log(text); process.exit(0); };
const socket = require('node:net').connect(process.argv[1]);
setTimeout(() => done('no reply in ' + took() + ' ms'), Number(process.argv[2]));
socket.on('error', error => done((error.code || error.message) + ' after ' + took() + ' ms'));
socket.on('connect', () => socket.write(Buffer.from([0x6c, 0, 11, 0, 0, 0, 0, 0, 0, 0, 0, 0])));
socket.on('data', data => done('answered in ' + took() + ' ms: ' + (data[0] === 1 ? 'accepted' : data[0] === 2 ? 'asks for authentication' : 'refused, "' + data.subarray(8, 8 + data[1]).toString('latin1').trim() + '"')));
socket.on('close', () => done('closed by the server after ' + took() + ' ms, no reply'));
`;

/**
 * What the X server does with a brand-new connection right now (called after a launch failed, so it says whether the server answers NOW, not at the failure): one raw handshake with no
 * authorization. A live server answers "refused, Authorization required…" (or accepts when it runs without auth); an unreachable one gives the socket error. Never reads a cookie.
 * '' when the display name has no number.
 * @param {string|undefined} display the DISPLAY the failed launch was given
 * @param {{socketDir?: string, waitMs?: number}} [where] test seam: the X socket folder, how long to wait for a reply
 * @returns {string} e.g. "X handshake now: answered in 2 ms: refused, \"Authorization required, but no authorization protocol specified\""
 */
export function xHandshake(display, {socketDir = '/tmp/.X11-unix', waitMs = 3000} = {}) {
  const number = /^:(\d+)/.exec(display || '')?.[1];
  if (!number) return '';
  const run = spawnSync(process.execPath, ['-e', HANDSHAKE, path.join(socketDir, `X${number}`), String(waitMs)], {encoding: 'utf8', timeout: waitMs + 2000});
  return `X handshake now: ${run.error ? `could not run (${run.error.code || run.error.message})` : run.stdout.trim() || `child gave no line (exit ${run.status})`}`;
}
