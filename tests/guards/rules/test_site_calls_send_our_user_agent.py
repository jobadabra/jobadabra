"""Guard: release — a call to our own site without our user agent is refused by Cloudflare (403 1010, before the Worker) and fails only live, never in a test that stubs urlopen.
Why (13 Nov 2026, sa and bp; four escapes: trial.py 5 Nov (hr 6/6 try 5), the benchmark's broker.py, the 12-13 Nov live read that hid a 403 1010, and #4042's reported-boards read that left
the Scout reading no reported board in discovery run 43516854672): every function that builds a urllib Request in src/ or tools/persona-search must set User-Agent unless its file is listed as calling another service (`ats.USER_AGENT` or a module's own)."""
import ast
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
FOLDERS = ('src', 'tools/persona-search')
# Files whose Requests go to another service's own endpoint (an AI provider, Notion, Google, Telegram, the app's own local renderer, a crash reporter, the persona tools' own judges), not to our site.
# Why (#4116, Gitar: a filter on words naming our site skipped scout_index.py and scout_carry.py, which get the site's URL passed in): every file is scanned and only these are exempt, so a new
# caller of our site passes only with an agent. The list only shrinks: a file that no longer builds a Request without an agent must leave it (test below).
OTHER_SERVICES = {
    'src/ai/providers/contract.py', 'src/crash_reporting.py', 'src/daily_helpers.py', 'src/notion/client.py', 'src/sources/google.py', 'src/sources/google_auth.py', 'src/sources/render.py',
    'src/telegram.py', 'tools/persona-search/claim.py', 'tools/persona-search/gate_judge.py', 'tools/persona-search/market_web.py',
}


def python_files():
    listed = subprocess.run(['git', 'ls-files', *FOLDERS], cwd=ROOT, capture_output=True, text=True, check=True).stdout.split()
    return [name for name in listed if name.endswith('.py') and 'Request(' in (ROOT / name).read_text(encoding='utf-8', errors='replace')]


def own_code(function):
    """Every AST node of `function`'s own code: its docstring and nested functions are left out, and comments never reach the AST."""
    body = function.body[1:] if function.body and isinstance(function.body[0], ast.Expr) and isinstance(function.body[0].value, ast.Constant) and isinstance(function.body[0].value.value, str) else function.body
    stack = list(body)
    while stack:
        node = stack.pop()
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            continue
        yield node
        stack.extend(ast.iter_child_nodes(node))


def names_agent(nodes):
    """True when `nodes` hold a *USER_AGENT* name or a 'User-Agent' string."""
    nodes = list(nodes)
    return any('USER_AGENT' in (node.id if isinstance(node, ast.Name) else node.attr) for node in nodes if isinstance(node, (ast.Name, ast.Attribute))) \
        or any(isinstance(node, ast.Constant) and isinstance(node.value, str) and node.value.lower() == 'user-agent' for node in nodes)


def agent_put_in(nodes, name):
    """True when the agent is put into the very name passed as headers: `name = {...}`, `name['User-Agent'] = ...` or `name.update(...)`/`setdefault(...)` holding it."""
    for node in nodes:
        targets = node.targets if isinstance(node, ast.Assign) else [node.target] if isinstance(node, (ast.AnnAssign, ast.AugAssign)) else []
        for target in targets:
            base = target.value if isinstance(target, ast.Subscript) else target
            if isinstance(base, ast.Name) and base.id == name and names_agent(ast.walk(node)):
                return True
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr in ('update', 'setdefault') and isinstance(node.func.value, ast.Name) and node.func.value.id == name and names_agent(ast.walk(node)):
            return True
    return False


def requests_without_agent(path=None, text=None):
    """[(function, line)] of every function in `path` (or in `text`) that builds a urllib Request (`urllib.request.Request(` or a bare `Request(`) whose own arguments do not carry the agent:
    a 'User-Agent' string or a *USER_AGENT* name inside the call, or headers that are a name this function puts the agent into, or a call to a function of this file that sets it.
    Why (#4094 and #4120, Gitar): a text search let a comment, a docstring or a nested function's agent pass; and a User-Agent anywhere in the function let one that only fed a log line or a JSON body pass."""
    tree = ast.parse(text if text is not None else path.read_text(encoding='utf-8', errors='replace'))
    functions = {node.name: node for node in ast.walk(tree) if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))}
    found = []
    for function in functions.values():
        nodes = list(own_code(function))
        for call in (node for node in nodes if isinstance(node, ast.Call) and ast.unparse(node.func) in ('Request', 'request.Request', 'urllib.request.Request')):
            given = [keyword.value for keyword in call.keywords if keyword.arg == 'headers'] + call.args[2:3]   # only the headers: an agent in the body or a log line is no agent
            inside = [node for value in given for node in ast.walk(value)]
            fed_by = [node.func.id for node in inside if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in functions]   # headers=_headers(env)
            by_name = any(isinstance(value, ast.Name) and agent_put_in(nodes, value.id) for value in given)   # headers=headers: the agent goes into that very name (Gitar on #4121)
            if not (names_agent(inside) or by_name or any(names_agent(own_code(functions[name])) for name in fed_by)):
                found.append((function.name, call.lineno))
    return found


class SiteCallsSendOurUserAgent(unittest.TestCase):
    def test_the_guard_sees_the_files_that_call_our_site(self):
        names = {Path(name).name for name in python_files()}
        self.assertTrue({'employer_index.py', 'scout_board_candidates.py', 'report_boards.py', 'scout_index.py', 'scout_carry.py'} <= names, names)

    def test_the_guard_flags_both_spellings_of_a_request_and_passes_one_with_an_agent(self):
        bare = 'from urllib.request import Request\ndef a(u):\n    return Request(u, headers={})\n'
        dotted = 'import urllib.request\ndef b(u):\n    return urllib.request.Request(u)\n'
        fine = 'import urllib.request\ndef c(u):\n    return urllib.request.Request(u, headers={"User-Agent": "x"})\n'
        self.assertEqual([name for name, _ in requests_without_agent(text=bare)], ['a'])
        self.assertEqual([name for name, _ in requests_without_agent(text=dotted)], ['b'])
        self.assertEqual(requests_without_agent(text=fine), [])

    def test_a_comment_a_docstring_or_a_nested_function_does_not_count_as_an_agent(self):
        comment = 'import urllib.request\ndef d(u):\n    # Why: Cloudflare 403 1010 needs User-Agent\n    return urllib.request.Request(u)\n'
        docstring = 'import urllib.request\ndef e(u):\n    """Sends USER_AGENT."""\n    return urllib.request.Request(u)\n'
        nested = 'import urllib.request\ndef f(u):\n    def g():\n        return {"User-Agent": "x"}\n    return urllib.request.Request(u)\n'
        for name, text in (('d', comment), ('e', docstring), ('f', nested)):
            self.assertEqual([found for found, _ in requests_without_agent(text=text)], [name], name)

    def test_only_the_headers_count_and_a_helper_of_the_same_file_may_set_them(self):
        body = 'import urllib.request, json, ats\ndef h(u):\n    return urllib.request.Request(u, data=json.dumps({"user_agent": ats.USER_AGENT}).encode(), headers={"X": "1"})\n'
        helper = 'import urllib.request\ndef _headers():\n    return {"User-Agent": "x"}\ndef i(u):\n    return urllib.request.Request(u, headers=_headers())\n'
        by_name = 'import urllib.request\ndef j(u):\n    headers = {"User-Agent": "x"}\n    return urllib.request.Request(u, headers=headers)\n'
        self.assertEqual([name for name, _ in requests_without_agent(text=body)], ['h'], 'an agent in the JSON body is no agent in the headers')
        self.assertEqual(requests_without_agent(text=helper), [])
        self.assertEqual(requests_without_agent(text=by_name), [])

    def test_a_headers_name_counts_only_when_the_agent_goes_into_it(self):
        log = 'import urllib.request, logging, ats\ndef k(u):\n    headers = {"X": "1"}\n    logging.info(ats.USER_AGENT)\n    return urllib.request.Request(u, headers=headers)\n'
        item = 'import urllib.request\ndef m(u):\n    headers = {}\n    headers["User-Agent"] = "x"\n    return urllib.request.Request(u, headers=headers)\n'
        update = 'import urllib.request\ndef n(u):\n    headers = {}\n    headers.update({"User-Agent": "x"})\n    return urllib.request.Request(u, headers=headers)\n'
        self.assertEqual([name for name, _ in requests_without_agent(text=log)], ['k'], 'an agent in a log line is no agent in the headers')
        self.assertEqual(requests_without_agent(text=item), [])
        self.assertEqual(requests_without_agent(text=update), [])

    def test_every_request_outside_the_other_services_sets_a_user_agent(self):
        missing = [f'{name}:{line} {function}' for name in python_files() if name not in OTHER_SERVICES for function, line in requests_without_agent(ROOT / name)]
        self.assertEqual(missing, [], 'a urllib Request without our User-Agent: Cloudflare answers 403 1010 live (use ats.USER_AGENT), or add the file to OTHER_SERVICES if it calls another service')

    def test_the_other_services_list_only_shrinks(self):
        stale = sorted(name for name in OTHER_SERVICES if not requests_without_agent(ROOT / name))
        self.assertEqual(stale, [], 'these files now send an agent (or no longer build a Request): remove them from OTHER_SERVICES')


if __name__ == '__main__':
    unittest.main()
