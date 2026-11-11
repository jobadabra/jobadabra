// "More places to find jobs" (renderer/coverage-card.js sourcesCard): the unused job sources the engine lists (src/coverage.py unused_sources), in its
// order (least effort first), each a chip to its Settings panel; nothing when all are in use or after "Not now" for this crawl.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {sourcesCard} from '../../../renderer/coverage-card.js';
import {keySources} from '../../../renderer/key-sources.js';
keySources.offered = true;   // these tests are about the source rows themselves; they are hidden by default (key-sources.js)

const verdict = {at: '2026-10-06T19:51', sources: [
  {id: 'brave', name: 'Web search (Brave)', effort: 'A free key, about 2 minutes', gain: "finds employers' own job sites"},
  {id: 'serpapi', name: 'Google Jobs (SerpApi)', effort: 'A free key (250 searches a month); paid plans beyond', gain: 'jobs Google has collected'}]};

test('the unused sources, in the engine\'s order, each a chip to its panel', () => {
  const card = sourcesCard(verdict);
  assert.equal(card.title, 'More places to find jobs');
  assert.deepEqual(card.chips.map(chip => chip.id), ['brave', 'serpapi']);
  assert.match(card.chips[0].label, /Web search \(Brave\) · A free key/);
  assert.match(card.chips[1].title, /paid plans beyond/);
});

test('nothing when every source is in use, or after Not now for this crawl', () => {
  assert.equal(sourcesCard({...verdict, sources: []}), null);
  assert.equal(sourcesCard(verdict, verdict.at), null);
  assert.equal(sourcesCard(null), null);
});
