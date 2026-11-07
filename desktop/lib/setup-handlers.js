// The setup and settings IPC (moved out of main.js, 8 Oct 2026): connecting Notion (the sign-in and its gate), saving settings, the contact details and
// secrets, the AI engine (Claude Code or a key), Free AI, choosing and changing the CV. main.js passes in the services they share.
// Guards: the notion-oauth, settings, claude-code and cv tests in desktop/test.
import {t} from '../i18n/native.js';
import {setupText} from '../i18n/setup-notices.js';
import {displayText} from '../i18n/display-values.js';
import * as aiFree from './ai-free.js';
import * as claudeCode from './claude-code.js';
import * as atUpload from './cv-import-at-upload.js';
import * as cvChange from './cv-change.js';
import * as cvlib from './cv.js';
import * as notionOAuth from './notion-oauth.js';   // Notion-only: connecting Notion (sign in with Notion), the person's own choice
import {forWindow} from './site-accounts.js';
import fs from 'node:fs';
import path from 'node:path';
import {cleanSecret} from './secrets.js';
import {checkAnthropicKey} from './ai/anthropic-api.js';
import {keyWorked} from './ai/refusals.js';
import {registerPlanHandlers} from './plan-handlers.js';
import {checkOpenAiKey} from './ai/openai-api.js';
import {log as appLog} from './log.js';
import {registerNotifyHandlers} from './notify-handlers.js';   // Settings → Notifications
import {CV_FILES} from '../renderer/cv-files.js';
import {officeAddon} from './office-addon.js';   // LibreOffice for a Word CV, downloaded on use
import {registerOfficeHandlers} from './office-handlers.js';
import {backgroundBrowserAddon} from './background-browser-download.js';
import {registerBackgroundBrowserHandlers} from './background-browser-handlers.js';   // Jobadabra's browser, downloaded on use
import {registerLiveViewHandlers} from './live-view-handlers.js';
import * as terminals from './terminals.js';
import {backgroundApplyFor} from './background-apply-controller.js';
import {isDocx, setDocxCv} from './cv-docx.js';

// Stop on one session: its own mark (a visible session) and, for a hidden-browser job, the hand-over to the person at once, before its next fill report can clear the mark (review of [ap] 6/7).
const stopSession = async (storage, id) => {
  const marked = terminals.noteStopped(id);
  const handed = await backgroundApplyFor(storage).stopOne(id).catch(error => { appLog('apply', 'stop of one background application failed', {session: id, error: error.message}); return null; });
  return marked || !!handed;
};
export function registerSetupHandlers(ctx) {
  const {DEMO, connectNotion, dialog, handleImportant, ipcMain, needsNotion, shell, storage, syncCv, trackSetup, getWindow, setNotionFrom, keepLook, renderDocx, toWindow} = ctx;
  registerNotifyHandlers({ipcMain, storage, DEMO, log: appLog});
  const office = officeAddon(storage, {toWindow, toast: body => toWindow('toast', body)});
  registerOfficeHandlers({ipcMain, addon: office, DEMO});
  registerBackgroundBrowserHandlers({ipcMain, addon: backgroundBrowserAddon(storage, {toWindow, toast: body => toWindow('toast', body)}), DEMO});
  registerLiveViewHandlers({DEMO, storage, ipcMain, toWindow, dialog, getWindow, log: appLog, page: id => backgroundApplyFor(storage).page(id),   // a hidden-browser session's held tab, in the app
    submitControl: id => backgroundApplyFor(storage).submitControl(id), stop: id => stopSession(storage, id)});
  handleImportant('notionConnect', 'Connecting Notion', async (_, pasted) => {   // about Notion
    const cleaned = cleanSecret(pasted), {value: token, error} = cleaned;
    if (error) return {ok: false, error: displayText(cleaned, error)};
    return connectNotion(token);
  });
  // "Connect with Notion": Notion's consent page in the browser, then the same connect as above.
  handleImportant('notionOAuth', 'Connecting Notion', async (_, options = {}) => {   // about Notion
    setNotionFrom(typeof options?.from === 'string' ? options.from.slice(0, 40) : 'unknown');  // for the log: wizard, gate:<reason>, settings
    const signedIn = await notionOAuth.connect(url => shell.openExternal(url));
    if (!signedIn.ok) return {...signedIn, error: displayText(signedIn, signedIn.error)};
    getWindow()?.show();
    getWindow()?.focus();
    return {...await connectNotion(signedIn.access_token, {templateRoot: notionOAuth.templateRoot(signedIn)}), workspace: signedIn.workspace_name};
  });
  ipcMain.handle('notionOAuthCancel', () => notionOAuth.cancel());
  ipcMain.handle('saveSettings', (_, patch) => {
    const before = storage.settings();
    const saved = storage.saveSettings(patch);
    trackSetup(patch, before);
    return forWindow(saved);   // the same shape as the window's state: the account switch must not flip to ON for an unset (assist) setting
  });
  ipcMain.handle('saveSecret', (_, name, pasted) => {
    const cleaned = cleanSecret(pasted), {value, error} = cleaned;
    if (error) throw new Error(displayText(cleaned, error));
    storage.setSecret(name, value);
    if (name === 'ANTHROPIC_API_KEY' && !aiFree.isFreeKey(value)) aiFree.stop(storage);  // own key: leave Free AI
    return storage.secretsPresent();
  });
  // The AI engine (Settings → Connections → AI, the wizard's AI step; lib/claude-code.js): the user's own choice.
  ipcMain.handle('setAiEngine', (_, choice, options = {}) => {
    if (!claudeCode.ENGINES.includes(choice)) throw new Error(`Unknown AI engine: ${choice}`);
    if (choice === 'api') aiFree.leave(storage);   // Free is stored as 'api': pressing the API key card must leave it (#1017)
    storage.saveSettings({aiEngine: choice, ...(choice === 'cli' ? {claudeCodeNotice: true} : {}), ...(choice === 'codex' ? {codexNotice: true} : {}),
      ...('fallback' in options ? {aiFallback: !!options.fallback} : {})});
    return forWindow(storage.settings());
  });
  // The status, Verify, file picker, install page and support details of Claude Code and Codex: lib/plan-handlers.js (the readiness states).
  registerPlanHandlers({ipcMain, storage, dialog, getWindow, shell, clipboard: ctx.clipboard, track: ctx.track, DEMO, appVersion: ctx.app?.getVersion?.() || '', ...(ctx.plan || {})});
  ipcMain.handle('checkOpenAI', async (_, pasted) => {
    const cleaned = cleanSecret(pasted), {value: key, error} = cleaned;
    if (error) return {ok: false, error: displayText(cleaned, error)};
    try {
      await checkOpenAiKey(key);   // free call: is the key valid?
      return {ok: true};
    } catch (error) {
      return {ok: false, error: error.status === 401 ? setupText('openaiRejected') : error.message};
    }
  });
  ipcMain.handle('setAiFallback', (_, on) => { storage.saveSettings({aiFallback: !!on}); return forWindow(storage.settings()); });
  ipcMain.handle('dismissEngineOffer', () => { storage.saveSettings({aiEngineOffered: true}); return forWindow(storage.settings()); });
  // Free AI for everyone (lib/ai-free.js).
  ipcMain.handle('startFreeAi', async () => {
    const result = await aiFree.start(storage);
    return result.ok ? result : {...result, error: displayText(result, result.error)};
  });
  ipcMain.handle('checkAnthropic', async (_, pasted) => {
    const cleaned = cleanSecret(pasted), {value: key, error} = cleaned;
    if (error) return {ok: false, error: displayText(cleaned, error)};
    try {
      // Why (29 Oct 2026, run 40836904987; #2427 exposed it; names renamed 1 Nov 2026): backbone setup checks use a dummy key, never Anthropic; outside e2e the real validator is unchanged.
      const testKey = process.env.JOBADABRA_E2E && storage.settings().anthropicKeyTest;
      if (testKey === 'reject') throw Object.assign(new Error('Invalid test key'), {status: 401});
      if (testKey !== 'accept') {
        await checkAnthropicKey(key); // free call: is the key valid?
        keyWorked('api', key);   // a key the provider just took is not "refused" any more (lib/ai-key-health.js)
      }
      return {ok: true};
    } catch (error) {
      return {ok: false, error: error.status === 401 ? setupText('anthropicRejected') : error.message};
    }
  });
  ipcMain.handle('chooseCv', async () => {
    const picked = await dialog.showOpenDialog(getWindow(), {title: t('native.chooseCv'), filters: [{name: t('native.cvFilter'), extensions: CV_FILES.extensions}], properties: ['openFile']});
    if (picked.canceled || !picked.filePaths[0]) return null;
    // The file is set at once; the CV is read into cv.json in the background (lib/cv-import-at-upload.js), once per file.
    // A Word CV is kept as cv.docx and drawn to cv.pdf first, LibreOffice fetched on first use (lib/cv-docx.js).
    const file = picked.filePaths[0], setCv = (from, as) => atUpload.setCv(storage, from, as,
      {client: claudeCode.client(storage), key: storage.secret('ANTHROPIC_API_KEY'), look: keepLook, toast: body => toWindow('toast', body)});
    const {name} = isDocx(file) ? await setDocxCv(storage, file, path.basename(file), {office, renderDocx, setCv}) : setCv(file, path.basename(file));
    syncCv();  // this version to the Profile in Notion too
    return name;
  });
  // After setup, a replaced CV: its effects (Strategy → "What changes with this CV"). See lib/cv-change.js.
  ipcMain.handle('cvChange', () => ({...(storage.settings().cvChange || {}), name: storage.settings().cvName,
    comparable: fs.existsSync(storage.path(cvChange.PREVIOUS)), base: !!cvlib.baseCv(storage)}));
  ipcMain.handle('cvReview', async () => {
    const gate = needsNotion('profile');
    if (gate) return gate;
    try { return {ok: true, ...await cvChange.review(storage, storage.secret('ANTHROPIC_API_KEY'), {client: claudeCode.client(storage)})}; }
    catch (error) { return {ok: false, error: error.message}; }
  });
  handleImportant('cvApply', 'Saving your CV and strategy', async (_, accepted) => {
    const gate = needsNotion('profile');
    if (gate) return gate;
    try { return {ok: true, ...await cvChange.apply(storage, accepted)}; } catch (error) { return {ok: false, error: error.message}; }
  });
  ipcMain.handle('cvChangeDone', () => { storage.saveSettings({cvChange: null}); return true; });
}
