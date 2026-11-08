// Every way in gets a job ready through the ONE Apply readiness step (lib/apply-readiness.js): no handler, page or batch drafts a kit or reads a form on its own path.
// Why (8 Nov 2026, owner, R2: "every Apply goes through Apply readiness"; spec docs/superpowers/specs/2026-11-07-apply-readiness-design.md): three paths drafted kits their own way and the Apply press never read the form first.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const root = new URL('../../../', import.meta.url);
const read = file => fs.readFileSync(new URL(file, root), 'utf8');
const walk = dir => fs.readdirSync(new URL(dir, root), {withFileTypes: true}).flatMap(entry =>
  entry.isDirectory() ? walk(`${dir}${entry.name}/`) : /\.(c?js|mjs)$/.test(entry.name) ? [`${dir}${entry.name}`] : []);
const FILES = ['main.js', 'preload.cjs', ...walk('lib/'), ...walk('renderer/')];

// What drafts a kit or reads a form directly -> the only places allowed to, with how many times.
const DIRECT = [
  {what: 'a kit draft (prepareKitFor)', pattern: /\bprepareKitFor\(/g, allowed: {'lib/apply-handlers.js': 1}},   // the one wiring of the step (createReadiness)
  {what: "the engine's kit run (mode 'prepare')", pattern: /mode: 'prepare'/g, allowed: {'lib/kit-handlers.js': 1}},   // prepareKitFor's own body
  // TODO(AI): the Always on branch of Prepare top matches still runs the engine's kits mode until the cloud browser runner takes the check (8 Nov 2026).
  {what: "the engine's top-matches kits run (mode 'kits')", pattern: /mode: 'kits'/g, allowed: {'lib/job-actions-handlers.js': 1}},
  {what: 'a form read in the hidden browser (triageRead)', pattern: /\.triageRead\b/g, allowed: {'lib/apply-handlers.js': 1}},   // the step's readForm
  {what: "the window's old kit call (pilot.prepareKit)", pattern: /\bprepareKit: call\(|pilot\.prepareKit\(/g, allowed: {}},
];

test('nothing but the Apply readiness step drafts a kit or reads a form', () => {
  const seen = new Map();
  for (const file of FILES) {
    const text = read(file);
    for (const {what, pattern, allowed} of DIRECT) {
      const count = (text.match(pattern) || []).length;
      if (count) seen.set(`${what} in ${file}`, count);
      assert.ok(count <= (allowed[file] || 0), `${file} has ${count} × ${what}: get the job ready through Apply readiness (lib/apply-readiness-registry.js readinessOf, or the applyReadiness call) instead`);
    }
  }
  assert.equal(seen.get('a kit draft (prepareKitFor) in lib/apply-handlers.js'), 1, `the scan reads the step's own wiring (positive control): ${[...seen.keys()]}`);
  assert.equal(seen.get('a form read in the hidden browser (triageRead) in lib/apply-handlers.js'), 1, 'the scan finds the form read the step is built with (positive control)');
});

test('the batch, Ready to send and Prepare top matches reach the step, not a kit draft', () => {
  assert.match(read('lib/apply-handlers.js'), /job => readiness\.applyReadiness\(jobOf\(job\)\)\.then\(done => done\.kit\)/, 'the Apply batch drafts through the step');
  assert.match(read('lib/kit-handlers.js'), /prepare: \{kit: job => readyThroughStep\(storage, job\)/, "Ready to send's night drafts through the step");
  assert.match(read('lib/job-actions-handlers.js'), /readiness\.applyReadiness\(/, 'Prepare top matches goes through the step on this Mac');
});
