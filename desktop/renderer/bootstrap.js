// Resolve display language before importing pages so module-level labels start in the selected language.
import {setLocale, resolveLocale} from '../i18n/index.js';
import '../i18n/screens.js';
import {translate} from './i18n-dom.js';
import {init as language} from './pages/language.js';

const state = await window.pilot.locale?.() || {choice: 'system', locale: resolveLocale('system', navigator.languages)};
setLocale(state.locale);
document.documentElement.lang = state.locale;
translate(document.body);
language(state);
await import('./app.js');
