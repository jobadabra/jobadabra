// The AI user agent's fictional person for one session: who they are (country, language, role, place), the CV they bring (a shape that has broken the app before) and the strategy they start with. Pure and seeded.
// Job: report health
// Why (3 Nov 2026, AI user agents 3/7; owner: "new states, new CV profiles, new search strategy"; the four tester bugs were data shapes no test ever had): the CV is GENERATED from a list of shapes, not picked from five fixed people.
// Everything is invented (names, e-mails on example.test, employers); global, not tech (memory project-global-not-tech).
import {sequence} from './seeded-random.mjs';

const pick = (list, next) => list[Math.floor(next() * list.length)];

/** Who they can be: country, UI/CV language, role, home place, salary currency, languages with levels. The five of the spec first, then more, none tech-only. */
export const PEOPLE = [
  {name: 'Marta Ferreira', country: 'Portugal', language: 'pt-PT', role: 'Primary-school teacher', place: 'Porto', currency: 'EUR', languages: ['Portuguese (native)', 'English (B2)']},
  {name: 'Dennis Brandt', country: 'Germany', language: 'de', role: 'Warehouse supervisor', place: 'Hannover', currency: 'EUR', languages: ['German (native)', 'English (B1)']},
  {name: 'Aisha Wanjiru', country: 'United Kingdom', language: 'en', role: 'Registered nurse', place: 'Leeds', currency: 'GBP', languages: ['English (native)', 'Swahili (native)', 'French (A2)']},
  {name: 'Tomasz Zielinski', country: 'Poland', language: 'pl', role: 'Bookkeeper', place: 'Wroclaw', currency: 'PLN', languages: ['Polish (native)', 'English (B2)', 'German (A2)']},
  {name: 'Lucia Navarro', country: 'Spain', language: 'es', role: 'UX designer', place: 'Valencia', currency: 'EUR', languages: ['Spanish (native)', 'Catalan (native)', 'English (C1)', 'French (B1)']},
  {name: 'Ioana Popescu', country: 'Romania', language: 'ro', role: 'Hotel receptionist', place: 'Cluj-Napoca', currency: 'RON', languages: ['Romanian (native)', 'English (B2)', 'Italian (B1)']},
  {name: 'Jonas Lindqvist', country: 'Sweden', language: 'sv', role: 'Electrician', place: 'Gothenburg', currency: 'SEK', languages: ['Swedish (native)', 'English (C1)']},
  {name: 'Chiara Moretti', country: 'Italy', language: 'it', role: 'Pastry chef', place: 'Bologna', currency: 'EUR', languages: ['Italian (native)', 'English (B1)']},
  {name: 'Yannick Dubois', country: 'Switzerland', language: 'fr', role: 'Truck driver', place: 'Lausanne', currency: 'CHF', languages: ['French (native)', 'German (B1)', 'English (A2)']},
  {name: 'Eleni Papadaki', country: 'Greece', language: 'el', role: 'Pharmacist', place: 'Thessaloniki', currency: 'EUR', languages: ['Greek (native)', 'English (C1)']},
];

/** How the CV is built: each shape is a data form that broke, or could break, a reader of CVs. `build` gets the person and returns the CV's lines. */
const jobs = person => [`${person.role}, ${person.place} Services`, `Assistant ${person.role.toLowerCase()}, Northgate Group`];
const dates = ['Mar 2021 - Present', 'Jun 2016 - Feb 2021'];
const body = person => jobs(person).flatMap((job, i) => [job, dates[i], `- Handled daily work as ${person.role.toLowerCase()} for a team of ${4 + i * 3}`, '']);
export const CV_SHAPES = {
  headingLines: person => [person.name, 'Summary', `${person.role} with eight years of experience`, '', 'Experience', ...body(person), 'Education', 'Vocational diploma, 2014', '', 'Languages', ...person.languages],
  table: person => [`| ${person.name} | ${person.place} |`, '|---|---|', ...jobs(person).map((job, i) => `| ${job} | ${dates[i]} |`), `| Languages | ${person.languages.join(', ')} |`],
  noSummary: person => [person.name, ...body(person), 'Education', 'Vocational diploma, 2014'],
  manyLanguages: person => [person.name, `Languages: ${[...person.languages, 'Dutch (A1)', 'Arabic (A1)'].join(', ')}`, ...body(person)],
  gapYears: person => [person.name, `${person.role}, ${person.place} Services`, 'Mar 2021 - Present', '', 'Career break 2017 - 2020 (family care)', '', `Assistant ${person.role.toLowerCase()}, Northgate Group`, 'Jun 2013 - Dec 2016'],
  foreignSalary: person => [person.name, ...body(person), `Expected salary: 41,000 ${person.currency === 'EUR' ? 'USD' : 'EUR'} a year; current salary 3,400 ${person.currency} a month`],
  veryShort: person => [`${person.name}, ${person.role}`, person.place],
  veryLong: person => [person.name, ...Array.from({length: 20}, (_, i) => body({...person, role: `${person.role} ${i + 1}`})).flat(), 'Education', 'Vocational diploma, 2014'],
};
/** File names that have broken an upload or a title: spaces, accents, a long name, no extension word, a trailing copy marker. */
export const FILE_NAMES = ['CV final (2) FINAL.pdf', 'Curriculum_vitae_actualizado.pdf', 'cv.PDF', 'My résumé – 2026.pdf', 'resume.docx.pdf', `${'long-name-'.repeat(8)}cv.pdf`];
/** Strategies the person starts with: how wide the roles and the places are. */
const STRATEGIES = ['one role in one city', 'one role anywhere in the country', 'two related roles, city and remote', 'a role they have not done before, in the same city'];

/**
 * One person for a seed: {seed, name, country, language, role, place, currency, languages, strategy, cv: {shape, fileName, lines, text, headingLines}}.
 * `shape` is picked unless `shape` is passed (a named plan fixes the shape that broke). `headingLines` are the CV lines that are only a section name ("Summary"): none of them may end up saved as an answer.
 */
export function makePersona(seed, {shape} = {}) {
  const next = sequence(seed), person = pick(PEOPLE, next), name = shape && CV_SHAPES[shape] ? shape : pick(Object.keys(CV_SHAPES), next);
  const lines = CV_SHAPES[name](person), headings = ['Summary', 'Experience', 'Education', 'Languages'].filter(word => lines.includes(word));
  return {seed, ...person, strategy: pick(STRATEGIES, next), cv: {shape: name, fileName: pick(FILE_NAMES, next), lines, text: lines.join('\n'), headingLines: headings},
    email: `${person.name.toLowerCase().normalize('NFD').replace(/[^a-z ]/g, '').replace(/ +/g, '.')}@example.test`};
}
