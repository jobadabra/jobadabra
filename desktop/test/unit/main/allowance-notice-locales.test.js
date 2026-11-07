// Selected-language allowance guidance preserves actual credit/trial gates, payload flags and raw cap messages without live services.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createAppAllowance} from '../../../lib/app-allowance.js';
import {setLocale, SUPPORTED_LOCALES} from '../../../i18n/index.js';
import {setSiteOff} from '../../../lib/recipes.js';
import common from '../../../i18n/catalogs/screens/common.js';
import profile from '../../../i18n/catalogs/screens/profile.js';
import {logFile} from '../../../lib/log.js';

const NOW = 1800000000000;
const trial = ['The free trial is over.', 'Die kostenlose Testphase ist vorbei.', 'La période d’essai gratuite est terminée.', 'Il periodo di prova gratuito è terminato.', 'La prueba gratuita ha terminado.', 'Perioada de probă gratuită s-a încheiat.', 'Бесплатный пробный период завершён.'];

function fixture({plan, ended = false, ownKey = false} = {}) {
  const forbidden = [], sent = [];
  const deny = name => { forbidden.push(name); throw Error(`Forbidden ${name}`); };
  const settings = {aiFree: !ownKey, ...(plan ? {plan: {at: NOW, status: plan}} : {})};
  const storage = {settings: () => settings, saveSettings: () => deny('write'), secret: () => deny('secret')};
  const app = createAppAllowance({DEMO: false, getStorage: () => storage, getTelemetry: () => null,
    getLicense: () => ({state: () => ({licensed: false, license: null, used: 25, limit: 20, daysLeft: 0, ended})}),
    log: () => {}, toWindow: (...args) => sent.push(args)});
  app.getPlan().caps = async () => null;
  return {app, forbidden, sent};
}

test('actual trial and credit gates retain verdicts while their authored errors follow each locale', t => {
  const network = [];
  t.mock.timers.enable({apis: ['Date'], now: NOW});
  t.mock.method(globalThis, 'fetch', () => { network.push('fetch'); throw Error('No network'); });
  assert.equal(logFile(), null);
  setSiteOff('');
  try {
    for (const [column, locale] of SUPPORTED_LOCALES.entries()) {
      setLocale(locale);
      const free = fixture({ended: true, ownKey: true});
      const result = free.app.allowanceBlock();
      assert.equal(result.ok, false);
      assert.equal(result.allowance, true);
      assert.ok(result.error.startsWith(trial[column]), locale);
      assert.ok(result.error.includes(`${common.messages.settings[column]} → ${profile.messages.text223[column]}`), locale);
      assert.equal(free.sent[0][0], 'allowance');
      assert.deepEqual(free.forbidden, []);
      for (const credit of [{hasCredit: false, warn: null}, {hasCredit: true, warn: 0}]) {
        const pro = fixture({plan: {plan: 'pro', mode: 'test', ...credit}});
        const blocked = pro.app.allowanceBlock();
        assert.deepEqual({ok: blocked.ok, credit: blocked.credit}, {ok: false, credit: true});
        if (locale !== 'en') assert.doesNotMatch(blocked.error, /^(Our AI|Your AI credit)/);
        assert.equal(blocked.allowance, undefined);
        assert.ok(blocked.error.includes([common.messages.settings[column], common.messages.connections[column], common.messages.ai[column]].join(' → ')), locale);
        assert.deepEqual(pro.forbidden, []);
      }
    }
    assert.deepEqual(network, []);
  } finally { setLocale('en'); setSiteOff(''); }
});

test('raw cap messages remain exact and only a missing-message fallback localizes', async t => {
  const network = [], raw = 'Fictional this Mac Keychain ⌘K {error}';
  t.mock.timers.enable({apis: ['Date'], now: NOW});
  t.mock.method(globalThis, 'fetch', () => { network.push('fetch'); throw Error('No network'); });
  try {
    for (const [column, locale] of SUPPORTED_LOCALES.entries()) {
      setLocale(locale);
      for (const message of [raw, '']) {
        const f = fixture();
        f.app.getPlan().caps = async () => ({capped: 'day', resetsAt: '2099-01-01T00:00:00Z', message});
        const result = await f.app.allowanceGate();
        assert.equal(result.credit, true);
        assert.equal(result.cap, 'day');
        assert.equal(result.resetsAt, '2099-01-01T00:00:00Z');
        if (message) assert.equal(result.error, raw);
        else {
          assert.ok(result.error.includes([common.messages.settings[column], common.messages.connections[column], common.messages.ai[column]].join(' → ')), locale);
          if (locale !== 'en') assert.doesNotMatch(result.error, /^Free AI is not available/);
        }
        assert.deepEqual(f.forbidden, []);
      }
    }
    assert.deepEqual(network, []);
  } finally { setLocale('en'); }
});
