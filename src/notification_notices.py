"""Pure end-user operational notice framing from captured facts; canonical check details and control identities remain unchanged."""
from html import escape
from . import notification_cards as cards


def health_message(facts):
    """Render captured (name, failed, detail, fix) tuples without rechecking health or translating their raw diagnostics."""
    blocks = [cards.join('', ['<b>' + escape(name) + ' · ', cards.words('health.failed' if failed else 'health.warning'),
              '</b>\n' + escape(detail), cards.join('', ['\n<b>', cards.words('notice.nextStep'), ':</b> ' + escape(fix)]) if fix else ''])
              for name, failed, detail, fix in facts]
    return cards.card(cards.words('health.title'), cards.words('health.problems', count=len(facts)), blocks, emoji='🩺')


def failure_message(kind, mode, url):
    """Tag the known install-user workflow failure case; raw mode/URL values are never parsed, translated or sent here."""
    if kind not in ('run', 'mail', 'scout'):
        raise ValueError('unknown end-user workflow failure kind')
    return cards.words('failure.' + kind, {'mode': mode, 'url': url})


def main(argv=None):
    """Print the explicit workflow's localized plain Telegram body; this pure CLI performs no delivery or account access."""
    import sys
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) != 3:
        raise ValueError('expected failure kind, raw mode and raw run URL')
    message = failure_message(*args)
    print('❌ ' + cards.delivery(message).get('display_text', str(message)))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
