// Resolve display language before importing pages so module-level labels start in the selected language.
import {setLocale} from '../i18n/index.js';
import '../i18n/screens.js';
import {translate} from './i18n-dom.js';
import {startWithLocale} from './locale-start.js';

await startWithLocale({read: () => window.pilot.locale?.(), apply: async state => {
  document.documentElement.lang = setLocale(state.locale);
  translate(document.body);
  const {init: language} = await import('./pages/language.js');
  language(state);
}, start: () => import('./app.js'), onUnavailable: () => window.dispatchEvent(new Event('pilot-outdated'))});
