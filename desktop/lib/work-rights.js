// Where the person may work without a visa, as the engine reads it (owner, 12 Nov 2026, #3850: "Work rights doesn't really make sense. They should be only in
// the Profile"): derived from Profile → Your details → Work eligibility, the one owner, and written to config/work-rights.json, which nothing else writes
// (preferences.json is replaced whole by several writers). The engine reads it through src/work_rights.py. Guarded by test/unit/main/work-rights.test.js.
import {fragmentWords} from '../renderer/fragment-words.js';
import {log} from './log.js';
import {OLDER, STATUSES, ZONES, eligibilityOf, isAsked, isOldLine, zoneOfLabel} from '../renderer/work-eligibility.js';

export const FILE = 'config/work-rights.json';
// The words a freely open zone stands for, as the place AI reads them: "EU" is every EU member state, plus the EEA and Switzerland.
const ZONE_WORDS = {eu: ['EU', 'Switzerland', 'Norway', 'Iceland', 'Liechtenstein'], uk: ['United Kingdom'], us: ['United States']};
const [FREELY, PERMIT] = STATUSES;
const unique = list => [...new Set(list)];

/**
 * Work eligibility lines ({label, value, kind?}) -> {work_rights: [words], permit_zones: [zone labels], unread: [older lines' text]}.
 * Invariants: "yes, freely" (saved, or opened by the nationality) clears the whole zone; "yes, with a permit" clears only the countries of the person's own
 * search places in that zone (owner, 12 Nov 2026, asked via AskUserQuestion: a Swiss permit gives no right to work in Germany), so it is a zone the engine
 * pairs with the search's places, never zone words; "no, needs sponsorship" clears nothing. An older line not folded yet keeps its words (unread), never lost.
 */
export function rightsOf(lines) {
  const {nationality, rows} = eligibilityOf(lines || []);
  const work = [...(nationality || [])], permit = [];
  for (const row of rows) {
    const zone = zoneOfLabel(row.label), status = OLDER[row.value] ?? row.value;
    if (zone && status === FREELY) work.push(...ZONE_WORDS[zone.id]);
    else if (zone && status === PERMIT) permit.push(zone.label);
  }
  const unread = (lines || []).filter(line => isOldLine(line) && String(line.value ?? '').trim() && !isAsked(line.value)).map(line => `${line.label}: ${line.value}`);
  return {work_rights: unique(work), permit_zones: unique(permit).filter(label => ZONES.some(zone => zone.label === label)), unread: unique(unread)};
}

/** The older Strategy list (preferences.work_rights) as words ("\\beu\\b" -> "eu"); [] when none or unreadable. */
export function olderRights(storage) {
  try { return unique((JSON.parse(storage.readText('config/preferences.json') || '{}').work_rights || []).map(right => fragmentWords(String(right)).trim()).filter(Boolean)); }
  catch { return []; }
}

/**
 * Writes config/work-rights.json from these Work eligibility lines when what it says changed. -> true when written.
 * Invariants: until lib/work-rights-move.js has carried the older Strategy list into the Profile (settings.workRightsMovedAt), that list rides along, so a
 * Profile save before the move never drops a right the engine read. Never throws: a failed write is logged and returns false (Why, #3862 review: the
 * Profile was already saved or read; the engine keeps its last copy until the next open writes it).
 */
export function writeRights(storage, lines) {
  try {
    const rights = rightsOf(lines);
    if (!storage.settings().workRightsMovedAt) rights.work_rights = unique([...rights.work_rights, ...olderRights(storage)]);
    const next = JSON.stringify(rights, null, 2) + '\n';
    if (storage.readText(FILE) === next) return false;
    storage.writeText(FILE, next);
    return true;
  } catch (failed) {
    log('profile', 'the work rights file was not written', {error: failed.message});
    return false;
  }
}
