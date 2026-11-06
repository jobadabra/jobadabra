"""Where a message goes besides Telegram: e-mail, through our site (POST /api/notify/email, site/src/account-email.js).

The app (or the Always on repo) says which channels the person chose in JOBADABRA_NOTIFY, a comma list of email, telegram, app. Unset = the old behaviour (Telegram only).
Every message src/telegram.py sends goes through here too, so each Telegram message has its e-mail form with the same layout (src/tgcard.py's Telegram HTML; the site keeps a safe subset).
Cadence (owner, 17 Oct 2026): new matches (kind 'matches') go as ONE e-mail per run, sent when the process ends or at flush(); an urgent message (an interview) goes at once, alone;
everything else (kind 'activity': mail-check results, insights, finished jobs) is handed to the site as ONE message per run, which holds it for the person's daily or weekly digest (site/src/mail-held.js).
Each mail names its row (`mail`, jobadabra-web shared/mail-registry.js APP_ROWS) so the person's switch for it (Settings → Notifications and Automation) can hold it; a message that fits no row sends none.
Rows this engine can name: app-matches (a run's new matches), app-weekly (the weekly report), app-stopped (a failed GitHub run, `python -m src.notify`). Rows it cannot send yet: app-needs-you and app-applied (the
app sends those), app-nothing (nothing writes it yet). The app tells the run which rows the person has off in JOBADABRA_MAIL_OFF (a comma list); such a mail is not sent at all, and the site holds it too.
The run identifies as the install (JOBADABRA_TRIAL_KEY,
or the Free AI key JPF1.<install>.<token>), never an SMTP secret. Guarded by tests/unit/engine/test_notify.py.
"""
import atexit
import json
import os
import re
import sys
import urllib.error
import urllib.request

from .sources.ats import USER_AGENT

SITE = 'https://www.jobadabra.top'
MAX_HTML = 18000   # the site keeps 20000 characters
SEPARATOR = '\n\n———\n\n'
_QUEUE = {'matches': [], 'weekly': [], 'activity': []}
KINDS = tuple(_QUEUE)
ROW_OF = {'matches': 'app-matches', 'weekly': 'app-weekly'}   # the row a held kind goes out under; 'activity' (the digest) has none
_registered = []


def channels(env=None):
    """The chosen channels as a set, or None when nothing was chosen (the old behaviour: Telegram only)."""
    raw = (os.environ if env is None else env).get('JOBADABRA_NOTIFY')
    if raw is None or not raw.strip():
        return None
    return {part.strip().lower() for part in raw.split(',') if part.strip()}


def wants_email(env=None):
    return 'email' in (channels(env) or ())


def wants_telegram(env=None):
    chosen = channels(env)
    return chosen is None or 'telegram' in chosen


def _key(env):
    key = (env.get('JOBADABRA_TRIAL_KEY') or '').strip()
    if not key and (env.get('ANTHROPIC_API_KEY') or '').startswith('JPF1.'):
        key = env['ANTHROPIC_API_KEY']
    return key


def _plain(html):
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', html or '')).strip()


def _subject(items):
    first = re.search(r'<b>(.*?)</b>', items[0][0], re.S)
    title = _plain(first.group(1) if first else items[0][0])[:100] or 'Jobadabra'
    return title if len(items) == 1 else f'{title} and {len(items) - 1} more'


def _buttons(markup):
    """The inline keyboard's link buttons (an e-mail cannot press a callback button)."""
    found = []
    for row in (markup or {}).get('inline_keyboard', []):
        for button in row:
            if button.get('url') and button.get('text'):
                found.append({'text': _plain(button['text']), 'url': button['url']})
    return found


def mail_off(env=None):
    """The rows the person turned off (JOBADABRA_MAIL_OFF, set by the app from their switches in Settings → Notifications and Automation)."""
    raw = (os.environ if env is None else env).get('JOBADABRA_MAIL_OFF') or ''
    return {part.strip() for part in raw.split(',') if part.strip()}


def queue(text, markup=None, urgent=False, kind='activity', mail=''):
    """Hold a message for this run's e-mail. urgent=True sends it at once, alone (an interview notice). kind: 'matches' = the run's one new-matches mail; 'weekly' = the weekly report, its own mail (held by the site for the digest like 'activity', carrying its row);
    'activity' = held by the site for the digest. mail: the row an urgent message goes out under ('' = none); a held kind uses ROW_OF. A row the person turned off is not sent (True: nothing failed)."""
    if not wants_email():
        return True
    if (mail if urgent else ROW_OF.get(kind, '')) in mail_off():
        return True
    if urgent:
        return _post([(text, markup)], mail=mail)
    _QUEUE[kind if kind in KINDS else 'activity'].append((text, markup))
    if not _registered:
        _registered.append(True)
        atexit.register(flush)
    return True


def flush(kind=None):
    """Send what is held (one kind, or all) as ONE e-mail per kind. True when nothing was held or the site took it; False (and a printed warning) when it did not."""
    ok = True
    for name in ([kind] if kind else KINDS):
        items, _QUEUE[name][:] = list(_QUEUE[name]), []
        if items and not _post(items, kind=name, mail=ROW_OF.get(name, '')):
            ok = False
    return ok


def _post(items, urlopen=None, env=None, kind='matches', mail=''):
    env = os.environ if env is None else env
    urlopen = urlopen or urllib.request.urlopen
    key = _key(env)
    base = env.get('JOBADABRA_SITE_URL', SITE).rstrip('/')
    if env.get('JOBADABRA_E2E') and not env.get('JOBADABRA_SITE_URL'):
        return True   # the end-to-end journey never reaches the real site
    if not key:
        print('Warning: no e-mail sent: this run has no install key.', file=sys.stderr)
        return False
    html = SEPARATOR.join(item[0] for item in items)[:MAX_HTML]
    buttons = [b for item in items for b in _buttons(item[1])][:6]
    body = json.dumps({'subject': _subject(items), 'html': html, 'buttons': buttons, **({'kind': 'activity'} if kind in ('activity', 'weekly') else {}), **({'mail': mail} if mail else {})}).encode()
    request = urllib.request.Request(f'{base}/api/notify/email', data=body, method='POST', headers={'x-api-key': key, 'content-type': 'application/json', 'User-Agent': USER_AGENT})   # Why (5 Nov 2026, hr 6/6 try 5): Cloudflare answers urllib's own agent with 403 1010 before our Worker sees the call
    try:
        with urlopen(request, timeout=20) as response:
            answer = json.load(response)
    except urllib.error.HTTPError as error:
        # Why (se, 4 Nov 2026, Sentry APP-4R/4V): the site answers a refusal as JSON with a status (401 {"ok": false, "error": "unauthorized"}, api/account-email.js), but urllib raises
        # for any 4xx/5xx, so the run said only "(HTTPError)" and the reason the line below already prints was never read. The reason, else the status, now reaches the log.
        try:
            answer = json.loads(error.read(4096))
        except Exception:  # noqa: BLE001 - a body that is not JSON: the status is the reason
            answer = None
        # Only a word the site sent as text, cut short (a body that is `null`, a list or an object has no reason): never an exception out of a site outage.
        word = next((str(answer[key])[:80] for key in ('reason', 'error') if isinstance(answer, dict) and isinstance(answer.get(key), str) and answer[key]), f'HTTP {error.code}')
        print(f'Warning: the e-mail was not sent ({word}).', file=sys.stderr)
        return False
    except Exception as error:  # noqa: BLE001 - a site outage must not stop a person's search
        print(f'Warning: the e-mail was not sent ({type(error).__name__}).', file=sys.stderr)
        return False
    if not answer.get('ok'):
        print(f"Warning: the e-mail was not sent ({answer.get('reason') or answer.get('error') or 'refused'}).", file=sys.stderr)
        return False
    return True


def failure_words():
    """What to tell the person when the e-mail did not go (the digest keeps its jobs unshown, like a refused Telegram message)."""
    return 'The e-mail could not be sent, so the digest was not delivered. It is listed again next time.'


def main(argv=None):
    """python -m src.notify "text": a plain line to the person's chosen e-mail (the workflows' own notices: a failed run, Gmail not connected). Telegram stays their curl. It is the row "Always on stopped working" (app-stopped)."""
    import html
    import sys
    text = ' '.join(sys.argv[1:] if argv is None else argv).strip()
    if not text or not wants_email():
        return 0
    queue(html.escape(text), urgent=True, mail='app-stopped')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
