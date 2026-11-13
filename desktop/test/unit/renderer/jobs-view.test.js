import {readScreenSource} from '../../static-screen-source.js';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isSent, sentBreakdown, newOfTotal, jobCounts, interviewJob, notionPageUrl, ago, applicationStats, avatar, inProcess, band, byStat, isStuck, matchLabel, placeAndMode, sorted, stats, statusPill, tags, unscoredWhy, workMode} from '../../../renderer/jobs-view.js';

test('place and mode on one line say the mode once', () => {
  assert.equal(placeAndMode('Remote (Europe)', 'Remote'), 'Remote (Europe)');
  assert.equal(placeAndMode('Germany (Remote)', 'Remote (stated)'), 'Germany (Remote)');
  assert.equal(placeAndMode('Zurich', 'Hybrid'), 'Zurich · Hybrid');
  assert.equal(placeAndMode('', 'On-site'), 'On-site');
  assert.equal(placeAndMode('Bern', ''), 'Bern');
});

test('match label and age', () => {
  assert.deepEqual([matchLabel(78), matchLabel(62), matchLabel(30), matchLabel(null)], ['Strong match', 'Good match', 'Weak match', 'Not scored']);
  const now = Date.parse('2026-09-28T12:00:00Z');
  assert.equal(ago('2026-09-28T11:30:00Z', now), 'just now');
  assert.equal(ago('2026-09-28T07:00:00Z', now), '5h ago');
  assert.equal(ago('2026-09-25T12:00:00Z', now), '3d ago');
  assert.equal(ago('2026-09-07T12:00:00Z', now), '3w ago');
  assert.equal(ago('', now), '');
  assert.equal(ago('2099-01-01', now), '');  // a date in the future: no age
});

test('the counters: total, high fit, new this week, unique companies', () => {
  const now = Date.parse('2026-09-28T12:00:00Z');
  const jobs = [
    {fit: 80, company: 'Acme', first_seen_at: '2026-09-27'},
    {fit: 70, company: 'acme ', first_seen_at: '2026-09-01'},
    {fit: 40, company: 'Globex', first_seen_at: ''},
    {fit: null, company: '', first_seen_at: '2026-09-22'},
  ];
  assert.deepEqual(stats(jobs, 214, now), {total: 214, high: 2, week: 2, companies: 2});
  assert.equal(stats(jobs, undefined, now).total, 4);
});

test('clicking a counter shows the jobs it counts', () => {
  const now = Date.parse('2026-09-28T12:00:00Z');
  const jobs = [
    {fit: 60, company: 'Acme', first_seen_at: '2026-09-27'},
    {fit: 80, company: 'acme ', first_seen_at: '2026-09-01'},
    {fit: null, company: 'Globex', first_seen_at: '2026-09-22'},
    {fit: 90, company: '', first_seen_at: ''},
  ];
  assert.deepEqual(byStat(jobs, 'high', now), [jobs[1], jobs[3]]);
  assert.deepEqual(byStat(jobs, 'week', now), [jobs[0], jobs[2]]);
  assert.deepEqual(byStat(jobs, 'companies', now), [jobs[1], jobs[2]]);  // Acme's best fit, list order kept
  assert.equal(byStat(jobs, null, now), jobs);
  assert.equal(byStat(jobs, 'companies').length, stats(jobs).companies);
});

test('application counters follow the Notion stage, with the funnel\'s stage sets', () => {
  const jobs = [
    {status: 'applied', stage: 'Applied'}, {status: 'applied', stage: 'Interviewing'}, {status: 'applied', stage: 'Rejected'},
    {status: 'applied', stage: 'No response'}, {status: 'saved', stage: 'Saved'}, {status: 'unreviewed', stage: ''},
    {status: 'applied', stage: 'Applying'},  // a form still being filled: not sent, not counted
    {status: 'applied', stage: 'Screening'},
  ];
  // Sent = waiting + in process + closed: the boxes add up (the Applied card is isSent, its line is sentBreakdown).
  assert.deepEqual(applicationStats(jobs), {waiting: 1, interviews: 2, closed: 2});
  assert.equal(jobs.filter(isSent).length, 5);
  assert.deepEqual(sentBreakdown(jobs), {waiting: 1, closed: 2});
  assert.deepEqual(inProcess(jobs), {screening: 1, interviews: 1});
  assert.deepEqual(byStat(jobs, 'waiting'), [jobs[0]]);
  assert.deepEqual(byStat(jobs, 'closed'), [jobs[2], jobs[3]]);
});

test('Applying is stuck only when no session explains it', () => {
  const job = {stage: 'Applying', url: 'https://jobs.test/1'};
  assert.equal(isStuck(job, () => false), true);
  assert.equal(isStuck(job, () => true), false);  // a session for it is open: it is in progress, not stuck
  assert.equal(isStuck({stage: 'Applied'}, () => false), false);
});

test('sorting keeps the engine order for best match; newest and company reorder a copy', () => {
  const jobs = [{company: 'B', first_seen_at: '2026-09-01'}, {company: 'a', first_seen_at: '2026-09-20'}, {company: 'C', first_seen_at: ''}];
  assert.deepEqual(sorted(jobs, 'best'), jobs);
  assert.deepEqual(sorted(jobs, 'newest').map(j => j.company), ['a', 'B', 'C']);
  assert.deepEqual(sorted(jobs, 'company').map(j => j.company), ['a', 'B', 'C']);
  assert.equal(jobs[0].company, 'B');
});

test('company badges: initials and a stable colour; fit bands', () => {
  assert.equal(avatar('Northwind Robotics').initials, 'NR');
  assert.equal(avatar('Twilio').initials, 'TW');
  assert.equal(avatar('').initials, '?');
  assert.equal(avatar('Acme').hue, avatar('Acme').hue);
  assert.deepEqual([band(null), band(85), band(70), band(55), band(10)], ['none', 'high', 'high', 'mid', 'low']);
});

test('work-mode chip: one word for a known mode, the source wording otherwise', () => {
  assert.deepEqual(workMode('Remote (stated)'), {kind: 'remote', label: 'Remote'});
  assert.deepEqual(workMode('Hybrid'), {kind: 'hybrid', label: 'Hybrid'});
  assert.deepEqual(workMode('On site'), {kind: 'onsite', label: 'On-site'});
  assert.deepEqual(workMode('Flexible'), {kind: '', label: 'Flexible'});
});

test('an application shows its Notion Stage, e.g. Rejected rather than Applied', () => {
  assert.deepEqual(statusPill({status: 'applied', stage: 'Rejected'}), {label: 'Rejected', tone: 'bad'});
  assert.deepEqual(statusPill({status: 'applied', stage: 'Interviewing'}), {label: 'Interviewing', tone: 'info'});
  assert.deepEqual(statusPill({status: 'applied', stage: 'Applied'}), {label: 'Applied', tone: 'good'});
  assert.deepEqual(statusPill({status: 'applied'}), {label: 'Applied', tone: 'good'});
  assert.deepEqual(statusPill({status: 'unreviewed'}), {label: 'New', tone: 'info'});
  assert.deepEqual(statusPill({status: 'saved', stage: 'Recruiter lead'}), {label: 'Recruiter lead', tone: 'signal'});
});
test('feedback is visible beside Rejected while the funnel still counts one closed application', () => {
  const asked = {status: 'applied', stage: 'Rejected', feedback_status: 'Asked for feedback'};
  const received = {...asked, feedback_status: 'Received feedback'};
  assert.deepEqual(statusPill(asked), {label: 'Rejected · Asked for feedback', tone: 'warn'});
  assert.deepEqual(statusPill(received), {label: 'Rejected · Received feedback', tone: 'info'});
  assert.deepEqual(applicationStats([received]), {waiting: 0, interviews: 0, closed: 1});
  assert.deepEqual(sentBreakdown([received]), {waiting: 0, closed: 1});
});

test('the Interviews Job cell: a listed job opens in Jobs, a Notion-only link opens in Notion, none offers Link a job', () => {
  const job = {company: 'Grafana Labs', title: 'SRE', url: 'https://x.test/g', notion_url: 'https://www.notion.so/g1'};
  assert.deepEqual(interviewJob({application: ['g-1']}, job), {kind: 'job', name: 'Grafana Labs', role: 'SRE', notion: 'https://www.notion.so/g1'});
  assert.equal(interviewJob({application: ['a-1-2']}, {title: 'SRE', url: 'u'}).notion, 'https://www.notion.so/a12');
  assert.deepEqual(interviewJob({application: ['a-1-2']}, null), {kind: 'notion', name: 'Linked in Notion', role: '', notion: notionPageUrl('a-1-2')});
  assert.deepEqual(interviewJob({application: []}, null), {kind: 'none', name: 'No job linked', role: '', notion: ''});
});

// Inbound (renderer/origin.js): opportunities that found you.
test('an inbound opportunity counts as workload, as Applied only once you applied, and is not a job match', async () => {
  const {inConversation, matchesOnly} = await import('../../../renderer/jobs-view.js');
  const jobs = [
    {url: 'o1', stage: 'Screening', source: 'Job Pilotto app', company: 'Acme'},  // you applied
    {url: 'i1', stage: 'Screening', source: 'LinkedIn', company: 'Beta'},  // a recruiter found you: no Applied on
    {url: 'i2', stage: 'Interviewing', source: 'Gmail', notes: 'Recruiter message (Email)', applied_on: '2026-09-20', company: 'Gamma'},
    {url: 'i3', stage: 'Recruiter lead', source: 'Telegram', company: 'Delta', next_step: 'Reply to Jane'},
    {url: 'i4', stage: 'Rejected', source: 'Phone', company: 'Epsilon'},
    {url: 'm1', stage: '', company: 'Zeta', fit: 80},
  ];
  assert.deepEqual(applicationStats(jobs), {waiting: 0, interviews: 3, closed: 1});
  assert.deepEqual(jobs.filter(isSent).map(job => job.url), ['o1', 'i2'], 'Applied: the ones you applied to (the inbound i2 once it has an applied date)');
  // The list below: job matches only (the leads and recruiter pitches are not there).
  assert.deepEqual(matchesOnly(jobs).map(job => job.url), ['o1', 'm1']);
  // In conversation: the open inbound ones and the jobs you applied to that are being talked about; those with a
  // next step first; the rejected one is over.
  assert.deepEqual(inConversation(jobs).map(job => job.url), ['i3', 'o1', 'i1', 'i2']);
  assert.deepEqual(inConversation([{stage: 'Applied', source: 'Job Pilotto app'}, {stage: 'Rejected', source: 'Job Pilotto app'}]), []);
  assert.deepEqual(inConversation([{stage: 'Recruiter lead', source: 'Gmail'}, {stage: 'Dismissed', source: 'LinkedIn'}]).length, 1);
});

test('the Show menu: matches by status, every match under All matches, inbound under Inbound only', async () => {
  const {byFilter, inboundCount, sorted: order, toReview} = await import('../../../renderer/jobs-view.js');
  const jobs = [
    {url: 'm-new', status: 'unreviewed', first_seen_at: '2026-09-01'},
    {url: 'm-saved', status: 'saved'},
    {url: 'm-gone', status: 'dismissed'},
    {url: 'i-lead', status: 'saved', stage: 'Recruiter lead', source: 'Gmail', first_seen_at: '2026-09-02'},
    {url: 'i-new', status: 'unreviewed', source: 'LinkedIn', first_seen_at: '2026-09-03'},
    {url: 'i-talk', status: 'applied', stage: 'Screening', source: 'Phone', first_seen_at: '2026-08-01', applied_on: '2026-09-20'},
    {url: 'i-over', status: 'dismissed', stage: 'Dismissed', source: 'LinkedIn', first_seen_at: '2026-09-04'},
  ];
  const urls = filter => byFilter(jobs, filter).map(job => job.url);
  assert.deepEqual(urls('open'), ['m-new']);
  assert.deepEqual(urls('saved'), ['m-saved']);
  assert.deepEqual(urls('applied'), []);
  assert.deepEqual(urls('dismissed'), ['m-gone']);
  assert.deepEqual(urls('inbound'), ['i-lead', 'i-new', 'i-talk', 'i-over']);
  // All matches = every job match, whatever its status: exactly the set the Total matches card counts, so clicking that
  // card lists the number it shows. The opportunities that found you are Inbound's alone.
  assert.deepEqual(urls('all'), ['m-new', 'm-saved', 'm-gone']);
  // An applied job match is an application, not a match to decide on: every match list and counter leaves it out.
  const withApplied = [...jobs, {url: 'm-applied', status: 'applied', stage: 'Applied', fit: 90, first_seen_at: '2026-10-12'}];
  assert.deepEqual(byFilter(withApplied, 'all').map(job => job.url), ['m-new', 'm-saved', 'm-gone']);
  assert.deepEqual(byFilter(withApplied, 'applied').map(job => job.url), ['m-applied']);
  const {openMatches, stats: countStats} = await import('../../../renderer/jobs-view.js');
  assert.deepEqual(openMatches(withApplied).map(job => job.url), ['m-new', 'm-saved', 'm-gone']);
  assert.equal(countStats(openMatches(withApplied)).high, 0);
  // Everything = All matches + Inbound, every status: the one list that holds both kinds (no card counts it).
  assert.deepEqual(urls('everything'), jobs.map(job => job.url));
  assert.deepEqual(order(byFilter(jobs, 'inbound'), 'activity').map(job => job.url), ['i-talk', 'i-over', 'i-new', 'i-lead']);
  assert.equal(inboundCount(jobs), 4);
  assert.equal(byFilter(jobs, 'everything').length, byFilter(jobs, 'all').length + byFilter(jobs, 'inbound').length);
  // The Jobs menu item's count: the list as it opens — each match waiting for a first look, inbound left out.
  assert.equal(toReview(jobs), 1);
});

test('the four cards: Total and Applied are menu lists, New and Interviews counter lists; the active one again goes back to every match', async () => {
  const {statClick, statPressed} = await import('../../../renderer/jobs-view.js');
  assert.deepEqual(statClick('total', 'fresh', 'all'), {stat: null, filter: 'all'});
  assert.deepEqual(statClick('applied', null, 'open'), {stat: null, filter: 'applied'});
  assert.deepEqual(statClick('fresh', null, 'applied'), {stat: 'fresh', filter: 'all'});
  assert.deepEqual(statClick('fresh', 'fresh', 'all'), {stat: null, filter: 'all'});
  assert.deepEqual(statClick('interviews', 'fresh', 'all'), {stat: 'interviews', filter: 'all'});
  assert.equal(statPressed('total', null, 'all'), true);
  assert.equal(statPressed('applied', null, 'applied'), true);
  assert.equal(statPressed('applied', null, 'all'), false);
  assert.equal(statPressed('fresh', 'fresh', 'all'), true);
  assert.equal(statPressed('total', 'fresh', 'all'), false, 'a counter list is pressed, not Total');
  // Everything is wider than any card: none is pressed while it is the list (the Total matches card counts 132, not 138).
  assert.equal(statPressed('total', null, 'everything'), false);
});

test('Jobs page: "New matches" (not "To review"), Inbound and Everything as options of the one Show menu', async () => {
  const html = readScreenSource(new URL('../../../renderer/index.html', import.meta.url), 'utf8');
  const {FILTER_OPTIONS} = await import('../../../renderer/jobs-filters.js');
  const labels = FILTER_OPTIONS.map(option => option.label);
  for (const wanted of ['New matches', 'Saved', 'Applied', 'Dismissed', 'Inbound', 'All matches', 'Everything']) assert.ok(labels.includes(wanted), wanted);
  assert.ok(!html.includes('To review'));
  const cards = [...html.matchAll(/data-stat="(\w+)"/g)].map(m => m[1]);
  assert.deepEqual(cards, ['total', 'fresh', 'applied', 'interviews'], 'four cards (df 2/2, owner 13 Nov 2026): Total, New (last run), Applied, Interviews');
});

test('a job being prepared stays Preparing through re-renders, until its kit shows', async () => {
  const {prepareState} = await import('../../../renderer/jobs-view.js');
  const tracker = new Map([['ab12', 'local'], ['cd34', 'local'], ['ef56', 'failed']]);
  assert.deepEqual(['ab12', 'cd34', 'ef56', 'zz99'].map(code => prepareState({code}, tracker)), ['local', 'local', 'failed', '']);
  assert.equal(prepareState({code: 'cd34', kit: true}, tracker), '');  // the reloaded list has the kit: forgotten
  assert.equal(tracker.has('cd34'), false);
});

test('a posting that lists many places shows the first two and a count, with all of them on hover (2 Oct 2026: one row was 20 lines tall)', async () => {
  const {shortPlace} = await import('../../../renderer/jobs-view.js');
  const many = 'Remote - European Union; Spain; Italy; Germany; Switzerland; Denmark; Norway; Croatia; Ireland; Stockholm; Romania; Austria; Barcelona; Netherlands; Portugal; France; Berlin; Sweden; Hungary; Estonia';
  assert.deepEqual(shortPlace(many), {text: 'Remote - European Union; Spain +18', full: many.replace(/;\s*/g, '; ')});
  assert.deepEqual(shortPlace('Zurich; Geneva'), {text: 'Zurich; Geneva', full: ''});   // two or fewer: as written
  assert.deepEqual(shortPlace('Zurich, Switzerland'), {text: 'Zurich, Switzerland', full: ''});
  assert.deepEqual(shortPlace(''), {text: '', full: ''});
  assert.equal(placeAndMode(many, 'Remote').split(' · ')[0], 'Remote - European Union; Spain +18');   // the row and the board card too
});

test('a saved or kit-ready job found Closed on refresh is named; other changes are not', async () => {
  const {takenDown} = await import('../../../renderer/jobs-view.js');
  const before = [{url: 'a', stage: 'Kit ready'}, {url: 'b', stage: 'Saved'}, {url: 'c', stage: 'Applying'}, {url: 'd', stage: 'Kit ready'}];
  const after = [{url: 'a', stage: 'Closed'}, {url: 'b', stage: 'Dismissed'}, {url: 'c', stage: 'Closed'}, {url: 'd', stage: 'Kit ready'}];
  assert.deepEqual(takenDown(before, after).map(job => job.url), ['a']);
  assert.deepEqual(takenDown([], after), []);   // the first load is not news
});

// #323: a job whose place cannot be told (only a country, posting unreadable) is listed, unscored, and the row says why; the "not scored yet"
// banner (the AI failing) does not count it.
test('a job whose place is unclear says so instead of "not scored yet"', () => {
  assert.match(unscoredWhy({fit: null, place_unclear: true}), /place is unclear.*could not be read/);
  assert.match(unscoredWhy({fit: null}), /^Not scored yet/);
  assert.equal(unscoredWhy({fit: 80, place_unclear: true}), '', 'a scored job needs no reason');
  const render = readScreenSource(new URL('../../../renderer/pages/jobs-render.js', import.meta.url), 'utf8');
  assert.match(render, /pill\(PLACE_UNCLEAR, 'warn'\)/, 'the row shows the badge');
  assert.match(render, /job\.status === 'unreviewed' && !job\.place_unclear\)\.length/, 'the AI banner leaves these out');
});

test('tags are the skills the AI read from the posting, for any trade and language, never a word list', () => {
  const jobs = [
    {title: 'Pflegefachperson Nachtdienst', reason: 'Patient monitoring, Palliativ', skills: ['Palliativpflege', 'Wundversorgung', 'Schichtdienst', 'Dipl. Pflege HF', 'Extra']},
    {title: 'Chauffeur CE', reason: 'Nahverkehr', skills: [' Kat. CE ', 'Tachograph', 'Tachograph', '']},
    {title: 'Senior SRE', reason: 'Kubernetes on AWS', skills: ['Terraform']},
  ];
  assert.deepEqual(tags(jobs[0]), ['Palliativpflege', 'Wundversorgung', 'Schichtdienst', 'Dipl. Pflege HF']);
  assert.deepEqual(tags(jobs[1]), ['Kat. CE', 'Tachograph']);
  assert.deepEqual(tags(jobs[2]), ['Terraform']);
  // Title and fit line alone never make a tag: "monitoring" on a nurse is not "Observability"; a job the AI has not read has none.
  assert.deepEqual(tags({title: 'Senior SRE Kubernetes AWS', reason: 'monitoring observability'}), []);
});

test('jobs-view.js holds no tech word list', () => {
  const source = readScreenSource(new URL('../../../renderer/jobs-view.js', import.meta.url), 'utf8');
  for (const word of ['Observability', 'Kubernetes', 'Terraform', 'OpenTelemetry', 'DevOps']) assert.ok(!source.includes(word), word);
});

test('In conversation starts folded as one line; a saved open choice unfolds it', async () => {
  const {talkingBar, talkingStartsOpen} = await import('../../../renderer/jobs-view.js');
  assert.equal(talkingStartsOpen(null), false);
  assert.equal(talkingStartsOpen('0'), false);
  assert.equal(talkingStartsOpen('1'), true);
  const talking = [{stage: 'Screening', source: 'Job Pilotto app'}, {stage: 'Recruiter lead', source: 'Gmail'}];
  assert.deepEqual(talkingBar(talking, false), {title: '2 in conversation', detail: '', toggle: 'Show'});
  assert.deepEqual(talkingBar(talking, true), {title: 'In conversation', detail: '2 active · 1 inbound · 1 outbound', toggle: 'Hide'});
});

// #3377 (owner 7 Nov 2026, "Words say it"): the header's Total matches counts saved and dismissed matches, the New matches list holds the unreviewed ones; the list bar names both sets.
test('the list bar says "N new of M matches" only on the plain New matches list, when the two counts differ', () => {
  const mk = (status, i) => ({url: `u${i}`, status, stage: status === 'applied' ? 'Applied' : 'Kit ready', fit: 80, first_seen_at: '2026-01-01', company: `C${i}`});
  const twelve = Array.from({length: 12}, (_, i) => mk('unreviewed', i));
  const view = (jobs, over = {}) => ({filter: 'open', statFilter: null, text: '', shown: 12, data: {jobs, total: jobs.length}, ...over});
  assert.deepEqual(newOfTotal(view([...twelve, mk('saved', 90)])), {new: 12, total: 13}, 'one saved match: the header says 13, the list holds 12');
  assert.equal(jobCounts({jobs: [...twelve, mk('saved', 90)], total: 13}).total, 13, 'the header number is the same definition');
  assert.deepEqual(newOfTotal(view([...twelve, mk('dismissed', 91)])), {new: 12, total: 13}, 'a set-aside match counts in the header too');
  assert.equal(newOfTotal(view(twelve)), null, 'nothing else to explain: the plain count stays');
  assert.equal(newOfTotal(view([...twelve, mk('applied', 92)])), null, 'an applied job is not a match: 12 and 12');
  const withSaved = [...twelve, mk('saved', 90)];
  assert.equal(newOfTotal(view(withSaved, {filter: 'all', shown: 13})), null, 'another filter keeps its own count');
  assert.equal(newOfTotal(view(withSaved, {statFilter: 'high'})), null, 'a counter clicked above the list keeps its own count');
  assert.equal(newOfTotal(view(withSaved, {text: 'pilot'})), null, 'search words narrow the list: no split');
  assert.equal(newOfTotal(view(withSaved, {data: null})), null, 'a list not loaded yet says nothing');
  assert.equal(newOfTotal(view(withSaved, {shown: 14})), null, 'never "14 new of 13"');
  assert.equal(newOfTotal(view(withSaved, {data: {jobs: withSaved, total: 1335}})), null, 'a cut list (200 of 1,335 loaded): the rows left out may be new too, so no split');
});

// jobs-5 (docs/app-expectations/jobs.md, corrected 7 Nov 2026, owner: "Keep the code, fix the rule", #3516): the AI persona's seeded lead (desktop/e2e/lib/agent-seed.mjs inboundRows: an inbound row, stage Applied, an Applied on date)
// is an application the person sent, so Applied shows 1 while Total matches shows 0. The rule used to say the Applied tile leaves inbound jobs out, and the persona filed this screen as a bug.
test('an inbound lead the person applied to counts in Applied while Total matches stays 0', () => {
  const lead = {url: 'https://jobs.e2e.test/plover/lead', stage: 'Applied', applied_on: '2026-11-07', source: 'Email', origin: 'Inbound', company: 'Plover Partners'};
  assert.equal(jobCounts({jobs: [lead]}).total, 0, 'no job match');
  assert.deepEqual(applicationStats([lead]), {waiting: 1, interviews: 0, closed: 0}, 'one application sent, waiting for a reply');
  assert.equal(isSent(lead), true);
  assert.equal(isSent({...lead, applied_on: undefined}), false, 'control: the same lead before the person applied is not Applied');
});
