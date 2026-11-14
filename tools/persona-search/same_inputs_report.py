"""Read a same-inputs pair (tools/persona-search/same-inputs.mjs): LISTED / READ / RIGHT in three cells (both / only A / only B), the blind judge run once over both lists, and the log counts.
Usage: python3 tools/persona-search/same_inputs_report.py <work folder the runner printed> <profile id> [--no-judge]
The judge is the locked one (gate_judge.judge: role AND place, 3 answers, majority) asked through the Claude plan's own Claude Code (engine `cli`): no API key, no broker, never the production account.
Why (14 Nov 2026, owner via sa): one judge pass over the union of both lists, so a job both sides list is judged once and the two sides' RIGHT cells compare like with like."""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)
import inout  # noqa: E402

work, pid = sys.argv[1], sys.argv[2]
SIDES = 'ab'
side = {s: json.load(open(os.path.join(work, s, 'jobs.json'), encoding='utf-8')) for s in SIDES}


def cells(a, b):
    """'both / only a / only b' counts of two sets, as one cell of the report."""
    return f'{len(a & b)} / {len(a - b)} / {len(b - a)}'


def judge_once():
    """The union of both lists through the locked judge, written to <work>/judged.json; returns the set of keys judged right in role and place."""
    for name in list(os.environ):
        if name.endswith('_API_KEY') or name in ('ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL'):
            del os.environ[name]
    os.environ.update(JOBADABRA_AI_ENGINE='cli', JOBADABRA_NO_DOTENV='1')
    import gate_judge
    import profiles
    from src.ai import providers
    client, model = providers.build(dict(os.environ), 'same-inputs-judge'), gate_judge.TIERS[os.environ.get('JOBADABRA_JUDGE_TIER') or 'small'][0]

    def ask(profile, jobs, **_):
        prompt = profile + '\n\nJOBS\n' + '\n'.join(f'{j["n"]}. {j["title"]} | {j["company"] or "?"} | {j["location"] or "(no place)"}' for j in jobs)
        reply = client.messages.create(model=model, max_tokens=8000, system=gate_judge.SYSTEM, messages=[{'role': 'user', 'content': prompt}])
        data = json.loads(re.search(r'\{.*\}', ''.join(b.text for b in reply.content if getattr(b, 'type', 'text') == 'text'), re.S).group(0))
        return gate_judge.complete({r['n']: {**r, 'ai': getattr(reply, 'model', '') or '?'} for r in data['jobs']}, jobs)

    gate_judge.PERSONAS = [profiles.for_judge(p) for p in profiles.PROFILES]
    # judge_pooled is the pair's one pass over the union (a job on both lists has one verdict); only the asker differs: this one speaks to the plan's Claude Code, not the broker
    verdicts = gate_judge.judge_pooled(profiles.IDS.index(pid) + 1, [('main', side['a']), ('pr', side['b'])], asker=ask)
    rows = [{k: v for k, v in r.items() if k != 'answers'} for verdict in verdicts for r in verdict['rows']]
    json.dump({'rows': rows, 'agreement': verdicts[0]['agreement']}, open(os.path.join(work, 'judged.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    return {gate_judge.key(r) for r in rows if r['role'] == 'yes' and r['place'] == 'yes'}, gate_judge.key


listed = {s: {j.get('url') or f"{j['title']}|{j['company']}": j for j in side[s]} for s in SIDES}
stages, never = {}, {}
for s in SIDES:
    logs = [os.path.join(d, f) for d, _, files in os.walk(os.path.join(work, s)) for f in files if f == 'run-1.log']
    stages[s] = (inout.stages(logs[0]) if logs else None) or {}   # a run cut before its first stage line has none: READ 0, not a crash
    never[s] = sum(1 for st in stages[s].values() if all(x == 'read' for x in st))
L = {s: set(listed[s]) for s in SIDES}
# Why (14 Nov 2026, sa, owner's pair rule): "the search's time was up before Claude Code had a free slot" (src/ai/providers/cli_base.py) is the engine's own clock rule, hit alike by both sides, not a fault: it is a count per side, flagged only when the sides differ by more than 3.
# A pair is NOT VALID for any other failed call (plan refused, no valid JSON, no answer in N s) and for one whose text is not in the log (a build without the same-inputs text capture).
from src.ai.providers.cli_base import CLOCK_UP as CLOCK  # noqa: E402  (the engine owns the words of its clock rule)
failed = {}
for s in SIDES:
    texts = [open(os.path.join(d, f), errors='replace').read() for d, _, files in os.walk(os.path.join(work, s)) for f in files if f == 'run-1.log']
    failed[s] = [line for text in texts for line in text.splitlines() if 'Technical: ' in line]   # every line contract.detail writes is a failed AI call, whatever its exception class (RuntimeError, JSONDecodeError, an SDK error)
clock = {s: [line for line in failed[s] if CLOCK in line] for s in SIDES}
other = {s: [line for line in failed[s] if CLOCK not in line] for s in SIDES}
gap = abs(len(clock['a']) - len(clock['b']))
verdict = 'NOT VALID' if any(other.values()) else 'valid, clock-rule gap over 3 (flag)' if gap > 3 else 'valid'
print(f'{pid}: {verdict}: AI calls failed A {len(failed["a"])} (clock rule {len(clock["a"])}, other {len(other["a"])}), B {len(failed["b"])} (clock rule {len(clock["b"])}, other {len(other["b"])})')
for s in SIDES:
    for line in other[s][:3]:
        print(f'  failed {s.upper()} (not the clock rule): {line[:200]}')
print(f'{pid}: LISTED both / only A / only B: {cells(L["a"], L["b"])}')
print(f'{pid}: READ   both / only A / only B: {cells(*({u for u in stages[s]} for s in SIDES))}   (read, never judged: A {never["a"]}, B {never["b"]})')
if '--no-judge' not in sys.argv:
    try:
        right, key = judge_once()
    except Exception as error:   # an unreadable or partial judge answer is a failure the report shows, never a half-filled RIGHT row
        print(f'{pid}: RIGHT  judge failed ({type(error).__name__}: {str(error)[:160]}); LISTED and READ above stand, no RIGHT cell')
    else:
        K = {s: {key(r) for r in side[s]} for s in SIDES}
        R = {s: K[s] & right for s in SIDES}
        print(f'{pid}: RIGHT  both / only A / only B: {cells(R["a"], R["b"])}   (right A {len(R["a"])}, B {len(R["b"])}; listed A {len(K["a"])}, B {len(K["b"])})')
        for s, o in (('a', 'b'), ('b', 'a')):
            for k in sorted(R[s] - R[o]):
                print(f'  right only {s.upper()}: {k[0][:50]} | {k[1][:24]} | {k[2][:24]}')
for s in SIDES:
    for d, _, files in os.walk(os.path.join(work, s)):
        if 'run-1.log' in files:
            text = open(os.path.join(d, 'run-1.log'), errors='replace').read()
            print(f'{pid}: side {s.upper()}: "sent nothing for" {text.count("sent nothing for")} · "Board pass: owed" {text.count("Board pass: owed")}')
