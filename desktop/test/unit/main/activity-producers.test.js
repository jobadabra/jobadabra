// Execute the six producers' notification expressions with fictional inputs; state, targets and raw values stay intact.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test, afterEach} from 'node:test';
import {setLocale} from '../../../i18n/index.js';
import {activityText} from '../../../i18n/activity-notices.js';

afterEach(() => setLocale('en'));
const source = name => fs.readFileSync(new URL(`../../../lib/${name}.js`, import.meta.url), 'utf8');
function execute(name, marker, context = {}) {
  const line = source(name).split('\n').find(line => line.includes(marker) && line.includes('notify('));
  assert.ok(line, `${name}: native notification expression remains present`);
  const expression = line.slice(line.indexOf('notify('), line.lastIndexOf(');') + 1);
  const calls = [];
  vm.runInNewContext(expression, {activityText, notify: (...args) => calls.push(args), ...context});
  return calls[0];
}

test('display-only producer expressions localize while retaining exact targets and raw titles', () => {
  setLocale('de');
  const raw = 'Fictional {title} this Mac Keychain ⌘K';
  const learned = execute('learned', "section: 'profile'", {count: 2, storage: {}, notionGate: {notionInUse: () => false}});
  assert.equal(learned[0], '2 Antworten gemerkt');
  assert.equal(JSON.stringify(learned.slice(2)), JSON.stringify([{view: 'settings', section: 'profile'}, 'good']));
  const transcript = execute('interview-handlers', "{view: 'interviews'}", {meta: {status: 'ready', title: raw}, storage: {}, byStore: () => assert.fail('not saved: no store wording needed')});
  assert.equal(transcript[0], 'Transkript fertig'); assert.ok(transcript[1].startsWith(`${raw}: `));
  assert.equal(JSON.stringify(transcript.slice(2)), JSON.stringify([{view: 'interviews'}, 'good']));
  const quit = execute('lifecycle', 'NO_PLACE.app', {dialog: {detail: raw}, NO_PLACE: {app: {view: 'activity'}}});
  assert.equal(quit[0], 'Jobadabra wird nach Abschluss beendet'); assert.equal(quit[1], raw);
  const overnight = execute('ready-handlers', "{view: 'actions'}", {waiting: {ready: 2, left: 1}});
  assert.equal(overnight[0], 'Bereit zum Absenden ✓'); assert.match(overnight[1], /Submit/);
  assert.equal(JSON.stringify(overnight.slice(2)), JSON.stringify([{view: 'actions'}, 'good']));
  const review = execute('background-apply-controller', "{view: 'sessions', session: item.id}, 'good'", {item: {id: 'fictional'}});
  assert.equal(review[0], 'Bewerbung bereit zur Prüfung'); assert.match(review[1], /Submit/);
  assert.equal(JSON.stringify(review.slice(2)), JSON.stringify([{view: 'sessions', session: 'fictional'}, 'good']));
});

test('scheduled-search callback changes only its notification strings', () => {
  setLocale('ru');
  const line = source('background-handlers').split('\n').find(line => line.includes('soon: () => notify('));
  const call = line.slice(line.indexOf('notify('), line.lastIndexOf(')});') + 1);
  const calls = [];
  vm.runInNewContext(call, {activityText, notify: (...args) => calls.push(args)});
  assert.equal(calls[0][0], 'Поиск новых вакансий через 1 минуту');
  assert.equal(JSON.stringify(calls[0].slice(2)), JSON.stringify([{activity: true}, 'info']));
});
