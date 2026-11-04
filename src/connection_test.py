"""The checks behind Always on's Test button: python -m src selftest github|notion|ai (owner, 4 Nov 2026: "a test button that will do a simple test of the e2e flow").

The workflow's `test` job (.github/workflows/daily.yml) runs the three checks as three steps in the user's own repository, with the secrets that run really uses,
so a wrong copy of a secret shows up here and not on the first real search. Nothing is searched, written or sent: Notion is only read, the AI gets one
tiny question (well under a cent on the user's own key), GitHub is only asked which secrets arrived. Each check prints one plain line, exits 1 when it failed,
and adds itself to selftest.json (an artifact), which the app reads to say which step failed and why. Never prints or stores a secret's value.
Guarded by tests/unit/engine/test_connection_test.py.
"""
import json
import os
import sys
import urllib.error
from pathlib import Path

RESULT_FILE = Path('selftest.json')
STEPS = ('github', 'notion', 'ai')
AI_SECRETS = {'api': 'ANTHROPIC_API_KEY', 'openai': 'OPENAI_API_KEY'}


def ai_secret_name(env):
    """The secret the chosen engine needs, named as providers.choice reads the choice (trimmed, lower case, anything unknown means api)."""
    engine = (env.get('JOBADABRA_AI_ENGINE') or 'api').strip().lower()
    return AI_SECRETS.get(engine, AI_SECRETS['api'])


def check_github(env=None):
    """(ok, line): did the repository hand this run its Notion token, its Notion database id and the AI key of the engine the user chose?"""
    env = os.environ if env is None else env
    wanted = ['NOTION_TOKEN', 'NOTION_APPLICATIONS_DB', ai_secret_name(env)]
    missing = [name for name in wanted if not env.get(name)]
    if missing:
        return False, f'GitHub started the run, but this repository has no {" and no ".join(missing)}. Turn Always on on again in the app to copy it.'
    return True, 'GitHub started the run with your Notion token, your jobs database and your AI key.'


def check_notion(tracker=None):
    """(ok, line): does the Notion token work, and can it read the jobs database? Reads only."""
    from . import features
    if tracker is None and features.disabled('notion'):
        return False, 'Notion is switched off in this repository (the JOBADABRA_DISABLE variable). Always on needs it; remove it there, then press Test again.'
    if tracker is None:
        from .notion.client import Tracker
        tracker = Tracker.from_env()
    if tracker is None:
        return False, 'No Notion token reached this run. Connect Notion in the app, then press Test again.'
    if not tracker.database_id:
        return False, 'This repository has no Notion jobs database set. Turn Always on on again in the app to copy it.'
    try:
        tracker._request('GET', 'users/me')
    except urllib.error.HTTPError as error:
        return False, 'Notion refused the token (401). Connect Notion again in the app.' if error.code == 401 else f'Notion answered {error.code} to the token check.'
    except Exception as error:  # noqa: BLE001 — any failure to reach Notion is the one answer "could not be reached"
        return False, f'Notion could not be reached ({type(error).__name__}).'
    try:
        tracker._request('GET', f'databases/{tracker.database_id}')
    except urllib.error.HTTPError as error:
        if error.code in (400, 404):
            return False, 'Notion answers, but your jobs database is not shared with Jobadabra. Connect Notion again in the app.'
        return False, f'Notion answered {error.code} when reading your jobs database.'
    except Exception as error:  # noqa: BLE001
        return False, f'Notion could not be reached ({type(error).__name__}).'
    return True, 'Notion answered and your jobs database can be read.'


def check_ai(client=None, env=None):
    """(ok, line): does the user's own AI key answer one tiny question? The only check that spends anything (their key, a fraction of a cent)."""
    env = os.environ if env is None else env
    if not env.get(ai_secret_name(env)):
        return False, 'No AI key reached this run. Turn Always on on again in the app to copy it.'
    if client is None:
        from .ai import engine
        try:
            # Why (4 Nov 2026): no step name: this call is on the user's own key and never through Free AI, so it has no cost line to name (ACTIONS is Free AI's list).
            client = engine.client(env, action='')
        except Exception as error:  # noqa: BLE001 — a missing SDK or key is a failed check, not a crash
            return False, f'The AI engine could not start ({type(error).__name__}).'
    from .ai.models import SMALL_MODEL
    try:
        client.messages.create(model=SMALL_MODEL, max_tokens=1000, messages=[{'role': 'user', 'content': 'Reply with the word ok.'}])
    except Exception as error:  # noqa: BLE001 — the provider's answer is what the person needs to read
        text = str(error)
        refused = any(word in text.lower() for word in ('401', 'invalid x-api-key', 'incorrect api key'))
        return False, 'Your AI key was refused (401). Paste a working key in the app, then press Test again.' if refused else f'Your AI key did not answer ({type(error).__name__}).'
    # Why (4 Nov 2026, review): any answer proves the key is accepted; a model that spends its whole allowance thinking returns no text, which is not a failure.
    return True, 'Your AI key answered.'


def record(step, ok, line, path=None):
    """Adds one step's verdict to the result file the workflow uploads (RESULT_FILE, read at call time). Returns the whole document."""
    path = path or RESULT_FILE
    data = json.loads(path.read_text()) if path.exists() else {'steps': {}}
    data['steps'][step] = {'ok': ok, 'line': line}
    path.write_text(json.dumps(data, indent=2))
    return data


def main(argv=None):
    args = sys.argv[1:] if argv is None else argv
    step = args[0] if args else ''
    if step not in STEPS:
        print(f'usage: python -m src selftest {"|".join(STEPS)}', file=sys.stderr)
        return 2
    ok, line = {'github': check_github, 'notion': check_notion, 'ai': check_ai}[step]()
    record(step, ok, line)
    print(f'{"✅" if ok else "❌"} {line}')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
