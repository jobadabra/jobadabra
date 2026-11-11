// "How often" reaches the Always on schedule (ap 2/6, 11 Nov 2026; owner: "replicate the entire functionality/settings on the Always on as it's on the local"): the chosen hours go to the site at turn-on and on a change, once, never while off.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {hoursOf, pushSchedule, state, turnOn, turnOff} from '../../../lib/hosted-search.js';
import {strictSetSecret} from '../../strict-set-secret.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FREE = 'JPF1.install-0001.tok';
function store(settings = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-hours-')), mine = {...settings};
  fs.mkdirSync(path.join(dir, 'config'));
  return {settings: () => mine, saveSettings: patch => Object.assign(mine, patch), secret: name => (name === 'ANTHROPIC_API_KEY' ? FREE : ''), setSecret: strictSetSecret(), path: name => path.join(dir, name)};
}
const site = () => {
  const calls = [];
  return {calls, fetcher: async (url, init = {}) => { calls.push({key: `${init.method || 'GET'} ${new URL(url).pathname}`, body: init.body && JSON.parse(init.body)}); return Response.json({ok: true, state: 'on'}); }};
};
const hours = calls => calls.filter(call => call.key === 'PUT /api/hosted/schedule').map(call => call.body.freqHours);

test('turn-on carries the chosen hours; the default is 4 and "off" sends none', async () => {
  const mine = site();
  assert.deepEqual(hoursOf(store({schedule: {search: 6}})), {freqHours: 6});
  assert.deepEqual(hoursOf(store()), {freqHours: 4});
  assert.deepEqual(hoursOf(store({schedule: {search: 0}})), {});
  const settings = store({schedule: {search: 12}});
  assert.equal((await turnOn(settings, {email: 'me@example.com'}, {fetcher: mine.fetcher})).ok, true);
  assert.deepEqual(hours(mine.calls), [12]);
  assert.equal(state(settings).hoursSent, 12);
});

test('a change while on is sent once; the same hours again, and any change while off, send nothing', async () => {
  const mine = site(), settings = store({schedule: {search: 12}});
  await turnOn(settings, {email: 'me@example.com'}, {fetcher: mine.fetcher});
  mine.calls.length = 0;
  assert.equal((await pushSchedule(settings, {fetcher: mine.fetcher})).skipped, true);   // unchanged
  settings.saveSettings({schedule: {search: 8}});
  assert.equal((await pushSchedule(settings, {fetcher: mine.fetcher})).ok, true);
  assert.equal((await pushSchedule(settings, {fetcher: mine.fetcher})).skipped, true);
  assert.deepEqual(hours(mine.calls), [8]);
  await turnOff(settings, {fetcher: mine.fetcher});
  mine.calls.length = 0;
  settings.saveSettings({schedule: {search: 3}});
  assert.equal((await pushSchedule(settings, {fetcher: mine.fetcher})).skipped, true);
  assert.deepEqual(hours(mine.calls), []);
});

test('How often = Off after hours were sent does not reach the cloud, and says so', async () => {
  const mine = site(), settings = store({schedule: {search: 6}});
  await turnOn(settings, {email: 'me@example.com'}, {fetcher: mine.fetcher});
  mine.calls.length = 0;
  settings.saveSettings({schedule: {search: 0}});
  const done = await pushSchedule(settings, {fetcher: mine.fetcher});
  assert.deepEqual([done.skipped, done.off], [true, true]);
  assert.deepEqual(hours(mine.calls), []);
  assert.equal(state(settings).hoursSent, 6);   // the site still holds 6 h: the truth, not a guess
});

test('a refused push is not remembered, so the next start sends it again', async () => {
  const settings = store({schedule: {search: 6}, hostedSearch: {on: true, hoursSent: 4}});
  const refused = async () => Response.json({ok: false, error: 'no'}, {status: 500});
  assert.equal((await pushSchedule(settings, {fetcher: refused})).ok, false);
  assert.equal(state(settings).hoursSent, 4);
});
