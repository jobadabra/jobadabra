"""A web page's bytes as text: the charset the reply names, else the one the page declares in its own <meta>, else UTF-8.
Why (13 Nov 2026, #3989): a job board replied "Content-Type: text/html" with no charset and declared ISO-8859-1 only in its <meta>, 4.7 KB into the
page; every reader decoded it as UTF-8, so each accented job title reached the person garbled ("T�cnico de Farm�cia").
Invariants: never raises (an unknown charset name falls to the next); a page with no charset anywhere is UTF-8, as before; ISO-8859-1 is read as
windows-1252, its superset, as browsers do. Tests: tests/unit/sources/test_page_bytes.py."""
import codecs
import re

HEAD_BYTES = 32_768   # where a page's own charset is looked for: its <head>, which carries long style and script lists before the <meta>
_META = re.compile(rb'<meta\b[^>]*?charset\s*=\s*["\']?\s*([A-Za-z0-9._:-]+)', re.I)


def text(raw, charset=None):
    """`raw` (bytes; a str is returned as it is) decoded with `charset` (the reply's header), else the page's own <meta charset>, else UTF-8."""
    if isinstance(raw, str):
        return raw
    raw = bytes(raw or b'')
    for name in (charset, declared(raw), 'utf-8'):
        codec = _codec(name)
        if codec:
            return raw.decode(codec, 'replace')
    return raw.decode('utf-8', 'replace')


def declared(raw):
    """The charset the page names in a <meta> of its head, or None."""
    found = _META.search(raw[:HEAD_BYTES])
    return found.group(1).decode('ascii', 'ignore') if found else None


def _codec(name):
    try:
        codec = codecs.lookup(str(name)).name if name else None
    except LookupError:
        return None
    return 'cp1252' if codec in ('latin-1', 'iso8859-1') else codec
