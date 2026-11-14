"""The one hang guard of every test that runs tools/ship-watch.sh as a real subprocess (not a test)."""

# Why (14 Nov 2026, flaky: lg's #4184, run 43600785799; the files did not change since 102e6bb8): the watcher is a bash loop that spawns gh/jq/python per look, so its wall time follows the
#   load of the CI shard (a 192 s shard that day); a 30 s limit killed it mid-run. It ends itself when the fake PR reads CLOSED, so the limit is only a guard against a hang, never the clock of the test.
WATCH_HANG_GUARD_S = 300
