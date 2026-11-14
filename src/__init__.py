# Loaded first by every entry point: .env, then the Desktop App's workspace for anything .env doesn't set.
# run_result registers the process exit that writes the app's result file (one object per command).
from . import paths as _paths  # noqa: F401,E402
from . import run_result as _run_result  # noqa: F401,E402
# The persona search check's tape (src/search_tape.py): only when JOBADABRA_SEARCH_TAPE is set, before any module binds urlopen.
import os as _os  # noqa: E402
if _os.getenv('JOBADABRA_SEARCH_TAPE'):
    from . import search_tape as _search_tape  # noqa: E402
    _search_tape.install()
# A by-hand pair of searches that share pages and AI answers (src/same_inputs.py, tools/persona-search/same-inputs.mjs): only when JOBADABRA_TAPE_SHARED is set.
if _os.getenv('JOBADABRA_TAPE_SHARED'):
    from . import same_inputs as _same_inputs  # noqa: E402
    _same_inputs.install()
