#!/usr/bin/env python3
"""Gmail + Calendar -> the application ledger, read-only.

Each run (3 times a day by default, and 5 minutes after an application is marked Applied):

1. **Gmail**: searches recent mail from applicant-tracking systems, recruiter platforms and booking
   tools, plus mail naming a tracked company or role. Claude Haiku 5.5 classifies each new email
   (confirmation, reply, interview scheduled, rejection, offer, or not about an application) and
   matches it to an application. A recruiter pitching a new role ("Recruiter outreach") becomes a tracked
   recruiter lead (src/ai/opportunity.py: Applications row at Stage Recruiter lead, the message in its page,
   a Telegram line); their follow-ups then match it like any application. Matches become 📈 Application Events at the email's own time
   (Source Gmail, Source ID = message id, so an email is never logged twice), move Stage forward
   (never back), and fill Next interview when a time is stated. An event logged by hand for the same
   application, kind and day is linked to the email instead of duplicated.
2. **Calendar**: upcoming events that belong to an application (company, platform, or a contact's
   email among the attendees) set Next interview and an Interview scheduled event. The evening
   before (and the morning of) an interview, Telegram gets a prep message; a few hours after it,
   a nudge to send the transcript for an interview review.

A Telegram summary lists what changed. Nothing in Gmail or Calendar is modified.

Usage:
  python -m src.ai.mail [--days 2] [--send] [--dry-run] [--no-calendar]
"""
import argparse
from datetime import datetime, timezone
import sys

from .. import run_log, telegram, notification_cards as cards
from .. import tgcard  # noqa: F401 — desktop/test/fixtures/engine_messages.py reaches mail.tgcard for its engine/parser contract fixtures.
from ..sources.google import Google
from ..sources.google_scopes import CALENDAR, GMAIL, PART_NAMES, WHAT_IT_LOSES, MissingScope
from ..stores import open_stores
from . import cost
from .. import feedback as employer_feedback

from .mail_config import (  # noqa: F401 — re-exported: callers and tests use `mail.<name>`
    BATCH, DEFAULT_MODEL, INVITES, INVITE_MAILS, KINDS, LINKEDIN_SENDERS, OUTREACH, RANK, RECRUITER_DOMAINS, SCHEMA,
    SENDER_DOMAINS, STATE_FILE, SYSTEM, TERMINAL, TZ, YOU_REPLIED,
)
from .mail_read import (  # noqa: F401 — re-exported: callers and tests use `mail.<name>`
    _field, _role, _unread_invitation, _when, applications, classify, extra_query, ledger_key, listing, load_state, query,
    save_state, verified_feedback,
)
from .mail_record import (  # noqa: F401 — re-exported: callers and tests use `mail.<name>`
    MOVED, MOVED_FIELDS, _events_index, _moment, _near, _plain, _stage_for, _value, advance,
    changes_of, changes_readable, gmail_link, record,
)
from .mail_lines import (  # noqa: F401 — re-exported: callers and tests use `mail.<name>`
    EMOJI, EVENT_KIND, SHORT_KIND, _head, _label, _short, _who, ask,
)
from .mail_match import (  # noqa: F401 — re-exported: callers and tests use `mail.<name>`
    ENDED, PLATFORMS, STOP, _about_tracked, _ambiguous, _by_mention, _contact_names, _event_text, _matches, _nameless, _names_it,
    _names_person, _same_person, _sender_org, person_name,
)
from .mail_leads import (  # noqa: F401 — re-exported: callers and tests use `mail.<name>`
    TRACKABLE, _from_email, interview_lead, new_lead,
)
from .mail_inbox import (  # noqa: F401 — re-exported: callers and tests use `mail.<name>`
    mail_pass, without_ai,
)
from .mail_sent import (  # noqa: F401 — re-exported: callers and tests use `mail.<name>`
    EMAIL, SENT_MAX, contacts, review_rejections, sent_pass, sent_query,
)
from .mail_calendar import (  # noqa: F401 — re-exported: callers and tests use `mail.<name>`
    calendar_pass, prep_message, reminders, reviewed_since,
)
from .mail_failure import (  # noqa: F401 — re-exported: callers and tests use `mail.<name>`
    NOT_CHECKED, NOT_CHECKED_OPENAI, failure_cause, failure_warning, not_checked,
)


def _allowed(google, part):
    """False when the user left this part of the Google sign-in unticked (unknown = allowed until Google refuses)."""
    granted = getattr(google, 'scopes', None)
    return granted is None or part in granted


def run(tracker, google, *, client=None, model=DEFAULT_MODEL, days=2, send=None, calendar=True, dry_run=False,
        now=None, state_path=STATE_FILE, stats=None, on_new=None, always_report=False, stores=None, send_reminder=None):
    """always_report: a check answers even when there's nothing new. Off for the mail workflow, which the app
    dispatches for "Check Gmail now": a quiet check says so in the app and on its ⏱️ Search runs row, and a
    Telegram message for every check someone started is noise (1 Oct 2026).
    stores: the active store (src/stores); by default the one open_stores() picks, on `tracker` when one is given.
    send_reminder: how an interview reminder goes (the CLI: at once, under the person's "Interview reminder" switch, owner 8 Nov 2026); by default `send`."""
    stores = stores or open_stores(tracker=tracker)
    state = load_state(state_path, ledger_key(stores))
    apps = applications(stores)
    index = _events_index(stores)
    if client is None:
        from . import engine
        client = engine.client(action='mail')
    rejected = []
    lines, count, notes, gaps = [], 0, [], []   # gaps: parts the user left unticked; each is said once and the other part still runs
    if _allowed(google, GMAIL):
        print('Gmail: reading new emails…')
        try:
            lines, count = mail_pass(stores, google, client, model, apps, index, state, days, stats, dry_run, now, rejected,
                                     None if dry_run else on_new)
            if stats is not None:
                stats.update(pending=count, done=count)
            sent_pass(stores, google, apps, index, days, stats, dry_run)  # your own replies: for Focus's follow-ups
        except MissingScope as gap:
            gaps.append(gap)
    else:
        gaps.append(MissingScope(GMAIL))
    if calendar and _allowed(google, CALENDAR):
        print('Gmail: checking the calendar…')
        try:
            cal_lines, notes = calendar_pass(stores, google, client, model, apps, index, state, stats, now, dry_run)
            lines += cal_lines
        except MissingScope as gap:
            gaps.append(gap)
    elif calendar:
        gaps.append(MissingScope(CALENDAR))
    for gap in gaps:   # the part's own line in the log, the run row and the app; the part that was allowed keeps its results
        print(f'Gmail: {PART_NAMES[gap.part]} was not allowed in the Google sign-in, so {WHAT_IT_LOSES[gap.part]}. '
              'Settings → Connections → Gmail & Calendar → Reconnect.')
        if stats is not None:
            stats.setdefault('gaps', []).append(failure_warning(gap))
    if not dry_run:
        save_state(state, state_path)
        lines += review_rejections(stores, client, rejected, stats)
    if send and lines:
        send(cards.card(cards.words('mail.title'), cards.words('mail.updates', count=len(lines)), lines, emoji='📧'))
    elif send and always_report and not notes:
        send(cards.card(cards.words('mail.checked'), cards.words('mail.newEmails', count=count) if count else cards.words('mail.none'),
                         [cards.words('mail.noChanges')] if count else [], emoji='📧'))
    for note in notes:
        if send:
            (send_reminder or send)(note)
    if (stats or {}).get('updates') and not dry_run:  # one short line each, for the desktop app's activity panel
        print('Updates:')
        for line in stats['updates']:
            print(line)
    usd = (stats or {}).get('usd', 0.0)
    return f'Mail: {count} new email(s) classified, {len(lines)} update(s), {len(notes)} reminder(s) (${usd:.3f})'


def skipped_line(error):
    """The one sentence of a check that is skipped, not failed (no connection, the user's Claude Code stopped, the API spend limit), or None for an error that is a real failure."""
    if failure_cause(error) == 'offline':   # said once, the check ends ok and the next one tries again (src/offline.py)
        return 'Mail check skipped: no connection; it tries again at the next check'
    if cost.cli_limit(error):  # the user's Claude Code: its plan's usage window, or it is signed out
        return f'Mail check skipped: {error}'
    if cost.limit_reached(error):
        return (f'Mail check skipped: the Anthropic API spend limit is reached ({error}). '
                'Raise it in the Anthropic console, or it resumes when the limit resets.')
    return None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--days', type=int, default=2, help='how far back to search Gmail')
    parser.add_argument('--send', action='store_true', help='send the summary and reminders to Telegram')
    parser.add_argument('--dry-run', action='store_true', help='classify and print; write nothing')
    parser.add_argument('--no-calendar', action='store_true')
    parser.add_argument('--always-report', action='store_true',
                        help='with --send: answer even when nothing is new (a check someone started)')
    parser.add_argument('--log-run', action='store_true',
                        help='log this check to Notion ⏰ Search runs even without --send (the desktop app always does)')
    args = parser.parse_args(argv)
    google = Google.from_env()
    if not google:
        print('Gmail + Calendar is off: Google is not connected or JOBADABRA_DISABLE includes mail. '
              'See README → Gmail and Calendar.')
        return 0
    stores = open_stores()  # the active store: this Mac's (sqlite) or Notion; JOBADABRA_STORE picks it
    sender = reminder_sender = None
    from ..features import disabled
    if args.send and not disabled('telegram'):
        token, chat_id = telegram.credentials()
        sender = lambda text: telegram.deliver(text, token, chat_id, **cards.delivery(text))
        # Why (8 Nov 2026, owner: "an e-mail for every automation"): a reminder (the evening before, the morning of) was e-mailed as 'activity', held for the digest and under no switch, so it could arrive after the interview.
        # Now it goes at once under `app-reminder`, which the person's Interview reminder switch holds (src/notify.py mail_off).
        reminder_sender = lambda text: telegram.deliver(text, token, chat_id, urgent=True, mail='app-reminder', **cards.delivery(text))
    stats = {}
    logged = (args.send or args.log_run) and not args.dry_run
    if logged:
        run_log.auto_begin(stores)  # the check's run row opens when it starts, on any store
    log = run_log.new_run('mail')

    def log_check(warning=None):  # one ⏰ Search runs row per check: what it read, what it recorded, the cost
        log['mail'] = {key: value for key, value in stats.items() if key not in ('updates', 'emails', 'gaps')}
        log['updates'] = stats.get('updates', [])
        log['emails'] = stats.get('emails', [])  # every email read: its subject, its link, and what the check did with it
        log['seconds'] = int((datetime.now(timezone.utc) - datetime.fromisoformat(log['started_at'])).total_seconds())
        log['warnings'] += stats.get('gaps', [])   # a part left unticked: said on the run row, the rest of the check is kept
        if warning:
            log['warnings'].append(warning)
        url = run_log.log_run(stores, log)
        if url:
            print(f'Cronjob run logged: {url}')

    try:
        from ..paths import jobs_db
        from . import added  # jobs tracked from an email get facts and a fit score, like found ones
        print(run(None, google, days=args.days, send=sender, calendar=not args.no_calendar, dry_run=args.dry_run,
                  stats=stats, on_new=added.hook(stores, jobs_db(), log),
                  always_report=args.always_report, stores=stores, send_reminder=reminder_sender))
        if logged:
            log_check()
    except Exception as error:  # noqa: BLE001 — a spend limit is expected, not a crash
        from .. import run_result
        # Noted before the run row is written, so the result file carries the code and not only the sentence.
        if failure_cause(error):
            run_result.note_mail(failure_cause(error))
        if logged:
            log_check(failure_warning(error))
        if 'invalid_grant' in str(error):
            message = ('⚠️ The Google sign-in for Gmail and Calendar has expired (Google limits apps in testing mode '
                       'to 7 days). On the Mac, in the repo, run: python3 -m src.sources.google auth --github '
                       '(add --client-json <file> if you use your own Google app)')
            print(message)
            if sender:
                sender(cards.safe(cards.canonical(message, cards.words('mail.expired'))))
            return 0
        line = skipped_line(error)
        if line:
            print(line)
            return 0
        raise
    return 0


if __name__ == '__main__':
    sys.exit(main())