// Guard: data — a persona false alarm closed as by design must reach the persona's knowledge, a twin note of one run must not file twice, and a disagree that names a rule is held but listed (the open issues are the loop's data).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {PER_AREA, closedLessons, readClosed, shortWhy} from '../../lib/agent-closed.mjs';
import {BATCH1_RULES, batchKnowledge, batchMarkdown, askBatch, loadBatch, scoreBatch} from '../../lib/agent-judge-set.mjs';
import {SYSTEM, judgePrompt} from '../../lib/agent-judge.mjs';
import {knowledgeFor} from '../../lib/agent-knowledge.mjs';
import {readExpectations} from '../../lib/agent-memory.mjs';
import {citedIds, holdingIds, joinSameElement, rankNotes} from '../../lib/agent-notes.mjs';
import {AGENT_SYSTEM, goalIntro} from '../../lib/agent-run.mjs';
import {summarizeSession, summaryMarkdown} from '../../lib/agent-session.mjs';

const dir = new URL('../../fixtures/agent-judge-set-b1/', import.meta.url);
const batch = loadBatch(new URL(dir).pathname);
const expectations = readExpectations(new URL('../../../../docs/app-expectations', import.meta.url).pathname);
const verdict = why => ({author: {login: 'GarryOne'}, body: `<!-- ui-loop-verdict:false-positive -->\n> [!NOTE]\n> ### 🚫 Verdict: Not a bug — closed\n\n### 🧠 Why\n${why}\n\n### 📍 Evidence\n| Where in the code |\n|---|`});
const issue = (number, extra = {}) => ({number, title: '[AI persona] settings: Text size description contradicts selected Large option', closedAt: new Date(Date.UTC(2026, 10, 7, 12) + number * 1000).toISOString(),
  labels: ['auto-ui', 'source:ai-user-agent', 'resolution:by-design', 'view:settings'].map(name => ({name})),
  comments: [{author: {login: 'github-actions'}, body: '<!-- ui-loop-verdict:needs-human -->\n### 🧠 Why\nunsure'}, verdict('The percentage is the real zoom (`desktop/lib/zoom.js:5-9` SIZE_SCALE). On a laptop display Default is 80%, so Large is 100%.')], ...extra});

test('a persona issue closed as by design becomes a lesson of its area; other closures teach nothing', () => {
  const lessons = closedLessons([issue(3531),
    issue(3600, {labels: [{name: 'source:ai-user-agent'}, {name: 'resolution:fp:detector'}, {name: 'view:jobs'}]}),
    issue(3601, {labels: [{name: 'source:ui-review'}, {name: 'resolution:by-design'}, {name: 'view:jobs'}]}),
    issue(3602, {comments: [{author: {login: 'github-actions'}, body: 'no verdict comment'}]}),
    issue(3603, {labels: [{name: 'source:ai-user-agent'}, {name: 'resolution:by-design'}]})]);
  assert.deepEqual(Object.keys(lessons), ['Settings']);
  assert.equal(lessons.Settings.length, 1);
  const [lesson] = lessons.Settings;
  assert.equal(lesson.id, 'closed-3531');
  assert.equal(lesson.text, 'Text size description contradicts selected Large option', 'the title without its tag and view');
  assert.ok(!/desktop\/|zoom\.js/.test(lesson.why) && /Large is 100%/.test(lesson.why), `the why has no code reference: ${lesson.why}`);
});

test('a lesson list is newest first, at most PER_AREA per area, and a long why is cut at a sentence', () => {
  const many = Array.from({length: PER_AREA + 3}, (_, i) => issue(3700 + i));
  const list = closedLessons(many).Settings;
  assert.equal(list.length, PER_AREA);
  assert.equal(list[0].number, 3700 + PER_AREA + 2, 'the newest first');
  const long = shortWhy(`${'A sentence that is fairly long and says why. '.repeat(10)}`);
  assert.ok(long.length <= 240 && long.endsWith('.'), long);
  assert.deepEqual(readClosed('/nonexistent/closed.json'), {}, 'a file that does not exist: none');
  assert.deepEqual(readClosed(''), {}, 'no file: no closed verdicts');
});

test('the closed layer is in the knowledge of the actor and of the judge, named by an id the judge can cite, and shrinks after the notes', () => {
  const closed = batch.lessons;
  const text = knowledgeFor(['Settings'], {expectations, closed, notes: {Settings: [{text: 'an old note', seen: 1, last: '2026-10-01'}]}});
  assert.match(text, /- closed-3539 Not a bug: GitHub row claims "Always on" but is not connected: /);
  assert.ok(text.indexOf('- settings-3') < text.indexOf('- closed-3539') && text.indexOf('- closed-3539') < text.indexOf('- note: an old note'), 'rules, then closed verdicts, then notes');
  assert.ok(goalIntro({group: 'Settings', label: 'x'}, text).includes('closed-3539') && judgePrompt({title: 't', expected: 'e', observed: 'o', why: 'w'}, text).includes('closed-3539'));
  assert.match(AGENT_SYSTEM, /closed-<n> Not a bug/);
  assert.match(SYSTEM, /closed-<n> Not a bug/);
  const small = knowledgeFor(['Settings'], {expectations, closed, notes: {Settings: [{text: 'an old note', seen: 1, last: '2026-10-01'}]}, maxTokens: 330});
  assert.ok(!small.includes('an old note') && small.includes('closed-3539') && small.includes('settings-3'), 'the note goes first, then closed verdicts, rules never');
});

test('batch 1: the "Always on" row noted by two goals of one run is one note; notes that only share a common phrase are not joined', () => {
  const noted = batch.notes.map(note => ({...note, goal: note.n}));
  const twins = noted.filter(note => note.issue === 3538 || note.issue === 3539);
  const {kept, joined} = joinSameElement(twins);
  assert.equal(kept.length, 1);
  assert.equal(joined.length, 1);
  assert.deepEqual(kept[0].alsoGoals, [joined[0].goal]);
  const all = joinSameElement(noted);
  assert.equal(all.joined.length, 1, `only the one pair of batch 1 is joined: ${all.joined.map(note => note.title)}`);
  const a = {view: 'settings', goal: 1, observed: 'The badge says "Not connected" and the row "GitHub · Always on" runs searches.'}, b = {view: 'settings', goal: 2, observed: 'The AI row says "Not connected" while "Manage" is greyed out.'};
  assert.equal(joinSameElement([a, b]).joined.length, 0, 'one common phrase among several quotes is not the same element');
  assert.equal(joinSameElement([{view: 'jobs', goal: 1, observed: 'nothing quoted'}, {view: 'jobs', goal: 2, observed: 'nothing quoted'}]).joined.length, 0);
  assert.equal(joinSameElement([a, {...a, view: 'jobs', goal: 3}]).joined.length, 0, 'another screen is another element');
  // code review (7 Nov 2026): one shared quote joined a low note with a high one on another row and hid the high one
  const low = {view: 'settings', goal: 1, severity: 'low', title: 'low', observed: 'The status reads "Not connected" next to the GitHub row.'}, high = {view: 'settings', goal: 2, severity: 'high', title: 'high', observed: 'The AI row says "Not connected" while the key is saved.'};
  assert.equal(joinSameElement([low, high]).joined.length, 0, 'one shared quote is not the same element');
  const fresh = note => ({...note, alsoGoals: undefined, joinedTo: undefined}), lowTwin = {...fresh(twins[0]), severity: 'low', title: 'low twin', goal: 5}, highTwin = {...fresh(twins[1]), severity: 'high', title: 'high twin', goal: 6};
  const merged = joinSameElement([lowTwin, highTwin]);
  assert.deepEqual([merged.kept.map(note => note.title), merged.joined.map(note => note.title), merged.joined[0].joinedTo, merged.kept[0].alsoGoals], [['high twin'], ['low twin'], 'high twin', [5]], 'the higher severity of two twins stays');
});

test('a disagree is held only when it names a rule or closed verdict that is in the knowledge; held notes are listed in the summary', () => {
  const knowledge = '## Settings\n- settings-3 a row names a setting\n- closed-3539 Not a bug: GitHub row: …';
  assert.deepEqual(citedIds('settings-3 says the badge is the state; also see closed-3539 and jobs-99', knowledge), ['settings-3', 'closed-3539'], 'an id that is not in the knowledge never counts');
  const base = {view: 'settings', severity: 'medium', observed: 'o', why: 'w'};
  const ruledNote = {...base, title: 'ruled', judge: 'disagrees', judgeReason: 'settings-3 …', judgeCites: ['settings-3']};
  const bareNote = {...base, title: 'bare', judge: 'disagrees', judgeReason: 'seems fine', judgeCites: []};
  const agreed = {...base, title: 'agreed', judge: 'agrees', judgeCites: []};
  const proved = {...ruledNote, title: 'proved', proved: true};
  const ranked = rankNotes([ruledNote, bareNote, agreed, proved]);
  assert.deepEqual(ranked.filed.map(note => note.title), ['proved', 'agreed', 'bare'], 'a bare disagree still files, last; a proved note is never held');
  assert.deepEqual(ranked.ruled.map(note => note.title), ['ruled']);
  const summary = summarizeSession({session: 's', persona: 'P', seed: 1, goals: [], notes: [ruledNote, agreed], joined: [{title: 'twin', view: 'settings'}]});
  const text = summaryMarkdown(summary);
  assert.match(text, /Not filed, the second opinion answers a rule the note cited or a closed verdict \(1\)[\s\S]*- ruled \(settings\): settings-3/);
  assert.match(text, /Joined to an earlier note of this run \(1\)[\s\S]*- twin \(settings\)/);
});

test('batch 1 through the production hold, with the verdicts the judge really gave: only #3539 (it cited settings-3 itself) is held; #3534 files with judge:disagrees', () => {
  const asJudged = note => {
    const knowledge = batchKnowledge(note, {expectations, lessons: batch.lessons}, 'before');   // the rules as they were that day
    return {...note, judge: note.recorded.judge, judgeReason: note.recorded.reason, judgeCites: holdingIds(note, note.recorded.reason, knowledge)};
  };
  const ranked = rankNotes(batch.notes.map(asJudged), 20);
  assert.deepEqual(ranked.ruled.map(note => note.issue), [3539]);
  assert.equal(ranked.filed.length, 8);
  assert.equal(ranked.filed.find(note => note.issue === 3534).judge, 'disagrees', 'a note citing "general UX" against a rule the judge names still files, labelled');
  assert.deepEqual(ranked.filed.filter(note => note.label === 'real').map(note => note.issue).sort(), [3530, 3532, 3533], 'the three real ones still file');
});

test('a judge that misapplies a rule never holds a real note: only a rule the note cited or a closed verdict holds (exam run 42407753226: real note #9 was held 3 of 3 runs by settings-3)', () => {
  const knowledge = '## Settings\n- settings-3 a row names a setting\n- jobs-3 an applied job\n- jobs-30 something else\n- closed-3539 Not a bug: GitHub row: x';
  const reason = 'Rule settings-3 says the label does not claim the setting is on, see also closed-3539 and jobs-3.';
  const realNote = {expected: 'general UX: Automation status must consistently indicate whether it is active.'};
  assert.deepEqual(holdingIds(realNote, reason.replace(', see also closed-3539 and jobs-3', ''), knowledge), [], 'a rule the note did not cite does not hold it');
  assert.deepEqual(holdingIds({expected: 'settings-3: a row such as "Always on: your GitHub" names a setting'}, reason.replace(', see also closed-3539 and jobs-3', ''), knowledge), ['settings-3'], 'the rule the note cited, answered by the judge');
  assert.deepEqual(holdingIds(realNote, reason, knowledge), ['closed-3539'], 'a closed verdict holds even a general-UX note');
  assert.deepEqual(holdingIds({expected: 'jobs-30 says so'}, 'jobs-3 forbids this', knowledge), [], 'jobs-3 is not jobs-30');
});

test('the batch-1 exam set: 3 real, 6 false, every note has its picture, and each variant tells the judge what it should', () => {
  assert.equal(batch.notes.filter(note => note.label === 'real').length, 3);
  assert.equal(batch.notes.filter(note => note.label === 'false').length, 6);
  assert.ok(batch.notes.every(note => note.image.length > 1000));
  const know = (note, variant) => batchKnowledge(note, {expectations, lessons: batch.lessons}, variant);
  const raw = batch.notes.find(note => note.issue === 3537), zoom = batch.notes.find(note => note.issue === 3531);
  assert.ok(!know(raw, 'before').includes('jobs-7') && know(raw, 'rules').includes('jobs-7') && !know(raw, 'closed').includes('jobs-7'));
  assert.ok(know(raw, 'closed').includes('closed-3537') && !know(raw, 'rules').includes('closed-3537') && !know(zoom, 'before').includes('closed-3531'));
  const jobsNote = batch.notes.find(note => note.issue === 3529);
  assert.ok(know(jobsNote, 'others').includes('closed-3537') && !know(jobsNote, 'others').includes('closed-3529') && know(jobsNote, 'closed').includes('closed-3529'), 'leave-one-out: the other closures, never the note\'s own');
  assert.deepEqual(BATCH1_RULES.filter(id => !Object.values(expectations).flat().some(rule => rule.id === id)), [], 'the three rules exist in docs/app-expectations');
});

test('the batch-1 score: the production rule holds a false note only on a named id, a judge-alone gate would drop more real notes', async () => {
  const ask = async ({messages}) => {
    const text = [].concat(messages[0].content).map(part => part.text || '').join('');
    const falseNote = batch.notes.find(note => text.includes(`Report: ${note.title}`) && note.label === 'false');
    // a fake judge: disagrees on every false note naming the first closed verdict it was given, and on one real note without naming anything
    const id = /^- (closed-\d+) /m.exec(text.split('Report:')[0])?.[1];
    const real = batch.notes.find(note => text.includes(`Report: ${note.title}`) && note.n === 2);
    return JSON.stringify(falseNote ? {verdict: 'disagrees', reason: `${id} says so.`} : real ? {verdict: 'disagrees', reason: 'it looks fine to me'} : {verdict: 'agrees', reason: 'the picture shows it'});
  };
  const score = scoreBatch(await askBatch({ask, notes: batch.notes, expectations, lessons: batch.lessons, variant: 'closed', runs: 3}));
  assert.equal(score.falseHeld, 6, 'every false note names an id of its area');
  assert.equal(score.realFiled, 3, 'a real note the judge disagrees with without naming anything is still filed');
  assert.equal(score.realKeptByJudgeAlone, 2, 'a judge-alone gate would have dropped it');
  assert.match(batchMarkdown({closed: score}), /\| closed \| 6 of 6 \| 3 of 3 \| 6\/0, 6\/0, 6\/0 \| 6 of 6 \| 2 of 3 \|/);
  assert.ok(fs.existsSync(new URL('notes.json', dir)));
});
