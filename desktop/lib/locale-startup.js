// Initialize early native display copy from the existing non-secret appearance preference before any startup prompt.
import fs from 'node:fs';
import path from 'node:path';
import {localeView} from './locale-handlers.js';
import {setLocale} from '../i18n/index.js';

/** Read only settings.json, without opening storage, decrypting secrets or writing any startup state. */
export function initializeStartupLocale({app, readFile = fs.readFileSync}) {
  let settings = {};
  try {settings = JSON.parse(readFile(path.join(app.getPath('userData'), 'settings.json'), 'utf8'));}
  catch { /* A fresh, unreadable or malformed preference retains the English-first default. */ }
  const state = localeView(app, settings);
  setLocale(state.locale);
  return state;
}
