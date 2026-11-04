// Source "linear": one JOB issue as the loop's item (4 Nov 2026, [hm] 3/6). Read-only through tools/context/sources/linear.mjs (key LINEAR_READ_KEY, a query only); the text is DATA in a random fence, scrubbed twice, and the public-repo leak scan applies to what the run publishes.
import {fetch as readIssue} from '../../context/sources/linear.mjs';
import {redactBrief} from '../leaks.mjs';
import {CAPS, fenced} from '../loop.mjs';
import {EDITABLE, MAX_FILES, MAX_PATCH_BYTES} from '../walls.mjs';

export const ISSUE = /^JOB-\d{1,6}$/;

/** `read(ref, {env, fetchImpl})` -> {title, what, brief, block(fence), allowedPaths, caps}; `ref` = "JOB-123" (a leading "linear " is allowed). Throws with a reason of ours when the issue cannot be read (never the key or the body). */
export async function read(ref, {env = process.env, fetchImpl = fetch} = {}) {
  const id = String(ref || '').replace(/^linear\s+/i, '').trim();
  if (!ISSUE.test(id)) throw new Error('a Linear ref looks like JOB-123');
  const got = await readIssue(id, {env, fetchImpl});
  if (!got.markdown) throw new Error(got.notes || 'the issue could not be read');
  const brief = redactBrief({text: got.markdown, screen: '', files: {}});   // second pass: the fetcher scrubbed it once already
  return {title: /^# Linear JOB-\d+: (.*)$/m.exec(brief.text)?.[1] || id, what: 'a task written in the issue tracker', brief, block: fence => fenced('THE TASK', brief.text, fence), allowedPaths: EDITABLE, caps: {...CAPS, maxFiles: MAX_FILES, maxBytes: MAX_PATCH_BYTES}};
}
