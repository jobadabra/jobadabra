"""The blind judge's majority of three: each list asked ANSWERS times at once, the verdict per job is the answer at least 2 agree on, never a guess.
Owner, 11 Nov 2026 (asked via AskUserQuestion by sa: "Ask 3 times, take the majority (Recommended)"): one answer per job changed its verdict on 11.5% of 1,406 jobs
judged twice for the same person, and every "right jobs" number rests on it. Used by gate_judge.judge (the night, the market count).
Guard: tests/tooling/ci/test_judge_majority.py."""
import concurrent.futures

ANSWERS = 3
AGREE = 2     # the fewest answers that make a verdict: two failed calls (one answer left) or a three-way place split leave the job unjudged
ROLE = ('yes', 'no')
PLACE = ('yes', 'remote', 'no', 'unknown')
UNJUDGED = 'not-judged'   # what every reader already counts as unjudged, never right (verdicts.py)


def answered_three(ask_once):
    """The replies of ANSWERS calls of `ask_once()` made at once (the step takes one call's time, not three); a failed call is dropped.
    Fewer than AGREE replies raise the first failure: the judge step fails as one failed call did before, never a verdict from one answer."""
    with concurrent.futures.ThreadPoolExecutor(max_workers=ANSWERS) as pool:
        calls = [pool.submit(ask_once) for _ in range(ANSWERS)]
    replies, failures = [], []
    for call in calls:
        try:
            replies.append(call.result())
        except Exception as error:   # noqa: BLE001  any failed call is one lost answer; too few answers re-raise it below
            failures.append(error)
    if len(replies) < AGREE:
        raise failures[0]
    return replies


def _vote(values, allowed):
    """The value at least AGREE answers gave, else UNJUDGED."""
    counted = {value: values.count(value) for value in allowed}
    best = max(counted, key=counted.get)
    return best if counted[best] >= AGREE else UNJUDGED


def majority(answers):
    """One job's answers ([{role, place, ai}, ...]) -> (role, place, [[role, place, ai], ...], ai): role and place each by majority on their own;
    `ai` is the model that answered, or several joined by " + " when the answers came from different AIs (a fallback mid-run)."""
    kept = [[a.get('role'), a.get('place'), a.get('ai') or '?'] for a in answers if a]
    names = list(dict.fromkeys(ai for _, _, ai in kept))
    return (_vote([r for r, _, _ in kept], ROLE), _vote([p for _, p, _ in kept], PLACE), kept, ' + '.join(names))


def agreement(verdicts):
    """Over the judged jobs' majority() results: how many jobs, how many whose answers were not all the same (role or place), each part apart,
    how many had fewer than ANSWERS answers, and the AIs that answered. This is the judge's own flip rate, measured by every run for free."""
    out = {'jobs': 0, 'not_unanimous': 0, 'role_split': 0, 'place_split': 0, 'short': 0, 'ai': []}
    for _, _, kept, ai in verdicts:
        out['jobs'] += 1
        roles, places = {r for r, _, _ in kept}, {p for _, p, _ in kept}
        out['role_split'] += len(roles) > 1
        out['place_split'] += len(places) > 1
        out['not_unanimous'] += len(roles) > 1 or len(places) > 1
        out['short'] += len(kept) < ANSWERS
        for name in ai.split(' + '):
            if name and name not in out['ai']:
                out['ai'].append(name)
    return out
