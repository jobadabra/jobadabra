#!/usr/bin/env node
// Keeps the ONE "Claude: …" label of a PR in step with the Claude review of its head; READY (tools/ship-watch.sh) and the owner's PR list read it. Usage: GITHUB_REPOSITORY=o/r node tools/claude-label.mjs <pr>
// Why (owner, 13 Nov 2026: "We should replace Gitar" / "With Claude Code review"; coordinator mac-95: READY needs the Claude ✅ marker only): the label is a pure function of ONE signal, the newest of our marker reviews
//   (tools/claude-review.mjs ourReviews(): the sha it reviewed and its verdict, read from the body's headline, never from GitHub's review state: "Allow Actions to approve" is off, so an Approve is posted as a COMMENT) and the PR's head.
//   Design (owner, 14 Nov 2026: "Why it's so complicated?"; coordinator: drop "reviewing"): FOUR states, all computed from the newest review of ours and the head, so every writer (the review job's last step, pr-labels on a push) gets
//   the same answer from the same inputs: never reviewed -> "not reviewed"; reviewed head -> approved | changes requested; a head moved on since the last review -> the same verdict "· not re-reviewed". There is no "reviewing" state:
//   it was the only one with a second writer, and 4 Gitar rounds on #4124-#4134 came from it and from review windows.
//   READY never trusts the label alone: it also reads the newest review's sha against the head (tools/ship-watch.sh).
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readPr} from './claude-review.mjs';

const GH_RETRY = fileURLToPath(new URL('./gh_retry.py', import.meta.url));
const gh = (...args) => execFileSync('python3', [GH_RETRY, ...args], {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024});
export const OLD = ' · not re-reviewed';

export const LABELS = {
  approved: {name: 'Claude: approved', color: '0e8a16', description: 'Claude reviewed the current head and found no high or medium problem'},
  changes: {name: 'Claude: changes requested', color: 'd73a4a', description: 'Claude found a high or medium problem on the current head'},
  none: {name: 'Claude: not reviewed', color: 'f97316', description: 'Claude has not reviewed this PR yet; it does when the checks are green, or on "@claude review"'},
  approvedOld: {name: 'Claude: approved' + OLD, color: '86d98d', description: 'Claude approved an earlier head; the newest push is not reviewed yet'},
  changesOld: {name: 'Claude: changes requested' + OLD, color: 'f0a1a8', description: 'Claude asked for changes on an earlier head; the newest push is not reviewed yet'},
};
export const ALL = Object.values(LABELS);

/** The one label name the PR should hold: `reviews` = ourReviews() oldest first ({sha, verdict}), `head` = the PR's head sha. */
export function wantedLabel(reviews, head) {
  const last = [...(reviews || [])].pop();
  if (!last) return LABELS.none.name;
  const approved = last.verdict === 'APPROVE';
  if (last.sha === head) return (approved ? LABELS.approved : LABELS.changes).name;
  return (approved ? LABELS.approvedOld : LABELS.changesOld).name;
}

/** Adds `wanted` (creating the label once when the repo lacks it) and removes every other "Claude: …" label; -> how many it changed. `run` is the gh call. */
export function setLabel(repo, pr, wanted, have, run = gh) {
  let changed = 0;
  for (const name of have.filter(n => n.startsWith('Claude: ') && n !== wanted && !ALL.some(l => l.name === n))) { run('pr', 'edit', String(pr), '--remove-label', name, '-R', repo); changed++; }   // a "Claude: …" label this tool no longer writes
  for (const l of ALL) {
    if (l.name === wanted && !have.includes(l.name)) {
      const add = () => run('pr', 'edit', String(pr), '--add-label', l.name, '-R', repo);
      try { add(); } catch (error) {
        if (!String(error.message).includes(`'${l.name}' not found`)) throw error;
        run('label', 'create', l.name, '--color', l.color, '--description', l.description, '--force', '-R', repo);
        add();
      }
      changed++;
    } else if (l.name !== wanted && have.includes(l.name)) { run('pr', 'edit', String(pr), '--remove-label', l.name, '-R', repo); changed++; }
  }
  return changed;
}

/** Reads the PR and writes its label until a fresh read wants no change (at most 4 rounds); a closed or merged PR is left alone. -> the label name, or '' when it was left.
 * Why (13 Nov 2026, Gitar's finding on #4119): the review job and the push's pr-labels run both write this label, in different concurrency groups; a writer that read before the other one's review landed could
 * leave a stale state. Each writer therefore re-reads after its write and corrects until the PR agrees with the newest review. */
export function sync(repo, pr, run = gh) {
  let wanted = '';
  for (let round = 1; round <= 4; round++) {
    const {pr: p, reviews} = readPr(repo, pr, run, {withChecks: false});
    if (p.state !== 'OPEN') return wanted;
    wanted = wantedLabel(reviews, p.head);
    const changed = setLabel(repo, pr, wanted, p.labels, run);
    console.log(`claude-label: #${pr} → ${wanted}${changed ? '' : ' (unchanged)'}`);
    if (!changed) break;
  }
  return wanted;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const pr = process.argv[2];
    if (!/^\d+$/.test(pr || '')) throw new Error('usage: GITHUB_REPOSITORY=o/r node tools/claude-label.mjs <pr number>');
    sync(process.env.GITHUB_REPOSITORY, pr);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
