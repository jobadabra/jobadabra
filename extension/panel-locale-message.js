// Wrap extension panel message routing with a display-only bundled-locale reply, without changing application actions.
import {createI18n,catalogs} from './i18n.js';

/** Add only the locale message; every other request keeps the original handler, sender, callback and return value. */
export function withDisplayLocale(handler,storage = () => chrome.storage.local) {
  return (message,sender,reply) => {
    if (message?.type !== 'panelLocale') return handler(message,sender,reply);
    // Invariant: the reply contains only trusted bundled UI words; no applicant, employer, credential or action data.
    createI18n(storage()).then(ui => reply({locale:ui.locale(),messages:catalogs[ui.locale()],english:catalogs.en}))
      .catch(() => reply({locale:'en',messages:catalogs.en,english:catalogs.en}));
    return true;
  };
}
