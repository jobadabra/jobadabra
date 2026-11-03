// A stand-in for the app's storage in the desktop AI tests: sealed secrets and settings in memory, so no test touches the owner's Keychain, secrets.json or settings.json.
export function fakeStorage(extra = {}) {
  const secrets = {...extra};
  const settings = {};
  return {
    secret: name => secrets[name] || '',
    setSecret: (name, value) => { if (value) secrets[name] = value; else delete secrets[name]; },
    settings: () => settings,
    saveSettings: patch => { Object.assign(settings, patch); for (const key of Object.keys(patch)) if (patch[key] === undefined) delete settings[key]; return settings; },
    secrets,
  };
}
