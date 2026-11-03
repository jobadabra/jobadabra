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
import {agentAct, shootPage} from '../lib/agent-act.mjs';
import {brokerAsk} from '../lib/agent-ask.mjs';
import {changedSince, changedLines, knowledgeFor, mergeNotes} from '../lib/agent-knowledge.mjs';
import {memoryFiles, readExpectations, readNotes} from '../lib/agent-memory.mjs';
import {movesFromPalette, readPalette} from '../lib/agent-moves.mjs';
import {planSession, recordSession} from '../lib/agent-plan.mjs';
import {runSession} from '../lib/agent-run.mjs';
import {summaryMarkdown} from '../lib/agent-session.mjs';
import {VIEWS} from '../lib/uicheck.mjs';

export const name = 'agent';
export const keepGoing = true;
export const cadence = 'manual';   // never chosen by a schedule or a push (lib/plan.mjs); a person or the daily workflow names it
export const realAi = true;   // a live measurement, never a gate (see suites/explore.mjs)
export const minutes = 50;
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
  const {page} = ctx;
  await ensureSetUp(ctx);
  const errors = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(String(error.message || error)));
  const memoryDir = process.env.AGENT_MEMORY_DIR || '';   // a checkout of the agent-memory branch (the workflow clones it); empty = a first night, nothing remembered
  const out = path.join(ctx.ARTIFACTS, 'agent-memory-out');
  const seed = Number(process.env.AGENT_SEED) || todaySeed();
  const today = new Date().toISOString().slice(0, 10);

  let session = null;
  await ctx.run(`the AI user agent works its goals (seed ${seed}, at most ${CAPS.maxMinutes} min, ${CAPS.maxCalls} broker calls, ${CAPS.maxSteps} steps)`, async () => {
    const moves = movesFromPalette(await readPalette(page));
    const coverage = memoryDir && fs.existsSync(path.join(memoryDir, 'coverage.json')) ? JSON.parse(fs.readFileSync(path.join(memoryDir, 'coverage.json'), 'utf8')) : [];
    const changedLog = process.env.AGENT_CHANGED_LOG && fs.existsSync(process.env.AGENT_CHANGED_LOG) ? fs.readFileSync(process.env.AGENT_CHANGED_LOG, 'utf8') : '';
    const changed = changedSince(changedLog);
    const plan = planSession({seed, moves, coverage, changed: changed.areas});
    const expectations = readExpectations(path.join(REPO, 'docs/app-expectations')), notes = memoryDir ? readNotes(memoryDir) : {};
    const areas = [...new Set([...plan.goals.map(goal => goal.group), ...changed.areas])].filter(area => expectations[area] || notes[area]);
    const knowledge = [knowledgeFor(areas, {expectations, notes}), changed.changes.length ? `## Changed since your last session\n${changedLines(changed).join('\n')}` : ''].filter(Boolean).join('\n\n');
    console.log(`  plan: ${plan.goals.length} goals, ${(plan.newShare * 100).toFixed(0)}% new move pairs; changed areas: ${changed.areas.join(', ') || 'none'}`);
    const started = Date.now();
    session = await runSession({act: agentAct(page, errors), ask: brokerAsk('small'), judgeAsk: brokerAsk('mid'), views: VIEWS, plan, knowledge, knowledgeIds: Object.values(expectations).flat().map(entry => entry.id),
      caps: CAPS, log: line => console.log(line), shoot: () => shootPage(page), session: {id: `${today}-${seed}`, snapshot: (process.env.GITHUB_SHA || '').slice(0, 7)}});
    console.log(`  ${session.stopped}; ${session.summary.counts.worked} worked, ${session.summary.counts.bug} bug(s), ${session.findings.length} filed, ${((Date.now() - started) / 60000).toFixed(1)} min`);
    ctx.findings.push(...session.findings);
    // The memory the workflow pushes to the agent-memory branch afterwards (this suite never touches git): merged notes per area, the coverage record, the plan's pairs.
    const merged = {};
    for (const [area, texts] of Object.entries(session.observations)) merged[area] = mergeNotes(notes[area] || [], texts, {today, commit: (process.env.GITHUB_SHA || '').slice(0, 7), session: `${today}-${seed}`});
    for (const [file, text] of Object.entries(memoryFiles({...notes, ...merged}))) { fs.mkdirSync(path.dirname(path.join(out, file)), {recursive: true}); fs.writeFileSync(path.join(out, file), text); }
    fs.mkdirSync(out, {recursive: true});
    fs.writeFileSync(path.join(out, 'coverage.json'), JSON.stringify(recordSession(coverage, plan), null, 1));
    fs.writeFileSync(path.join(ctx.ARTIFACTS, 'agent-session.json'), JSON.stringify({...session.summary, stopped: session.stopped, persona: plan.persona.name, newShare: plan.newShare}, null, 2));
    fs.writeFileSync(path.join(ctx.ARTIFACTS, 'agent-summary.md'), `${summaryMarkdown(session.summary)}\n`);
    fs.writeFileSync(path.join(ctx.ARTIFACTS, 'agent-trace.jsonl'), session.trace.map(row => JSON.stringify(row)).join('\n') + '\n');
    if (session.stopped.startsWith('api:')) throw new Error(`the agent could not finish thinking (${session.stopped}): what it found so far is kept, the rest of the night is not run`);
  }, {needs: ctx.needs, limitMs: (CAPS.maxMinutes + 5) * 60000});   // Why (3 Nov 2026): the runner's default step limit is 8 minutes; a session runs up to its own minute cap
  fs.writeFileSync(path.join(ctx.ARTIFACTS, 'seed.json'), JSON.stringify({seed, fixed: true, detail: `AI user agent: ${session ? `${session.summary.goals.length} goals, ${session.findings.length} filed` : 'did not run'}`}));
  await ctx.run('the agent findings are written', async () => { finish(ctx); }, {needs: ctx.needs});
}
