// LinkedIn Easy Apply's switch, plan 1/5: the window's three channels (state, on, off) over lib/easy-apply-switch.js, registered beside LinkedIn jobs' (lib/browser-handlers.js).
// Guard: test/unit/main/easy-apply-switch.test.js.
import {turnOff, turnOn, viewOf} from './easy-apply-switch.js';

/** The window's three channels. In demo mode nothing is saved. `packaged`: app.isPackaged. `clock` stamps the warning. */
export function registerEasyApplyHandlers({DEMO, ipcMain, storage, packaged, clock = () => new Date()}) {
  ipcMain.handle('easyApplyState', () => (DEMO ? {on: false, linkedinOn: false, warned: false, offered: !packaged} : viewOf(storage, {packaged})));
  ipcMain.handle('easyApplyOn', (_, answer) => (DEMO ? {ok: true} : turnOn(storage, {warned: answer?.warned === true, now: clock(), packaged})));
  ipcMain.handle('easyApplyOff', () => (DEMO ? {ok: true} : turnOff(storage)));
}
