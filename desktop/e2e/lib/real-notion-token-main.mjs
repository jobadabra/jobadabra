// Electron entry of the twin's sync: `electron real-notion-token-main.mjs <real folder> -- <command...>` runs the command with the app's own Notion token in its environment (lib/real-notion-token.mjs).
// Job: run the backbone
import path from 'node:path';
import {app, safeStorage} from 'electron';
import {runWithAppToken} from './real-notion-token.mjs';
import {DATA_NAME, LEGACY_NAME} from '../../lib/app-identity.js';
import {itemOf, readPlan} from '../../lib/keychain-migration.js';

const args = process.argv.slice(process.argv.findIndex(arg => arg.endsWith('real-notion-token-main.mjs')) + 1);
const [folder, , ...command] = args;
// safeStorage's key is the Keychain item "<app name> Safe Storage": the real app's name, so this process reads the real app's key. Why (3 Nov 2026, owner): the app seals under
// "Jobadabra Safe Storage" once lib/keychain-migration.js moved the folder (its secrets.json says so); before that, under the old name.
app.setName(readPlan(path.join(folder, 'secrets.json'), itemOf(DATA_NAME)).state === 'migrated' ? DATA_NAME : LEGACY_NAME);
app.dock?.hide();
app.whenReady().then(() => {
  let status = 1;
  try { status = runWithAppToken({folder, safeStorage, command}); } catch (error) { console.error(`twin: ${error.message}`); }
  app.exit(status);
});
