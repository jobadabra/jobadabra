"""The environment every test that runs our tools against tests/fake_gh_rest.py adds: the gh shim's call logs off."""

# Why (14 Nov 2026, rb: the REST log of #4155 held 16,448 lines from one folder and the ship-watch test modules went from 98 s to 370 s on CI): tools/pr-rest-lib.sh puts tools/bin/gh first on PATH, so a
#   fake gh run by a test went through the shim, which spawns about fifteen processes per call to log it (0.19 s against 0.04 s) and wrote the fake calls into the owner's real ~/.cache/jobadabra/gh-rest.log,
#   where gh-rest-report.sh counted them as spent quota. A test that reads a log (test_gh_rest_log.py, test_pr_graphql_fallback.py) sets its own path instead.
NO_GH_LOGS = {'GH_REST_LOG': 'off', 'GH_GRAPHQL_LOG': 'off'}
