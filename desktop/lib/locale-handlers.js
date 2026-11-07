// Narrow display-language IPC follows local appearance preferences without writing profile or application data.
import {SUPPORTED_LOCALES, resolveLocale, setLocale} from '../i18n/index.js';

/** Register validated locale read/write handlers and establish the main process locale from saved settings. */
export function registerLocaleHandlers({ipcMain, app, storage, onChange = () => {}}) {
  const view = () => {
    const saved = storage.settings().displayLanguage;
    const choice = SUPPORTED_LOCALES.includes(saved) ? saved : 'system';
    return {choice, locale: resolveLocale(choice, app.getPreferredSystemLanguages?.() || [app.getLocale?.() || 'en']), supported: [...SUPPORTED_LOCALES]};
  };
  setLocale(view().locale);
  ipcMain.handle('locale', () => view());
  ipcMain.handle('setLocale', (_, choice) => {
    if (choice !== 'system' && !SUPPORTED_LOCALES.includes(choice)) throw new TypeError('Unsupported display language');
    storage.saveSettings({displayLanguage: choice}); // Invariant: a failed write never changes active/native language.
    const next = view();
    setLocale(next.locale);
    onChange(next);
    return next;
  });
}
