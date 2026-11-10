import '../i18n/screens-helpers.js';
import {t, getLocale} from '../i18n/index.js';
import {date, number} from '../i18n/format.js';
// The Technical log in plain words (owner, 7 Oct 2026: "readable by a non-technical person: what it is doing, if it added a job, closed a
// job, is waiting for Claude, is struggling, is scoring, is handling the locations with AI"). The engine's raw lines stay in logs/engine.log
// for debugging; this turns them into one line per thing that happened: noise dropped (Claude timings, pool sharing, Notion links), counters
// collapsed to their latest value, the rest reworded. A line it does not know is kept as it is.
import {aiName} from './ai-name.js';
const SLOW_S = 20, WAITED_S = 30;   // a Claude answer this slow, or a wait for a free slot this long, is worth a line

const host = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };
const when = (iso, time = false) => { const at = new Date(iso); return Number.isNaN(at.getTime()) ? iso
  : (getLocale() === 'en' ? at.toLocaleDateString('en-GB', {day: 'numeric', month: 'short'}) : date(at, {day: 'numeric', month: 'short'})) + (time ? `, ${at.toLocaleTimeString('en-GB', {hour: '2-digit', minute: '2-digit'})}` : ''); };
// English keeps its original counted phrase; other catalog sentences supply the noun around a formatted count.
const plural = (n, word) => getLocale() === 'en' ? `${n} ${word}${Number(n) === 1 ? '' : 's'}` : number(Number(n));

// "job(s)" as the number before it says ("1 job", "3 jobs"); with no number before it, the plural. Every line passes through here, known or not.
const COUNTED = /\((s|es)\)/g;
export function realPlural(line) {
  return String(line).replace(COUNTED, (found, ending, at, whole) => {
    const clause = whole.slice(0, at).split(/[;:]/).pop();
    const number = /(\d[\d,]*)\D*$/.exec(clause);
    return number && Number(number[1].replace(/,/g, '')) === 1 ? '' : ending;
  });
}

// [pattern, line -> text | null (dropped) | {key, text} (replaces the earlier line with the same key)]
const RULES = [
  // Runs before 18 Oct 2026 also said which place word made the search Swiss (a regex): the boards by name, as the engine says them now.
  [/^Job boards: .+? \(Swiss place word: .*$/, m => m.input.replace(/ \(Swiss place word: .*?\)*(; developer boards left out.*)?$/, '$1')],
  [/^Claude Code (\w+): answered in (\d+) s.*?(?:waited (\d+) s for a free slot)?;/, (m) => {
    const took = Number(m[2]), waited = Number(m[3] || 0);
    if (waited >= WAITED_S) return t('helperGuide.log1', {v0: waited});   // the line is Claude Code's own, whatever the chosen engine
    if (took >= SLOW_S) return t('helperGuide.log2', {v0: took});
    return null;
  }],
  [/^Run counts: /, () => null],   // the Find jobs card's numbers (find-card-model.js runCounts), not a line to read
  [/^Stages?: /, () => null],   // Why (sf, 10 Nov 2026): where each source's jobs stopped (src/sources/job_stage.py), the Search check's count, not a line to read
  [/^(Pool labels|Shared \d+ employer feeds|Pool catch-up|Cronjob run logged|AI: )/, () => null],
  [/^Job Matches: .*\(so far\)$/, () => null],
  [/^Job Matches: (\d+) created, (\d+) updated/, m => (Number(m[1]) + Number(m[2]) ? t('helperGuide.log3', {v0: m[1], v1: m[2]}) : null)],   // about Notion
  [/^Time budget: this search stops its AI steps at (.+?);/, m => t('helperGuide.log4', {v0: aiName(), v1: m[1]})],
  // One line per employer the role leaves out (src/sources/feeds.py): counted, one line per reason (the Find card's Live updates show it).
  [/^Employers: (\S+) left out: (.+)$/, (m, state) => ({key: `left-out:${m[2]}`, text: t('helperGuide.log5', {v0: plural(state.count(`left-out:${m[2]}`), 'employer'), v1: m[2]})})],
  // The web search resting (src/sources/board_web.py): its dates in the reader's own time, not ISO (owner, 26 Oct 2026: "rested: searched at 01:45, next at …").
  [/^Job boards: no web search: searched (\S+), next after (\S+?); (.+)$/, m => t('helperGuide.log6', {v0: when(m[1], true), v1: when(m[2]), v2: m[3]})],
  [/^Checked: (.+)$/, (m, state) => ({key: 'checked', text: t('helperGuide.log7', {v0: plural(state.count('checked'), 'employer')})})],
  [/^Job board: (\S+) · (.+?) · (.+?)(?: · page \d+)? · (.+)$/, (m, state) => ({key: 'board', text: t('helperGuide.log8', {v0: m[1], v1: plural(state.count('board'), 'page')})})],
  [/^⏱ This refresh places (\d+) of (\d+) job locations.*?; (\d+) wait/, m => t('helperGuide.log9', {v0: aiName(), v1: m[1], v2: m[2], v3: m[3]})],
  [/^Places: asking .+? where/, () => null],   // the engine's name (src/ai/providers who()): Claude, OpenAI, Codex or Free AI (two words)
  // The AI as the engine named the one that ran (owner, 26 Oct 2026: the panel said Free AI, the log Claude); every check of a run adds up in one line.
  [/^Places: (.+?) placed (\d+) location\(s\); (\d+) are in your places/, (m, state) => ({key: 'places',
    text: t('helperGuide.log10', {v0: m[1], v1: plural(state.sum('places', m[2]), 'location'), v2: state.sum('places-in', m[3])})})],
  [/^⏱ This refresh sorts (\d+) of (\d+) job titles/, m => t('helperGuide.log11', {v0: aiName(), v1: m[1], v2: m[2]})],
  [/^Titles: asking /, () => null],
  [/^Titles: (.+?) sorted (\d+) new title\(s\) in your places; (\d+) could fit/, (m, state) => ({key: 'titles',
    text: t('helperGuide.log12', {v0: m[1], v1: plural(state.sum('titles', m[2]), 'job title'), v2: state.sum('titles-fit', m[3])})})],
  [/^First jobs: reading (\d+) of (\d+)/, m => t('helperGuide.log13', {v0: m[1], v1: plural(m[2], 'employer site')})],
  [/^First jobs: (\d+) found$/, m => t('helperGuide.log14', {v0: plural(m[1], 'job')})],
  [/^First jobs: (\d+) found on the job boards$/, m => t('helperGuide.log15', {v0: plural(m[1], 'job')})],
  [/^First jobs: (\d+) found, none to score/, () => null],
  [/^First jobs: (\d+) scored in (\d+) s/, m => t('helperGuide.log16', {v0: plural(m[1], 'first job'), v1: m[2]})],
  [/^Jobs so far: (\d+) new from (.+)$/, m => t('helperGuide.log17', {v0: plural(m[1], 'new job'), v1: m[2]})],
  [/^Added (\d+) new job\(s\): (.+)$/, m => t('helperGuide.log18', {v0: plural(m[1], 'new job'), v1: m[2]})],
  [/^New job: (.+?) \| (.*?) \| \S*$/, m => `➕ ${m[1]}${m[2] ? ` · ${m[2]}` : ''}`],
  [/^(Closed|Expired|Unmatched|Removed) 0 job\(s\)/, () => null],
  // Since 10 Oct 2026 the engine says what happened to a job: expired (the posting is gone) or unmatched (outside your search); older runs said Closed.
  [/^Expired (\d+) job\(s\) not seen for (\d+) days/, m => t('helperGuide.log19', {v0: plural(m[1], 'job'), v1: m[2]})],
  [/^Expired (\d+) job\(s\) from employers your search no longer reads/, m => t('helperGuide.log20', {v0: plural(m[1], 'job')})],
  [/^Unmatched (\d+) job\(s\) outside your places: (.+)$/, m => t('helperGuide.log21', {v0: plural(m[1], 'job'), v1: m[2]})],
  [/^Removed (\d+) old unmatched or expired job\(s\)/, m => t('helperGuide.log22', {v0: plural(m[1], 'old job')})],
  [/^Closed (\d+) job\(s\) not seen for (\d+) days/, m => t('helperGuide.log23', {v0: plural(m[1], 'job'), v1: m[2]})],
  [/^Closed (\d+) job\(s\) outside your places: (.+)$/, m => t('helperGuide.log24', {v0: plural(m[1], 'job'), v1: m[2]})],
  [/^Closed (\d+) job\(s\) from employers your search no longer reads/, m => t('helperGuide.log25', {v0: plural(m[1], 'job')})],
  [/^Descriptions: read (\d+) of (\d+) missing job texts(.*)$/, m => t('helperGuide.log26', {v0: m[1], v1: m[2], v2: m[3].replace(/\(tried again next time\)/, t('helperGuide.logRetry'))})],
  [/^Descriptions: (\d+) of (\d+) missing fetched, (\d+) can't be read from (.+)$/, m =>
    t('helperGuide.log27', {v0: m[1], v1: m[2], v2: m[3], v3: m[4]})],   // a run from before 7 Oct 2026
  [/^⏱ This refresh scores (\d+) of (\d+) jobs.*?; (\d+) wait/, m => t('helperGuide.log28', {v0: m[1], v1: m[2], v2: m[3]})],
  [/^Scored (\d+) of (\d+) job\(s\)$/, m => ({key: 'scored', text: t('helperGuide.log29', {v0: m[1], v1: plural(m[2], 'job')})})],
  [/^Scored (\d+) of (\d+) job\(s\) with [^;]+; (\d+) failed/, m => ({key: 'scored', text: t('helperGuide.log30', {v0: m[1], v1: plural(m[2], 'job')}) + (Number(m[3]) ? t('helperGuide.logFailed', {count: m[3]}) : '')})],
  [/^\d+ job\(s\) to score with/, () => null],
  [/^⏱ (\d+) found job\(s\) wait for the next refresh/, m => t('helperGuide.log31', {v0: plural(m[1], 'found job')})],
  [/^Enriched (\d+) of (\d+) job\(s\)/, m => (Number(m[1]) ? t('helperGuide.log32', {v0: aiName(), v1: plural(m[1], 'job')}) : null)],
  [/^⏱ Time is up for this refresh: (\d+) (.+?) left/, m => t('helperGuide.log33', {v0: m[1], v1: m[2]})],
  [/^Digest ready: (\d+) jobs?, (\d+) new/, m => t('helperGuide.log34', {v0: plural(m[1], 'job'), v1: m[2]})],
  [/^Warning: (.+)$/, m => `⚠️ ${m[1]}`],
  // Reading job sites in your Chrome (the Read sites task: tabs the app opened to read)
  [/^Visit: read (\d+) jobs on (.+?) \((.+?)\) from a page you opened; (\d+) new in this visit, \d+ in all, (\d+) matching/, m =>
    t('helperGuide.log35', {v0: plural(m[1], 'job'), v1: m[2], v2: m[4], v3: m[5]})],
  [/^Visit: the job list of (\S+) is /, m => t('helperGuide.log36', {v0: m[1]})],
  [/^Visit filters: 0 steps/, () => null],
  [/^Visit filters: (\d+) steps for (\S+?):? (.+)$/, m => t('helperGuide.log37', {v0: plural(m[1], 'filter'), v1: host(m[2]), v2: m[3]})],
  [/^Visit unblock: 0 steps/, () => null],
  [/^Visit unblock: (\d+) steps for (\S+?):? /, m => t('helperGuide.log38', {v0: plural(m[1], 'step'), v1: host(m[2])})],
  [/^Visit: no job list on (\S+?),/, m => t('helperGuide.log39', {v0: host(m[1])})],
  [/^Visit: the recipe for (\S+) found no jobs/, m => t('helperGuide.log40', {v0: m[1]})],
  [/^Visit: job page of (.+?): not found/, m => t('helperGuide.log41', {v0: m[1]})],
];

// Progress lines ("⏳ Scoring jobs…: 3 of 29") keep only their latest value, per kind of progress.
const PROGRESS = /^⏳ ([^:·]+?)(?::| ·)/;

export function readableLog(lines = []) {
  const out = [], at = new Map(), counts = new Map();
  let inMessage = false;
  const state = {count: key => state.sum(key, 1), sum: (key, n) => { counts.set(key, (counts.get(key) || 0) + Number(n)); return counts.get(key); }};
  const put = (key, text) => {
    if (key && at.has(key)) { out[at.get(key)] = text; return; }
    if (key) at.set(key, out.length);
    out.push(text);
  };
  for (const raw of lines) {
    const line = String(raw ?? '').trimEnd();
    if (line === '<<<message') { inMessage = true; continue; }   // the digest itself: the run's card shows it
    if (line === 'message>>>') { inMessage = false; continue; }
    if (inMessage || !line.trim() || /^[{[]/.test(line)) continue;   // data lines for the app
    const progress = PROGRESS.exec(line);
    if (progress) { put(`progress:${progress[1]}`, realPlural(line)); continue; }
    const rule = RULES.find(([pattern]) => pattern.test(line));
    if (!rule) { put('', realPlural(line)); continue; }
    const result = rule[1](rule[0].exec(line), state);
    if (result == null) continue;
    if (typeof result === 'string') put('', realPlural(result));
    else put(result.key, realPlural(result.text));
  }
  return out;
}
