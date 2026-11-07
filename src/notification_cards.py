"""Compose known authored notification parts as immutable render trees; explicit producer delivery projects them without changing canonical records."""
from html import escape
from . import notification_language as language, tgcard


def _spec(value):
    if getattr(value, '_renderer', None) is _render:
        return value._snapshot[0]
    return ('raw', '' if value is None else str(value))


def _text(spec, locale, canonical=False):
    kind, *parts = spec
    if kind == 'override':
        return parts[0] if canonical else _text(parts[1], locale)
    if kind == 'raw':
        return parts[0]
    if kind == 'words':
        key, pairs, count = parts
        values = {name: _text(value[1], locale, canonical) if value[0] == 'part' else value[1] for name, value in pairs}
        return language.render(key, values, locale=locale, count=count)
    if kind == 'escape':
        return escape(_text(parts[0], locale, canonical))
    if kind == 'join':
        return parts[0].join(_text(part, locale, canonical) for part in parts[1])
    if kind == 'dot':
        return tgcard.dot(*[_text(part, locale, canonical) for part in parts[0]])
    if kind == 'block':
        return tgcard.block(_text(parts[0], locale, canonical), *[_text(part, locale, canonical) for part in parts[1]])
    if kind == 'fact':
        return tgcard.fact(_text(parts[0], locale, canonical), _text(parts[1], locale, canonical))
    title, subtitle, blocks, emoji, footer = parts
    return tgcard.card(_text(title, locale, canonical), _text(subtitle, locale, canonical), [_text(part, locale, canonical) for part in blocks], emoji, _text(footer, locale, canonical))


def _render(snapshot, locale):
    spec, buttons = snapshot
    markup = None
    if buttons:
        markup = {'inline_keyboard': [[{**dict(fields), 'text': language.render(key, locale=locale)} for key, fields in row] for row in buttons]}
    return _text(spec, locale), markup


def _message(spec, buttons=()):
    return language.projected_text(_text(spec, 'en', canonical=True), (spec, buttons), _render)


def raw(value):
    """Keep raw text or existing escaped HTML byte-for-byte; no interpretation or automatic escaping occurs."""
    return _message(('raw', str(value)))


def words(key, variables=None, *, count=None):
    """Choose a bundled key with immutable raw values or captured authored parts; the caller still owns escaping."""
    pairs = tuple((name, ('part', _spec(value)) if getattr(value, '_renderer', None) is _render else ('value', value))
                  for name, value in (variables or {}).items())
    return _message(('words', key, pairs, count))


def safe(value):
    """Escape a composed plain value exactly once at the same boundary as html.escape."""
    return _message(('escape', _spec(value)))


def join(separator, parts):
    """Join captured notification parts while retaining their authored identities and raw values."""
    return _message(('join', separator, tuple(_spec(part) for part in parts)))


def dot(*parts):
    """Mirror tgcard.dot for known notification parts without losing their render identities."""
    return _message(('dot', tuple(_spec(part) for part in parts)))


def block(heading, *lines):
    """Mirror tgcard.block with already-escaped HTML parts and frozen authored keys."""
    return _message(('block', _spec(heading), tuple(_spec(line) for line in lines)))


def fact(label, value):
    """Mirror tgcard.fact, escaping the plain label/value once during projection."""
    return _message(('fact', _spec(label), _spec(value)))


def card(title, subtitle='', blocks=(), emoji='', footer=''):
    """Mirror tgcard.card with plain title/subtitle and existing escaped blocks, retaining frozen render facts only."""
    return _message(('card', _spec(title), _spec(subtitle), tuple(_spec(part) for part in blocks), emoji, _spec(footer)))


def with_buttons(message, markup, keys):
    """Tag explicitly known button captions; callback/url fields and the canonical message remain unchanged."""
    rows = tuple(tuple((key, tuple((name, value) for name, value in button.items() if name != 'text'))
                       for key, button in zip(row_keys, row)) for row_keys, row in zip(keys, markup['inline_keyboard']))
    return _message(_spec(message), rows)



def canonical(text, presentation):
    """Attach a known authored presentation tree to an existing canonical string without changing any serialized bytes."""
    return _message(('override', str(text), _spec(presentation)))


def delivery(message, markup=None, *, locale=None):
    """Explicit end-user producer boundary: project a tagged message; ordinary operational text yields no sender overrides."""
    locale = language.language() if locale is None else locale
    if locale not in language.LOCALES:
        return {}
    projected = language.projection(message, locale=locale)
    if projected is None:
        return {}
    text, buttons = projected
    if locale == 'en' and text == str(message) and (buttons is None or buttons == markup):
        return {}
    return {'display_text': text, 'display_reply_markup': markup if buttons is None else buttons}
