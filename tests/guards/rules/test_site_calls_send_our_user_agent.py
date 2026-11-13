"""Guard: release — a call to our own site without our user agent is refused by Cloudflare (403 1010, before the Worker) and fails only live, never in a test that stubs urlopen.
Why (13 Nov 2026, sa and bp; four escapes: trial.py 5 Nov (hr 6/6 try 5), the benchmark's broker.py, the 12-13 Nov live read that hid a 403 1010, and #4042's reported-boards read that left
the Scout reading no reported board in discovery run 43516854672): every function that builds a urllib Request in a file that names our site must set User-Agent (`ats.USER_AGENT` or a module's own)."""
import ast
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SITE_WORDS = ('jobadabra.top', 'JOBADABRA_SITE_URL', 'JOBADABRA_INDEX_URL', 'service.SITE', 'employer_index.URL')
FOLDERS = ('src', 'tools/persona-search')


def site_files():
    listed = subprocess.run(['git', 'ls-files', *FOLDERS], cwd=ROOT, capture_output=True, text=True, check=True).stdout.split()
    return [ROOT / name for name in listed if name.endswith('.py') and any(word in (ROOT / name).read_text(encoding='utf-8', errors='replace') for word in SITE_WORDS)]


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


def requests_without_agent(path=None, text=None):
    """[(function, line)] of every function in `path` (or in `text`) whose own code builds a urllib Request, as `urllib.request.Request(` or a bare `Request(` after `from urllib.request import Request`, and never sets User-Agent in code (a 'User-Agent' string or a *USER_AGENT* name).
    Why (#4094, Gitar): a text search let a comment, a docstring or a nested function's agent pass a Request built without one."""
    text = text if text is not None else path.read_text(encoding='utf-8', errors='replace')
    found = []
    for function in ast.walk(ast.parse(text)):
        if not isinstance(function, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        nodes = list(own_code(function))
        makes = any(isinstance(node, ast.Call) and ast.unparse(node.func) in ('Request', 'request.Request', 'urllib.request.Request') for node in nodes)
        names = [node.id if isinstance(node, ast.Name) else node.attr for node in nodes if isinstance(node, (ast.Name, ast.Attribute))]
        strings = [node.value for node in nodes if isinstance(node, ast.Constant) and isinstance(node.value, str)]
        sets_agent = any('USER_AGENT' in name for name in names) or any(value.lower() == 'user-agent' for value in strings)
        if makes and not sets_agent:
            found.append((function.name, function.lineno))
    return found


class SiteCallsSendOurUserAgent(unittest.TestCase):
    def test_the_guard_sees_the_files_that_call_our_site(self):
        names = {path.name for path in site_files()}
        self.assertTrue({'employer_index.py', 'scout_board_candidates.py', 'report_boards.py'} <= names, names)

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

    def test_every_request_to_a_file_that_names_our_site_sets_a_user_agent(self):
        missing = [f'{path.relative_to(ROOT)}:{line} {name}' for path in site_files() for name, line in requests_without_agent(path)]
        self.assertEqual(missing, [], 'a urllib Request without our User-Agent: Cloudflare answers 403 1010 live (use ats.USER_AGENT)')


if __name__ == '__main__':
    unittest.main()
