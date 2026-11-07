"""Pure seven-language end-user notification formatting and immutable in-process render facts; canonical strings remain serialized unchanged."""
from functools import lru_cache
import json
import math
import os
from pathlib import Path
import re

LOCALES = ('en', 'de', 'fr', 'it', 'es', 'ro', 'ru')
_VARIABLE = re.compile(r'\{([a-zA-Z][\w]*)\}')


def language(env=None):
    """Read only an explicitly requested notification preference; servers never resolve system or regional choices."""
    value = (os.environ if env is None else env).get('JOBADABRA_NOTIFICATION_LANGUAGE')
    return value if value in LOCALES else 'en'


def plural_category(locale, count):
    """Select cardinal forms for the seven supported languages, including Romanian/Russian integers and decimal forms."""
    if not isinstance(count, (int, float)) or not math.isfinite(count):
        return 'other'
    n = abs(count)
    integer = int(n) == n
    if locale == 'ru':
        if not integer:
            return 'other'
        if n % 10 == 1 and n % 100 != 11:
            return 'one'
        if n % 10 in (2, 3, 4) and n % 100 not in (12, 13, 14):
            return 'few'
        return 'many'
    if locale == 'ro':
        return 'one' if n == 1 else 'few' if not integer or n == 0 or 1 <= n % 100 <= 19 else 'other'
    if locale == 'fr' and 0 <= n < 2:
        return 'one'
    if locale in ('fr', 'it', 'es') and integer and n != 0 and n % 1_000_000 == 0:
        return 'many'
    return 'one' if n == 1 else 'other'


@lru_cache(maxsize=7)
def _catalog(locale):
    return json.loads((Path(__file__).with_name('notification_catalogs') / f'{locale}.json').read_text(encoding='utf-8'))


def render(key, variables=None, *, locale='en', count=None):
    """Choose trusted copy before single-pass plain interpolation; callers retain their existing HTML-escaping boundary."""
    locale = locale if locale in LOCALES else 'en'
    value = _catalog(locale).get(key, _catalog('en').get(key, key))
    values = dict(variables or {})
    if count is not None:
        values['count'] = count
    if isinstance(value, dict):
        value = value.get(plural_category(locale, values.get('count')), value['other'])
    return _VARIABLE.sub(lambda match: str(values[match[1]]) if match[1] in values else match[0], value)


def _immutable(value):
    return type(value) in (str, int, float, bool, type(None)) or isinstance(value, tuple) and all(_immutable(part) for part in value)


class _NotificationText(str):
    """Canonical text with private immutable facts and a trusted pure renderer; no attributes enter str/JSON/wire output."""
    __slots__ = ('_snapshot', '_renderer')

    def __new__(cls, canonical, snapshot, renderer):
        if not _immutable(snapshot):
            raise TypeError('notification snapshots contain immutable render facts only')
        value = super().__new__(cls, canonical)
        object.__setattr__(value, '_snapshot', snapshot)
        object.__setattr__(value, '_renderer', renderer)
        return value

    def __setattr__(self, name, value):
        raise AttributeError('notification render facts are immutable')


def projected_text(canonical, snapshot, renderer):
    """Attach only frozen render facts and a pure renderer to canonical text; no live job/store/client handles are retained."""
    return _NotificationText(canonical, snapshot, renderer)


def projection(value, *, locale='en'):
    """Render a known in-process presentation once; ordinary strings have no translation metadata and return None."""
    if not isinstance(value, _NotificationText):
        return None
    return value._renderer(value._snapshot, locale if locale in LOCALES else 'en')
