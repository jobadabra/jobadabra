// Jobs' "Apply to jobs" dialog (owner, 28 Oct 2026 rework of #2317): it applies to jobs. The same three cards as Settings → Apply, only a built mode
// can be picked (the others say Coming soon), a pick is that batch's mode only and never writes Settings (owner, 7 Nov 2026, #3363), and the button says "Apply to N jobs".
import {readScreenSource} from '../../static-screen-source.js';
import assert from 'node:assert/strict';
import path from 'node:path';
import {test} from 'node:test';
import {applyButtonLabel, applyDialogOutcome, applyDialogPick, applyDialogStart, createApplyStartGate} from '../../../renderer/apply-dialog-model.js';
import {MODES, batchConfirmation, batchOf, modeBuilt, modeRunner} from '../../../renderer/apply-settings-model.js';
import {registerApplyHandlers} from '../../../lib/apply-handlers.js';
import {guard} from '../../../lib/apply-choice-gate.js';

const desktop = path.resolve(import.meta.dirname, '../../..');
const read = file => readScreenSource(path.join(desktop, file), 'utf8');

function register(mode, {chosen = true} = {}) {
  const handles = new Map(), starts = [], saves = [];
  let settings = {apply: {mode, chosenAt: chosen ? '2026-10-27T00:00:00.000Z' : ''}};
  const storage = {settings: () => settings, saveSettings: patch => { saves.push(patch); }};
  const ipcMain = {handle: guard((name, handler) => handles.set(name, handler), () => storage)};
  registerApplyHandlers({DEMO: false, extensionGate: () => null, allowanceBlock: async () => null, needsNotion: () => null,
    claudeConsent: async () => true, ipcMain, log: () => {}, here: desktop, storage, toWindow: () => {}, track: () => {}, shell: {},
    prepareKitFor: async () => ({}), startClaude: async () => ({ok: true}), getRecipeReporter: () => null, cloud: {},
    applyRunner: {start: async (_storage, options) => { starts.push(options); return {ok: true}; }}});
  return {handles, starts, saves, setSettings: value => { settings = value; }};
}

test('the primary button applies to jobs: "Apply to N jobs" from the count, never a settings action', () => {
  assert.equal(applyButtonLabel('3'), 'Apply to 3 jobs');
  assert.equal(applyButtonLabel(1), 'Apply to 1 job');
  assert.equal(applyButtonLabel('10'), 'Apply to 10 jobs');
  for (const bad of ['', '0', '11', '1.5', 'x']) assert.equal(applyButtonLabel(bad), 'Apply to jobs', bad);
  const page = read('renderer/pages/jobs-apply.js');
  assert.match(page, /applyButtonLabel\(/);
  assert.doesNotMatch(page + read('renderer/apply-dialog-model.js'), /Confirm Apply mode|Unavailable|for review'|saved to Settings/);
});

test('an unbuilt mode cannot be picked in the dialog: nothing is asked or written', async () => {
  let asked = 0;
  const confirm = async () => { asked++; return true; };
  for (const mode of MODES.filter(item => !modeBuilt(item.id)).map(item => item.id)) assert.equal((await applyDialogPick({mode, settings: {}, confirm})).ok, false, mode);
  assert.equal((await applyDialogPick({mode: 'other', settings: {}, confirm})).ok, false);
  assert.equal(asked, 0);
});

// Owner, 7 Nov 2026, #3363: "We don't want to change the settings from the Apply to jobs. We should let the user explicitly go and change that in the settings."
// The old rule (28 Oct 2026: a card pick is saved through Settings → Apply's writer) is replaced for this dialog only; this test asserts the opposite of the one it replaces.
test('a pick in the dialog is that batch\'s mode only: Start carries it, Settings is never written, the next dialog opens on Settings\' mode', async () => {
  const registered = register('fill');
  const pick = await applyDialogPick({mode: 'check', settings: {apply: {mode: 'fill'}}, confirm: async () => assert.fail('Standard automation asks nothing')});
  assert.deepEqual(pick, {ok: true, mode: 'check', autoConfirmedAt: '', linkedinConfirmedAt: ''});
  assert.equal((await applyDialogStart({count: '2', pick: pick.mode, autoConfirmedAt: pick.autoConfirmedAt, chosen: true, start: args => registered.handles.get('apply')({}, args)})).ok, true);
  assert.deepEqual(registered.starts, [{n: 2, mode: 'chrome', applyMode: 'check', checkFirst: true, pick: 'check'}], 'the batch ran in the pick, not in Settings\' Background mode');
  assert.deepEqual(registered.saves, [], 'nothing was written to Settings');
  const next = await applyDialogStart({count: '1', start: args => registered.handles.get('apply')({}, args)});   // the next dialog: no click, no pick
  assert.equal(next.ok, true);
  assert.deepEqual(registered.starts[1], {n: 1, mode: 'background', applyMode: 'fill', checkFirst: true}, 'with no pick the batch follows Settings, which never changed');
  const page = read('renderer/pages/jobs-apply.js');
  assert.doesNotMatch(page, /saveSettings\(|save as saveApplySettings/, 'the dialog has no writer of settings.apply');
  assert.match(page, /picked = ''; confirmedAt = '';/, 'every open starts on Settings\' mode');
});

// Owner, 7 Nov 2026: "we can choose a different apply mode every time, for every new batch": Fill, then Full automation, then Fill again, each in its own mode, each Full automation asked in its own call.
test('Full automation is confirmed in the call that picks it: asked again for every batch, declined means no pick, Settings\' own confirmed Full automation is not asked again', async () => {
  const settings = {apply: {mode: 'fill'}}, asks = [], now = () => new Date('2026-11-07T10:00:00.000Z');
  const answer = yes => async () => { asks.push(yes); return yes; };
  assert.deepEqual(await applyDialogPick({mode: 'auto', settings, confirm: answer(true), now}), {ok: true, mode: 'auto', autoConfirmedAt: '2026-11-07T10:00:00.000Z', linkedinConfirmedAt: ''});
  assert.deepEqual(await applyDialogPick({mode: 'fill', settings, confirm: answer(true), now}), {ok: true, mode: 'fill', autoConfirmedAt: '', linkedinConfirmedAt: ''}, 'Background automation carries no confirmation');
  assert.equal((await applyDialogPick({mode: 'auto', settings, confirm: answer(true), now})).ok, true);
  assert.deepEqual(asks, [true, true], 'the second Full automation batch asked again, nothing was inherited from the first');
  assert.equal((await applyDialogPick({mode: 'auto', settings, confirm: answer(false), now})).ok, false, 'declined: the pick stays where it was');
  const confirmedInSettings = {apply: {mode: 'auto', autoConfirmedAt: '2026-11-01T08:00:00.000Z'}};
  assert.deepEqual(await applyDialogPick({mode: 'auto', settings: confirmedInSettings, confirm: async () => assert.fail('Settings\' own confirmation stands'), now}), {ok: true, mode: 'auto', autoConfirmedAt: '', linkedinConfirmedAt: ''});
});

test('the confirmation a batch runs under is the one in its own call (recent) or Settings\' own, never another batch\'s', () => {
  const now = Date.parse('2026-11-07T10:00:00.000Z'), fill = {apply: {mode: 'fill', autoConfirmedAt: '2026-10-01T00:00:00.000Z'}};
  assert.equal(batchConfirmation('2026-11-07T09:59:00.000Z', fill, now), '2026-11-07T09:59:00.000Z', 'a stamp from this call');
  assert.equal(batchConfirmation('2026-11-07T08:00:00.000Z', fill, now), '', 'a stamp two hours old is not this call\'s');
  assert.equal(batchConfirmation('2026-11-07T09:45:00.000Z', fill, now), '', 'a dialog left open past ten minutes asks again');
  assert.equal(batchConfirmation('2026-11-07T10:30:00.000Z', fill, now), '', 'a stamp from the future is no confirmation');
  assert.equal(batchConfirmation('', fill, now), '', 'Settings on Background automation holds no Full automation confirmation');
  assert.equal(batchConfirmation('nonsense', {apply: {mode: 'auto', autoConfirmedAt: '2026-11-01T08:00:00.000Z'}}, now), '2026-11-01T08:00:00.000Z', 'Settings\' own confirmed Full automation');
});

// Why (14 Nov 2026, owner, plan 4b-1, asked via AskUserQuestion: "In the Full auto confirm (Recommended)"): LinkedIn sends only after its own yes, asked in the Full automation confirmation.
test('with Easy Apply on, Full automation\'s confirmation shows the LinkedIn line and its yes is the "LinkedIn may send" stamp; a confirmed Full automation without it asks again', async () => {
  const at = '2026-11-14T10:00:00.000Z', now = () => new Date(at), on = {linkedinJobs: {on: true}, easyApply: {on: true}}, asked = [];
  const confirm = async options => { asked.push(options); return true; };
  assert.deepEqual(await applyDialogPick({mode: 'auto', settings: {...on, apply: {mode: 'fill'}}, confirm, now}), {ok: true, mode: 'auto', autoConfirmedAt: at, linkedinConfirmedAt: at});
  const confirmedBefore = {...on, apply: {mode: 'auto', autoConfirmedAt: '2026-11-01T08:00:00.000Z'}};
  assert.equal((await applyDialogPick({mode: 'auto', settings: confirmedBefore, confirm, now})).linkedinConfirmedAt, at, 'Easy Apply turned on after Full automation was confirmed: asked again');
  const both = {...on, apply: {mode: 'auto', autoConfirmedAt: '2026-11-01T08:00:00.000Z', linkedinConfirmedAt: '2026-11-01T08:00:00.000Z'}};
  assert.deepEqual(await applyDialogPick({mode: 'auto', settings: both, confirm: async () => assert.fail('both yeses stand'), now}), {ok: true, mode: 'auto', autoConfirmedAt: '', linkedinConfirmedAt: ''});
  assert.equal((await applyDialogPick({mode: 'auto', settings: {linkedinJobs: {on: true}, easyApply: {on: false}, apply: {mode: 'fill'}}, confirm, now})).linkedinConfirmedAt, '', 'Easy Apply off: no LinkedIn yes');
  assert.deepEqual(asked, [{linkedin: true}, {linkedin: true}, {linkedin: false}], 'the line shown is the yes stamped');

  const clock = Date.parse(at), fresh = '2026-11-14T09:59:00.000Z';
  assert.deepEqual(batchOf('auto', {autoConfirmedAt: fresh, linkedinConfirmedAt: fresh}, {apply: {mode: 'fill'}}, clock), {autoConfirmedAt: fresh, linkedinConfirmedAt: fresh}, 'this call\'s yeses');
  assert.deepEqual(batchOf('auto', {}, both, clock), {autoConfirmedAt: '2026-11-01T08:00:00.000Z', linkedinConfirmedAt: '2026-11-01T08:00:00.000Z'}, 'Settings\' own yeses');
  assert.deepEqual(batchOf('auto', {}, confirmedBefore, clock), {autoConfirmedAt: '2026-11-01T08:00:00.000Z', linkedinConfirmedAt: ''}, 'no LinkedIn yes anywhere: LinkedIn jobs wait for the person');
  assert.deepEqual(batchOf('fill', {autoConfirmedAt: fresh, linkedinConfirmedAt: fresh}, both, clock), {autoConfirmedAt: '', linkedinConfirmedAt: ''}, 'only Full automation carries a yes');
});

test('a mode is built exactly when it names its batch runner; Standard\'s is the visible Chrome batch, Background\'s the hidden browser', () => {
  assert.deepEqual(Object.fromEntries(MODES.map(mode => [mode.id, modeRunner(mode.id)])), {check: 'chrome', fill: 'background', auto: 'background'});
  for (const mode of MODES) assert.equal(modeBuilt(mode.id), !!modeRunner(mode.id), mode.id);
  const handlers = read('lib/apply-handlers.js');
  assert.match(handlers, /applyMode = fromSettings \? picked \|\| applyOf\(settings\)\.mode/, 'main reads the dialog\'s pick, else the saved (built) mode');
  assert.match(handlers, /background\.enqueue\(jobs, which, batch, eligibility\)/, 'the batch\'s mode, confirmation and captured eligibility reach the queue');
  assert.match(handlers, /fromSettings \? modeRunner\(applyMode\)/, 'main starts the runner that mode names');
});

test('a start whose call fails says so and gives the button back', () => {
  const page = read('renderer/pages/jobs-apply.js');
  assert.match(page, /catch \(error\) \{[^}]*Could not start applying/);
  assert.match(page, /busy: saving \|\| gate\.isStarting\(\)/, 'the cards are off while a batch starts');
});

// Why (8 Nov 2026, owner: "bad UI" on the three full-width Inspect buttons): the job's title is the link that opens the Jobs drawer, as in the Jobs list; no button per row.
test('batch outcome inspection is the title link and the Jobs page drawer callback', () => {
  const page = read('renderer/pages/jobs-apply.js');
  assert.match(read('renderer/pages/apply-result.js'), /el\('a', 'apply-outcome-title', row\.title\)/);
  assert.doesNotMatch(page + read('renderer/pages/apply-result.js'), /Inspect job/);
  assert.match(page, /openJob\(job, 'application'\)/);
  assert.doesNotMatch(page, /from '\.\/job-panel\.js'/, 'Jobs injects the drawer opener to avoid a page dependency cycle');
  assert.match(read('renderer/pages/jobs.js'), /wireApplyDialog\(\{startedApplying, openJob: openJobPanel\}\)/);
});

test('fully refused batches keep the error tone when they also have per-job outcomes', () => {
  assert.match(read('renderer/pages/jobs-apply.js'), /view\.note\?\.tone === 'error' \? 'error' : undefined/);
  assert.match(read('renderer/apply-result-model.js'), /'not-started': \['notStarted', 'warn', 'clock', 'skipped'\]/, 'a verdict about the job is a warning with an icon; only a failure is red');
  assert.match(read('renderer/pages/jobs-apply.js'), /classList\.toggle\('apply-result'/, 'one state at a time: results hide the form');
  assert.match(read('renderer/pages/jobs-apply.js'), /batchFinished = !!result\.ok;[^\n]*\n\s*showOutcomes\(result/, 'batchFinished is set before showOutcomes: no "Change and try again" over a batch that started jobs');
});

test('Start sends the validated count; the main process runs the saved mode\'s own runner', async () => {
  const registered = register('check');
  const result = await applyDialogStart({count: '3', start: args => registered.handles.get('apply')({}, args)});
  assert.equal(result.ok, true);
  assert.deepEqual(registered.starts, [{n: 3, mode: 'chrome', applyMode: 'check', checkFirst: true}]);
});

test('a saved Background automation starts the hidden browser\'s runner (no extension needed: it carries its own copy)', async () => {
  const registered = register('fill');
  const result = await applyDialogStart({count: '2', start: args => registered.handles.get('apply')({}, args)});
  assert.equal(result.ok, true);
  assert.deepEqual(registered.starts, [{n: 2, mode: 'background', applyMode: 'fill', checkFirst: true}]);
});

test('the first-choice gate holds Start, then the main process reads the mode chosen in it', async () => {
  const registered = register('check', {chosen: false});
  const send = () => registered.handles.get('apply')({}, {n: 2, mode: 'settings'});
  assert.equal((await send()).needsApplyChoice, true);
  assert.deepEqual(registered.starts, []);
  registered.setSettings({apply: {mode: 'check', chosenAt: '2026-10-28T01:00:00.000Z'}});
  assert.equal((await send()).ok, true);
  assert.deepEqual(registered.starts, [{n: 2, mode: 'chrome', applyMode: 'check'}]);
});

test('invalid counts and cancel do not start a job batch', async () => {
  const registered = register('check');
  for (const count of ['0', '11', '1.5', '']) {
    const result = await applyDialogStart({count, start: args => registered.handles.get('apply')({}, args)});
    assert.equal(result.ok, false, count);
  }
  const cancelled = await applyDialogStart({count: '3', cancelled: true, start: args => registered.handles.get('apply')({}, args)});
  assert.equal(cancelled.cancelled, true);
  assert.deepEqual(registered.starts, []);
});

test('a second Start while the first batch is in flight cannot dispatch another batch', async () => {
  const gate = createApplyStartGate();
  let releaseFirst, starts = 0;
  const first = gate.run(() => new Promise(resolve => { starts++; releaseFirst = resolve; }));
  assert.equal(gate.isStarting(), true);
  assert.deepEqual(await gate.run(async () => { starts++; return {ok: true}; }), {ignored: true});
  assert.equal(starts, 1);
  releaseFirst({ok: true});
  assert.deepEqual(await first, {ok: true});
  assert.equal(gate.isStarting(), false);
  assert.deepEqual(await gate.run(async () => { starts++; return {ok: true}; }), {ok: true});
  assert.equal(starts, 2);
  assert.match(read('renderer/pages/jobs-apply.js'), /if \(gate\.isStarting\(\)\) return;/, 'typing in the count while starting keeps the button off');
});

test('the dialog: count, the shared mode cards, a native Close, one primary button; no saved-mode badge or mode paragraph', () => {
  const html = read('renderer/index.html');
  const at = html.indexOf('<dialog id="apply-dialog">'), dialog = html.slice(at, html.indexOf('</dialog>', at));
  assert.match(dialog, /<form method="dialog" id="apply-form">/);
  assert.match(dialog, /<button class="secondary" value="cancel">Close<\/button>/);
  assert.match(dialog, /id="apply-n" type="number" min="1" max="10"/);
  assert.match(dialog, /id="apply-mode-cards"/);
  // Why (8 Nov 2026, [fa] 2/2): a Full automation batch's check panel replaces the form while it shows (apply-check.css), so each view has one primary button.
  const panelAt = dialog.indexOf('id="apply-check"'), panel = dialog.slice(panelAt, dialog.indexOf('id="apply-start-banner"'));
  assert.equal((dialog.replace(panel, '').match(/class="primary"/g) || []).length, 1);
  assert.equal((panel.match(/class="primary"/g) || []).length, 1, 'the check panel: Cancel and one "Apply to N jobs"');
  assert.ok(dialog.indexOf('id="apply-n"') < dialog.indexOf('id="apply-mode-cards"'), 'how many jobs first: the dialog is about applying');
  assert.doesNotMatch(dialog + read('renderer/components.css'), /apply-mode-description|is-apply-saved-badge|apply-mode-summary/);
  assert.match(read('renderer/pages/jobs-apply.js'), /modeCards\(picked \|\| applyOf\(settings\)\.mode/, 'the preselected card is this batch\'s pick, else Settings\' mode');
});

test('the window cannot start the hidden browser by naming its runner: only the saved mode reaches it', async () => {
  const {handles, starts} = register('check');
  const result = await handles.get('apply')(null, {n: 1, mode: 'background', applyMode: 'auto'});
  assert.equal(result.ok, false);
  assert.deepEqual(starts, []);
});

// Owner's screenshot (28 Oct 2026): "Could not start applying: Error invoking remote method 'apply': Error: This job is not eligible…" showed Electron's own wrapper.
test('a start that fails as a call (not a refusal) shows the reason without Electron\'s IPC wrapper', async () => {
  const wrapped = new Error("Error invoking remote method 'apply': Error: An object could not be cloned.");
  const result = await applyDialogStart({count: 1, start: async () => { throw wrapped; }});
  assert.equal(result.ok, false);
  assert.equal(result.error, 'Could not start applying: An object could not be cloned. Try again in a moment.');
  assert.doesNotMatch(result.error, /remote method|^Error/);
});

test('a queued batch is a toast to Sessions and the dialog closes; a refusal stays in the dialog as its error (owner screenshots, 28 Oct 2026)', () => {
  assert.deepEqual(applyDialogOutcome({ok: true, message: '2 applications queued.'}), {close: true, toast: {title: 'Applying started', body: '2 applications queued.', target: {view: 'sessions'}, tone: 'good'}});
  assert.deepEqual(applyDialogOutcome({ok: false, error: 'Download the browser first.'}), {close: false, error: 'Download the browser first.'});
  assert.equal(applyDialogOutcome(undefined).close, false);
  assert.match(applyDialogOutcome({}).error, /Try again/);
});

test('a partial batch with per-job outcomes stays open so skipped and failed jobs remain inspectable', () => {
  const outcomes = [
    {url: 'https://jobs.example.test/1', title: 'Fictional Pilot', company: 'Example Air', status: 'started', reason: ''},
    {url: 'https://jobs.example.test/2', title: 'Fictional First Officer', company: 'Example Air', status: 'ineligible', reason: 'Required credential missing.'},
    {url: 'https://jobs.example.test/3', title: 'Fictional Captain', company: 'Example Air', status: 'failed', reason: 'The application kit could not be saved.'},
  ];
  assert.deepEqual(applyDialogOutcome({ok: true, message: '1 application queued.', outcomes}), {close: false, outcomes});
  assert.deepEqual(applyDialogOutcome({ok: false, error: 'No applications were started.', outcomes}), {close: false, outcomes});
  assert.equal(applyDialogOutcome({ok: false, code: 'BACKGROUND_BROWSER_MISSING', error: 'Download Jobadabra\'s browser first.', outcomes}).browserOffer, true, 'the download offer survives when failed rows are shown');
});

test('an all-started batch still closes to the Sessions toast when its outcome list has no skips or failures', () => {
  const result = applyDialogOutcome({ok: true, message: '2 applications queued.', outcomes: [
    {url: 'https://jobs.example.test/1', status: 'started'}, {url: 'https://jobs.example.test/2', status: 'started'},
  ]});
  assert.deepEqual(result, {close: true, toast: {title: 'Applying started', body: '2 applications queued.', target: {view: 'sessions'}, tone: 'good'}});
});

test('while a batch starts the dialog shows its strip and no spinner row: the strip is in the markup, hidden until then, and the page never asks for a waiting message', () => {
  assert.match(read('renderer/index.html'), /id="apply-progress"[^>]*hidden/);
  assert.doesNotMatch(read('renderer/pages/jobs-apply.js'), /'waiting'/);
});


test('drafting progress has its own wrapping status; it never becomes the primary button label', () => {
  assert.match(read('renderer/index.html'), /id="apply-start-status"[^>]*role="status"/);
  assert.match(read('renderer/pages/jobs-apply.js'), /onApplyProgress[^\n]*apply-start-status/);
  assert.doesNotMatch(read('renderer/pages/jobs-apply.js'), /onApplyProgress[^\n]*apply-go/);
});

// Code review (7 Nov 2026): the first-choice gate holds Start and replays it with the SAME arguments after the person's choice in the gate; a pick sent before it would override that choice.
test('before Settings → Apply was ever chosen the pick is not sent: the batch follows what the person chooses in the first-choice gate', async () => {
  const sent = [];
  for (const chosen of [false, true]) await applyDialogStart({count: '1', pick: 'auto', autoConfirmedAt: '2026-11-07T10:00:00.000Z', chosen, start: async args => { sent.push(args); return {ok: true}; }});
  assert.deepEqual(sent, [{n: 1, mode: 'settings', checkFirst: true}, {n: 1, mode: 'settings', checkFirst: true, pick: 'auto', autoConfirmedAt: '2026-11-07T10:00:00.000Z'}], 'every Start asks for the check first');
  assert.match(read('renderer/pages/jobs-apply.js'), /chosen: applyChosen\(settings\)/, 'the page tells the model whether Settings was chosen');
});
