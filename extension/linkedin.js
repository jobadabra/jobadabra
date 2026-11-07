// The extension's own consent page for LinkedIn jobs (extension/linkedin-session.js): Chrome asks for a permission only from an extension page, on a click. The app opens it when the person
// turns the switch on (desktop/lib/linkedin-handlers.js linkedinConnect). Nothing is asked or read before the button.
import {api, settings} from './flow.js';
import {displayLanguage,localize} from './i18n.js';
import {connect} from './linkedin-session.js';

const ui = await displayLanguage();
const render = () => localize(document,ui);
ui.subscribe(render); render();
document.getElementById('allow').addEventListener('click', async () => {
  const said = document.getElementById('said');
  said.className = '';
  said.dataset.i18n = 'linkedin.working'; said.textContent = ui.t('linkedin.working');
  const done = await connect({call: api, settings}).catch(() => ({ok:false,why:'offline'}));
  said.className = done.ok ? 'done' : '';
  const key = done.ok ? 'linkedin.done' : ['denied','signed-out','offline'].includes(done.why) ? 'linkedin.'+done.why : done.error ? '' : 'linkedin.failed';
  if (key) { said.dataset.i18n = key; said.textContent = ui.t(key); }
  else { delete said.dataset.i18n; said.textContent = done.error; }
  if (done.ok) setTimeout(() => window.close(), 1500);
});
