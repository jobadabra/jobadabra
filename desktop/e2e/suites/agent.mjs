// The AI user agent: a person-like session on the real app. It gets a day's goals from the seeded planner (lib/agent-plan.mjs), knows how the app should behave (docs/app-expectations) and what it saw before,
// works each goal through the explorer loop with its own instructions, files what it can ARGUE is a bug (lib/agent-notes.mjs, with a cold second opinion) and records what it did even when it finds nothing.
// Job: report health
// BY HAND OR BY THE DAILY WORKFLOW ONLY (a measurement, never a gate): it asks the AI broker, so it needs a CI job with an id-token and never runs on a push:   gh workflow run e2e.yml -f suite=agent
// Why (3 Nov 2026, AI user agents 6/12; owner: "a claude agent that literally tests my app by clicking around. And can interpret on the fly things"): the suite only wires the real window and the broker;
// the session itself is lib/agent-run.mjs, played in unit tests by a scripted model. Goals come from the ⌘K palette only for now: the harness-made moves (restart, reload) come with the off-script moves (phase 2).
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {finish} from '../lib/layout.mjs';
import {ensureSetUp} from '../lib/seed.mjs';
import {AGENT_VIEWS, agentAct, shootPage} from '../lib/agent-act.mjs';
import {actorAskOf, brokerAsk, MODELS} from '../lib/agent-ask.mjs';
import {planLine, planSizing} from '../lib/agent-steps.mjs';
import {actorEngineOf, actorTierOf, conversationLine, engineLine, harnessTokens, runBudget, stoppedLabel, tokensLine} from '../lib/agent-tier.mjs';
import {actionSchema} from '../lib/explore.mjs';
import {areaOfView, changedSince, changedLines, knowledgeFor, mergeNotes} from '../lib/agent-knowledge.mjs';
import {readClosed} from '../lib/agent-closed.mjs';
import {memoryFiles, readExpectations, readNotes, readPending} from '../lib/agent-memory.mjs';
import {movesFromPalette, readPalette, withLanguage} from '../lib/agent-moves.mjs';
import {laneOf, laneSeed, moveKey, planSession, queueAfter, recordSession} from '../lib/agent-plan.mjs';
import {namedPlan, rulesOff, shapeFor, withoutRules} from '../lib/agent-plans.mjs';
import {AGENT_SYSTEM, agentExtend, goalIntro, runSession} from '../lib/agent-run.mjs';
import {runRecord, shotFiles} from '../lib/agent-run-record.mjs';
import {seedPlanData, waitCvRead} from '../lib/agent-seed.mjs';
import {summaryMarkdown} from '../lib/agent-session.mjs';
import {chainFor, endBeforeRun, endLink, pointerOf, previousLink, restoreLink} from '../lib/agent-chain-run.mjs';
import {startAgentVideo} from '../lib/agent-video.mjs';

export const name = 'agent';
export const keepGoing = true;
export const cadence = 'manual';   // never chosen by a schedule or a push (lib/plan.mjs); a person or the daily workflow names it
export const realAi = true;   // a live measurement, never a gate (see suites/explore.mjs)
export const minutes = 50;
// Why (3 Nov 2026, AI user agents 7/12, code review): the default suite budget is 7 minutes and cuts a running step at its end, which would end a 20-minute session at about 6 minutes with nothing written; a session runs to its own minute cap (E2E_AGENT_MINUTES) like the other manual suites.
export const aggregateBudget = false;
export const watches = ['desktop/e2e/lib/agent-run.mjs', 'desktop/e2e/lib/explore.mjs'];

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
// The caps of one session come from the workflow's repository variables (E2E_AGENT_*); by hand the defaults are a short session.
const CAPS = {maxMinutes: Number(process.env.E2E_AGENT_MINUTES) || 10, maxCalls: Number(process.env.E2E_AGENT_CALLS) || 60, maxSteps: Number(process.env.E2E_AGENT_STEPS) || 60};
const todaySeed = () => Number(new Date().toISOString().slice(0, 10).replace(/-/g, ''));

/**
 * The suite: sets the app up, plans the night, runs the session through lib/agent-run.mjs and leaves its findings (ctx.findings), its summary, trace and memory files (ARTIFACTS) behind.
 * Reads AGENT_SEED, AGENT_MEMORY_DIR, AGENT_CHANGED_LOG and E2E_AGENT_* from the environment; a broker that refuses ends the night with the step red and what was found kept.
 */
export async function run(ctx) {
  ctx.findings = [];
  // Why (5 Nov 2026, code review of the tier input; Gitar on #3212): a typo such as "Large" must not silently run the small tier, and it fails before the app is seeded or the video starts; a night with no tier acts on mid (5 Nov 2026, owner via mac-32: large stalls; lib/agent-tier.mjs) under a token cap (5 Nov 2026, owner via mac-32; lib/agent-tier.mjs).
  const actorTier = actorTierOf({requested: process.env.AGENT_TIER, kind: process.env.AGENT_KIND});
  const engine = actorEngineOf({requested: process.env.AGENT_ENGINE, claudeOn: process.env.AGENT_CLAUDE_ON});   // '' = Codex first, as always; 'claude' = Claude alone for the actor (the second opinion is always Claude)
  if (!Object.hasOwn(MODELS, actorTier)) throw new Error(`AGENT_TIER must be ${Object.keys(MODELS).join(', ')}, got "${actorTier}"`);
  // Why (5 Nov 2026, Gitar on #3213): the screen reader switch accepts only empty or 'off'; "Off" or "no" must not leave the reader on while the person asked for a run without it.
  const screen = process.env.AGENT_SCREEN || '';
  if (!['', 'off'].includes(screen)) throw new Error(`AGENT_SCREEN must be empty or off, got "${screen}"`);
  let {page} = ctx;   // replaced after a chain's restore: the relaunch opens a new window and closes this one
  await ensureSetUp(ctx);
  const memoryDir = process.env.AGENT_MEMORY_DIR || '';   // a checkout of the agent-memory branch (the workflow clones it); empty = a first night, nothing remembered
  const out = path.join(ctx.ARTIFACTS, 'agent-memory-out');
  const lane = laneOf(process.env.AGENT_LANE), batchSeed = Number(process.env.AGENT_SEED) || todaySeed(), seed = laneSeed(batchSeed, lane);   // Why (7 Nov 2026, pz): a lane plans from the batch seed's own slice of the pool and acts under its own seed (lib/agent-plan.mjs lanePool)
  const today = new Date().toISOString().slice(0, 10), commitNow = (process.env.GITHUB_SHA || '').slice(0, 7);

  let session = null;
  await ctx.run(`the AI user agent works its goals (seed ${seed}, at most ${CAPS.maxMinutes} min, ${CAPS.maxCalls} broker calls, ${CAPS.maxSteps} steps)`, async () => {
    // Why (4 Nov 2026, AI user agents FR 3/4, owner: "All four now"): a night with free goals gets ONE known-bug data shape in the app, picked by its seed (AGENT_SHAPE pins it, 'none' turns it off), because the suite's one applicant never has the data the tester bugs needed (lib/agent-plans.mjs SHAPES). A named plan seeds its own data and no shape.
    const shapeId = shapeFor(seed, process.env.AGENT_SHAPE, process.env.AGENT_PLAN);
    // Why (5 Nov 2026, SC 2/2, owner: "chained runs"): a later link of a chain restores the app's data the last link saved instead of seeding it again, and refuses a chain of another app commit.
    const chainDir = process.env.AGENT_CHAIN_DIR || '', {prev: prevChain, ended: chainEnded} = previousLink(chainDir, commitNow);
    if (chainEnded) return endBeforeRun({ctx, prev: prevChain, ended: chainEnded});
    let restored = '';
    if (prevChain) ({restored, page} = await restoreLink(ctx, chainDir, prevChain));
    const seeded = prevChain ? '' : await seedPlanData(ctx, process.env.AGENT_PLAN || '', seed, shapeId);
    if (seeded) { console.log(`  ${seeded}`); await page.reload(); await page.waitForSelector('.view:not([hidden])'); console.log(`  the app kept its CV read after ${await waitCvRead(ctx, process.env.AGENT_PLAN || '', shapeId)} ms`); }   // the app reads the CV and the rows again on a fresh load
    // Why (7 Nov 2026, pz, code review): the night's pool was the palette alone, so the language goal (an OWN_MOVE) was never drawn; only that move is added, the other OWN_MOVES have no harness step yet
    const moves = withLanguage(movesFromPalette(await readPalette(page)));
    const coverage = memoryDir && fs.existsSync(path.join(memoryDir, 'coverage.json')) ? JSON.parse(fs.readFileSync(path.join(memoryDir, 'coverage.json'), 'utf8')) : [];
    const changedLog = process.env.AGENT_CHANGED_LOG && fs.existsSync(process.env.AGENT_CHANGED_LOG) ? fs.readFileSync(process.env.AGENT_CHANGED_LOG, 'utf8') : '';
    // Why (3 Nov 2026, AI user agents 8/12): a replay run (AGENT_PLAN: one named plan of the proof, lib/agent-plans.mjs) is a measurement of one app state, so what changed since the last night does not steer it; AGENT_RULES_OFF takes rules out of what the agent knows (the unprompted run).
    const planId = process.env.AGENT_PLAN || '';
    const changed = changedSince(planId ? '' : changedLog);
    const available = new Set(moves.map(moveKey));
    const pending = readPending(memoryDir).filter(goal => available.has(moveKey(goal)));
    // Why (7 Nov 2026, pz, owner: "3–4 goals per run"): the plan is sized from the run's token meter before it is drawn (lib/agent-steps.mjs goalCountFor), so every planned goal is funded at the engine's step price (a heavier page than the default can still leave a later goal short); 43 of 122 goals in 31 runs were never started.
    const budget = runBudget();
    const {stepTokens, goalMax} = planSizing(budget.usable(), process.env);   // Why (7 Nov 2026, pz): see lib/agent-steps.mjs planSizing
    const fresh = planId ? namedPlan(planId, seed) : planSession({seed: batchSeed, lane, moves, coverage, changed: changed.areas, pending, max: goalMax});
    const {state: chainState, plan} = chainFor({prev: prevChain, links: process.env.AGENT_CHAIN_LINKS, fresh, tier: actorTier, commitNow, runId: process.env.GITHUB_RUN_ID || 'local'});
    const expectations = withoutRules(readExpectations(path.join(REPO, 'docs/app-expectations')), rulesOff(process.env.AGENT_RULES_OFF)), notes = memoryDir ? readNotes(memoryDir) : {};
    // Why (7 Nov 2026, pz, owner via mac-50: "are we treating the root cause?"): the closed by-design verdicts of the persona's issues are knowledge for the actor and the judge (lib/agent-closed.mjs); a replay or an unprompted run measures one app state, so it is told none.
    const closed = planId || rulesOff(process.env.AGENT_RULES_OFF).length ? {} : readClosed();
    console.log(`  closed verdicts told to the agent and the judge: ${Object.values(closed).flat().length}${process.env.AGENT_CLOSED_FILE ? '' : ' (none: no file; a replay, an unprompted run or a local run)'}`);
    const areas = [...new Set([...plan.goals.map(goal => goal.group), ...changed.areas])].filter(area => expectations[area] || notes[area] || closed[area]);
    const knowledge = [knowledgeFor(areas, {expectations, notes, closed}), changed.changes.length ? `## Changed since your last session\n${changedLines(changed).join('\n')}` : ''].filter(Boolean).join('\n\n');
    // Why (5 Nov 2026, owner via mac-32: "Assuming the initial context/harness would be max 20k"): what every actor call carries before the page is measured now and the run fails here, before any call, when it is over 20k; the cap of 250k is spent on the app, not on the same words again.
    const harness = harnessTokens({system: AGENT_SYSTEM, schema: actionSchema(AGENT_VIEWS, agentExtend({knowledgeIds: [], views: AGENT_VIEWS, goal: {}, sink: []})), intros: plan.goals.map(goal => goalIntro(goal, knowledge))});
    console.log(`  harness: ${harness} tokens in every call before the page (limit 20000)`);
    console.log(planLine({plan, goalMax, usable: budget.usable(), stepTokens, planId, changedAreas: changed.areas}));
    const started = Date.now(), video = await startAgentVideo(page, {dir: ctx.ARTIFACTS, minutes: CAPS.maxMinutes}), act = agentAct(page);
    let kept = null;
    const meter = {usable: budget.usable, actorUsed: () => budget.state.used.actor, stepTokens};   // Why (7 Nov 2026, #3378): goals are sized by the token meter
    const actorAsk = actorAskOf(actorTier, engine);   // a night on one engine has none to fall back to
    try {
      session = await runSession({act, ask: budget.actor(actorAsk), failover: actorAsk.failover, judgeAsk: budget.judge(brokerAsk('mid', {only: 'claude'})), judgeKnowledge: note => knowledgeFor([areaOfView(note.view)], {expectations, notes, closed, maxTokens: 1000}), screenAsk: screen === 'off' ? null : budget.reader(brokerAsk('mid', {only: 'claude'})), views: AGENT_VIEWS, plan, knowledge, knowledgeIds: Object.values(expectations).flat().map(entry => entry.id),
        caps: CAPS, meter, log: line => console.log(line), shoot: () => shootPage(page), where: video.position, session: {id: `${today}-${seed}`, snapshot: commitNow, run: process.env.GITHUB_RUN_ID || '', chain: pointerOf(chainState)}});
    } finally { kept = await video.finish(); console.log(`  ${tokensLine(budget.state, actorTier)}`); }   // Why (5 Nov 2026, 9/12 part 2b and the tier cap): a session that throws still leaves the video of what it did and the line of what the actor ran on; `kept` (the video's meta) is what the run record below reads
    // Why (5 Nov 2026, owner via mac-32: cap each run at 250k tokens): the cap refusing the actor's next call ends the session cleanly, it is not a lost broker: the notes made are kept and the run is green.
    session.stopped = stoppedLabel(session.stopped, budget.state);
    session.summary.stopped = session.stopped;
    Object.assign(session.summary.cost, {countedTokens: budget.state.total, capTokens: budget.state.capTokens});
    if (session.unfunded.length) console.log(`  ${session.unfunded.length} goal(s) not started: the token budget could not fund them (goals ${session.unfunded.join(', ')})`);
    console.log(`  ${session.stopped}; ${session.summary.counts.worked} worked, ${session.summary.counts.bug} bug(s), ${session.findings.length} filed, ${((Date.now() - started) / 60000).toFixed(1)} min`);
    ctx.findings.push(...session.findings);
    // The memory the workflow pushes to the agent-memory branch afterwards (this suite never touches git): merged notes per area, the coverage record, the plan's pairs.
    const merged = {};
    for (const [area, texts] of Object.entries(session.observations)) merged[area] = mergeNotes(notes[area] || [], texts, {today, commit: (process.env.GITHUB_SHA || '').slice(0, 7), session: `${today}-${seed}`});
    for (const [file, text] of Object.entries(memoryFiles({...notes, ...merged}))) { fs.mkdirSync(path.dirname(path.join(out, file)), {recursive: true}); fs.writeFileSync(path.join(out, file), text); }
    fs.mkdirSync(out, {recursive: true});
    fs.writeFileSync(path.join(out, 'coverage.json'), JSON.stringify(recordSession(coverage, {...plan, goals: plan.goals.filter(goal => session.completed.includes(goal.n))}), null, 1));
    fs.writeFileSync(path.join(out, 'pending.json'), JSON.stringify(queueAfter(session, pending, plan), null, 1));   // Why (7 Nov 2026, pz): a changed area the budget had no slot for is queued, not forgotten
    fs.writeFileSync(path.join(ctx.ARTIFACTS, 'agent-session.json'), JSON.stringify({...session.summary, stopped: session.stopped, unfunded: session.unfunded, persona: plan.persona.name, newShare: plan.newShare, actor: budget.state, engine: engine || 'broker order'}, null, 2));
    fs.writeFileSync(path.join(ctx.ARTIFACTS, 'agent-summary.md'), `${summaryMarkdown(session.summary)}\n\n${tokensLine(budget.state, actorTier)}\n${engineLine({engine, steps: session.trace.length, actorTokens: budget.state.used.actor})}\n${conversationLine(session.trace)}\n`);
    fs.writeFileSync(path.join(ctx.ARTIFACTS, 'agent-trace.jsonl'), session.trace.map(row => JSON.stringify(row)).join('\n') + '\n');
    // Why (4 Nov 2026, AI user agents 9/12 part 2b; FR 3/4: its plan field also names a night's seeded shape, "shape inbound"): the record and one picture per note, for the Admin "AI persona" tab; the workflow's upload step sends them (agent-run-upload.mjs), this suite sends nothing.
    fs.writeFileSync(path.join(ctx.ARTIFACTS, 'agent-run.json'), JSON.stringify(runRecord(session, {run: process.env.GITHUB_RUN_ID || 'local', at: new Date(started).toISOString(), kind: process.env.AGENT_KIND || 'night', commit: (process.env.GITHUB_SHA || '').slice(0, 7), plan: planId || (shapeId ? `shape ${shapeId}` : '')}, kept)));
    for (const shot of shotFiles(session.notes)) fs.writeFileSync(path.join(ctx.ARTIFACTS, shot.name), shot.data);
    if (chainState) await endLink({ctx, state: chainState, session, restored, tokens: budget.state.total, runId: process.env.GITHUB_RUN_ID || 'local', commitNow});
    if (session.stopped.startsWith('api:')) throw new Error(`the agent could not finish thinking (${session.stopped}): what it found so far is kept, the rest of the night is not run`);
  }, {needs: ctx.needs, limitMs: (CAPS.maxMinutes + 5) * 60000});   // Why (3 Nov 2026): the runner's default step limit is 8 minutes; a session runs up to its own minute cap
  fs.writeFileSync(path.join(ctx.ARTIFACTS, 'seed.json'), JSON.stringify({seed, fixed: true, detail: `AI user agent: ${session ? `${session.summary.goals.length} goals, ${session.findings.length} filed` : 'did not run'}`}));
  await ctx.run('the agent findings are written', async () => { finish(ctx); }, {needs: ctx.needs});
}
