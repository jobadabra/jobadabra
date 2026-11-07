// Jobs → Board and the saved views, the rules without a window: the stage columns in funnel order, the Applications database's 10 views
// (read from the real workspace's view filters, 9 Oct 2026) and which app action a card dropped on a column asks for.
// Guarded by: test/unit/renderer/jobs-board-rules.test.js. Drawn by pages/jobs-board.js and pages/jobs-views.js.
import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
import {READY_LABEL} from './pages/ready-rows.js';

// Every Applications Stage the person sees (config/notion_schema.json), in the order a job moves through them.
// Why (2026-11-05, owner): "Kit ready" is stored but internal: "The user cares only about applying", so it has no column or view and reads Saved.
export const STAGES = ['Recruiter lead', 'Saved', 'Applying', 'Applied', 'Confirmation received', 'Screening',
  'Interview scheduled', 'Interviewing', 'Offer', 'Rejected', 'No response', 'Withdrawn', 'Closed', 'Dismissed'];
// A column's pill tone, like the list's status pills (jobs-view.js statusPill).
const TONE = {'Recruiter lead': 'signal', Saved: 'signal', Applying: 'info', Applied: 'good', Offer: 'good',
  Rejected: 'bad', 'No response': 'neutral', Withdrawn: 'neutral', Closed: 'neutral', Dismissed: 'neutral'};
/** A stored stage in the person's words: the internal Kit ready reads Saved; every other stage is its own word. */
export const stageLabel = stage => stage === 'Kit ready' ? 'Saved' : stage;
export const stageTone = stage => TONE[stage] || 'info';
const STAGE_MESSAGES = {'Recruiter lead': 'stageRecruiter', Saved: 'savedPlain', Applying: 'stageApplying', Applied: 'stageApplied',
  'Confirmation received': 'stageConfirmed', Screening: 'stageScreening', 'Interview scheduled': 'stageScheduled', Interviewing: 'stageInterviewing',
  Offer: 'stageOffer', Rejected: 'stageRejected', 'No response': 'stageNoResponse', Withdrawn: 'stageWithdrawn', Closed: 'stageClosed', Dismissed: 'stageDismissed'};
/** Translate known stage labels for display only; board columns and filters retain their stored English identifiers. */
export function stageText(stage) {
  const value = stageLabel(stage), key = STAGE_MESSAGES[value];
  return key ? t(`helpers.${key}`) : value;
}

/** A job's Next step for the screen: '' for the stored "📝 Kit ready…" step (src/ai/kit.py next_step, internal data), else its own words. */
export const nextStepOf = job => /kit ready/i.test(job?.next_step || '') ? '' : job?.next_step || '';

// The view filters, as Stage sets (the database's "Stage is A or B…" groups).
const SENT = ['Applied', 'Confirmation received', 'Screening', 'Interview scheduled', 'Interviewing', 'Offer'];
const CLOSED_OUT = ['Rejected', 'No response', 'Withdrawn'];
const DAY = 86400000;
// Fresh (the database's formula): applied on a date at most 7 days ago, "🆕 this week".
export function fresh(job, now = Date.now()) {
  const applied = Date.parse(String(job.applied_on || '').slice(0, 10));
  return Number.isFinite(applied) && Math.floor((now - applied) / DAY) <= 7;
}
// A job's column: its Applications Stage, else the stage its list status stands for. A job marked Applied or Dismissed only on its Job
// Matches row has no Stage (src/desktop_jobs.py: status from match_status), and the list counts and labels it Applied; the board must
// show it there too, not leave the column at 0 (9 Oct 2026, the UI audit). A job nobody acted on (unreviewed) has no column.
const STATUS_STAGE = {saved: 'Saved', applied: 'Applied', dismissed: 'Dismissed'};
/** A job -> its Board column and view stage, in the person's words: the stored stage through stageLabel, else its list status, else '' (no column). */
export const columnOf = job => stageLabel(job?.stage) || STATUS_STAGE[job?.status] || '';
// The saved views count by the same column as the board (9 Oct 2026: the chips said "All 3", "Dismissed 0" beside a board of 5 with a Dismissed card).
const hasStage = job => !!columnOf(job);
const among = stages => job => stages.includes(columnOf(job));
export const VIEWS = [
  {id: 'all-applications', label: t('helperFlow.allApplications'), title: t('helperFlow.allApplicationsHint'), test: among(['Applying', ...SENT, ...CLOSED_OUT])},
  {id: 'active', label: t('helperFlow.active'), title: t('helperFlow.activeHint'), test: among(SENT)},
  // Named by its stage, as every row's pill and the stuck banner say it (Notion's view is "In progress"; owner, 12 Oct 2026: "I don't have a way to
  // filter for Applying" beside a chip that did it under another word). A chip of one stage carries that stage's name (test/unit/renderer/jobs-board-rules.test.js).
  {id: 'applying', label: t('helpers.stageApplying'), title: t('helperFlow.applyingHint'), test: among(['Applying'])},
  {id: 'ready-to-submit', label: READY_LABEL, title: t('helperFlow.readyHint'), test: job => !!job.ready && job.status !== 'applied'},
  {id: 'saved', label: t('helpers.savedPlain'), title: t('helperFlow.savedJobs'), test: among(['Saved'])},
  {id: 'closed', label: t('helpers.stageClosed'), title: t('helperFlow.closedPostingHint'), test: among(['Closed'])},
  {id: 'dismissed', label: t('helpers.stageDismissed'), title: t('helperFlow.setAsideJobs'), test: among(['Dismissed'])},
  {id: 'all', label: t('helperFlow.all'), title: t('helperFlow.allStageHint'), test: hasStage},
  {id: 'rejected', label: t('helpers.stageRejected'), title: t('helperFlow.rejectedHint'), test: among(CLOSED_OUT)},
  {id: 'this-week', label: t('helperFlow.thisWeek'), title: t('helperFlow.last7Applied'), test: (job, now) => fresh(job, now)},
];
export const viewOf = id => VIEWS.find(view => view.id === id) || null;
export const inView = (job, id, now = Date.now()) => !!viewOf(id)?.test(job, now);


// The board: one column per stage (columnOf), each column in the list's own order.
export function boardColumns(jobs) {
  const columns = STAGES.map(stage => ({stage, tone: stageTone(stage), jobs: []}));
  const at = new Map(columns.map(column => [column.stage, column]));
  for (const job of jobs) at.get(columnOf(job))?.jobs.push(job);
  return columns;
}

// A card dropped on a column: the app action that asks for that stage, so the store's own rules decide (rules.mark: Saved and
// Dismissed never replace a real stage; the ledger logs an outcome as an event). Stages the app sets itself take no drop.
const STATUS = {Saved: 'saved', Applied: 'applied', Dismissed: 'dismissed'};
export const OUTCOME_STAGES = ['Confirmation received', 'Screening', 'Interview scheduled', 'Interviewing', 'Offer', 'Rejected', 'No response', 'Withdrawn'];
const SET_BY_APP = {Applying: t('helperFlow.startingApplication'), Closed: t('helperFlow.postingCloses'),
  'Recruiter lead': t('helperFlow.loggingRecruiter')};
export function dropFor(job, stage) {
  if (!job || columnOf(job) === stage) return {none: true};
  if (STATUS[stage]) return {call: 'setStatus', arg: STATUS[stage]};
  if (OUTCOME_STAGES.includes(stage)) return {call: 'setStage', arg: stage};
  return {refused: t('helperFlow.stageDropRefused', {stage: stageText(stage), reason: SET_BY_APP[stage] || t('helperFlow.app')})};
}
export const takesDrop = stage => !!STATUS[stage] || OUTCOME_STAGES.includes(stage);
