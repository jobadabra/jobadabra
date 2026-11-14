// Helper catalogs keep seven real translations and preserve named interpolation boundaries.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const root = new URL('../../../', import.meta.url);
const locales = ['en', 'de', 'fr', 'it', 'es', 'ro', 'ru'];
const catalog = locale => import(new URL(`i18n/catalogs/helpers/${locale}.js`, root));
const parameters = text => [...String(text).matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();

test('helper plural maps explicitly cover every category of their display locale', async () => {
  const folder = new URL('i18n/catalogs/helpers/', root);
  for (const file of fs.readdirSync(folder).filter(file => file.endsWith('.js'))) {
    const locale = file.slice(0, 2);
    const {messages} = await import(new URL(file, folder));
    for (const [key, value] of Object.entries(messages)) {
      if (typeof value !== 'object') continue;
      for (const category of new Intl.PluralRules(locale).resolvedOptions().pluralCategories) {
        assert.ok(Object.hasOwn(value, category), `${file}/${key}: missing ${category}`);
      }
    }
  }
});

test('helper messages have seven complete catalogs with matching named parameters', async () => {
  const {messages: english} = await catalog('en');
  assert.ok(Object.keys(english).length >= 50);
  for (const locale of locales) {
    const {messages} = await catalog(locale);
    assert.deepEqual(Object.keys(messages).sort(), Object.keys(english).sort(), locale);
    for (const [key, value] of Object.entries(messages)) {
      assert.equal(typeof value, 'string', `${locale}.${key}`);
      assert.ok(value.trim(), `${locale}.${key}`);
      assert.deepEqual(parameters(value), parameters(english[key]), `${locale}.${key}`);
    }
  }
});

test('every migrated helper lookup is registered and user content stays outside the catalog', async () => {
  const {messages} = await catalog('en');
  const namespaces = {helpers: messages};
  for (const [namespace, suffix] of Object.entries({helperState: 'state', helperMore: 'more', helperFlow: 'flow', helperProfile: 'profile', helperRest: 'rest', helperGuide: 'guide', helperTips: 'tips', helperTail: 'tail'})) namespaces[namespace] = (await import(new URL(`i18n/catalogs/helpers/en-${suffix}.js`, root))).messages;
  const files = fs.readdirSync(new URL('renderer/job-drawer/', root)).filter(file => file.endsWith('.js')).map(file => `renderer/job-drawer/${file}`);
  files.push(...fs.readdirSync(new URL('renderer/', root)).filter(file => file.endsWith('.js')).map(file => `renderer/${file}`));
  let count = 0;
  for (const file of files) {
    const source = fs.readFileSync(new URL(file, root), 'utf8');
    for (const match of source.matchAll(/t\('(helpers|helperState|helperMore|helperFlow|helperProfile|helperRest|helperGuide|helperTips|helperTail)\.([^']+)'/g)) {
      assert.ok(match[2] in namespaces[match[1]], `${file}: ${match[1]}.${match[2]}`);
      count++;
    }
  }
  assert.ok(count >= 50, `only ${count} localized helper lookups`);
  const rows = fs.readFileSync(new URL('renderer/job-drawer/documents-rows.js', root), 'utf8');
  assert.match(rows, /document\.createTextNode\(part\)/);
});

test('localized controls resolve at call time and preserve interpolation as plain text', async () => {
  await import('../../../i18n/screens-helpers.js');
  const {setLocale, t} = await import('../../../i18n/index.js');
  const {foldToggleWord} = await import('../../../renderer/fold-toggle.js');
  try {
    setLocale('de');
    assert.equal(foldToggleWord(false), 'Anzeigen');
    setLocale('ru');
    assert.equal(foldToggleWord(true), 'Скрыть');
    assert.equal(t('helpers.yourAnswer', {answer: '<img onerror=bad>'}), 'Ваш ответ: <img onerror=bad>');
    setLocale('ro');
    assert.equal(t('helpers.position', {index: 2, total: 5}), '2 din 5');
  } finally { setLocale('en'); }
});

test('drawer facts translate labels while preserving posting, employer and answer text', async () => {
  await import('../../../i18n/screens-helpers.js');
  const {setLocale} = await import('../../../i18n/index.js');
  const {glanceTiles, postingFacts, postingBlocks, kitParts, allAnswers} = await import('../../../renderer/job-page-view.js');
  try {
    setLocale('ru');
    const tiles = glanceTiles({salary: 'CHF 120000', work_mode: 'Hybrid', technologies: 'Rust'});
    assert.equal(tiles[0].label, 'Зарплата');
    assert.equal(tiles[0].value, 'CHF 120000');
    assert.equal(tiles[1].value, 'Hybrid');
    assert.equal(tiles[1].note, 'Дни в офисе не указаны');
    const company = '<Acme & Sons>';
    assert.equal(postingFacts({company}, {}, 'Keep the original text.')[0].value, company);
    assert.equal(postingBlocks('## Original employer heading\nOriginal posting text.')[0].text, 'Original employer heading');
    const kit = kitParts({answers: [{question: 'Why Acme?', answer: '<My own answer>'}], cover_letter: 'My own letter'}, '');
    assert.equal(kit.letter, 'My own letter');
    assert.equal(allAnswers(kit.answers), 'Why Acme?\n<My own answer>');
  } finally { setLocale('en'); }
});

test('stage display translations never change stored board stages or filtering', async () => {
  await import('../../../i18n/screens-helpers.js');
  const {setLocale} = await import('../../../i18n/index.js');
  const rules = await import('../../../renderer/jobs-board-rules.js');
  try {
    setLocale('de');
    assert.equal(rules.stageText('Applied'), 'Beworben');
    assert.equal(rules.stageText('Kit ready'), 'Gespeichert');
    assert.equal(rules.stageText('Employer-specific stage'), 'Employer-specific stage');
    assert.equal(rules.columnOf({stage: 'Applied'}), 'Applied');
    assert.equal(rules.inView({stage: 'Applied'}, 'active'), true);
  } finally { setLocale('en'); }
});

test('timeline icon lookup keeps stored event kinds as keys', () => {
  const source = fs.readFileSync(new URL('renderer/job-drawer/tab-timeline.js', root), 'utf8');
  const icons = source.match(/const ICONS = (.*);/)[1];
  assert.equal(icons, "{'Job discovered': 'search', Applied: 'file', 'Confirmation received': 'check-circle', 'Interview scheduled': 'calendar', Rejected: 'close', Offer: 'check-circle'}");
});

test('AI install guidance translates copy while preserving executable commands and action ids', async () => {
  await import('../../../i18n/screens-helpers.js');
  const {setLocale} = await import('../../../i18n/index.js');
  try {
    setLocale('es');
    const {guide} = await import('../../../renderer/ai-plan-guide.js');
    const result = guide('app-only', {family: 'openai', platform: 'win32', inApp: true});
    assert.match(result.title, /Encontramos/);
    assert.equal(result.actions[0].id, 'install');
    assert.equal(result.actions[0].label, 'Instalar Codex');
    assert.equal(result.command, 'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"');
    assert.match(result.steps[0], /^Abre PowerShell/);
  } finally { setLocale('en'); }
});

test('helper state catalogs have complete keys and matching interpolation in every plural branch', async () => {
  for (const suffix of ['state', 'more', 'flow', 'profile', 'rest', 'guide', 'tips', 'tail']) {
  const stateCatalog = locale => import(new URL(`i18n/catalogs/helpers/${locale}-${suffix}.js`, root));
  const {messages: english} = await stateCatalog('en');
  const branches = value => typeof value === 'string' ? [value] : Object.values(value);
  for (const locale of locales) {
    const {messages} = await stateCatalog(locale);
    assert.deepEqual(Object.keys(messages).sort(), Object.keys(english).sort(), locale);
    for (const [key, value] of Object.entries(messages)) {
      const params = branch => parameters(branch).filter(name => typeof english[key] !== 'object' || name !== 'count');
      const expected = params(branches(english[key])[0]);
      for (const branch of branches(value)) {
        assert.ok(branch.trim(), `${locale}.${key}`);
        assert.deepEqual(params(branch), expected, `${locale}.${key}`);
      }
      if (typeof value === 'object') assert.equal(typeof value.other, 'string', `${locale}.${key}.other`);
    }
  }
  }
});

test('pure helpers retain English defaults when offline tooling imports them without renderer bootstrap', async () => {
  const {execFileSync} = await import('node:child_process');
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', "import {runStatus} from './renderer/run-status.js'; console.log(runStatus({ok:true,result:'original'},false)[0]);"], {cwd: root, encoding: 'utf8'});
  assert.equal(output.trim(), 'Completed');
});

test('page step display is localized while canonical journal lines stay unchanged', async () => {
  const {setLocale} = await import('../../../i18n/index.js');
  const pages = await import('../../../renderer/page-lines.js');
  try {
    setLocale('de');
    assert.equal(pages.pageLine('reading'), 'Reading this page…');
    assert.equal(pages.displayPageLine('reading'), 'Diese Seite wird gelesen…');
    assert.equal(pages.displayPageLine('account', true), 'Anmeldeseite');
  } finally { setLocale('en'); }
});

test('a localized session keeps active counts and account identifiers independent of displayed words', async () => {
  const {execFileSync} = await import('node:child_process');
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', "import {setLocale} from './i18n/index.js'; setLocale('de'); const {sessionState,dockCounts}=await import('./renderer/session-state.js'); const items=[{status:'running',kind:'claude',live:true},{status:'done',kind:'form',endedAt:'2026-11-07'}]; console.log(JSON.stringify({label:sessionState(items[0])[0],counts:dockCounts(items)}));"], {cwd: root, encoding: 'utf8'});
  assert.deepEqual(JSON.parse(output), {label: 'Bewerbung läuft', counts: {active: 2, needs: 0, waiting: 0}});
});

test('apply-mode labels translate without changing persisted mode ids, runners or answer choices', async () => {
  const {execFileSync} = await import('node:child_process');
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', "import {setLocale} from './i18n/index.js'; setLocale('it'); const {MODES,applyPatch,applyOf}=await import('./renderer/apply-settings-model.js'); console.log(JSON.stringify({title:MODES[0].title,id:MODES[0].id,runner:MODES[0].runner,saved:applyOf(applyPatch({}, {mode:'fill',answers:'facts'}))}));"], {cwd: root, encoding: 'utf8'});
  const value = JSON.parse(output);
  assert.equal(value.title, 'Automazione standard');
  assert.equal(value.id, 'check');
  assert.equal(value.runner, 'chrome');
  assert.equal(value.saved.mode, 'fill');
  assert.equal(value.saved.answers, 'facts');
});

test('AI engine chooser localizes descriptions while keeping engine ids, fallback settings and billing ids stable', async () => {
  const {execFileSync} = await import('node:child_process');
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', "import {setLocale} from './i18n/index.js'; setLocale('ro'); const {TEXT,chosen,billingLabel,ENGINE_CHOICES}=await import('./renderer/ai-engine-view.js'); console.log(JSON.stringify({title:TEXT.title,choice:chosen({aiEngine:'codex'}),billing:billingLabel({billing:'ChatGPT plan'}),ids:ENGINE_CHOICES.map(item=>item[0])}));"], {cwd: root, encoding: 'utf8'});
  assert.deepEqual(JSON.parse(output), {title: 'Motor de execuție', choice: 'codex', billing: 'Codex · planul tău', ids: ['free','family-claude','family-openai','cli','codex']});
});

test('desktop assistant display translates while its copied instruction stays canonical', async () => {
  const {setLocale} = await import('../../../i18n/index.js');
  const {words,connectWords,instruction,KEY} = await import('../../../renderer/desktop-ai-words.js');
  try {
    setLocale('fr');
    assert.equal(words('openai').title, 'Laissez ChatGPT répondre à vos questions');
    assert.equal(connectWords('openai').connect, 'Connecter ChatGPT');
    assert.match(connectWords('openai').privacy.text, /OpenAI/);
    assert.match(instruction(true), /Never press Submit on any job\. Do not change Settings\./);
    assert.equal(KEY, 'desktop-ai:answer');
  } finally { setLocale('en'); }
});

test('credit display localizes around the unchanged shared estimate', async () => {
  const {setLocale} = await import('../../../i18n/index.js');
  const {applicationsFor} = await import('../../../renderer/credit-buys.js');
  const {buysWords} = await import('../../../renderer/credit-buys-view.js');
  try {
    setLocale('ro');
    assert.equal(buysWords(10), `aproximativ ${applicationsFor(10)} de candidaturi`);
    assert.equal(buysWords(0), '');
  } finally { setLocale('en'); }
});

test('plan and Always on copy translate without altering caps, availability or account choices', async () => {
  const {execFileSync} = await import('node:child_process');
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', "import {setLocale} from './i18n/index.js'; setLocale('de'); const {topupWords}=await import('./renderer/plan-view.js'); const {choices,running}=await import('./renderer/always-on-choice-words.js'); const c=choices({open:false,now:'ours'}); console.log(JSON.stringify({cap:topupWords({cap:'day'}),ids:c.map(item=>item.id),title:c[0].title,disabled:c[0].disabled,running:running({hostedOn:true,cloudRepo:'example/repo'})}));"], {cwd: root, encoding: 'utf8'});
  const value = JSON.parse(output);
  assert.equal(value.cap.primary, 'Zu Pro wechseln');
  assert.equal(value.cap.pro, false);
  assert.equal(value.disabled, false);
  assert.deepEqual(value.ids, ['ours','own']);
  assert.equal(value.title, 'Auf unseren Servern');
  assert.equal(value.running, 'both');
});

test('CV readiness translates its display without changing the read state', async () => {
  const {setLocale} = await import('../../../i18n/index.js');
  const {cvStateText} = await import('../../../renderer/cv-state.js');
  try {
    setLocale('de');
    assert.equal(cvStateText({base: true, custom: true}, false), '· bereit · Ihr Design');
    assert.equal(cvStateText({base: false}, true), '· nicht gelesen');
  } finally { setLocale('en'); }
});

test('Gmail and hosted offers preserve interpolated addresses, employers and activation states', async () => {
  const {execFileSync} = await import('node:child_process');
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', "import {setLocale} from './i18n/index.js'; setLocale('it'); const {offerWords,KEY}=await import('./renderer/gmail-offer-words.js'); const {model,when,turnedOnLine}=await import('./renderer/hosted-words.js'); console.log(JSON.stringify({gmail:offerWords({employer:'Example & Co'}),code:offerWords({why:'code',host:'www.example.test'}),key:KEY,hosted:model({on:true,email:'fictional@example.test'}),tomorrow:when(new Date(2026,10,8,7).toISOString(),new Date(2026,10,7,12)),confirmed:turnedOnLine('fictional@example.test',false)}));"], {cwd: root, encoding: 'utf8'});
  const value = JSON.parse(output);
  assert.equal(value.gmail.yes, 'Collega Gmail');
  assert.match(value.gmail.lead, /Example & Co/);
  assert.match(value.code.lead, /^example.test ha inviato/);
  assert.equal(value.key, 'gmail:connect');
  assert.equal(value.hosted.state, 'on');
  assert.deepEqual(value.hosted.pill, ['Attivo', 'good']);
  assert.match(value.hosted.line, /fictional@example.test/);
  assert.equal(value.tomorrow, 'domani ~7:00');
  assert.match(value.confirmed, /Premi il link/);
});

test('LinkedIn consent translates its warning and keeps action keys and raw failure notes', async () => {
  const {execFileSync} = await import('node:child_process');
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', "import {setLocale} from './i18n/index.js'; setLocale('de'); const {CONSENT,KEY,notOpened,signInEnded,linkedinEntries}=await import('./renderer/linkedin-words.js'); console.log(JSON.stringify({words:CONSENT.ask,key:KEY,note:notOpened({reason:'missing',note:'Original provider note'})[1],error:signInEnded({reason:'not-kept',error:'Original provider error'})[1],action:linkedinEntries({view:{loaded:true}})[0].actions[0].do}));"], {cwd: root, encoding: 'utf8'});
  const value = JSON.parse(output);
  assert.equal(value.words.yes, 'Weiter', 'the choice decides the way; the button only continues');
  assert.match(value.words.line, /Konten einschränken/);
  assert.match(value.words.lead, /Jobadabra sieht Ihr Passwort nie/);
  assert.equal(value.key, 'linkedin:jobs');
  assert.equal(value.action, 'turn_on_linkedin');
  assert.match(value.note, /Original provider note$/);
  assert.equal(value.error, 'Original provider error');
});

test('job displays translate while stage identifiers, filters and unknown posting words stay original', async () => {
  const {execFileSync} = await import('node:child_process');
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', "import {setLocale} from './i18n/index.js'; setLocale('de'); const {statusPill,workMode,ago}=await import('./renderer/jobs-view.js'); const {columnOf,STAGES,inView}=await import('./renderer/jobs-board-rules.js'); const {FILTER_OPTIONS,inFilters}=await import('./renderer/jobs-filters.js'); const job={status:'applied',stage:'Rejected'}; console.log(JSON.stringify({pill:statusPill(job),column:columnOf(job),stage:STAGES[9],view:inView(job,'rejected'),filter:inFilters(job,['applied']),label:FILTER_OPTIONS.find(x=>x.id==='open').label,mode:workMode('Remote (stated)'),unknown:workMode('Employer wording'),ago:ago('2026-11-07T07:00:00Z',Date.parse('2026-11-07T12:00:00Z'))}));"], {cwd: root, encoding: 'utf8'});
  const value = JSON.parse(output);
  assert.deepEqual(value.pill, {label: 'Abgelehnt', tone: 'bad'});
  assert.equal(value.column, 'Rejected');
  assert.equal(value.stage, 'Rejected');
  assert.equal(value.view, true);
  assert.equal(value.filter, true);
  assert.equal(value.label, 'Neue Treffer');
  assert.deepEqual(value.mode, {kind: 'remote', label: 'Remote'});
  assert.deepEqual(value.unknown, {kind: '', label: 'Employer wording'});
  assert.equal(value.ago, 'vor 5 Std.');
});

test('interview display preserves review parsing, transcript content and preparation action ids', async () => {
  const {execFileSync} = await import('node:child_process');
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', "import {setLocale} from './i18n/index.js'; setLocale('de'); const {reviewParts}=await import('./renderer/interview-review-view.js'); const {prepCard}=await import('./renderer/prep-card.js'); console.log(JSON.stringify({review:reviewParts({review:['## Questions','- ✅ [Team] Why? — My own answer','## Original heading','Original review'].join(String.fromCharCode(10)),transcript:'My original transcript'}),prep:prepCard({prep_at:'2026-11-06',prep_stale:true,prep_why:'booked',prep_since:'2026-11-07'},'2026-11-07'),ready:prepCard({prep_at:'2026-11-07'},'2026-11-07')}));"], {cwd: root, encoding: 'utf8'});
  const value = JSON.parse(output);
  assert.equal(value.review.questions[0].verdict, 'Stark');
  assert.equal(value.review.questions[0].answer, 'My own answer');
  assert.equal(value.review.groups[0].title, 'Original heading');
  assert.deepEqual(value.review.transcript, ['My original transcript']);
  assert.equal(value.prep.primary.run, 'build');
  assert.equal(value.prep.more[0].run, 'open');
  assert.match(value.prep.meta[1], /heute/);
  assert.doesNotMatch(value.prep.meta[1], /on heute/);
  assert.equal(value.ready.primary.run, 'open');
});

test('insight counts use Russian plural forms while generated titles and quotes remain original', async () => {
  const {execFileSync} = await import('node:child_process');
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', "import {install} from './test/tiny-dom.js'; install(); import {setLocale,t} from './i18n/index.js'; setLocale('ru'); const {insightView}=await import('./renderer/interview-insight.js'); const insight=insightView({sample:2,headline:'Original headline',confidence:'high',interviews:[{id:'one',title:'Example company'}],patterns:[{title:'Original pattern',text:'Original explanation',interviews:['one'],evidence:[{quote:'Original quote',interview:'one'}]}]},[{id:'one',overall:'Good'}]); console.log(JSON.stringify({insight,counts:[1,2,5].map(count=>t('helperFlow.interviewsCount',{count}))}));"], {cwd: root, encoding: 'utf8'});
  const value = JSON.parse(output);
  assert.deepEqual(value.counts, ['1 собеседование', '2 собеседования', '5 собеседований']);
  assert.equal(value.insight.primary.headline, 'Original headline');
  assert.equal(value.insight.primary.tag, 'Наблюдалось: 2 собеседования');
  assert.equal(value.insight.patterns[0].title, 'Original pattern');
  assert.equal(value.insight.moments[0].quotes[0].quote, 'Original quote');
  assert.equal(value.insight.chip.level, 'high');
});

test('re-score wording localizes counts without changing its sixty-job batch promise', async () => {
  const {setLocale} = await import('../../../i18n/index.js');
  const {jobs,noticeTitle,pressLabel,dialogLead} = await import('../../../renderer/rescore-words.js');
  try {
    setLocale('ro');
    assert.equal(jobs(1), '1 ofertă');
    assert.equal(jobs(3), '3 oferte');
    assert.equal(jobs(20), '20 de oferte');
    assert.match(noticeTitle(1), /a fost evaluată/);
    assert.equal(pressLabel(100), 'Reevaluează 60 acum');
    assert.match(dialogLead(100), /pentru restul/);
    assert.doesNotMatch(dialogLead(12), /pentru restul/);
  } finally { setLocale('en'); }
});

test('catalog-backed journey expectations keep their original English behavior contracts', async () => {
  const {messages} = await import('../../../i18n/catalogs/helpers/en-state.js');
  assert.equal(messages.connectionOff, 'Connection off');
  assert.equal(messages.unsavedLabel, 'Unsaved changes');
  assert.equal(messages.saveAll, 'Save all changes');
});
