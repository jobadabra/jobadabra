"""A page's <a> links and an href's value in each of the three ways HTML writes it ("…", '…' or unquoted, as in href=/16165566/designer/), structure only.
Why (14 Nov 2026, zb; sa's run 43614387886, b10 Lisbon): a job board writing its offers' links without quotes gave our readers no link at all (13 offers on the
page, 0 read): the AI page reader is handed the page's links (src/ai/page_reader.py) and got only the quoted menu ones. Five readers each had their own
quoted-only pattern; this is the one. Tests: tests/unit/sources/test_anchors.py."""
import re

_VALUE = r'''(?:"([^"]*)"|'([^']*)'|([^\s"'<>`]+))'''   # HTML's three forms of an attribute value; an unquoted one ends at a space or the tag's end
_TAG = re.compile(r'<a\b((?:[^>"\']|"[^"]*"|\'[^\']*\')*)>(.*?)</a>', re.S | re.I)   # a `>` inside a quoted attribute is not the tag's end
_HREF = re.compile(r'(?<![\w-])href\s*=\s*' + _VALUE, re.I)   # the attribute whole: not data-href


def href(attrs):
    """The href value in a tag's attribute text, as written (not unescaped), or None when it has none."""
    found = _HREF.search(attrs or '')
    if not found:
        return None
    return next(part for part in found.groups() if part is not None)


def anchors(markup, fragments=False):
    """[(href, inner markup)] of every <a> with a non-empty href, in page order; fragments=False leaves out links that are only `#…` on this page."""
    out = []
    for attrs, inner in _TAG.findall(markup or ''):
        value = href(attrs)
        if value and (fragments or not value.startswith('#')):
            out.append((value, inner))
    return out


def tagged(markup):
    """[(attribute text, inner markup)] of every <a> with a non-empty href that is not only `#…`: for readers that also read the tag's other attributes."""
    return [(attrs, inner) for attrs, inner in _TAG.findall(markup or '') if (href(attrs) or '#')[:1] != '#']
