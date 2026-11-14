"""The search PR check's blind judge: per job found, "right role?" and "right place?" for the persona, from title, employer and place only (no URL,
no source, no score), shuffled. The same prompt and rules as the benchmark round's judge (jobadabra-benchmarks search-bench/judge.py, 27 Oct 2026),
on the Codex subscription through the same local broker relay as the press; no API key or CLI sign-in is used.
Why (owner, 27 Oct 2026, "Right role + place"): the engine's own "in places" count called 16 jobs right for p3 that the blind judge called 0
(an interior architect for a carpenter); a check that trusts the engine's count can't see the engine get it wrong.
Each list is asked ANSWERS times and the majority per job counts (judge_three.py); the result keeps the answers and names the AI that gave each.
  node tools/persona-search/codex.mjs -- python3 tools/persona-search/gate_judge.py <persona n> <jobs.json> <judged.json>      Tests: tests/tooling/ci/test_judge_majority.py"""
import json
import random
import re
import os
import sys
from urllib.request import Request, urlopen
from urllib.parse import urlparse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from gate import PERSONAS  # noqa: E402
from judge_three import ANSWERS, agreement, answered_three, majority  # noqa: E402

BATCH = 60
MODEL = 'claude-haiku-5-5'   # Why (30 Oct 2026, owner): retain the small tier; the broker maps Haiku to Codex on the ChatGPT plan.
# Why (11 Nov 2026, sa for the owner's "What LLM model does the blind judge use? It is because it uses Haiku instead of Sonnet?" and his "Luna might be very dumb, maybe we
# should a higher intelligence model, or luan with higher reasoning"): a by-hand run may name another tier to measure it (JOBADABRA_JUDGE_TIER, search-personas.yml judge_tier):
# a larger model (mid, large) or the same small one reasoning more (small-high: effort high, which the broker passes to Codex only and counts 2x on the Codex week).
# The night never sets it; making another tier the default is a Scoreboard-change of its own. Each tier: (model, effort or None = Codex's default).
TIERS = {'small': (MODEL, None), 'small-high': (MODEL, 'high'), 'mid': ('claude-sonnet-5-5', None), 'large': ('claude-opus-5-5', None)}
SYSTEM = ('You check a job search for one job seeker. You get their short profile and a numbered list of jobs (title, employer, place). For EACH job decide two things on their own. '
          'role: would a person with this profile see it as their kind of job? yes = same occupation (any seniority, any employer, any language of the title); no = a different occupation. '
          'place: yes = in their city or a short commute from it, or remote and the text names their country; remote = says remote and names no country, or names many countries (a list such as "Remote - Moldova; Remote - Canada; ..." is worldwide remote, never yes); no = another city or country (including remote limited to another country); unknown = no place given. '
          'Judge only from the title, employer and place shown; do not guess beyond them. Answer with JSON only: {"jobs":[{"n":1,"role":"yes|no","place":"yes|remote|no|unknown"}, ...]} covering every number.')


def key(row):
    return (row['title'].strip().lower(), (row.get('company') or '').strip().lower(), (row.get('location') or '').strip().lower())


def ask(profile, jobs, open_url=urlopen, env=None):
    """One blind batch through the wrapper's loopback Codex relay; missing relay or a refused reply fails without another provider."""
    env = os.environ if env is None else env
    base = env.get('ANTHROPIC_BASE_URL', '')
    address = urlparse(base)
    if env.get('JOBADABRA_PERSONA_CODEX') != '1' or address.scheme != 'http' or address.hostname != '127.0.0.1':
        raise ValueError('the judge requires the local Codex relay')
    tier = env.get('JOBADABRA_JUDGE_TIER') or 'small'
    if tier not in TIERS:
        raise ValueError(f'JOBADABRA_JUDGE_TIER "{tier[:20]}" is not one of {sorted(TIERS)}')
    prompt = profile + '\n\nJOBS\n' + '\n'.join(f'{j["n"]}. {j["title"]} | {j["company"] or "?"} | {j["location"] or "(no place)"}' for j in jobs)
    model, effort = TIERS[tier]
    body = {'model': model, 'max_tokens': 8000, 'system': SYSTEM, 'messages': [{'role': 'user', 'content': prompt}], **({'output_config': {'effort': effort}} if effort else {})}
    request = Request(base + '/v1/messages', data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'})
    with open_url(request, timeout=600) as response:
        reply = json.loads(response.read())
    text = ''.join(part.get('text', '') for part in reply['content'] if part.get('type') == 'text')
    data = json.loads(re.search(r'\{.*\}', text, re.S).group(0))
    # Why (11 Nov 2026, cr): the result said "Codex small tier" on 27 of 187 saved calls that Qwen, Haiku or Gemma answered; the relay's reply names the model that did.
    return complete({r['n']: {**r, 'ai': reply.get('model') or '?'} for r in data['jobs']}, jobs)


def complete(got, jobs):
    """The verdicts, or ValueError when the reply left jobs out. Why (gitar on #2243): a left-out job counted as wrong and showed as a search
    drop ("below main's lowest"); now the judge step fails and the result says the judge wrote no verdicts."""
    missing = [j['n'] for j in jobs if j['n'] not in got]
    if missing:
        raise ValueError(f'the judge left out {len(missing)} of {len(jobs)} jobs: {missing[:5]}')
    return got


def judge(n, pool, asker=ask):
    """The pool with role and place set on every row: the majority of ANSWERS answers per distinct job, in a seeded shuffle; each row keeps its answers.
    Why (11 Nov 2026, owner, asked via AskUserQuestion: "Ask 3 times, take the majority (Recommended)"): one answer per job changed its verdict on 11.5% of
    1,406 jobs judged twice for the same person (p9's identical 3-job list: yes ×4 at night, no ×4 at midday); every "right jobs" number rests on the judge."""
    p = PERSONAS[int(n) - 1]
    profile = f'Profile: {p["title"]}, 6 years of experience, living in {p["city"]}, {p["country"]}; on-site or hybrid; speaks {p["language"]} and English.'
    unique = {}
    for row in pool:
        unique.setdefault(key(row), row)
    jobs = list(unique.values())
    random.Random(f'bench-judge-{n}').shuffle(jobs)
    verdicts = {}
    for start in range(0, len(jobs), BATCH):
        chunk = jobs[start:start + BATCH]
        asked = [{'n': i + 1, **{k: j.get(k, '') for k in ('title', 'company', 'location')}} for i, j in enumerate(chunk)]
        replies = answered_three(lambda asked=asked: asker(profile, asked))
        for i, j in enumerate(chunk):
            verdicts[key(j)] = majority([reply.get(i + 1, {}) for reply in replies])
    for row in pool:
        row['role'], row['place'], row['answers'], row['ai'] = verdicts.get(key(row), ('not-judged', 'not-judged', [], ''))
    return {'persona': p, 'judged_jobs': len(jobs), 'model': 'the AI each answer names (rows: ai, answers)', 'tier': os.environ.get('JOBADABRA_JUDGE_TIER') or 'small',
            'answers': ANSWERS, 'agreement': agreement(verdicts.values()), 'billing': 'subscription', 'usd': 0, 'rows': pool}


def judge_pooled(n, runs, asker=ask):
    """The pair's judge: ONE judge() call over the union of every side's jobs, so a job shown on both sides gets one verdict. `runs` = [(side, rows), ...] with side 'main' or 'pr'
    (a side may have several runs); -> [verdict of judge() with that run's own rows, plus `pooled`: {distinct, shown_on_both}], in the order of `runs`.
    Why (14 Nov 2026, sa for the owner, asked via AskUserQuestion: "Should the pair judge each job once and use that verdict on both sides?" "Yes, judge each job once (Recommended)"):
    each side was judged on its own list, so the same job sat in another batch of 60 beside other jobs and its verdict followed the batch: in pair 43604153744 (#4199) 4 jobs shown on
    both sides of b08 read "no" 3 of 3 on main and "yes" 3 of 3 on the PR, same model, so a real +2 read as +6. The prompt, the AI, the answers and the majority are unchanged."""
    pool = [row for _, rows in runs for row in rows]
    whole = judge(n, pool, asker)   # judge() gives every row of the pool its verdict by key: a job on both sides has one
    on = {side: {key(row) for s, rows in runs if s == side for row in rows} for side in ('main', 'pr')}
    shown = len(on['main'] & on['pr'])
    out = []
    for _, rows in runs:
        kept = {key(row): (row['role'], row['place'], row['answers'], row['ai']) for row in rows}
        out.append({**whole, 'rows': rows, 'judged_jobs': len(kept), 'agreement': agreement(kept.values()), 'pooled': {'distinct': whole['judged_jobs'], 'shown_on_both': shown}})
    return out


def main(argv):
    if argv and argv[0] == '--pooled':   # --pooled <n> <jobs.json> <judged.json> [<jobs.json> <judged.json> ...]: the side comes from the folder name <person>--main-1 / <person>--pr-1
        n, files = argv[1], argv[2:]
        if not files or len(files) % 2:
            raise SystemExit('--pooled takes <jobs.json> <judged.json> pairs (Gitar on #4213: an odd list used to drop its last jobs file)')

        def side(path):
            found = re.search(r'--(main|pr)-\d+$', Path(path).resolve().parent.name)
            if not found:
                raise SystemExit(f'--pooled: the folder of {path} must be named <person>--main-<k> or <person>--pr-<k>')
            return found.group(1)
        paths = list(zip(files[::2], files[1::2]))
        runs = [(side(jobs), json.loads(Path(jobs).read_text(encoding='utf-8'))) for jobs, _ in paths]   # every folder checked before any output folder or judge call
        for _, out in paths:
            Path(out).parent.mkdir(parents=True, exist_ok=True)
        try:
            verdicts = judge_pooled(n, runs)
        except Exception as error:   # Why (Gitar on #4213): one batch that fails now fails every side, so the log and the step summary say so; no judged.json is written for any side
            raise SystemExit(f'the pooled judge failed ({type(error).__name__}: {str(error)[:300]}): no side has verdicts') from error
        for (jobs, out), verdict in zip(paths, verdicts):
            Path(out).write_text(json.dumps(verdict, ensure_ascii=False, indent=1), encoding='utf-8')
            print(f"p{n} {Path(jobs).resolve().parent.name}: judged once for both sides ({verdict['pooled']['distinct']} distinct jobs, {verdict['pooled']['shown_on_both']} shown on both); "
                  f"{sum(1 for r in verdict['rows'] if r['role'] == 'yes' and r['place'] == 'yes')} right role and place")
        return
    n, jobs_path, out = argv[:3]
    Path(out).parent.mkdir(parents=True, exist_ok=True)   # a tool makes its own output folder, before the paid judge call, so a bad path fails at once (6 Nov 2026, run 42191804037)
    pool = json.loads(Path(jobs_path).read_text(encoding='utf-8'))
    verdict = judge(n, pool)
    Path(out).write_text(json.dumps(verdict, ensure_ascii=False, indent=1), encoding='utf-8')
    local = sum(1 for r in verdict['rows'] if r['role'] == 'yes' and r['place'] == 'yes')
    split = verdict.get('agreement') or {}
    print(f"p{n}: judge cost ${verdict['usd']:.3f}; judged {verdict['judged_jobs']} distinct jobs, {local} right role and place; "
          f"{split.get('not_unanimous', 0)} of {split.get('jobs', 0)} not unanimous over {ANSWERS} answers; AI: {', '.join(split.get('ai', [])) or 'none'}")


if __name__ == '__main__':
    main(sys.argv[1:])
