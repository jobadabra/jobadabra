// The panel's footer names the extension build (owner, 11 Oct 2026: a bug screenshot did not say which version ran, so the cause could not be placed on a build).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {catalogs} from '../../../../extension/i18n.js';
import {readPanel} from '../../../../app-core/test/helpers/panel.js';

const review = readPanel();

test('the panel footer carries the extension version in its text and its tooltip', () => {
  assert.match(review, /const version = chrome\.runtime\.getManifest\(\)\.version;/);
  assert.match(review, /stateLine\.textContent = `\$\{word\} · v\$\{version\}\$\{build\?\.label \? ` · \$\{build\.label\}` : ''\}`;/, 'the version and the build stay in the footer line');
  const source = review.match(/function renderFooter\([\s\S]*?\n    }/)[0];
  for (const [locale, messages] of Object.entries(catalogs)) {
    const foot = {classList:{toggle() {}}}, line = {};
    const t = (key, fallback, values) => globalThis.__jobadabraFormatDisplayMessage(messages, catalogs.en, locale, key, values, fallback);
    const render = new Function('$', 'chrome', 't', 'connectionWords', `return (${source});`)(
      selector => selector === '.foot' ? foot : line,
      {runtime:{getManifest:() => ({version:'0.9.123'})}}, t, () => 'connection');
    render({connection:{connected:true}, build:{label:'preview', behind:0}});
    assert.equal(line.textContent, `${messages['panel.connectedShort']} · v0.9.123 · preview`, locale);
    assert.equal(foot.title, t('panel.extensionVersion', '', {connection:'connection',version:'0.9.123',build:' (preview)'}), locale);
    assert.match(foot.title, /0\.9\.123/);
    assert.match(foot.title, /preview/);
    render({connection:{connected:true}});
    assert.equal(line.textContent, `${messages['panel.connectedShort']} · v0.9.123`, locale);
    assert.equal(foot.title, t('panel.extensionVersion', '', {connection:'connection',version:'0.9.123',build:''}), locale);
  }
});
