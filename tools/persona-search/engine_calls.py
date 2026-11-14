"""Which AI answered one person's night: the relay line's `engine <name>` for every answered call (codex.mjs timedRelay), counted per engine for the press and the judge.
Why (10 Nov 2026, owner on #3703: "Claude should be at any times a replacement"): the check goes on to Claude when Codex is out, so a night may be measured by two
engines; each row says which and how much (one fixed word per engine: codex, claude), and the Admin graph marks a mixed or another-model night instead of hiding it."""
import re
from pathlib import Path

ANSWERED = re.compile(r'^relay: .* status 200 .* engine ([a-z-]+)', re.M)
ANY_ANSWER = re.compile(r'^relay: .* status 200 ', re.M)
UNANSWERED = re.compile(r'^relay: .* status (?!200 )(\S+) .*?(?: why (.+))?$', re.M)   # refused (why …) or never reached (status error, no why)
SHORT_CALL = re.compile(r'^relay: small total \d+ broker (\d+) .* status 200 ', re.M)
HUNG_SHORT_MS = 30000   # Why (14 Nov 2026, owner via sa: "Drop the build, fix the measure"; #4100 pair 1 had a 62.9 s title call): a short (small-tier) call over 30 s hung, so the side did not measure the code


def engines_in(text):
    """The engines that answered a call in one log's text, sorted ([] when none): one parser for "ONE engine per search" (Gitar on #4130)."""
    return sorted(set(ANSWERED.findall(text)))


def unanswered_calls(text):
    """How many calls the broker did not answer (refused, or never reached) in one log's text; 0 for no relay line.
    Why (13 Nov 2026, sa; runs 43524290510 / 43524315186 / 43524339782): 358 calls were refused at the paid lane's day cap, which no wait p90 sees."""
    return len(UNANSWERED.findall(text))


def longest_short_ms(text):
    """The longest answered short (small-tier) call of one log's text in ms of AI time at the broker (`broker N`; the queue wait is the waits p90 rule, not this one); 0 for none."""
    return max((int(ms) for ms in SHORT_CALL.findall(text)), default=0)


def calls_by_engine(log):
    """{engine: answered calls} from one log; {} when it names none or there is no log."""
    try:
        text = Path(log).read_text(encoding='utf-8', errors='replace')
    except OSError:
        return {}
    counts = {}
    for engine in ANSWERED.findall(text):
        counts[engine] = counts.get(engine, 0) + 1
    return counts


def not_run(log):
    """The broker's reason when a press's AI never answered (every call refused: Codex and Claude both out, `subs: codex <why>, claude <why>`; or never
    reached: `status error`), else ''.
    Why (10 Nov 2026, sa, WP5 2/6): such a night measured nothing; it is "not run", never a fault or a row of zeros (jobadabra-web #523 draws it as a gap)."""
    try:
        text = Path(log).read_text(encoding='utf-8', errors='replace')
    except OSError:
        return ''
    refused = UNANSWERED.search(text)
    return '' if ANY_ANSWER.search(text) or not refused else (refused.group(2) or f'status {refused.group(1)}').strip()[:200]


def row_fields(out):
    """The row's `calls_by_engine` (the press's answered calls per engine), `judged_by` ("codex", "claude" or "claude + codex") and `not_run` (the reason no call
    was answered), each only when known."""
    press, judge, refused = calls_by_engine(Path(out) / 'run.log'), calls_by_engine(Path(out) / 'judge.log'), not_run(Path(out) / 'run.log')
    return {**({'calls_by_engine': press} if press else {}), **({'judged_by': ' + '.join(sorted(judge))} if judge else {}), **({'not_run': refused} if refused else {})}
