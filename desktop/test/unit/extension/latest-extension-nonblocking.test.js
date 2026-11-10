// A development copy's check-in never waits for git: latestExtension() answers at once, whatever git is doing (hw, 10 Nov 2026).
// Why (10 Nov 2026, hw): the owner runs the app from source; every check-in re-ran the git commit count synchronously (devVersion's 20 s cache is shorter than the
// 30 s between check-ins), and a CPU profile of the main thread put 3.4 s of a 4 s stall inside it (lib/dev-extension-version.js -> latestExtension -> handleTabs). Test: a git that takes 700 ms.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';

test('latestExtension answers at once in a development copy while git is slow, and the stamped version follows when git answers', {skip: process.platform === 'win32' && 'the stand-in git is a shell script'}, async () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-slowgit-'));
  fs.writeFileSync(path.join(bin, 'git'), '#!/bin/sh\nsleep 0.7\ncase "$*" in *--is-shallow-repository*) echo false;; *rev-parse*) echo aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa;; *log*) for n in 1 2 3; do echo "${n}aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 2026-10-16T14:02:00Z"; done;; *) ;; esac\n', {mode: 0o755});

// A copy that reloaded for the stamped version is newer than the bare manifest version a development copy reports before git answers: never "older" (review of the same change).
test('a reloaded development copy is not called older while the app still reports the bare manifest version', async () => {
  const {staleExtension} = await import('../../../lib/server-env.js');
  assert.equal(staleExtension('0.9.150', '0.9'), '');
  assert.match(staleExtension('0.9', '0.9.150'), /older than this app's 0\.9\.150/);
});
  const kept = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${kept}`;
  try {
    const {latestExtension} = await import('../../../lib/server-env.js');
    const {whenCheckoutCommits} = await import('../../../lib/build-state.js');
    const began = Date.now();
    const first = latestExtension();
    const took = Date.now() - began;
    assert.ok(took < 300, `latestExtension waited ${took} ms for git (a check-in is the app's whole event loop)`);
    assert.match(first, /^\d+\.\d+(\.\d+)?$/, 'the manifest version stands until git has answered');
    await whenCheckoutCommits(path.resolve(import.meta.dirname, '..', '..', '..', '..'));
    assert.match(latestExtension(), /^\d+\.\d+\.3$/, 'when git has answered, the stamped version is the manifest base and the count of commits that changed extension/');
  } finally { process.env.PATH = kept; fs.rmSync(bin, {recursive: true, force: true}); }
});
