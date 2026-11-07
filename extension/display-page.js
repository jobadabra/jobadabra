// Localize an extension-owned page asynchronously while its existing permission/action listeners register immediately.
import {displayLanguage,localize} from './i18n.js';
import {displayText} from './display-cache.js';

/** Return immediate English-capable display access; failed or delayed locale IO never blocks the page's actions. */
export function startDisplayPage(root) {
  let runtime = null;
  displayLanguage().then(loaded => {
    runtime = loaded;
    const render = () => localize(root,runtime);
    runtime.subscribe(render); render();
  }).catch(() => {});
  return {t:(key,values) => runtime ? runtime.t(key,values) : displayText(key,values)};
}
