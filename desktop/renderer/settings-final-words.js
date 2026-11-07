// Known Settings display labels follow the active locale while storage, channel IDs and unknown raw labels remain canonical.
import {settingsText as words} from '../i18n/settings-native.js';
import {hostPlatform} from '../i18n/platform.js';

/** Display known notification-channel names without changing their saved identifiers or order. */
export function channelNames(channels) {
  const keys = {email: 'channelEmail', app: 'channelApp', telegram: 'channelTelegram'};
  return channels.length ? channels.map(name => keys[name] ? words(keys[name]) : name).join(', ') : words('channelNothing');
}

/** Use a typed known local-store identity for presentation; provider/unknown labels remain byte-for-byte unchanged. */
export function storeLabel(store, name = store.name, platform = hostPlatform()) {
  return name === 'sqlite' ? words(platform === 'win32' ? 'localPc' : 'localMac') : store.label;
}

/** Resolve the displayed day independently of the canonical today filter/IPC token. */
export function logDay(day, format) { return day === 'today' ? words('today') : format(day); }
