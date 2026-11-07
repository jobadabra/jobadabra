#!/usr/bin/env python3
"""Focus, part 1: the constants (time zone, targets, who-wrote-last sets) and the small helpers every Focus item is
made from: reading a field, a time or "N days ago", an item dict, the presented item, the list's summary line,
and the questions the app already asked. Rows are store records (src/stores/base.py), events and interviews too;
an application's record carries 'link' (its page, when the store has one). No I/O. src/focus.py re-exports every
name here.

Guarded by tests/unit/notion/test_focus.py, tests/unit/ai/test_follow_up.py and tests/unit/notion/test_job_titles.py.
"""
from .ui_copy import text, join, date as copy_date
import re
from datetime import datetime, timezone

from . import tz
from .notion.ledger import REPLY

TZ = tz.local_zone()

DEFAULT_TARGET = 5  # fewer, better applications: a handful of good-fit ones a day
REPLIED = 'Replied'
ENDED = {'Rejected', 'Withdrawn', 'No response', 'Closed', 'Dismissed'}
# Events that come from the other side and wait for an answer; anything later (your reply, a booking) settles them.
NEEDS_ANSWER = {REPLY, 'Recruiter lead', 'Offer'}
WAITING_DAYS, QUIET_DAYS, SOON_HOURS, STALE_DAYS = 7, 3, 48, 30
FOLLOW_UP_HOURS = 24  # your message unanswered this long: Focus recommends a follow-up
# Messages, for "who wrote last": yours (a reply you sent or logged, Done in Focus) and theirs. Stage moves and
# the app's own bookkeeping are not messages.
YOURS = {REPLIED}
THEIRS = NEEDS_ANSWER | {'Interview scheduled', 'Rejected', 'Confirmation received', 'Feedback received'}


def _when(value):
    if not value:
        return None
    try:
        moment = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=TZ)


def _ago(moment, now):
    days = (now.astimezone(TZ).date() - moment.astimezone(TZ).date()).days
    return text('focusCards.items.m001', 'today') if days <= 0 else text('focusCards.items.m002', 'yesterday') if days == 1 else text('focusCards.items.m003', '{days} days ago', {'days': days, 'count': days})


def _field(row, name):
    """A record's field as text-ish ('' when empty or no record)."""
    value = (row or {}).get(name)
    return '' if value is None else value


def _role(row):
    """The job's role: a record's title is the role alone (the notion store drops the " · via Huxley" a page title
    carries, src/notion/titles.py): every Focus line names the employer or agency itself."""
    return _field(row, 'title') if row else ''


def _asked_subject(event):
    """The email subject of a "which job?" question (src/ai/mail.py ask: the event's changes['subject'])."""
    return str((event.get('changes') or {}).get('subject') or '')


def answered_questions(rows, events):
    """The "which job?" questions you have answered, newest first: the email's subject and the job it went to ('' = not
    about a job). The Gmail check's run page shows the question next to its answer from this."""
    by_id = {r['id'].replace('-', ''): r for r in rows}
    out = []
    for event in events:
        subject = _asked_subject(event)
        if not subject or event.get('needs_you'):
            continue
        row = by_id.get(event['app_id'].replace('-', '')) if event.get('app_id') else None
        job = f"{_field(row, 'company') or _field(row, 'via') or '?'} — {_role(row)[:60]}" if row else ''
        out.append({'subject': subject, 'job': job, 'at': event.get('at') or ''})
    return sorted(out, key=lambda a: a['at'], reverse=True)[:60]


def _gmail(source_id):
    """The Gmail link of a message id. Only Gmail's own ids: a calendar event ("cal:") and a chat or screenshot you logged
    ("paste:", "chat:") are not emails, so a LinkedIn conversation never gets an "Open email" button."""
    return f'https://mail.google.com/mail/u/0/#all/{source_id}' if source_id and not source_id.startswith(('cal:', 'paste:', 'chat:')) else ''


def _booking_link(note):
    """The scheduling link the log saved in an event's note ("Booking link: https://calendly.com/…"), '' when none."""
    found = re.search(r'Booking link:\s*(https?://[^\s<>"\')]+)', note or '')
    return found.group(1).rstrip('.,;') if found else ''


def _item(priority, kind, emoji, title, detail, row=None, link='', link_label='', done=False, **extra):
    field = lambda name: _field(row, name) if row else ''
    return {'priority': priority, 'kind': kind, 'emoji': emoji, 'title': title, 'detail': detail,
            'company': field('company'), 'job': _role(row), 'via': field('via'), 'stage': field('stage'),
            'salary': field('salary'), 'location': field('location'), 'reached': field('reached_via'),
            'job_url': field('url'), 'page_id': row['id'] if row else '',
            'notion_url': (row or {}).get('link', ''), 'link': link, 'link_label': link_label, 'done': done, **extra}


def _short(text, limit=28):
    text = re.sub(r'\s+', ' ', text or '').strip()
    return text if len(text) <= limit else text[:limit - 1].rstrip(' ,·(') + '…'


def present(item, gmail=True):
    """The card's words (the app's Up next list): an icon, a badge, a short headline and a meta line."""
    kind, who = item['kind'], item['company'] or item['via'] or text('focusCards.items.m004', 'the recruiter')
    meta = []
    if kind in ('reply', 'book', 'offer'):
        reached = item['reached'] or ('LinkedIn' if 'linkedin' in item['link'] else 'Email' if 'mail.google' in item['link'] else '')
        icon, badge, tone = {'reply': ('chat' if reached == 'LinkedIn' else 'mail' if reached == 'Email' else 'chat', text('focusCards.items.m005', 'Reply today'), 'bad'),
                             'book': ('calendar', text('focusCards.items.m006', 'Book the call'), 'bad'), 'offer': ('target', text('focusCards.items.m007', 'Offer'), 'good')}[kind]
        headline = {'reply': text('focusCards.items.m008', 'Reply to {who} recruiter', {'who': who}) if item.get('lead') else text('focusCards.items.m009', 'Reply to {who}', {'who': who}),
                    'book': text('focusCards.items.m010', 'Book a call with {who}', {'who': who}), 'offer': text('focusCards.items.m011', "Answer {who}'s offer", {'who': who})}[kind]
        meta = [_short(item['job'], 40), enum_words(reached), _short(item['salary']), _short(item['location'])]
    elif kind == 'prepare':
        at = _when(item.get('at', ''))
        icon, badge, tone = 'mic', text('focusCards.items.m012', 'Interview {value}', {'value': date_words(at.astimezone(TZ), '%a %H:%M')}) if at else text('focusCards.items.m013', 'Interview'), 'bad' if item['priority'] == 1 else 'warn'
        headline = text('focusCards.items.m014', 'Prepare for {who}', {'who': who})
        meta = [_short(item['job'], 40), item.get('prep_reason') if item.get('prep_stale') else
                text('focusCards.items.m015', '✓ prep kit ready') if item.get('prep_at') else text('focusCards.items.m016', 'posting, kit and weak topics')]
    elif kind == 'review':
        icon, badge, tone = 'file', text('focusCards.items.m017', 'Review'), 'warn'
        headline, meta = text('focusCards.items.m018', 'Review your {who} interview', {'who': who}), [_short(item['job'], 40), text('focusCards.items.m019', 'import the recording or transcript')]
    elif kind == 'follow_up':
        at = _when(item.get('at', ''))
        icon, badge, tone = 'send', text('focusCards.items.m020', 'Follow up'), 'warn'
        headline = text('focusCards.items.m021', 'Follow up with {who}', {'who': who})
        meta = [_short(item['job'], 40), text('focusCards.items.m022', 'you wrote {value}', {'value': date_words(at.astimezone(TZ), '%a %d %b')}) if at else '',
                text('focusCards.items.m023', '{value}, no reply', {'value': _days_ago(item.get('quiet', 0), short=True)})]
    elif kind == 'nudge':
        quiet = item.get('quiet', 0)
        icon, badge, tone = 'send', text('focusCards.items.m020', 'Follow up'), 'warn'
        headline = text('focusCards.items.m024', 'Move {who} forward', {'who': who})
        meta = [_short(item['job'], 40), enum_words(item['stage']), text('focusCards.items.m025', 'no news for {quiet} days', {'quiet': quiet, 'count': quiet}) if quiet >= QUIET_DAYS else text('focusCards.items.m026', 'nothing booked')]
    elif kind in ('feedback', 'feedback_wait', 'feedback_review'):
        icon, badge, tone = 'chat', {'feedback': text('focusCards.items.m027', 'Learn from it'), 'feedback_wait': text('focusCards.items.m028', 'Asked for feedback'),
                                    'feedback_review': text('focusCards.items.m029', 'Received feedback')}[kind], 'info'
        headline = {'feedback': text('focusCards.items.m030', 'Ask {who} for feedback', {'who': who}), 'feedback_wait': text('focusCards.items.m031', 'Waiting for {who} feedback', {'who': who}),
                    'feedback_review': text('focusCards.items.m032', 'Learn from {who} feedback', {'who': who})}[kind]
        meta = [_short(item['job'], 40), {'feedback': text('focusCards.items.m033', 'One specific point can improve your next interview'),
                # Only a connected Gmail is checked: without it the row would promise replies nobody collects (#312).
                'feedback_wait': text('focusCards.items.m034', 'Gmail checks for replies · or add feedback here') if gmail else text('focusCards.items.m035', 'Connect Gmail to collect replies · or add feedback here'),
                'feedback_review': text('focusCards.items.m036', 'Employer feedback, separate from AI guesses')}[kind]]
    elif kind == 'which_job':
        icon, badge, tone = 'mail', text('focusCards.items.m037', 'Which job?'), 'warn'
        headline = item['title']
        meta = [enum_words(item.get('event_kind', '')), _short(item.get('note', ''), 60)]
    elif kind == 'details':
        icon, badge, tone = 'info', text('focusCards.items.m038', 'Add details'), 'bad' if item['stage'] == 'Interview scheduled' else 'warn'
        headline = text('focusCards.items.m039', 'Tell Jobadabra about the {who} interview', {'who': who}) if item['company'] or 'company' not in item.get('missing', []) \
            else text('focusCards.items.m040', 'Who is the employer behind {who}?', {'who': who})
        meta = [_short(item['job'], 40), join("", [text('focusCards.items.m041', 'missing: '), missing_words(item.get('missing', []))])]
    elif kind == 'apply':
        done, left, best = item.get('applied', 0), item.get('left', 0), item.get('best', [])
        icon, badge, tone = 'briefcase', text('focusCards.items.m042', 'Next step'), 'info'
        headline = text('focusCards.items.m043', 'Apply to your next role') if not done else text('focusCards.items.m044', 'Apply to {left} more today', {'left': left, 'count': left})
        meta = [text('focusCards.items.m045', 'Your best: {value}', {'value': ', '.join(best)}) if best else text('focusCards.items.m046', 'Your application is prepared automatically when you apply'),
                text('focusCards.items.m047', '{done} of {value} today', {'done': done, 'value': item.get('target', DEFAULT_TARGET)})]
    elif kind == 'happened':
        at = _when(item.get('at', ''))
        icon, badge, tone = 'calendar', text('focusCards.items.m048', 'Did it happen?'), 'warn'
        headline = text('focusCards.items.m049', 'Interview with {who}', {'who': who})  # the badge asks "Did it happen?"
        meta = [_short(item['job'], 40), date_words(at.astimezone(TZ), '%a %d %b %H:%M') if at else '']
    elif kind == 'waiting' and item.get('after_interview'):
        icon, badge, tone = 'pulse', text('focusCards.items.m050', 'Waiting'), 'neutral'
        headline = text('focusCards.items.m051', "Waiting for {who}'s next step", {'who': who})
        meta = [_short(item['job'], 40), _short(item['next_step'], 60) if item.get('next_step') else text('focusCards.items.m052', 'next step not stated')]
    else:  # waiting
        icon, badge, tone = 'pulse', text('focusCards.items.m053', 'When you can'), 'neutral'
        headline, meta = item['title'], [text('focusCards.items.m054', 'No human reply yet'), text('focusCards.items.m055', 'follow up or let them go')]
    item.update(icon=icon, badge=badge, tone=tone, headline=headline, meta=[m for m in meta if m])
    return item


def summary(items):
    """One sentence for "Your focus": the first two kinds of work, in order."""
    phrases = {'offer': 'answer the offer', 'book': 'book the call you were invited to', 'reply': 'reply to recruiters',
               'prepare': 'prepare for your interview', 'review': 'review your last interview',
               'happened': 'confirm your last interview happened', 'nudge': 'follow up where things went quiet',
               'follow_up': 'follow up where your message got no answer',
               'apply': 'apply to your next role', 'waiting': 'follow up on applications waiting for a reply',
               'feedback': 'ask for feedback to improve your next interview', 'feedback_review': 'learn from employer feedback'}
    order = []
    for item in items:
        kind = item['kind']
        if not item.get('after_interview') and kind in phrases and kind not in order:
            order.append(kind)
    if not order:
        return text('focusCards.summary.empty', "You're up to date. A good moment to apply to a few more jobs.")
    kind = order[0]
    phrase = phrases[kind]
    first = text('focusCards.summary.start.' + kind, phrase[:1].upper() + phrase[1:])
    if len(order) > 1:
        kind = order[1]
        second = text('focusCards.summary.next.' + kind, phrases[kind])
        return text('focusCards.summary.two', '{first} first, then {second}.', {'first': first, 'second': second})
    return text('focusCards.summary.one', '{first}.', {'first': first})


def _days_ago(days, short=False):
    """"yesterday" / "3 days ago" (short: "1 day" / "3 days")."""
    if short:
        return text('focusCards.items.daysOne' if days == 1 else 'focusCards.items.daysOther', '{count} day' if days == 1 else '{count} days', {'count': days})
    return text('focusCards.items.m002', 'yesterday') if days <= 1 else text('focusCards.items.m003', '{days} days ago', {'days': days, 'count': days})


def missing_words(values, alternative=False):
    """Annotate known missing-detail labels without changing the canonical missing codes or unknown values."""
    labels = {'company': text('focusCards.missing.company', 'company'),
              'salary': text('focusCards.missing.salary', 'salary'),
              'job description': text('focusCards.missing.description', 'job description')}
    parts = [labels.get(value, value) for value in values]
    if not alternative or not parts:
        return join(', ', parts)
    result = parts[0]
    for part in parts[1:]:
        result = text('focusCards.missing.or', '{first} or {next}', {'first': result, 'next': part})
    return result


def date_words(moment, pattern, canonical=None):
    """Capture a formatted date through the shared desktop formatter, retaining its exact original English fallback."""
    options = {'timeZone': str(TZ) if isinstance(moment, datetime) else 'UTC'}
    for token, field, style in (('%a', 'weekday', 'short'), ('%b', 'month', 'short'), ('%d', 'day', '2-digit'),
                                ('%H', 'hour', '2-digit'), ('%M', 'minute', '2-digit')):
        if token in pattern:
            options[field] = style
    if '%H' in pattern:
        options['hour12'] = False
    return copy_date(moment.isoformat(), options, moment.strftime(pattern) if canonical is None else canonical)


def enum_words(value):
    """Annotate known Focus display enums only; unknown provider values and canonical control fields stay untouched."""
    labels = ('Recruiter lead', 'Saved', 'Kit ready', 'Applying', 'Applied', 'Confirmation received',
              'Reply received', 'Screening', 'Interview scheduled', 'Interviewing', 'Offer', 'Rejected',
              'No response', 'Withdrawn', 'Closed', 'Dismissed', 'Feedback received', 'Email', 'Phone')
    return text('focusCards.enum.' + str(labels.index(value)), value) if value in labels else value
