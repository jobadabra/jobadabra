import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
// What Settings → Your data says while the data moves to Notion and after (lib/store-move.js): pure, so its wording is tested
// (test/unit/renderer/store-move-text.test.js); renderer/pages/data.js shows it.
// What each part of the data is called while it moves, and the texts Notion may already have.
const ENTITIES = ['applications', 'events', 'matches', 'interviews', 'insights', 'employers', 'agent_runs', 'cron_runs', 'texts'];
export const MOVE_WORDS = Object.fromEntries(ENTITIES.map(entity => [entity, t(`helperGuide.moved_${entity}`, {count: 0}).replace(/^0\s*/, '')]));
Object.assign(MOVE_WORDS, {events: t('helperGuide.moveEvents'), cron_runs: t('helperGuide.moveRuns'), texts: t('helperGuide.moveTexts')});
const TEXT_WORDS = {profile: 'helperGuide.aProfile', answers: 'helperGuide.standardAnswers', knowledge: 'helperGuide.formKnowledge'};
// "Moved to Notion ✓ 12 applications, 40 runs." + one sentence per text Notion already had (the 3 Oct 2026 wording).
/** Describe moved entity counts and preserved Notion texts without changing archive paths or data. */
export function movedText({moved = {}, kept = [], archive = ''} = {}) {
  const parts = Object.entries(moved).filter(([, count]) => count).map(([entity, count]) => ENTITIES.includes(entity) ? t(`helperGuide.moved_${entity}`, {count}) : `${count} ${entity}`);
  const keptLines = kept.map(name => t('helperGuide.keptNotion', {text: TEXT_WORDS[name] ? t(TEXT_WORDS[name]) : name, archive}));
  return [t('helperGuide.movedNotion') + (parts.length ? ` ${parts.join(', ')}.` : ''), ...keptLines].join(' ');
}
// Three states: trying (no home yet: keep it here, or connect Notion), this Mac (move it to Notion for Always on), Notion (open it there).
// The card asks capabilities (cloud, links), never a store's name.
