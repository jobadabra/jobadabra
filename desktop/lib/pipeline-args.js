// Owns: the command lines the app gives the engine: dailyArgs (the workflow's own command), mailArgs, visitsArgs, syncMatchesArgs, scoreQueueArgs,
// the search and scout budgets, and triggerEnv.
// Guarded by: test/unit/main/pipeline-run.test.js, test/unit/renderer/mail-report.test.js, test/unit/main/run-kinds.test.js, test/unit/main/tune.test.js, test/unit/main/notion-trying.test.js.
// Split out of pipeline.js (a pure move); pipeline.js re-exports everything.
import * as claudeCode from './claude-code.js';
import {cadence} from './cadence.js';
import {deliveryReady, telegramReady} from './notify-channel.js';

export {deliveryReady, telegramReady};

// The same command .github/workflows/daily.yml runs for these inputs (mode, job, action, page, seed,
// file, note), so Telegram buttons and commands work the same from the app as from the cloud.
// A run is asked to send (--send) only when the person has a channel besides the app: Telegram set up, or e-mail chosen (lib/notify-channel.js). Without one the app shows the message itself. Guard: test/unit/main/telegram-send.test.js.
// The inputs passed to the engine as they are, in this order (the cloud workflow runs the same flags).
const PASSED_INPUTS = [['target', '--target'], ['jobTitle', '--job-title'], ['jobCompany', '--job-company'], ['jobText', '--job-text'], ['page', '--page'], ['seed', '--seed'],
  ['file', '--file'], ['note', '--note'], ['origin', '--origin'], ['interview', '--interview']];
/** Whether an AI engine is set up on this Mac (a key or a signed-in CLI): what lets a run use AI steps. */
export const aiReadyOf = storage => claudeCode.aiReady(storage.settings(), !!storage.secret('ANTHROPIC_API_KEY'), !!storage.secret('OPENAI_API_KEY'));
export function dailyArgs(storage, inputs = {}) {
  const mode = inputs.mode || 'scheduled';
  const ai = aiReadyOf(storage);
  const telegram = deliveryReady(storage);
  // --log-run: every run from the app gets a row in Notion ⏰ Search runs (Notion is where the details live).
  const args = ['src', 'daily', '--mode', mode, ...(telegram ? ['--send'] : []), '--log-run'];
  if (inputs.job) args.push('--job', String(inputs.job), '--action', String(inputs.action || 'applied'));
  if (inputs.talking) args.push('--action', 'talking');
  for (const [name, flag] of PASSED_INPUTS) if (inputs[name]) args.push(flag, String(inputs[name]));
  if (inputs.firstJobs) args.push('--first-jobs');   // a small slice of fast feeds is read and 3 jobs scored first (src/first_jobs.py)
  if (inputs.discoverBeside) args.push('--discover-beside');   // the job boards' employers discovered beside the employer sites (src/sources/boards_beside.py)
  if (ai && AI_MODES.includes(mode)) args.push('--enrich-max', '100', '--score-max', '60');
  if (ai && mode === 'rescore') args.push('--score-max', '60');   // Re-score: new scores for the jobs that have an old one, nothing else (src/daily_modes.py rescore_mode)
  if (ai && mode === 'score') args.push('--score-max', String(Math.max(1, Math.min(60, Number(inputs.scoreMax) || 60))));   // the scoring queue: what the run's 60 leave after the search's own scores (lib/pipeline-tasks.js queueMax)
  // A search's AI steps stop at 3 minutes (owner, 7 Oct 2026: "never more than 2-3 minutes"); what is left waits for the next search (src/budget.py).
  // Every mode that runs AI steps has it: the first run's follow-up (mode today) had none from 16 Oct, so on a big market it sorted 600 titles and
  // placed 277 places for 15 minutes before the first jobs were scored (Cluj, 18 Oct 2026: first 70+ match after 23 minutes).
  // budget: the seconds a Find jobs press gives this run (lib/search-steps.js: one deadline for the press), with or without AI.
  if (inputs.budget) args.push('--budget', String(inputs.budget));
  else if (ai && (AI_MODES.includes(mode) || mode === 'rescore')) args.push('--budget', String(SEARCH_BUDGET_S));
  const {insights} = cadence(storage.settings());
  if (ai && mode === 'scheduled' && insights !== 'off') args.push('--insight');
  return args;
}
/** The day's insight when it is due (never a forced one): what the app asks while our servers run the search (lib/one-place.js), same rule as a scheduled search's --insight. */
export const insightArgs = storage => [...dailyArgs(storage, {mode: 'insight'}), '--if-due'];
// Notion just connected after a time of trying: one run that spends no AI (every cap at 0), so the Job Matches sync
// (src/notion/matches.py, hash-keyed over every scored job in the cache) puts what was scored before Notion there.
// `--mode today` is the no-AI path that reaches that sync; it also reads the feeds, which is free.
const AI_MODES = ['scheduled', 'run', 'today'];   // the modes that read, score and enrich with AI
/** Whether an engine run may draft an application kit (src/daily_modes.py prepare and kits, a search's --auto-kit-max): it then gets About you's kit bundle. */
export function draftsKits(args) {
  const valueOf = flag => (args.includes(flag) ? String(args[args.indexOf(flag) + 1] ?? '') : '');
  return ['prepare', 'kits'].includes(valueOf('--mode')) || Number(valueOf('--auto-kit-max')) > 0;
}
const CEILING = Number(process.env.JOBADABRA_PRESS_SECONDS) || 0;
// Why (7 Nov 2026, ps 2/6, owner: "We aim quality, speed and coverage"): the press's yardstick records each persona once with every share of the press made
// longer (src/time_budget.py part), the ceiling a press can find; only a search-tape recording may (JOBADABRA_SEARCH_TAPE_MODE=record, which the app never sets).
export const SEARCH_BUDGET_S = process.env.JOBADABRA_SEARCH_TAPE_MODE === 'record' && CEILING > 180 ? CEILING : 180;
// Find new employers starts no new check after 3 minutes (owner, 7 Oct 2026: "runs for too long"); each check is saved as it ends (src/scout.py).
export const SCOUT_BUDGET_S = 180;
// The queue's own clock after a search: the jobs it checks, the postings it reads and its scores stop at 10 minutes; what is left continues after the next search or on "Score".
// Why (12 Nov 2026, owner, asked via AskUserQuestion: "All checked, 60 scored, 10 min (Recommended)"; it was 900, a hang guard for scores only).
export const SCORE_QUEUE_S = 600;
/** The scoring queue's command (src/daily_modes.py score_mode): scores for the jobs a search found and did not reach, `max` at most, on its own clock; no digest is sent. */
export const scoreQueueArgs = (storage, max = 60) => dailyArgs(storage, {mode: 'score', scoreMax: max, budget: SCORE_QUEUE_S}).filter(arg => arg !== '--send');
export const syncMatchesArgs = () => ['src', 'daily', '--mode', 'today', '--log-run', '--enrich-max', '0', '--score-max', '0', '--auto-kit-max', '0'];
// Gmail and Calendar check (src/ai/mail.py): confirmations, replies, rejections and interviews -> Notion.
// `updates` = what it recorded (the lines it prints under "Updates:"), shown in the app and the notification.
export function mailArgs(storage, now = Date.now()) {
  const settings = storage.settings();
  const telegram = deliveryReady(storage);
  // Look back far enough to cover the time since the last check (the Mac may have been off), 2 to 14 days.
  const since = settings.lastMailOkAt ? (now - Date.parse(settings.lastMailOkAt)) / 86400000 : 0;
  const days = Math.min(14, Math.max(2, Math.ceil(since) + 1));
  return ['src.ai.mail', '--days', String(days), ...(telegram ? ['--send'] : []), '--log-run'];
}
// What started a run, for its Notion ⏰ Search runs row (GitHub runs say Schedule or Manual).
export const triggerEnv = trigger => ({JOBADABRA_TRIGGER: trigger === 'schedule' ? 'Mac schedule' : 'Mac (you)'});
// The jobs read in Chrome, scored at once after a read (Always on or not: those pages stay on this Mac). A run here that reads
// only those pages (src/daily.py --only-visits, mode today: it closes nothing, no Telegram digest), scores what matches and writes it to Notion.
// The light run after Find jobs using your browser scores the jobs it found that match, and nothing else (7 Oct 2026: it read 41 other
// jobs with AI first, 2 minutes, and the 1 match waited behind them): no reading, no kits, as many scores as matches.
export function visitsArgs(storage, fits = 60) {
  const args = [...dailyArgs(storage, {mode: 'today'}).filter(arg => arg !== '--send'), '--only-visits'];
  const set = (flag, value) => { const at = args.indexOf(flag); if (at >= 0) args[at + 1] = String(value); };
  set('--enrich-max', 0);
  set('--auto-kit-max', 0);
  set('--score-max', Math.max(1, Math.min(60, Number(fits) || 60)));
  return args;
}
