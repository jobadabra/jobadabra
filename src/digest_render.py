"""Pure digest HTML and keyboard rendering from immutable facts; tests/unit/engine/test_digest_notification_language.py guards canonical copy and callbacks."""
from html import escape, unescape
import re
from . import notification_language, tgcard


def render_badges(badges, locale):
    """Render only known signal keys; raw salary text is escaped once as in the canonical formatter."""
    shown = []
    for prefix, key, pairs in badges:
        values = dict(pairs)
        if 'language' in values:
            values['language'] = notification_language.render('job.language.' + values['language'], locale=locale)
        shown.append(prefix + escape(notification_language.render(key, values, locale=locale) if key else values['raw']))
    return shown



def _plain_badge(text):
    """'🇬🇧 English' -> 'English', '🔴 visa sponsorship needed' -> 'visa sponsorship needed': the card layout has no emoji per line."""
    return re.sub(r'^[^\w(]+', '', unescape(text)).strip()



def render_job(facts, locale):
    """Pure rendering from frozen values: existing escaping, source values and numbered link identity stay intact."""
    index, title, url, company, location, seniority, mode, saved, fit, badges = facts
    word = lambda key: notification_language.render(key, locale=locale)
    title = escape(title)
    if url:
        title = f'<a href="{escape(url, quote=True)}">{title}</a>'
    summary = [escape(company), escape(location or word('job.locationMissing'))]
    summary += [word('job.seniority.' + seniority)] if seniority else []
    summary += [word('job.mode.' + mode)] if mode else []
    summary += [word('job.saved')] if saved else []
    lines = [' · '.join(summary)]
    if fit:
        lines.append(tgcard.fact(word('job.fit'), f"{fit[0]}/100" + (f' · {fit[1]}' if fit[1] else '')))
    if badges:
        lines.append(tgcard.fact(word('job.check'), ' · '.join(_plain_badge(item) for item in render_badges(badges, locale))))
    return tgcard.block(f'{index}. {title}', *lines)



def _keyboard(entries):
    """Number buttons, five per row. Tapping n makes the Worker show '✅ Applied · ⭐ Save · ❌ Dismiss'
    for job n on the same message (callback 'pick:<code>:<n>')."""
    buttons = [{'text': str(index), 'callback_data': f'pick:{code}:{index}'} for index, code in entries]
    return {'inline_keyboard': [buttons[i:i + 5] for i in range(0, len(buttons), 5)]} if buttons else None



def render_page(snapshot, locale):
    """Render one captured page without reading stores, scoring, ranking or mutable source objects again."""
    page, first, new_count, total, rows, entries, remaining, next_count, seed = snapshot
    word = lambda key, values=None, count=None: notification_language.render(key, values, locale=locale, count=count)
    if page == 1:
        # One number (owner, 24 Oct 2026: run results show one number): the jobs new since the last digest. No "Top N of total" and no pipeline counts block.
        subtitle = word('digest.new', count=new_count)
    elif rows:
        subtitle = word('digest.page', {'first': first + 1, 'last': first + len(rows), 'total': total})
    else:
        return tgcard.card(word('digest.title'), word('digest.noMore'), emoji='✈️'), None
    blocks, section = [tgcard.card(word('digest.title'), subtitle, emoji='✈️')], None
    for kind, place, count, facts in rows:
        if (kind, place) != section:
            section = (kind, place)
            # The one emoji in the digest besides its title: it makes the two groups easy to tell apart at a glance (owner, 5 Oct 2026).
            heading = ('📍 ' if place else '🌍 ') + '<b>' + escape(word('digest.preferred' if place else 'digest.outside')) + '</b>'
            blocks.append(heading + '\n' + word('digest.section.' + kind) + ' · ' + word('digest.jobs', count=count))
        blocks.append(render_job(facts, locale))
    blocks.append(word('digest.tap') + (' ' + word('digest.more', count=remaining) if remaining else ''))
    keyboard = _keyboard(entries)
    if remaining:
        keyboard = keyboard or {'inline_keyboard': []}
        keyboard['inline_keyboard'].append([{'text': word('digest.next', count=next_count), 'callback_data': f'more:{seed}:{page + 1}'}])
    return '\n\n'.join(blocks), keyboard

