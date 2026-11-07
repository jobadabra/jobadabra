// Synchronous display snapshot for worker-owned badges and injected notices; startup and action registration never wait on settings.
import {createI18n,catalogs} from './i18n.js';
let runtime = null;
const refresh = () => {
  const storage = globalThis.chrome?.storage?.local;
  if (storage?.get) createI18n(storage).then(value => { runtime = value; }).catch(() => {});
};
refresh();
globalThis.chrome?.storage?.onChanged?.addListener((changes,area) => {
  if (area === 'local' && (changes.extensionLanguage || changes.desktopDisplayLocale)) refresh();
});
/** Read a bundled display message without delaying a Stop, permission check or worker action. */
export function displayText(key,values = {}) {
  return runtime ? runtime.t(key,values) : globalThis.__jobadabraFormatDisplayMessage(catalogs.en,catalogs.en,'en',key,values);
}

/** Translate only the fixed app-authored worker step vocabulary at its rendering seam; unknown/external content is returned untouched. */
export function displayStepText(text) {
  const key = Object.keys(catalogs.en).find(key => key.startsWith('step.') && catalogs.en[key] === text);
  return key ? displayText(key) : text;
}
