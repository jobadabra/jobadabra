/* global document */
// Job: report health
// The AI explorer (lib/explore.mjs): an AI uses the app on a path no suite scripted, and reports what looks wrong with a CHECK a script can verify. Every report is then REPLAYED
// without AI from a fresh page; only a bug whose check holds again becomes a finding (source explorer). BY HAND ONLY (a measurement, never a gate): it asks the AI broker
// (Codex, then Claude, then Free AI; lib/broker-client.mjs), so it needs a CI job with an id-token and never runs on a schedule or a push:   gh workflow run e2e.yml -f suite=explore
// Why (3 Nov 2026, AI user agents 2/7): the API-key path is gone; the run ends at its caps (E2E_AGENT_MINUTES, E2E_AGENT_CALLS, E2E_AGENT_TIER) and prints its tokens, seconds per call and per tier.
import {askBroker} from '../lib/broker-client.mjs';
import {noteBrokerCapped} from '../lib/ai-cap.mjs';
import {compareViews, formatComparison, formatTierProbe, sessionLine} from '../lib/agent-observe.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {finish} from '../lib/layout.mjs';
import {settle} from '../lib/app.mjs';
import {ensureSetUp} from '../lib/seed.mjs';
import {VIEWS} from '../lib/uicheck.mjs';
import {SYSTEM, actionSchema, explore, formatObservation, observePage, parseAction, replay, stepWords} from '../lib/explore.mjs';
import {goView} from '../lib/go-view.mjs';

export const name = 'explore';
export const keepGoing = true;
export const cadence = 'manual';   // never chosen by a schedule or a push (lib/plan.mjs); a person names it
// Why (2 Nov 2026, owner: "I want the guardrail to be general, for any e2e or itnegrations"): a live measurement, never a gate; its unanswered asks go on to the model (every other suite's are refused, test/ai/one-answer-rule.test.mjs).
export const realAi = true;
export const minutes = 50;   // Why (3 Nov 2026, AI user agents 2/7): room for a full 35-minute session (the daily workflow's cap), plus the comparison, the tier probe and the replays
export const watches = ['desktop/e2e/lib/explore.mjs'];

// The acting tier: small by default (spec: picking the next control from a named list is easy); mid for the small-vs-mid comparison run. A Claude id is what the broker's tierOf maps.
const TIER = process.env.E2E_AGENT_TIER === 'mid' ? 'mid' : 'small';
const MODEL = TIER === 'mid' ? 'claude-sonnet-5-5' : 'claude-haiku-5-5';
// Why (3 Nov 2026, AI user agents 2/7): the by-hand spike defaults to 10 minutes and 60 broker calls (about 1.5% of the Codex week at the old ceiling): it measures tokens and seconds per call, not a whole session.
// The spec's 35 minutes and 260 calls are what the daily workflow (5/7) passes in E2E_AGENT_MINUTES and E2E_AGENT_CALLS from repository variables.
const CAPS = {maxMinutes: Number(process.env.E2E_AGENT_MINUTES) || 10, maxCalls: Number(process.env.E2E_AGENT_CALLS) || 60};
CAPS.maxSteps = Number(process.env.E2E_AGENT_STEPS) || CAPS.maxCalls;   // a step is one call

export async function run(ctx) {
  ctx.findings = [];
  const {page} = ctx;
  await ensureSetUp(ctx);
  const errors = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(String(error.message || error)));
  const ipc = {
    mark: () => ctx.app.evaluate(() => (globalThis.__jpIpc || []).at(-1)?.seq || 0),
    since: mark => ctx.app.evaluate((_electron, from) => (globalThis.__jpIpc || []).filter(call => call.seq > from).map(({channel, ms}) => ({channel, ms})), mark),
  };
  const tagged = i => page.locator(`[data-explore="${i}"]`);
  const act = {
    observe: () => page.evaluate(observePage),
    click: async i => { await tagged(i).scrollIntoViewIfNeeded({timeout: 2000}).catch(() => {}); await tagged(i).click({timeout: 3000, noWaitAfter: true}); await page.waitForTimeout(700); },
    type: async (i, text) => { await tagged(i).fill(String(text || '').slice(0, 200), {timeout: 3000}); await page.waitForTimeout(300); },
    press: async key => { await page.keyboard.press(key); await page.waitForTimeout(400); },
    go: async view => { await goView(page, view); await settle(page); },
    readText: () => page.evaluate(() => (document.querySelector('.view:not([hidden])')?.innerText || document.body.innerText || '')),
    errorMark: () => errors.length,
    errorsSince: mark => errors.slice(mark),
    // A press, measured the way the interaction probe does: did the page change, did a call reach the app.
    measure: async label => {
      const seen = await page.evaluate(observePage);
      const control = seen.controls.find(item => item.label === label && !item.disabled);
      if (!control) return null;
      const snapshot = () => page.evaluate(() => `${document.body.innerText.length}:${document.body.innerHTML.length}:${location.hash}`);   // eslint-disable-line no-undef
      const before = await snapshot(), mark = await ipc.mark();
      await tagged(control.i).click({timeout: 3000, noWaitAfter: true}).catch(() => {});
      await page.waitForTimeout(1200);
      return {changed: (await snapshot()) !== before, calls: (await ipc.since(mark)).length};
    },
  };
  // One broker call per turn: the Messages-shaped request is the broker's `toBrokerCall` input; the answer's text is the action JSON.
  const ask = async ({system, messages, schema}, model = MODEL) => {
    const answer = await askBroker({model, max_tokens: 1024, system, messages, output_config: {format: {type: 'json_schema', schema}}});
    // Why (3 Nov 2026, Gitar on #3048; owner 31 Oct 2026): a broker that says no on its BUDGET greys the step with an alert, never fails it (a lost login fails it since 4 Nov 2026, owner via mac-32: a check that skips in grey without its login measures nothing); the runner reads this note (lib/ai-cap.mjs takeCapped), as for broker-relay and model.
    if (!answer.ok) { if (answer.status === 'capped') noteBrokerCapped(answer.detail); throw new Error(`${answer.status} ${answer.detail}`); }
    return {text: answer.message.content[0].text, usage: answer.message.usage, ms: answer.ms, tier: answer.tier, engine: answer.engine};
  };

  // The spike's first measurement (AI user agents 2/7: "tree or text"): what each view looks like to the agent as the explorer's text and as Playwright's accessibility snapshot.
  await ctx.run('the observation comparison: explorer text vs accessibility snapshot, per view', async () => {
    const rows = [];
    for (const view of VIEWS) {
      await goView(page, view);
      await settle(page);
      const t0 = Date.now(), text = formatObservation(await page.evaluate(observePage)), t1 = Date.now();
      const tree = await page.locator('.view:not([hidden])').first().ariaSnapshot(), t2 = Date.now();
      rows.push({view, text, tree, textMs: t1 - t0, treeMs: t2 - t1});
    }
    const comparison = compareViews(rows);
    console.log(formatComparison(comparison));
    fs.writeFileSync(path.join(ctx.ARTIFACTS, 'agent-observation.json'), JSON.stringify(comparison, null, 2));
  }, {needs: ctx.needs});

  // The tier probe: the same screen asked three times on each tier, so tokens and seconds per call are measured without two 35-minute sessions (which tier acts is chosen in 3/7, from named plans).
  await ctx.run('the tier probe: one screen asked on the small and the mid tier', async () => {
    await goView(page, 'jobs');
    await settle(page);
    const messages = [{role: 'user', content: `Start. You have at most 10 steps.\n\n${formatObservation(await page.evaluate(observePage))}`}];
    const rows = [];
    for (const [tier, model] of [['small', 'claude-haiku-5-5'], ['mid', 'claude-sonnet-5-5']]) {
      for (let n = 0; n < 3; n++) {
        const answer = await ask({system: SYSTEM, messages, schema: actionSchema(VIEWS)}, model);
        rows.push({tier: answer.tier || tier, engine: answer.engine || '', ms: answer.ms, input: answer.usage.input_tokens, output: answer.usage.output_tokens, action: parseAction(answer.text).action || 'invalid'});
      }
    }
    console.log(formatTierProbe(rows));
    fs.writeFileSync(path.join(ctx.ARTIFACTS, 'agent-tiers.json'), JSON.stringify(rows, null, 2));
  }, {needs: ctx.needs});

  let result = null;
  const started = Date.now();
  await ctx.run(`the AI explores the app (${TIER} tier, at most ${CAPS.maxMinutes} min or ${CAPS.maxCalls} broker calls)`, async () => {
    result = await explore({act, ask, views: VIEWS, caps: CAPS, log: line => console.log(line)});
    console.log(`  explorer stopped: ${result.stopped}; ${result.steps.length} step(s), ${result.bugs.length} report(s); ${sessionLine(result, Date.now() - started)}`);
    if (result.stopped.startsWith('api:')) throw new Error(`the explorer could not finish thinking (${result.stopped}): nothing is filed from this run`);
  }, {needs: ctx.needs, limitMs: (CAPS.maxMinutes + 5) * 60000});   // Why (3 Nov 2026): the runner's default step limit is 8 minutes; a session runs up to its own minute cap
  fs.writeFileSync(path.join(ctx.ARTIFACTS, 'ai-explorer-usage.json'), JSON.stringify({tier: TIER, model: MODEL, caps: CAPS, ms: Date.now() - started, spent: result?.spent, stopped: result?.stopped || 'failed'}, null, 2));
  if (!result) return;
  fs.writeFileSync(path.join(ctx.ARTIFACTS, 'agent-trace.jsonl'), result.trace.map(row => JSON.stringify(row)).join('\n') + '\n');

  // Each report is proved again without AI, from a fresh page. Only what holds again is a finding.
  const proved = [];
  for (const [at, bug] of result.bugs.entries()) {
    await ctx.run(`report ${at + 1} replayed without AI: ${String(bug.title).slice(0, 50)}`, async () => {
      await page.reload();
      await page.waitForSelector('.view:not([hidden])', {state: 'attached', timeout: 60000});
      await settle(page);
      const outcome = await replay({act, bug});
      console.log(`  report ${at + 1} "${bug.title}" (${bug.check.type}): ${outcome.reproduced ? 'REPRODUCED' : 'not reproduced'}; ${outcome.why}`);
      proved.push({bug, outcome});
      if (outcome.reproduced) {
        const goes = bug.steps.filter(step => step.tool === 'go').at(-1);
        ctx.findings.push({view: goes?.view || 'focus', severity: bug.severity, kind: bug.kind, title: bug.title, source: 'explorer',
          detail: `${bug.what} Replayed without AI and it held again: ${outcome.why}. Steps: ${bug.steps.map(stepWords).join(' → ') || '(on the first page)'}.`});
      }
    }, {needs: ctx.needs});
  }
  fs.writeFileSync(path.join(ctx.ARTIFACTS, 'explorer.json'), JSON.stringify({steps: result.steps, stopped: result.stopped, reports: proved.map(({bug, outcome}) => ({...bug, reproduced: outcome.reproduced, why: outcome.why}))}, null, 2));
  fs.writeFileSync(path.join(ctx.ARTIFACTS, 'seed.json'), JSON.stringify({seed: 0, fixed: true, detail: `AI explorer (${MODEL}): ${result.steps.length} steps, ${result.bugs.length} report(s), ${proved.filter(item => item.outcome.reproduced).length} proved again`}));
  await ctx.run('explorer findings are written', async () => { finish(ctx); }, {needs: ctx.needs});
}
