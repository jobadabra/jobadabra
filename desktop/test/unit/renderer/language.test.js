// Changing desktop language never saves or reloads over an unsaved Profile or Strategy draft.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {changeLanguage, firstWizardStep} from '../../../renderer/language-change.js';
import {install} from '../../tiny-dom.js';

test('language is asked before the first wizard step and confirmation resumes welcome', () => {
  assert.equal(firstWizardStep({}), 'language');
  assert.equal(firstWizardStep({wizardStep: 'cv'}), 'language');
  assert.equal(firstWizardStep({displayLanguage: 'ru', wizardStep: 'language'}), 'welcome');
  assert.equal(firstWizardStep({displayLanguage: 'system', wizardStep: 'cv'}), 'cv');
  assert.equal(firstWizardStep({displayLanguage: 'fr', wizardStep: 'extras'}), 'draft');
  assert.equal(firstWizardStep({displayLanguage: 'invalid'}), 'language');
});

test('an unsaved draft blocks persistence and reload', async () => {
  const calls = [];
  const result = await changeLanguage('ru', {hasUnsaved: () => true, save: async () => calls.push('save'), reload: () => calls.push('reload')});
  assert.equal(result.reason, 'unsaved'); assert.deepEqual(calls, []);
});
test('a successful write precedes reload and a failed write never reloads', async () => {
  const calls = [];
  const result = await changeLanguage('de', {hasUnsaved: () => false, save: async choice => { calls.push(choice); return {choice, locale: choice}; }, reload: () => calls.push('reload')});
  assert.equal(result.ok, true); assert.deepEqual(calls, ['de', 'reload']);
  const failed = await changeLanguage('ru', {hasUnsaved: () => false, save: async () => { throw new Error('Disk full'); }, reload: () => calls.push('bad')});
  assert.equal(failed.ok, false); assert.equal(failed.reason, 'save'); assert.deepEqual(calls, ['de', 'reload']);
});

test('the language question is first in the wizard and a switch is mounted in Overview', async () => {
  const body = install({realNodeLists: true});
  const wizard = document.createElement('section'); wizard.id = 'wizard';
  const steps = document.createElement('ol'); steps.id = 'step-list';
  const welcomeItem = document.createElement('li'); welcomeItem.dataset.step = 'welcome'; steps.append(welcomeItem);
  const stepBody = document.createElement('div'); stepBody.className = 'step-body';
  const welcome = document.createElement('div'); welcome.className = 'step'; welcome.dataset.step = 'welcome'; stepBody.append(welcome);
  wizard.append(steps, stepBody);
  const overview = document.createElement('div'); overview.dataset.settingsPage = 'overview'; body.append(wizard, overview);
  const {init} = await import('../../../renderer/pages/language.js');
  init({choice: 'system', locale: 'en'}, {});
  assert.equal(steps.children[0].dataset.step, 'language');
  assert.equal(stepBody.children[0].id, 'wizard-language');
  assert.equal(document.getElementById('wizard-language-choice').options.length, 8);
  assert.ok(overview.contains(document.getElementById('settings-language')));
  assert.equal(document.getElementById('wizard-language-continue').textContent, 'Continue');
  init({choice: 'system', locale: 'en'}, {});
  assert.equal(steps.children.length, 2, 'mounting twice does not duplicate the first step');
});
