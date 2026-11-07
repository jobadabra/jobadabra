// Localize an extension-owned page asynchronously while its existing permission/action listeners register immediately.
import {displayLanguage,localize,catalogs,locales} from './i18n.js';

/** Return immediate English-capable display access; failed or delayed locale IO never blocks the page's actions. */
export function startDisplayPage(root) {
  let runtime = null, pendingChoice = null;
  const listeners = new Set();
  const locale = () => runtime?.locale() || (locales.includes(pendingChoice) ? pendingChoice : 'en');
  const changed = () => { localize(root,ui); for (const listener of listeners) listener(); };
  const ui = {
    t:(key,values) => runtime ? runtime.t(key,values) : globalThis.__jobadabraFormatDisplayMessage(catalogs[locale()],catalogs.en,locale(),key,values),
    locale, choice:() => runtime?.choice() ?? pendingChoice ?? 'desktop',
    number:value => new Intl.NumberFormat(locale()).format(value),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async preference(choice) {
      pendingChoice = choice;
      if (runtime) await runtime.preference(choice);
      else { changed(); await chrome.storage.local.set({extensionLanguage:choice}).catch(() => {}); }
    },
  };
  displayLanguage().then(async loaded => {
    runtime = loaded;
    if (pendingChoice !== null) await runtime.preference(pendingChoice);
    runtime.subscribe(changed); changed();
  }).catch(() => {});
  return ui;
}
