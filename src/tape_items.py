"""A batched AI question answered one item at a time on a search tape's replay, so a re-ordered press finds its recorded answers (the press's yardstick,
spec docs/superpowers/specs/2026-11-07-the-press-design.md, "Yardstick" 2). A batched call sends one numbered list (`1. <item>` lines) and its answer
is one list: item numbers (`{"fit": [1, 3]}`) or rows that name their item (`{"locations": [{"n": 2, ...}]}`). Recording keeps each item's part
(items.jsonl); a replay whose whole request is not on the tape rebuilds the batch from its items, renumbered, only when every item is there.
Off unless JOBADABRA_TAPE_ITEMS=1: an item answered beside other items may read differently alone, so only the yardstick, which counts these
answers (`ai_rebuilt`), turns it on. Used by src/search_tape.py. Tests: tests/unit/sources/test_tape_items.py."""
import json
import os
import re

ITEM = re.compile(r'^(\d+)\. ', re.M)


def on():
    """True when a replay may rebuild a batch from its items."""
    return os.getenv('JOBADABRA_TAPE_ITEMS') == '1'


def split(content):
    """A question's text -> (prefix, [item texts]) when it holds exactly one list numbered 1..N, else None (two lists, no list, not text)."""
    if not isinstance(content, str):
        return None
    starts = list(ITEM.finditer(content))
    if not starts or [int(m.group(1)) for m in starts] != list(range(1, len(starts) + 1)):
        return None
    ends = [m.start() for m in starts[1:]] + [len(content)]
    return content[:starts[0].start()], [content[m.end():end].strip() for m, end in zip(starts, ends)]


def parts(text, size):
    """An answer's text -> (field, {n: part}) for n in 1..size: for a list of numbers its place in the list (0 = first) or False, the item's rows (without 'n')
    for rows; None for any other shape. Why (Gitar on #3565): a list of numbers may be ranked (web_search's 'keep', best first), so each item keeps its rank."""
    try:
        answer = json.loads(text)
    except (TypeError, ValueError):
        return None
    if not isinstance(answer, dict) or len(answer) != 1:
        return None
    (field, value), = answer.items()
    if not isinstance(value, list):
        return None
    if all(type(v) is int for v in value):
        rank = {}
        for at, n in enumerate(value):
            rank.setdefault(n, at)
        return field, {n: rank.get(n, False) for n in range(1, size + 1)}
    if all(isinstance(v, dict) and type(v.get('n')) is int for v in value):
        rows = {n: [] for n in range(1, size + 1)}
        for v in value:
            if v['n'] in rows:
                rows[v['n']].append({k: x for k, x in v.items() if k != 'n'})
        return field, rows
    return None


def join(field, items):
    """The answer of a batch from its items' parts -> text, or None when the parts are of two shapes. Numbers come back in their recorded rank (items
    of one recorded batch keep their order; ties by the batch's order). An empty list was recorded as False, so False beside rows means no row."""
    if all(part is False or type(part) is int for part in items):
        return json.dumps({field: [n for _, n in sorted((part, n) for n, part in enumerate(items, 1) if part is not False)]})
    if any(type(part) is int for part in items):
        return None
    return json.dumps({field: [{'n': n, **row} for n, part in enumerate(items, 1) for row in (part or [])]}, ensure_ascii=False)


def context(params, prefix):
    """What makes two items the same question besides their own text: the whole request but its list (max_tokens stays: a lower cap may cut a batch off)."""
    rest = {k: v for k, v in params.items() if k != 'messages'}
    return json.dumps([rest, (params.get('messages') or [])[:-1], prefix], sort_keys=True, default=str, ensure_ascii=False)
