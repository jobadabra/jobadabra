/* global document, getComputedStyle */
// Job: report health
// The AI explorer: Claude USES the app (a compact text view of the page and a few tools), like a curious, careful person, on paths no suite scripted.
// Every bug it reports carries a CHECK a script can verify, and is replayed WITHOUT AI from a fresh page: only a bug whose check holds again becomes a
// finding (filed by the Finder like any other). "The agent explores, a script proves": an AI's one-off judgement never reaches the issue list alone.
// Safety: it presses only what the interaction probe may press (lib/interact.mjs isSafe), never Enter, and types at most 200 characters.
// Why (3 Nov 2026, AI user agents 2/7): the AI broker answers plain text, not tool calls (lib/broker-client.mjs), so each turn is ONE JSON action in a fixed shape (actionSchema) that this file
// validates; the API-key path is gone. A session ends at its own caps: broker calls, minutes, steps.
import {isSafe} from './interact.mjs';

export const CHECKS = ['text_visible', 'text_missing', 'console_error', 'dead_control'];
export const KEYS = ['Escape', 'Tab', 'Shift+Tab', 'ArrowDown', 'ArrowUp'];
export const ACTIONS = ['click', 'type', 'press', 'go', 'report_bug', 'done'];
/** The actions a run may answer with: the explorer's, minus `extend.without` (an agent notes bugs with `note`, so report_bug is not offered), plus `extend.actions`. */
export const actionsOf = extend => [...ACTIONS.filter(action => !extend?.without?.includes(action)), ...(extend?.actions || [])];
const KINDS = ['functionality', 'error-shown', 'text', 'layout', 'consistency', 'empty-state'];
const SEVERITIES = ['high', 'medium', 'low'];

/**
 * The one answer shape of a turn: every field is required (a strict structured answer), the ones an action does not use are '' (control: -1).
 * `extend` ({actions, properties}) adds the actions and fields of a goal-driven session (lib/agent-run.mjs); without it the shape is the explorer's, unchanged.
 */
export function actionSchema(views, extend = null) {
  const text = {type: 'string'}, choice = values => ({type: 'string', enum: ['', ...values]});
  const properties = {action: {type: 'string', enum: actionsOf(extend)}, control: {type: 'integer'}, text, key: choice(KEYS), view: choice(views),
    title: text, kind: choice(KINDS), severity: choice(SEVERITIES), what: text, check_type: choice(CHECKS), check_text: text, check_control: text, summary: text, ...(extend?.properties || {})};
  return {type: 'object', additionalProperties: false, required: Object.keys(properties), properties};
}

export const SYSTEM = `You test the Jobadabra desktop app (a job-search tool) in a TEST account, like a curious, careful person who wants to find real bugs.
Explore what scripted tests miss: multi-step flows, doing things in an odd order, filters and sorting, opening and closing things, going away and coming back, empty and error states.
A real bug, by severity: high = it BLOCKS a task (a needed control missing or doing nothing, a wrong result or false status, a raw error or technical text shown, lost data);
medium = it confuses the person or makes them work around it, or it is plainly bad UX; low = barely noticeable.
Never report: taste; a toast, tooltip or animation caught half-way; a guess about how the app works inside; anything you cannot show on the page.
Every report needs a CHECK a script can verify after replaying your steps since your latest "go": text_visible / text_missing with EXACT text you saw, console_error, or dead_control
with the control's label. Prefer few, solid reports over many weak ones. Controls marked [not allowed] are refused (they delete, send, sign in, leave the app or spend AI credit).
You have a limited number of steps: when you have explored enough, answer with the action done.
Each turn you answer with ONE JSON action and nothing else. action is click (control = its index), type (control, text), press (key), go (view), report_bug (title, kind, severity, what,
check_type and check_text or check_control) or done (summary). Fields the action does not use are "" (control: -1).`;

// Runs in the page: what a person sees (the visible page's text, open dialogs and toasts) and the controls, each tagged data-explore=<index>.
export function observePage() {
  for (const old of document.querySelectorAll('[data-explore]')) old.removeAttribute('data-explore');
  const visible = el => { const box = el.getBoundingClientRect(); const style = getComputedStyle(el); return box.width > 2 && box.height > 2 && style.visibility !== 'hidden' && style.display !== 'none' && !el.closest('[hidden]'); };
  const controls = [];
  for (const el of document.querySelectorAll('button, a[href], [role="button"], [role="tab"], input, textarea, select, summary')) {
    if (controls.length >= 120 || !visible(el) || el.closest('nav, .sidebar')) continue;
    const kind = /^(INPUT|TEXTAREA)$/.test(el.tagName) ? 'field' : el.tagName === 'SELECT' ? 'select' : el.tagName === 'A' ? 'link' : 'button';
    const label = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.getAttribute('name') || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    el.setAttribute('data-explore', String(controls.length));
    // Why (4 Nov 2026, AI user agents, owner: "Yes, fix it now"): the badge in a control ("What we learned" + the pill "2 to check") is information, not the press; safety reads the name without the app's pills, so "check" in a count never refuses the tab (replay 41807054784: the whole Profile tab was [not allowed]).
    const named = el.cloneNode(true);
    for (const badge of named.querySelectorAll('.ui-pill')) badge.remove();
    const safeLabel = el.getAttribute('aria-label') ? label : named.textContent.replace(/\s+/g, ' ').trim().slice(0, 80);
    controls.push({i: controls.length, kind, label, safeLabel, disabled: !!el.disabled, cls: String(el.className || ''), href: el.getAttribute('href') || '', type: el.getAttribute('type') || ''});
  }
  const shown = document.querySelector('.view:not([hidden])');
  const text = (shown?.innerText || document.body.innerText || '').replace(/\n{3,}/g, '\n\n').slice(0, 3000);
  const overlays = [...document.querySelectorAll('#toasts .toast, dialog[open]')].map(node => node.innerText.replace(/\s+/g, ' ').trim().slice(0, 200)).filter(Boolean);
  return {view: shown?.dataset.view || '', text, overlays, controls};
}

// A control's safety is judged on its own name (safeLabel: the label without the app's pills, as a count "2 to check" is not a press); an old record without one keeps its label.
// Typing into a field presses nothing (Enter is never sent), so a field named "Search" is allowed; a password field never is. Anything pressable follows the probe's rule.
export const allowed = control => !control.disabled && control.type !== 'password' && (control.kind === 'field' || isSafe({text: control.safeLabel ?? control.label, cls: control.cls, href: control.href}));

export function formatObservation(seen) {
  return [`Page: ${seen.view || '(unknown)'}`, ...(seen.overlays.length ? [`Open dialogs and toasts: ${seen.overlays.join(' | ')}`] : []), '', 'Visible text:', seen.text, '',
    'Controls (index · kind · label):', ...seen.controls.map(c => `${c.i} · ${c.kind} · ${c.label || '(no label)'}${c.disabled ? ' [disabled]' : ''}${allowed(c) ? '' : ' [not allowed]'}`)].join('\n');
}

// The replayable steps of a report: from the latest "go" before it (or the start) to the report.
export function segmentFor(log, at) {
  let start = 0;
  for (let i = Math.min(at, log.length) - 1; i >= 0; i--) if (log[i].tool === 'go') { start = i; break; }
  return log.slice(start, at).filter(step => ['go', 'click', 'type', 'press'].includes(step.tool));
}
export const stepWords = step => (step.tool === 'go' ? `Open ${step.view}` : step.tool === 'click' ? `Press "${step.label}"` : step.tool === 'type' ? `Type "${step.text}" into "${step.label}"` : `Press the ${step.key} key`);

/** One turn's answer text -> the action, or {error} when it is not one JSON object with a known action. */
export function parseAction(text, actions = ACTIONS) {
  let input;
  try { input = JSON.parse(String(text).trim().replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { return {error: 'your answer was not one JSON object'}; }
  return input && actions.includes(input.action) ? input : {error: `action must be one of ${actions.join(', ')}`};
}

/** What one broker call used, added to the session's tally (per tier, so a small-vs-mid run compares). `answer`: {usage, ms, tier}. */
function spend(spent, answer) {
  const tier = answer.tier || 'unknown', row = spent.tiers[tier] ||= {calls: 0, input: 0, output: 0, ms: 0};
  const input = answer.usage?.input_tokens || 0, output = answer.usage?.output_tokens || 0, ms = Number.isFinite(answer.ms) ? answer.ms : 0;
  for (const target of [spent, row]) { target.calls++; target.input += input; target.output += output; target.ms += ms; }
}

// The loop. `act`: {observe(), click(i), type(i, text), press(key), go(view)}; `ask({system, messages, schema})` -> {text, usage, ms, tier, engine?} (the broker's answer; it throws when the broker refuses).
// Stops on done, at its caps (steps, broker calls, minutes on the injected clock), or when the broker refuses (nothing is filed from a run that could not finish thinking).
// Returns {steps, bugs, trace, spent, stopped, final}: `trace` has one row per turn (what it did and what that turn cost) for the session's step record; `final` is the answer that ended the run (done), or null.
// A goal-driven session passes `system` (its own instructions), `first` (the goal and what it knows, put before the first page view) and `extend` ({actions, properties, take(input, row) -> reply text}):
// the extra actions never touch the page, they are answered by `take` (Why, 3 Nov 2026, AI user agents 6/12: one loop for the explorer and the agent, so a fix to the loop reaches both).
export async function explore({act, ask, views, caps = {}, now = Date.now, log = () => {}, system = SYSTEM, first = '', extend = null}) {
  const {maxSteps = 40, maxCalls = 260, maxMinutes = 35} = caps;
  const started = now(), steps = [], bugs = [], trace = [], spent = {calls: 0, input: 0, output: 0, ms: 0, tiers: {}};
  let seen = await act.observe(), stopped = 'steps';
  const messages = [{role: 'user', content: `${first ? `${first}\n\n` : ''}Start. You have at most ${maxSteps} steps.\n\n${formatObservation(seen)}`}];
  let final = null;
  for (let turn = 0; turn < maxSteps; turn++) {
    if (spent.calls >= maxCalls) { stopped = `calls ${maxCalls}`; break; }
    if ((now() - started) / 60000 >= maxMinutes) { stopped = `minutes ${maxMinutes}`; break; }
    let answer;
    try { answer = await ask({system, messages, schema: actionSchema(views, extend)}); } catch (error) { stopped = `api: ${String(error.message).slice(0, 160)}`; break; }
    spend(spent, answer);
    messages.push({role: 'assistant', content: answer.text});
    const input = parseAction(answer.text, actionsOf(extend)), row = {n: turn + 1, view: seen.view, action: input.action || 'invalid', tier: answer.tier, engine: answer.engine || '', ms: answer.ms ?? null, tokens: (answer.usage?.input_tokens || 0) + (answer.usage?.output_tokens || 0)};
    const turned = await takeTurn({input, act, seen, steps, bugs, views, row, extend});
    seen = turned.seen;
    // Older page views are dropped from the conversation: the latest one is what matters, and the prompt stays short.
    for (const message of messages) if (message.role === 'user' && message.content.length > 400 && message !== messages[0]) message.content = '(an earlier page view, omitted)';
    messages.push({role: 'user', content: turned.reply});
    trace.push(row);
    log(`  step ${turn + 1}: ${row.action} (${spent.calls} calls, ${spent.input + spent.output} tokens)`);
    if (turned.finished) { stopped = 'done'; final = input; break; }
  }
  return {steps, bugs, trace, spent, stopped, final};
}

/** Why an action is refused, or '' when it may run: the control must be in the latest view and allowed, a page and a key must come from their lists. */
function refusal(input, seen, views) {
  const tool = input.action, control = Number.isInteger(input.control) ? seen.controls[input.control] : null;
  if ((tool === 'click' || tool === 'type') && (!control || !allowed(control))) return `Refused: control ${input.control} is ${control ? 'not allowed' : 'not in the latest page view'}.`;
  if (tool === 'type' && control.kind !== 'field') return 'Refused: that control is not a field.';
  if (tool === 'go' && !views.includes(input.view)) return `Refused: ${input.view || 'no page'} is not a page of the app.`;
  if (tool === 'press' && !KEYS.includes(input.key)) return `Refused: the key must be one of ${KEYS.join(', ')}.`;
  return '';
}

/** A bug report: recorded when its check is one a script can verify, else refused. Returns the reply to the AI. */
function takeReport(input, steps, bugs, row) {
  const check = {type: input.check_type, text: input.check_text, control: input.check_control};
  if (!CHECKS.includes(check.type)) return `Refused: the check must be one of ${CHECKS.join(', ')}.`;
  bugs.push({title: input.title, kind: input.kind, severity: input.severity, what: input.what, check, steps: segmentFor(steps, steps.length), at: steps.length});
  row.title = input.title;
  return 'Recorded. It will be replayed without AI.';
}

/** The step of a performed action, as the replay and the person's words read it. */
function stepOf(input, control) {
  const tool = input.action;
  if (tool === 'go') return {tool, view: input.view};
  if (tool === 'press') return {tool, key: input.key};
  return {tool, label: control.label, kind: control.kind, ...(tool === 'type' ? {text: String(input.text || '').slice(0, 200)} : {})};
}

/** One answered turn: refuses, records a report, stops, or performs the action and reads the page again. Returns {reply, seen, finished}; `row` gets what was done. */
async function takeTurn({input, act, seen, steps, bugs, views, row, extend}) {
  if (input.error) return {reply: `Refused: ${input.error}.`, seen, finished: false};
  if (input.action === 'done') return {reply: 'Stopped.', seen, finished: true};
  if (extend?.actions.includes(input.action)) return {reply: await extend.take(input, row, {steps}), seen, finished: false};
  if (input.action === 'report_bug') return {reply: takeReport(input, steps, bugs, row), seen, finished: false};
  const refused = refusal(input, seen, views);
  if (refused) return {reply: refused, seen, finished: false};
  const control = Number.isInteger(input.control) ? seen.controls[input.control] : null, step = stepOf(input, control);
  let reply = '';
  try { await act[step.tool](step.tool === 'go' ? input.view : step.tool === 'press' ? input.key : control.i, step.text); steps.push(step); }
  catch (error) { reply = `That failed: ${String(error.message).split('\n')[0].slice(0, 160)}\n\n`; row.failed = true; }
  row.did = stepWords(step);
  const after = await act.observe();
  return {reply: reply + formatObservation(after), seen: after, finished: false};
}

// Replays a report's steps WITHOUT AI and evaluates its check. `act` as above plus readText(), errorsSince(mark) / errorMark(), and measure(label) -> {changed, calls} for a press.
export async function replay({act, bug}) {
  const mark = act.errorMark();
  for (const step of bug.steps) {
    if (step.tool === 'go') await act.go(step.view);
    else if (step.tool === 'press') await act.press(step.key);
    else {
      const seen = await act.observe();
      const control = seen.controls.find(c => c.label === step.label && c.kind === step.kind && allowed(c));
      if (!control) return {reproduced: false, why: `"${step.label}" was not on the page when replayed`};
      await act[step.tool](control.i, step.text);
    }
  }
  const check = bug.check;
  if (check.type === 'text_visible' || check.type === 'text_missing') {
    const has = (await act.readText()).replace(/\s+/g, ' ').includes(String(check.text || '').replace(/\s+/g, ' ').trim());
    const held = check.type === 'text_visible' ? has && !!String(check.text || '').trim() : !has;
    return {reproduced: held, why: `"${check.text}" ${has ? 'is' : 'is not'} on the page`};
  }
  if (check.type === 'console_error') { const errors = act.errorsSince(mark); return {reproduced: errors.length > 0, why: errors[0] ? `console: ${errors[0].slice(0, 160)}` : 'no console error'}; }
  const result = await act.measure(String(check.control || ''));
  return {reproduced: !!result && !result.changed && !result.calls, why: result ? `pressing "${check.control}": ${result.changed ? 'the page changed' : 'nothing changed'}, ${result.calls} call(s)` : `"${check.control}" not found`};
}
