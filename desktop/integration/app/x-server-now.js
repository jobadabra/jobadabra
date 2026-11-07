// What the X server looks like at the moment an Electron launch could not connect to it: counts read from /proc, never values from the environment.
// Why (7 Nov 2026, xv; app (Linux) runs 42334336670, 42345066531, 42386437125 died with "Missing X server or $DISPLAY" while DISPLAY and the auth file were set, Xvfb stayed alive and its
// own log held only keymap warnings): the red said the connect failed but not whether the server was gone, full or just busy, so the cause could not be named. This line says it.
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
