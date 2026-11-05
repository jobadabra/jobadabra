"""A posting's HTML as readable text that keeps its shape: headings, paragraphs and list items stay on their own lines, so the app can show
"Responsibilities" with its bullets (renderer/job-drawer/tab-description.js). 10 Oct 2026: both fetchers squashed every posting into one
line, and 138 of 139 saved descriptions were one block of text. Structure only (the HTML's own block tags), never a word list.
Markers the readers share: "## Heading" on a line of its own, "- item" for a list item, a blank line between paragraphs.
Guarded by tests/unit/sources/test_posting_text.py."""
import html
import re

LIMIT = 12000
_HEADING = re.compile(r'<\s*h[1-6]\b[^>]*>(.*?)<\s*/\s*h[1-6]\s*>', re.S | re.I)
# A paragraph that is only bold text, short, is a heading in all but name ("<p><strong>Requirements</strong></p>").
_BOLD_ONLY = re.compile(r'<\s*(p|div)\b[^>]*>\s*<\s*(strong|b)\b[^>]*>([^<]{1,80})<\s*/\s*\2\s*>\s*:?\s*<\s*/\s*\1\s*>', re.I)
_ITEM = re.compile(r'<\s*li\b[^>]*>', re.I)
_BREAK = re.compile(r'<\s*/?\s*(?:p|div|section|article|header|footer|ul|ol|table|tr|br|hr|blockquote)\b[^>]*>', re.I)
# Why (5 Nov 2026, tester card f9e48e, #3182): `<[^>]+>` took any angle-bracket text for markup, so "Fluency in <German> and English" read
# "Fluency in and English" and the posting's summary lost its required language. Only a tag that IS HTML goes: the standard's element names (a
# fixed list from the spec, not a word list of ours), a namespaced (<o:p>) or custom (<my-tag>) element, a comment, a doctype, a declaration.
_ELEMENTS = ('a abbr address area article aside audio b base bdi bdo big blockquote body br button canvas caption center cite code col colgroup data '
             'datalist dd del details dfn dialog div dl dt em embed fieldset figcaption figure font footer form frame frameset h1 h2 h3 h4 h5 h6 head '
             'header hgroup hr html i iframe img input ins kbd label legend li link main map mark menu meta meter nav nobr noscript object ol optgroup '
             'option output p param picture pre progress q rp rt ruby s samp script section select slot small source span strike strong style sub '
             'summary sup svg table tbody td template textarea tfoot th thead time title tr track tt u ul var video wbr').split()
TAG = re.compile(r'</?(?:(?:%s)|[a-z][\w.]*:[\w.:-]+|[a-z][a-z0-9]*(?:-[a-z0-9]+)+)(?![\w:-])[^<>]*>|<!--.*?-->|<![a-z\[][^<>]*>|<\?[^<>]*>'
                 % '|'.join(_ELEMENTS), re.I | re.S)
# A posting some portals send as a converted web page, in markdown: front matter, backslash-escaped marks, links, bold, "===" underlines, "#" headings.
_FRONT_MATTER = re.compile(r'\A\s*---(?=[\w-]+:).{0,800}?---', re.S)   # "---base:meta-keywords: … title: X---": key: value pairs between two rules
_ESCAPE = re.compile(r'\\+(?=[^\w\s])')   # "\-", "\\&amp;": marks escaped once or twice
_ESCAPED_MARKS = re.compile(r'\\[-\[\]*&()<>]')
_LINK = re.compile(r'\[([^\]\n]{1,300})\]\([^)\n]{0,300}\)')
_BOLD = re.compile(r'\*\*(?=\S)([^*\n]{1,300}?)(?<=\S)\*\*')
_RULE = re.compile(r'={3,}')
_HASHES = re.compile(r'(?m)^(#{1,6})[ \t]+(?=\S)|(?<=\s)#{2,6}[ \t]+(?=\S)')


_ENTITY = re.compile(r'&(?:#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);')


def label(value):
    """A job's title, employer or place as plain text: HTML entities decoded (twice, as a feed may escape twice) and whitespace tidied. Only entities that
    end in ';' count, so "Smith &not Sons" keeps its words (html.unescape would turn that into a "¬")."""
    text = str(value or '')
    for _ in range(2):
        text = _ENTITY.sub(lambda found: html.unescape(found[0]), text)
    return re.sub(r'\s+', ' ', text).strip()


def _clean(fragment):
    return re.sub(r'\s+', ' ', TAG.sub(' ', fragment)).strip()


def _is_markdown_page(text):
    """True for a posting that is a converted web page: it opens on front matter (key: value pairs between two "---"), or its punctuation is backslash-escaped
    (three marks or more). Plain text and HTML keep every "#", "===", backslash and "[x](y)" they have ("# of openings", "C:\\temp", "arr[i](j)")."""
    return bool(_FRONT_MATTER.match(text)) or len(_ESCAPED_MARKS.findall(text)) >= 3


def _markdown(text):
    """A markdown page's marks taken out (structure only): its front matter, escapes, links (the words stay), bold and "===" underlines; a "#" heading
    on its own line is the shared "## " marker, a "#" run inside a line is dropped. Only for a text that _is_markdown_page. Why (4 Nov 2026, a tester on 0.9.6):
    EURES sent a posting as such a page and the job's Description tab opened on "---base:meta-keywords…" and literal "###"."""
    if not _is_markdown_page(text):
        return text
    text = _FRONT_MATTER.sub(' ', text)
    text = _LINK.sub(r'\1', _ESCAPE.sub('', text))
    text = _RULE.sub('\n', _BOLD.sub(r'\1', text))
    return _HASHES.sub(lambda found: '## ' if found[1] else '', text)


def html_to_text(markup, limit=LIMIT):
    """HTML (possibly escaped twice) to text with its structure; text without tags comes back as it was, tidied. A markdown page is read too (_markdown)."""
    text = html.unescape(html.unescape(_markdown(markup or '')))
    text = _HEADING.sub(lambda found: f'\n\n## {_clean(found[1]).rstrip(":").strip()}\n', text)
    text = _BOLD_ONLY.sub(lambda found: f'\n\n## {found[3].strip().rstrip(":").strip()}\n', text)
    text = _ITEM.sub('\n- ', text)
    text = _BREAK.sub('\n', text)
    text = html.unescape(TAG.sub(' ', text))
    lines = [re.sub(r'[ \t\r\f\v ]+', ' ', line).strip() for line in text.split('\n')]
    out = []
    for line in lines:
        if line == '-':   # an empty list item
            continue
        if not line and (not out or not out[-1] or out[-1].startswith('## ')):
            continue   # one blank line at most, none at the start or straight after a heading
        out.append(line)
    return '\n'.join(out).strip()[:limit]
