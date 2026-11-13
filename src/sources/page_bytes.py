"""A web page's bytes as text: the charset the reply names, else the one the page declares in its own <meta>, else UTF-8.
Why (13 Nov 2026, #3989): a job board replied "Content-Type: text/html" with no charset and declared ISO-8859-1 only in its <meta>, 4.7 KB into the
page; every reader decoded it as UTF-8, so each accented job title reached the person garbled ("T�cnico de Farm�cia").
Invariants: never raises (an unknown name or one that is no text encoding, such as base64, falls to the next); a page with no charset anywhere is
UTF-8, as before; ISO-8859-1 is read as windows-1252, its superset, as browsers do; a <meta> naming UTF-16/32 means UTF-8, as the HTML spec says
(a page whose <meta> is readable as ASCII is not UTF-16); a <meta> inside a comment or a script is not the page's; a page whose bytes are valid
UTF-8 with letters beyond ASCII is UTF-8 whatever its <meta> says (a stale meta must not garble a UTF-8 page that read right before).
Readers through ats._get (join, phenom, umantis, eightfold, jobs.ch) get the bytes only, not the reply's header: they use the <meta>, else UTF-8.
Tests: tests/unit/sources/test_page_bytes.py."""
import codecs
import re

HEAD_BYTES = 32_768   # where a page's own charset is looked for: its <head>, which carries long style and script lists before the <meta>
_META = re.compile(rb'<meta\b[^>]*?charset\s*=\s*["\']?\s*([A-Za-z0-9._:-]+)', re.I)
_NOT_MARKUP = re.compile(rb'<!--.*?(?:-->|$)|<script\b.*?(?:</script\s*>|$)', re.S | re.I)


def text(raw, charset=None):
    """`raw` (bytes; a str is returned as it is) decoded with `charset` (the reply's header), else the page's own <meta charset>, else UTF-8."""
    if isinstance(raw, str):
        return raw
    raw = bytes(raw or b'')
    for name, meta in ((charset, False), (declared(raw), True), ('utf-8', False)):
        codec = _codec(name, meta)
        if codec and meta and codec != 'utf-8' and _utf8(raw):
            return raw.decode('utf-8')
        try:
            if codec:
                return raw.decode(codec, 'replace')
        except (UnicodeError, LookupError):   # 'undefined', idna: text codecs that refuse any bytes; the next name is tried
            continue
    return raw.decode('utf-8', 'replace')


def reply(response, limit):
    """The text of an open HTTP reply (at most `limit` bytes), with the charset its headers name; a reply with no headers (a stand-in) has none."""
    headers = getattr(response, 'headers', None)
    return text(response.read(limit), headers.get_content_charset() if headers is not None else None)


def declared(raw):
    """The charset the page names in a <meta> of its head, or None."""
    found = _META.search(_NOT_MARKUP.sub(b'', raw[:HEAD_BYTES]))
    return found.group(1).decode('ascii', 'ignore') if found else None


def _utf8(raw):
    """True when the bytes are valid UTF-8 and carry letters beyond ASCII (a single-byte page with accents almost never is)."""
    try:
        raw.decode('utf-8')
    except UnicodeDecodeError:
        return False
    return not raw.isascii()


def _codec(name, meta=False):
    try:
        info = codecs.lookup(str(name)) if name else None
    except LookupError:
        return None
    if info is None or not info._is_text_encoding:   # base64, hex, rot13: known to codecs, but bytes.decode refuses them
        return None
    if meta and info.name.startswith(('utf-16', 'utf-32')):
        return 'utf-8'
    return 'cp1252' if info.name in ('latin-1', 'iso8859-1') else info.name
