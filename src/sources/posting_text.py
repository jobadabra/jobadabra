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
_TAG = re.compile(r'<[^>]+>')
# A posting some portals send as a converted web page, in markdown: front matter, backslash-escaped marks, links, bold, "===" underlines, "#" headings.
_FRONT_MATTER = re.compile(r'\A\s*---.{0,800}?---', re.S)
_ESCAPE = re.compile(r'\\+(?=[^\w\s])')   # "\-", "\\&amp;": marks escaped once or twice
_LINK = re.compile(r'\[([^\]\n]{1,300})\]\([^)\n]{0,300}\)')
_BOLD = re.compile(r'\*\*(?=\S)(.+?)(?<=\S)\*\*', re.S)
_RULE = re.compile(r'={3,}')
_HASHES = re.compile(r'(?m)^(#{1,6})[ \t]+(?=\S)|(?<=\s)#{2,6}[ \t]+(?=\S)')


def _clean(fragment):
    return re.sub(r'\s+', ' ', _TAG.sub(' ', fragment)).strip()


def _markdown(text):
    """A markdown page's marks taken out (structure only): its front matter, escapes, links (the words stay), bold and "===" underlines; a "#" heading
    on its own line is the shared "## " marker, a "#" run inside a line is dropped. Why (4 Nov 2026, a tester on 0.9.6): EURES sent a posting as such a page and
    the job's Description tab opened on "---base:meta-keywords…" and literal "###"."""
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
    text = html.unescape(_TAG.sub(' ', text))
    lines = [re.sub(r'[ \t\r\f\v ]+', ' ', line).strip() for line in text.split('\n')]
    out = []
    for line in lines:
        if line == '-':   # an empty list item
            continue
        if not line and (not out or not out[-1] or out[-1].startswith('## ')):
            continue   # one blank line at most, none at the start or straight after a heading
        out.append(line)
    return '\n'.join(out).strip()[:limit]
