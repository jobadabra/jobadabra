// Guard: release — without the cache folder in the launch env every macOS run's Electron cache stays cold and one GitHub 504 reddens the release suites; a CI secret beside it must still not reach the app.
// Why (10 Nov 2026, fr; RC soak 42582847751, 9 apply reds on 8-9 Nov): the macOS jobs fetch Electron's zip at the first launch, inside the child that lib/app-env.mjs
// filters down to an allowlist. `electron_config_cache` was not on it, so the zip went to ~/Library/Caches/electron, the cache action found nothing to save and every
// macOS run stayed cold: one GitHub 504 on the release host reddened the suite. The action's variable and the allowlist must name the same thing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {appLaunchEnv} from '../../lib/app-env.mjs';

const ACTION = fileURLToPath(new URL('../../../../.github/actions/electron-cache/action.yml', import.meta.url));

test('the variable the cache action exports reaches the launched app, and a secret next to it does not', () => {
  const exported = [...fs.readFileSync(ACTION, 'utf8').matchAll(/echo "([A-Za-z_]+)=\$RUNNER_TEMP\/[^"]*" >> "\$GITHUB_ENV"/g)].map(match => match[1]);
  assert.deepEqual(exported, ['electron_config_cache'], 'the action exports its cache folder through one variable');
  const env = appLaunchEnv({PATH: '/bin', [exported[0]]: '/runner/_temp/electron-cache', E2E_ANTHROPIC_KEY: 'fake-key-value'});
  assert.equal(env[exported[0]], '/runner/_temp/electron-cache');
  assert.equal(env.E2E_ANTHROPIC_KEY, undefined);
});
