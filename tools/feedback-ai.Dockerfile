# The box the AI's code runs in (ai-fixer.yml, job `prove`): node 22, python 3.12, git, nothing else.
# Why (3 Nov 2026, 7/7 Gitar review, owner: "Isolate the proof in a container"): on a hosted runner every step can read the runner's cache token from process memory, so AI-written test code could poison main's cache; inside this box (no network, no capabilities, only the workspace mounted) it sees neither.
# Built from the commit being run, BEFORE the AI's patch is applied, so a patch cannot change this file.
FROM node:22-bookworm-slim AS node
FROM ubuntu:24.04
COPY --from=node /usr/local/ /usr/local/
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
