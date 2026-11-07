// Every checkbox in the app's page has an accessible name, so a screen reader and the extension's control list can say what it turns on.
import {readScreenSource} from '../../static-screen-source.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const html = readScreenSource(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../renderer/index.html'), 'utf8');

/** The checkboxes of index.html that have no aria-label, no `<label for>` and no text inside an enclosing label (#3239). */
function unnamedCheckboxes() {
  const unnamed = [];
  for (const m of html.matchAll(/<input type="checkbox"([^>]*)>/g)) {
    if (/aria-label=/.test(m[1])) continue;
    const id = (m[1].match(/id="([^"]+)"/) || [])[1];
    const before = html.slice(0, m.index);
    const inLabel = before.lastIndexOf('<label') > before.lastIndexOf('</label>');
    const labelText = inLabel ? html.slice(before.lastIndexOf('<label'), html.indexOf('</label>', m.index)).replace(/<[^>]*>/g, '').trim() : '';
    if (!labelText && !html.includes(`for="${id}"`)) unnamed.push(id);
  }
  return unnamed;
}

test('no checkbox in index.html lacks an accessible name (the Focus reminders switch had none, #3239)', () => {
  assert.deepEqual(unnamedCheckboxes(), []);
});
