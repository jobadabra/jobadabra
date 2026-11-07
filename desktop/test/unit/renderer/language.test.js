// Changing desktop language never saves or reloads over an unsaved Profile or Strategy draft.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {changeLanguage, firstWizardStep} from '../../../renderer/language-change.js';
import {install} from '../../tiny-dom.js';

test('Welcome stays first and a language choice never adds a wizard step', () => {
  assert.equal(firstWizardStep({}), 'welcome');
  assert.equal(firstWizardStep({wizardStep: 'cv'}), 'cv');
  assert.equal(firstWizardStep({displayLanguage: 'ru', wizardStep: 'language'}), 'welcome');
  assert.equal(firstWizardStep({displayLanguage: 'system', wizardStep: 'cv'}), 'cv');
  assert.equal(firstWizardStep({displayLanguage: 'fr', wizardStep: 'extras'}), 'draft');
  assert.equal(firstWizardStep({displayLanguage: 'invalid'}), 'welcome');
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

test('a language dropdown is placed on Welcome and in Overview without a new step or card', async () => {
  const body = install({realNodeLists: true});
  const wizard = document.createElement('section'); wizard.id = 'wizard';
  const steps = document.createElement('ol'); steps.id = 'step-list';
  const welcomeItem = document.createElement('li'); welcomeItem.dataset.step = 'welcome'; steps.append(welcomeItem);
  const stepBody = document.createElement('div'); stepBody.className = 'step-body';
  const welcome = document.createElement('div'); welcome.className = 'step'; welcome.dataset.step = 'welcome';
  const magic = document.createElement('div'); magic.className = 'magic'; welcome.append(magic); stepBody.append(welcome);
  wizard.append(steps, stepBody);
  const overview = document.createElement('div'); overview.dataset.settingsPage = 'overview'; body.append(wizard, overview);
  const {init} = await import('../../../renderer/pages/language.js');
  init({choice: 'en', locale: 'en'}, {});
  assert.equal(steps.children[0].dataset.step, 'welcome');
  assert.equal(stepBody.children.length, 1);
  assert.equal(document.getElementById('wizard-language'), null);
  assert.ok(magic.contains(document.getElementById('wizard-language-choice')));
  assert.equal(document.getElementById('wizard-language-choice').value, 'en');
  assert.equal(document.getElementById('wizard-language-choice').options.length, 8);
  assert.ok(overview.contains(document.getElementById('settings-language')));
  assert.equal(document.getElementById('wizard-language-continue'), null);
  init({choice: 'en', locale: 'en'}, {});
  assert.equal(steps.children.length, 1, 'no sidebar step is added');
  assert.equal(document.querySelectorAll('#wizard-language-choice').length, 1, 'mounting twice does not duplicate the dropdown');
});
