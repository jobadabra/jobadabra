// Settings → Diagnostics → Updates: whether this is the latest version, from main's updateStatus.
import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
import {ago} from './jobs-view.js';

export function updateText({offer, checkedAt, fromSource, fromStore} = {}, now = Date.now()) {
  if (fromStore) return {latest: true, text: t('helperMore.storeUpdated')};
  if (fromSource) return {latest: true, text: t('helperMore.sourceUpdate')};
  if (offer) return {latest: false, text: t('helperMore.versionAvailable', {version: offer.version})};
  if (!checkedAt) return {latest: false, text: t('helperMore.notCheckedYet')};
  return {latest: true, text: t('helperMore.upToDate', {when: ago(checkedAt, now)})};
}

// Settings → Diagnostics → Test builds, from main's betaState: {test, on, fromSource, fromStore}. Builds made by hand (a "Build only" run of desktop.yml) with no test run on them.
export function testText({test, fromSource, fromStore} = {}) {
  if (fromStore) return {text: t('helperMore.storeVersions'), toggle: ''};
  if (fromSource) return {text: t('helperMore.notSourceBuild'), toggle: ''};
  return test ? {text: t('helperMore.testBuildsOn'), toggle: t('helperMore.turnOff')}
    : {text: t('helperMore.testBuildsOff'), toggle: t('helperMore.getTestBuilds')};
}

// Settings → Diagnostics → Beta, from main's betaState: {on, current, stable, ahead, fromSource, fromStore}.
export function betaText({on, current, stable, ahead, fromSource, fromStore} = {}) {
  if (fromStore) return {text: t('helperMore.storeVersions'), toggle: '', back: false};
  if (fromSource) return {text: t('helperMore.notSourceBuild'), toggle: '', back: false};
  if (ahead) return {text: on ? t('helperMore.aheadStableOn', {version: stable}) : t('helperMore.aheadStableOff', {version: stable}), toggle: on ? t('helperMore.turnOff') : t('helperMore.joinBeta'), back: true};
  return {text: on ? t('helperMore.betaOn') : t('helperMore.betaOff'), toggle: on ? t('helperMore.turnOff') : t('helperMore.getBeta'), back: false};
}
