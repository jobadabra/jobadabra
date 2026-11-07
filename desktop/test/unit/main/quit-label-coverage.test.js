// Prevent native quit-dialog translations drifting from actual critical producers and the pipeline task catalog.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {TASKS} from '../../../lib/pipeline-lines.js';
import {rows} from '../../../i18n/catalogs/quit-labels.js';
import {criticalLabel, taskLabel} from '../../../i18n/quit-labels.js';
import {setLocale, SUPPORTED_LOCALES} from '../../../i18n/index.js';

// Only source guards read producer declarations; behavioral tests invoke real critical tracking and quit options separately.
function labelsIn(source) {
  const direct = [...source.matchAll(/critical\.during\(\s*(['"])(.*?)\1/g)].map(match => match[2]);
  const registered = [...source.matchAll(/handleImportant\(\s*(['"])[^'"]+\1\s*,\s*(['"])(.*?)\2/g)].map(match => match[3]);
  if (/critical\.during\(\s*LABELS\b/.test(source)) {
    const table = source.match(/const LABELS\s*=\s*\{([^}]+)\}/)?.[1];
    assert.ok(table, 'a critical label map must be visible to the coverage guard');
    direct.push(...[...table.matchAll(/:\s*(['"])(.*?)\1/g)].map(match => match[2]));
  }
  return [...direct, ...registered];
}

function assertCovered(labels) {
  const known = new Set(Object.values(rows).map(values => values[0]));
  for (const label of labels) assert.ok(known.has(label), `Add quit-dialog translations for producer label: ${label}`);
}

test('every current critical producer label has a bundled quit translation', () => {
  const root = new URL('../../../lib/', import.meta.url);
  const labels = fs.readdirSync(root).filter(file => file.endsWith('.js')).flatMap(file => labelsIn(fs.readFileSync(new URL(file, root), 'utf8')));
  assert.ok(labels.length >= 17, 'positive control: actual critical registrations and data-job labels were found');
  assertCovered(labels);
  try {
    for (const locale of SUPPORTED_LOCALES) {
      setLocale(locale);
      for (const label of labels) assert.ok(criticalLabel(label));
    }
  } finally { setLocale('en'); }
});

test('a renamed or newly registered untranslated critical label is refused by the coverage guard', () => {
  const labels = labelsIn("handleImportant('fixture', 'New untranslated operation', run); critical.during('Renamed operation', run);");
  assert.deepEqual(labels.sort(), ['New untranslated operation', 'Renamed operation']);
  assert.throws(() => assertCovered(labels), /Add quit-dialog translations for producer label/);
});

test('every kind in the actual pipeline task catalog, plus search and mail, resolves without fallback', () => {
  try {
    for (const locale of SUPPORTED_LOCALES.filter(value => value !== 'en')) {
      setLocale(locale);
      for (const kind of [...Object.keys(TASKS), 'search', 'mail']) {
        assert.notEqual(taskLabel(kind, () => 'UNTRANSLATED_KIND'), 'UNTRANSLATED_KIND', `${locale}/${kind}`);
      }
    }
  } finally { setLocale('en'); }
});
