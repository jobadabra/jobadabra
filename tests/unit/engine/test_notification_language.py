"""Pure end-user notification language/plural catalogs never change raw values or infer a server system language."""
import json
import unittest
from pathlib import Path
from src import notification_language as language


class NotificationLanguageTests(unittest.TestCase):
    def test_only_explicit_supported_environment_value_is_used(self):
        for locale in ('en', 'de', 'fr', 'it', 'es', 'ro', 'ru'):
            self.assertEqual(language.language({'JOBADABRA_NOTIFICATION_LANGUAGE': locale}), locale)
        for value in (None, '', 'system', 'de-CH', 'unsupported'):
            self.assertEqual(language.language({'JOBADABRA_NOTIFICATION_LANGUAGE': value}), 'en')
        self.assertEqual(language.language({}), 'en')

    def test_plural_categories_cover_russian_romanian_and_every_supported_locale(self):
        counts = [0, 1, 2, 5, 21]
        expected = {
            'en': ['other', 'one', 'other', 'other', 'other'],
            'de': ['other', 'one', 'other', 'other', 'other'],
            'fr': ['one', 'one', 'other', 'other', 'other'],
            'it': ['other', 'one', 'other', 'other', 'other'],
            'es': ['other', 'one', 'other', 'other', 'other'],
            'ro': ['few', 'one', 'few', 'few', 'other'],
            'ru': ['many', 'one', 'few', 'many', 'one'],
        }
        for locale, forms in expected.items():
            self.assertEqual([language.plural_category(locale, n) for n in counts], forms)
        self.assertEqual(language.plural_category('ro', 19), 'few')
        self.assertEqual(language.plural_category('ro', 20), 'other')
        self.assertEqual(language.plural_category('ru', 1.5), 'other')
        self.assertEqual(language.plural_category('ro', 1.5), 'few')
        for locale in ('fr', 'it', 'es'):
            self.assertEqual(language.plural_category(locale, 1_000_000), 'many')

    def test_named_plain_interpolation_is_single_pass_and_locale_is_request_scoped(self):
        raw = '<Fictional employer> {count} this Mac Keychain ⌘K'
        for locale in ('en', 'de', 'fr', 'it', 'es', 'ro', 'ru'):
            rendered = language.render('digest.more', {'count': raw}, locale=locale)
            self.assertEqual(rendered.count(raw), 1)
        self.assertEqual(language.render('digest.title'), 'Job digest')
        self.assertEqual(language.render('digest.title', locale='ru'), 'Подборка вакансий')
        self.assertEqual(language.render('digest.title'), 'Job digest')
        self.assertEqual(language.render('not.registered', locale='ru'), 'not.registered')

    def test_all_bundled_catalogs_have_matching_keys_and_named_parameters(self):
        folder = Path(__file__).resolve().parents[3] / 'src' / 'notification_catalogs'
        catalogs = {locale: json.loads((folder / f'{locale}.json').read_text(encoding='utf-8')) for locale in ('en', 'de', 'fr', 'it', 'es', 'ro', 'ru')}
        import re
        def params(value):
            forms = [value] if isinstance(value, str) else list(value.values())
            return set(re.findall(r'\{([a-zA-Z][\w]*)\}', ' '.join(forms)))
        for locale, catalog in catalogs.items():
            self.assertEqual(catalog.keys(), catalogs['en'].keys(), locale)
            for key, value in catalog.items():
                self.assertEqual(params(value), params(catalogs['en'][key]), f'{locale}.{key}')
                self.assertTrue(all(isinstance(form, str) and form for form in ([value] if isinstance(value, str) else value.values())))


if __name__ == '__main__':
    unittest.main()
