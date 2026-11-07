"""Capture authored Focus/Jobs presentation descriptors while retaining canonical fields and raw content."""
import copy
import re


class _Text(str):
    """An internal canonical string with a captured display recipe; ordinary string/JSON consumers keep its original value."""
    __slots__ = ('_display_copy',)

    def __new__(cls, canonical, descriptor):
        value = super().__new__(cls, canonical)
        object.__setattr__(value, '_display_copy', copy.deepcopy(descriptor))
        return value

    def __setattr__(self, _name, _value):
        raise AttributeError('display copy is immutable')


def _descriptor(value):
    if isinstance(value, _Text):
        return copy.deepcopy(value._display_copy)
    if isinstance(value, (tuple, list)):
        return {'list': [_descriptor(part) for part in value]}
    return {'value': copy.deepcopy(value)}


def text(key, template, variables=None):
    """Capture a trusted catalog key and raw interpolation values; canonical text is formatted once with no locale change."""
    values = variables or {}
    canonical = re.sub(r'\{([a-zA-Z][\w]*)\}', lambda match: str(values[match[1]]) if match[1] in values else match[0], template)
    return _Text(canonical, {'key': key, 'fallback': canonical,
                            'values': {name: _descriptor(value) for name, value in values.items()}})


def join(separator, parts):
    """Join authored and raw parts without discarding their identities or altering the canonical string."""
    values = list(parts)
    return _Text(separator.join(str(part) for part in values),
                 {'join': [_descriptor(part) for part in values], 'separator': separator})


def date(iso, options, canonical):
    """Keep an existing canonical date fragment and ask the desktop's shared date formatter to present its ISO value."""
    return _Text(canonical, {'date': iso, 'options': copy.deepcopy(options), 'fallback': canonical})


def _tagged(value):
    return isinstance(value, _Text) or isinstance(value, (list, tuple)) and any(_tagged(part) for part in value)


def wire(value):
    """Serialize explicit UI-only recipes beside unchanged canonical fields; stores, diagnostics and control values are never localized."""
    if isinstance(value, dict):
        result = {name: wire(part) for name, part in value.items()}
        fields = {name: _descriptor(part) for name, part in value.items() if _tagged(part)}
        if fields:
            result['displayCopy'] = fields
        return result
    if isinstance(value, (list, tuple)):
        return [wire(part) for part in value]
    return str(value) if isinstance(value, _Text) else value
