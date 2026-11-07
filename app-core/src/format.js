// Telegram message text for the worker: HTML escaping and the run / applications / saved-jobs listings.
// Pure functions of Notion/GitHub rows, no I/O. Re-exported by index.js. Guarded by app-core/test/index.test.js and status.test.js.

import {botText, botStage, botMode} from './bot-copy.js';

export const STAGE_EMOJI = {
  Saved: '⭐', Applied: '📨', 'Confirmation received': '📬', Screening: '📞',
  'Interview scheduled': '🗓', Interviewing: '🎤', Offer: '🎉', Rejected: '❌',
  Withdrawn: '↩️', 'No response': '💤', 'Recruiter lead': '🤝',
};

export function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Render supplied GitHub runs as Telegram-safe HTML; optional user context localizes wrappers and empty lists keep a clear message. */
export function formatRuns(runs, context = {}) {
  if (!runs.length) return botText(context, 'noWorkflowRuns');
  const icon = (run) => run.status !== 'completed' ? '⏳' : run.conclusion === 'success' ? '✅' : '❌';
  const lines = runs.map((run) => {
    const when = run.created_at.replace('T', ' ').slice(0, 16);
    return `${icon(run)} <a href="${escapeHtml(run.html_url)}">${escapeHtml(run.display_title)}</a> · ${when} UTC`;
  });
  return [`🛠 <b>${botText(context, 'recentRuns')}</b>\n${botText(context, 'latest', {count: lines.length})}`, lines.join('\n\n')].join('\n\n');
}

// The bot's lists read plain items, whichever store holds the data: a Notion row becomes one here (appItem, runItem); the desktop's
// store on this Mac hands the same items (desktop/lib/store/telegram-store.js). `link`: a page to open, or '' (no page on this Mac).
const plainText = (prop) => (prop?.rich_text || prop?.title || []).map((t) => t.plain_text).join('');
export function appItem(page) {
  const p = page.properties || {};
  return { id: page.id, title: plainText(p.Job), company: plainText(p.Company), stage: p.Stage?.select?.name || '',
    applied_on: p['Applied on']?.date?.start || '', next_interview: p['Next interview']?.date?.start || '', url: p['Job URL']?.url || '' };
}
export function runItem(page) {
  const p = page.properties || {};
  return { link: page.url || '', mode: p.Mode?.select?.name || '', status: p.Status?.select?.name || '', started: p.Started?.date?.start || '',
    where: p['Run URL']?.url ? 'github' : /^Mac/.test(p.Trigger?.select?.name || '') ? 'mac' : '', summary: plainText(p.Summary) };
}
const linked = (link, html) => (link ? `<a href="${escapeHtml(link)}">${html}</a>` : html);

// /status: the latest runs (⏱️ Search runs, or the store's), wherever they ran (the Mac, GitHub, a button here), with the one running.
/** Render plain store run items without reads or writes; supplied summaries stay escaped raw content and missing context retains English. */
export function formatRunItems(runs, context = {}) {
  if (!runs.length) return botText(context, 'noRuns');
  const ICON = { Running: '⏳', Failed: '❌', Warnings: '⚠️' };
  const lines = runs.map((run) => {
    const when = (run.started || '').replace('T', ' ').slice(0, 16);
    const where = run.where === 'github' ? ' · GitHub' : run.where === 'mac' ? ' · Mac' : '';
    const summary = (run.summary || '').replace(/;?\s*\(?AI cost \$[\d.]+\)?\.?$/, '');
    return `${ICON[run.status] || '✅'} ${linked(run.link, escapeHtml(run.mode ? botMode(context, run.mode) : botText(context, 'runFallback')))} · ${when} UTC${where}`
      + (summary ? `\n${escapeHtml(summary.slice(0, 160))}` : '');
  });
  return [`🛠 <b>${botText(context, 'recentRuns')}</b>\n${botText(context, 'latest', {count: lines.length})}`, lines.join('\n\n')].join('\n\n');
}
/** Project supplied Notion pages to the same run presentation; no query is made and context remains explicit. */
export const formatNotionRuns = (pages, context = {}) => formatRunItems(pages.map(runItem), context);

// `databaseUrl`: the Applications database in Notion, or '' with the data on this Mac.
/** Render supplied applications with optional localized wrappers; canonical data is never mutated and an empty list explains how to add one. */
export function formatAppliedItems(items, databaseUrl, context = {}) {
  if (!items.length) return databaseUrl ? botText(context, 'noApplicationsNotion', {link: `<a href="${databaseUrl}">Notion</a>`}) : botText(context, 'noApplicationsApp');
  const lines = items.map((item, index) => {
    const stage = item.stage || botText(context, 'noStage');
    const title = `<b>${escapeHtml(item.title || botText(context, 'untitled'))}</b>`;
    const interview = item.next_interview ? `\n${botText(context, 'interviewLabel')}: ${item.next_interview.slice(0, 16).replace('T', ' · ')}` : '';
    return `${index + 1}. ${linked(item.url, title)}\n`
      + `${escapeHtml(item.company)} · ${STAGE_EMOJI[stage] || ''} ${escapeHtml(botStage(context, stage))}\n`
      + `${botText(context, 'appliedLabel')}: ${item.applied_on || botText(context, 'dateMissing')}${interview}`;
  });
  return [`📋 <b>${botText(context, 'applications')}</b>\n${botText(context, 'tracked', {count: items.length})}${databaseUrl ? ` · <a href="${databaseUrl}">${botText(context, 'openNotion')}</a>` : ''}`, lines.join('\n\n')].join('\n\n');
}
/** Convert supplied Notion application pages for display, retaining raw data and the optional explicit language context. */
export const formatApplied = (pages, databaseUrl, context = {}) => formatAppliedItems(pages.map(appItem), databaseUrl, context);

/** Render supplied saved jobs with escaped personal content, explicit optional context and a helpful empty-state message. */
export function formatSavedItems(items, databaseUrl, context = {}) {
  if (!items.length) return botText(context, 'noSaved');
  const lines = items.map((item, i) => `${i + 1}. ${linked(item.url, `<b>${escapeHtml(item.title || botText(context, 'untitled'))}</b>`)}\n${escapeHtml(item.company)}`);
  return [`⭐ <b>${botText(context, 'savedJobs')}</b>\n${botText(context, 'savedCount', {count: items.length})}${databaseUrl ? ` · <a href="${databaseUrl}">${botText(context, 'openNotion')}</a>` : ''}`, lines.join('\n\n')].join('\n\n');
}
/** Convert supplied Notion saved-job pages into the shared pure listing; preserve legacy English when no context is supplied. */
export const formatSaved = (pages, databaseUrl, context = {}) => formatSavedItems(pages.map(appItem), databaseUrl, context);
