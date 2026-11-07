// Known rebuild section names translate only in presentation; canonical Markdown and unknown raw headings remain unchanged.
import assert from 'node:assert/strict';
import {afterEach, test} from 'node:test';
import {setLocale} from '../../../i18n/index.js';
import {rebuildGroups} from '../../../lib/strategy-rebuild.js';
import {forWindow} from '../../../lib/settings-native-display.js';

afterEach(() => setLocale('en'));

test('known changed-field names translate in all locales without changing canonical documents or unknown names', () => {
  const raw = 'Custom {name} <b>Provider</b> — 2026';
  const before = {profile: '# Summary\nold', answers: `# Availability\nold\n# ${raw}\nold`};
  const draft = {profile_markdown: '# Summary\nnew', answers_markdown: `# Availability\nnew\n# ${raw}\nnew`};
  const groups = rebuildGroups(before, draft);
  const original = JSON.stringify({before, draft, groups});
  for (const locale of ['en', 'de', 'fr', 'it', 'es', 'ro', 'ru']) {
    setLocale(locale);
    const shown = forWindow(groups);
    if (locale === 'en') {
      assert.equal(shown[0].changes[0], '~ Summary');
      assert.equal(shown[1].changes[0], '~ Availability');
    } else {
      assert.notEqual(shown[0].changes[0], '~ Summary', locale);
      assert.notEqual(shown[1].changes[0], '~ Availability', locale);
    }
    assert.equal(shown[1].changes[1], `~ ${raw}`);
    assert.equal(JSON.stringify({before, draft, groups}), original);
  }
});

test('known added and removed sibling names translate while markers, emoji and raw unknown names survive', () => {
  const groups = rebuildGroups({profile: '# Education\nold\n# 🛂 Work eligibility\nold', answers: '# Custom heading\nold'},
    {profile_markdown: '# Core skills\nnew\n# 🛂 Work eligibility\nnew', answers_markdown: '# New custom heading\nnew'});
  setLocale('ru');
  const shown = forWindow(groups);
  assert.deepEqual(shown[0].changes, ['+ Ключевые навыки (новый раздел)', '~ 🛂 Право на работу', '− Образование (удалён)']);
  assert.deepEqual(groups[0].changes, ['+ Core skills (new section)', '~ 🛂 Work eligibility', '− Education (removed)']);
  assert.deepEqual(shown[1].changes, ['+ New custom heading (новый раздел)', '− Custom heading (удалён)']);
});
