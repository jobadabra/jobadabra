#!/usr/bin/env bash
# Runs one command inside the proof box (tools/feedback-ai.Dockerfile) and returns its exit code. The only way ai-fixer.yml runs the AI's code.
# Why (3 Nov 2026, 7/7 Gitar review): no network (the cache service and the runner's token are unreachable), no capabilities, not root, no GitHub environment variable (only the ones named below),
# our script copy read-only; the box's own copy of the workspace is the only thing it can write, and the job never publishes from it (`publish` starts from a fresh checkout and the scanned patch).
# Needs: FBT (our script copy), PYDEPS (python packages installed before the patch), BOX (a COPY of the patched workspace, made by the workflow; the runner never reads or writes anything inside it:
# a symlink or a .git/config the AI plants there would otherwise run on the runner, 7/7 Gitar review, 3 Nov 2026).
set -euo pipefail
: "${FBT:?FBT is the folder with our copy of tools/feedback-ai.mjs}" "${PYDEPS:?PYDEPS is the folder with the python packages}" "${BOX:?BOX is the copy of the workspace the box may write}"
# Why (5 Nov 2026, run 41966155152): reap orphaned children; npm/Python as PID 1 leaves zombie PIDs that make lifecycle tests falsely report a live process.
exec docker run --rm --init --network none --cap-drop ALL --security-opt no-new-privileges --pids-limit 4096 --memory 6g \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp -e PYTHONPATH=/pydeps -e CI=true \
  -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory -e GIT_CONFIG_VALUE_0=/w \
  -v "$BOX":/w -v "$FBT":/fbt:ro -v "$PYDEPS":/pydeps:ro -w /w \
  fd-ai-proof "$@"
