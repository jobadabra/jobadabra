/* global document */
// Render translated desktop pages on fictional data and keep session chrome out of English in German and Russian.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {needsElectron} from '../../test/needs-electron.js';
import {probeWindow} from './window-probe.js';

for (const locale of ['de', 'ru']) test(`${locale} pages render localized session counts and accessible labels`, needsElectron, () => {
  const seen = probeWindow({settings: {displayLanguage: locale}, script: async kit => {
    await kit.until(() => document.getElementById('nav-sessions-text').textContent.includes('2'), 'the demo sessions to load');
    const open = async name => {
      document.querySelector(`.nav[data-view="${name}"]:not([data-settings])`).click();
      await kit.until(() => document.querySelector(`.view[data-view="${name}"]:not([hidden])`), `the ${name} page`);
      if (name === 'strategy') {
        await kit.until(() => document.getElementById('strategy-improve').textContent.includes('6'), 'the strategy suggestion count');
        document.querySelector('[data-tab="strategy-suggestions"]').click();
        await kit.until(() => document.getElementById('strategy-tune')?.textContent.includes('2'), 'the tuning summary');
      }
      if (name === 'employers') await kit.until(() => document.getElementById('emp-rows').textContent.includes('Bluefin'), 'the employer rows');
    };
    const only = (name, wanted, read) => (name === wanted ? read() : '');
    const edges = name => {
      const headings = name === 'jobs' ? [...document.querySelectorAll('#jobs-head > span')] : [];
      if (!headings.length) return {fitEdge: 0, roleEdge: 0};
      const range = document.createRange();
      range.selectNodeContents(headings[0]);
      return {fitEdge: range.getBoundingClientRect().right, roleEdge: headings[1].getBoundingClientRect().left};
    };
    const snapshot = name => ({
      heading: document.querySelector(`.view[data-view="${name}"] h1`).textContent,
      session: document.getElementById('nav-sessions-text').textContent,
      accessible: document.getElementById('nav-applying-badge').title,
      suggestions: only(name, 'strategy', () => document.getElementById('strategy-improve').textContent),
      tune: only(name, 'strategy', () => document.getElementById('strategy-tune').textContent),
      employers: only(name, 'employers', () => document.querySelector('.view[data-view="employers"]').innerText),
      focus: only(name, 'focus', () => document.querySelector('.view[data-view="focus"]').innerText),
      focusTitles: only(name, 'focus', () => [...document.querySelectorAll('.view[data-view="focus"] [title]')].map(node => node.title).join('\n')),
      ...edges(name),
    });
    const pages = {};
    for (const name of ['jobs', 'focus', 'actions', 'strategy', 'employers', 'settings']) {
      await open(name);
      pages[name] = snapshot(name);
    }
    document.querySelector('[data-settings-go="notifications"]').click();
    await kit.until(() => document.querySelectorAll('#mail-rows .switch-row').length >= 4, 'the notification rows');
    const {switchRow} = await import('./pages/mail-switches.js');
    const custom = {id: 'custom', name: 'My <custom> notification', when: 'Supplied description', on: false};
    const before = JSON.stringify(custom), presses = [];
    const customRow = switchRow(custom, '', '', (id, on) => presses.push([id, on]));
    document.body.append(customRow);
    customRow.querySelector('input').click();
    customRow.remove();
    const {openJobPanel} = await import('./pages/job-panel.js');
    await openJobPanel(globalThis.__jp.shared.allJobs[0], 'messages');
    await kit.until(() => document.getElementById('job-panel').textContent.includes('Technical interview invitation'), 'the linked message cards');
    return {lang: document.documentElement.lang, pages, mail: document.getElementById('mail-rows').textContent, news: document.getElementById('news-rows').textContent,
      filters: [...document.getElementById('emp-feed').options].map(option => option.value),
      custom: {text: customRow.textContent, unchanged: before === JSON.stringify(custom), presses}, drawer: document.getElementById('job-panel').innerText};
  }}).result;
  assert.equal(seen.lang, locale);
  for (const [page, view] of Object.entries(seen.pages)) {
    assert.doesNotMatch(`${view.session} ${view.accessible}`, /sessions? (?:needs? you|open|filled)/, page);
    assert.match(view.session, locale === 'de' ? /Sitzungen/ : /сеанса/);
    assert.equal(view.accessible, view.session, `${page}: the badge and visible counter agree`);
    assert.doesNotMatch(view.suggestions, /\d+ suggestions?\b/, `${page}: the shared count is translated`);
    assert.doesNotMatch(view.tune, /changes your results support|Leave out|drop Paris/, `${page}: producer display recipes reach the tuning card`);
    assert.doesNotMatch(view.employers, /\bEmployer\b|Feed found|No open jobs|Low relevance|No public feed|Your list|Find employers|Starter list/, page);
    assert.doesNotMatch(view.focus, /Reply today|Open LinkedIn|Open email|Open chat|Human reply|Contacted you|Review evidence|Issue detected|Reply to recruiters first|\bPrepared\b|\bOffers\b/, page);
    assert.doesNotMatch(view.focusTitles, /Recruiter pitch|Read the posting and your kit|You wrote/, `${page}: authored tooltip framing is translated`);
    if (page === 'jobs') assert.ok(view.fitEdge <= view.roleEdge, 'the translated Fit heading stays out of the Role column');
  }
  assert.doesNotMatch(seen.mail, /New matches|An application needs you|Applied for you|Weekly summary|Always on stopped working|Nothing found for days/);
  assert.doesNotMatch(seen.news, /What's new|News and tips|A new version and what changed|Offers, tips/);
  assert.ok(seen.filters.includes('Feed found'), 'employer filter values keep their canonical identity');
  assert.ok(seen.custom.text.includes('My <custom> notification'));
  assert.ok(seen.custom.unchanged, 'display rendering preserves unknown supplied values');
  assert.deepEqual(seen.custom.presses, [['custom', true]], 'a switch still sends its original row ID and boolean');
  assert.doesNotMatch(seen.drawer, /Interview scheduled|Confirmation received|Recruiter message|Logged messages/);
});
