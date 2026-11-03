// What came in from LinkedIn (lib/linkedin-import-review.js): rows the person ticks, built from LinkedIn's CV, the main CV and the AI match; nothing is saved unticked,
// a differing Your details line is unticked and never replaces, unmapped columns (birth date) never become a row. Fixture: test/fixtures/linkedin-snapshot.json.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {toCv} from '../lib/linkedin-export.js';
import {applyPicks, buildReview, detailRows, mergeSource} from '../lib/linkedin-import-review.js';

const FIXTURE = JSON.parse(fs.readFileSync(new URL('./fixtures/linkedin-snapshot.json', import.meta.url), 'utf8'));
const rowsOf = domain => FIXTURE[domain].flatMap(page => page.elements.flatMap(e => e.snapshotData));
const tables = {'Profile.csv': rowsOf('PROFILE'), 'Positions.csv': rowsOf('POSITIONS'), 'Education.csv': rowsOf('EDUCATION'), 'Skills.csv': rowsOf('SKILLS'), 'Languages.csv': rowsOf('LANGUAGES')};
const cv = toCv(tables);
const profileRow = rowsOf('PROFILE')[0];
// The person's main CV has Acme's Product Manager (the AI matched LinkedIn role 0 to it; one bullet is new), the SQL skill, the German language and the same school.
const main = {jobs: [{company: 'Acme', roles: [{title: 'Product Manager', period: '2021 – Present', bullets: ['Led the pricing relaunch']}]}], skills: 'SQL, Roadmaps', languages: 'German', education: [{school: 'Universität Wien', degree: 'MSc', period: '2013 – 2015'}]};
const match = [{sourceRole: 0, mainJob: 0, mainRole: 0, newBullets: [1]}, {sourceRole: 1, mainJob: -1, mainRole: -1, newBullets: []}, {sourceRole: 2, mainJob: -1, mainRole: -1, newBullets: []}];

test('with a main CV: new roles and roles with new bullets are rows, what they already have is only counted', () => {
  const review = buildReview({main, cv, match, profileRow, contact: {}});
  assert.deepEqual(review.positions.map(r => [r.label, r.chip, r.newBullets, r.ticked]), [
    ['Product Manager · Acme', 'new-bullets', 1, true], ['Associate Product Manager · Acme', 'new', 0, true], ['Data Analyst · Northwind', 'new', 0, true]]);
  assert.deepEqual(review.skills.map(r => r.label), ['Looker', 'Stakeholder management']);
  assert.equal(review.have.skills, 1, '"1 skill you already have"');
  assert.deepEqual(review.languages.map(r => r.label), ['English (Full professional)']);
  assert.deepEqual(review.education, [], 'the same school is not offered again');
  assert.equal(review.have.education, 1);
  const same = buildReview({main, cv, match: [{...match[0], newBullets: []}, ...match.slice(1)], profileRow});
  assert.ok(!same.positions.some(r => r.label.startsWith('Product Manager')), 'a role with nothing new is not a row');
});

test('with no main CV (the CV step) everything is new and ticked', () => {
  const review = buildReview({main: null, cv, match: [], profileRow, contact: {}});
  assert.equal(review.positions.length, 3);
  assert.ok(review.positions.every(r => r.chip === 'new' && r.ticked));
  assert.equal(review.education.length, 1);
  assert.equal(review.skills.length, 3);
});

test('Your details: an empty line is proposed (ticked), a different value is shown with both and unticked, the same is left out, unmapped columns never appear', () => {
  const rows = detailRows(profileRow, {first_name: 'Anna', last_name: 'Rossi-Meier', location: 'Wien, Austria', postal_code: ''});
  assert.deepEqual(rows.map(r => [r.field, r.chip, r.ticked, r.current, r.linkedin]), [
    ['last_name', 'differs', false, 'Rossi-Meier', 'Rossi'], ['street', 'new', true, '', 'Graben 1'], ['postal_code', 'new', true, '', '1010'], ['website', 'new', true, '', 'https://anna.example']]);
  assert.ok(!JSON.stringify(rows).includes('Mar 4'), 'the birth date is not a row');
  assert.deepEqual(detailRows(null, {}), []);
});

test('ticking saves only what is ticked: nothing ticked saves nothing; a differing details line is never replaced unless ticked', () => {
  const review = buildReview({main, cv, match, profileRow, contact: {last_name: 'Rossi-Meier'}});
  const none = applyPicks({cv, match}, review, []);
  assert.deepEqual([none.cv.jobs, none.match, none.details], [[], [], {}]);
  assert.equal(none.cv.skills, undefined);
  const ids = id => review.positions.find(r => r.label.startsWith(id)).id;
  const some = applyPicks({cv, match}, review, [ids('Product Manager'), ids('Data Analyst'), 's:1', 'd:postal_code']);
  assert.deepEqual(some.cv.jobs.map(j => [j.company, j.roles.map(r => r.title)]), [['Acme', ['Product Manager']], ['Northwind', ['Data Analyst']]]);
  assert.deepEqual(some.match, [{sourceRole: 0, mainJob: 0, mainRole: 0, newBullets: [1]}, {sourceRole: 1, mainJob: -1, mainRole: -1, newBullets: []}], 're-indexed to the picked roles');
  assert.equal(some.cv.skills, 'Stakeholder management');
  assert.deepEqual(some.details, {postal_code: '1010'}, 'the unticked differing last name is not in it');
  const replace = applyPicks({cv, match}, review, ['d:last_name']);
  assert.deepEqual(replace.details, {last_name: 'Rossi'}, 'only when the person ticked it');
});

// Gitar on #3046: the role number was taken inside find(), so from the second role on an Update lost its matches and could hand one role's new bullets to another.
test('an Update keeps each earlier role with its own match (new bullets stay on the role they belong to)', () => {
  const later = [{sourceRole: 0, mainJob: -1, mainRole: -1, newBullets: []}, {sourceRole: 1, mainJob: 0, mainRole: 0, newBullets: [2]}, {sourceRole: 2, mainJob: 0, mainRole: 0, newBullets: [0, 1]}];   // matches on the LATER roles
  const merged = mergeSource({cv, match: later}, {cv: {jobs: [], education: [], skills: '', languages: ''}, match: []});
  assert.deepEqual(merged.match, later, 'every role keeps its own mainJob, mainRole and newBullets');
});
