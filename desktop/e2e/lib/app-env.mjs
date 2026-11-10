// The traced app and browsers inherit only named runtime settings; CI credentials stay in the harness.
// Job: run the backbone
// Why (10 Nov 2026, fr; RC soak 42582847751): ELECTRON_CONFIG_CACHE is the folder CI's cache action restores and saves for Electron's zip (.github/actions/electron-cache). The app is launched through node_modules/.bin/electron, which fetches a missing zip in THIS filtered env; without the name the zip went to ~/Library/Caches/electron, the cache never got saved on macOS and a GitHub 504 reddened the suites. It is a folder path, not a secret.
const RUNTIME = new Set(['PATH', 'Path', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'TMPDIR', 'LOCALAPPDATA', 'APPDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMDATA', 'DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'LANG', 'LC_ALL', 'TZ', 'CI', 'PYTHONPATH', 'PYTHONUTF8', 'NODE_V8_COVERAGE', 'COVERAGE_PROCESS_START', 'COVERAGE_FILE', 'E2E_PY_COVERAGE_DIR', 'ELECTRON_CONFIG_CACHE'].map(name => name.toUpperCase()));

// Why (10 Nov 2026, hw): Claude Code reads its sign-in from the Keychain under USER. Never inherited (a test must not reach the owner's Claude Code); only a caller that names it,
// which is practice/launch.mjs, the one launcher meant to use the person's own signed-in Claude Code. Guard: e2e/test/harness/launch-secrets.test.mjs.
const EXPLICIT_ONLY = new Set(['USER']);
/** Build launch options without inherited CI secrets; explicit product hooks remain, credential overrides do not. */
export function appLaunchEnv(base, overrides = {}) {
  const result = Object.fromEntries(Object.entries(base).filter(([name]) => RUNTIME.has(name.toUpperCase())));
  for (const [name, value] of Object.entries(overrides)) {
    if (RUNTIME.has(name.toUpperCase()) || name.startsWith('JOBADABRA_') || EXPLICIT_ONLY.has(name) || ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'].includes(name)) result[name] = value;
  }
  // withoutWrappers reads a plain object's PATH; Windows commonly supplies Path instead.
  result.PATH ??= Object.entries(result).find(([name]) => name.toUpperCase() === 'PATH')?.[1];
  if (result.PATH === undefined) delete result.PATH;
  // Invariant: CI credential names cannot be smuggled back through suite overrides.
  for (const name of Object.keys(result)) if (/^(?:E2E_.*(?:KEY|TOKEN)|ACTIONS_|CI_.*(?:TOKEN|KEY))/.test(name)) delete result[name];
  // Invariant: a suite cannot copy an inherited CI secret into a differently named product hook.
  for (const [name, value] of Object.entries(base)) {
    const testerKey = name === 'JOBADABRA_TESTER_KEY' && overrides.JOBADABRA_TESTER === 'persona' && overrides.JOBADABRA_E2E === '1' && result.JOBADABRA_TESTER_KEY === value;
    if (value?.length >= 8 && /(?:^|_)(?:KEY|TOKEN|SECRET|PASSWORD)(?:_|$)/.test(name)
      && Object.entries(result).some(([key, setting]) => String(setting).includes(value) && !(testerKey && key === 'JOBADABRA_TESTER_KEY'))) throw new Error(`CI credential override refused: ${name}`);
  }
  return result;
}
