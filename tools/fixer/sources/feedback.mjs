// Source "feedback": one report from the site's Send to AI, as the loop's item (4 Nov 2026, [hm] 3/6). Reuses what tools/feedback-ai.mjs does today: the brief with the run token, the second redaction, the fenced report.
import {REF, fetchBrief, reportBlock} from '../../feedback-ai.mjs';
import {redactBrief} from '../leaks.mjs';
import {CAPS} from '../loop.mjs';
import {EDITABLE, MAX_FILES, MAX_PATCH_BYTES} from '../walls.mjs';

/** `read(ref, {env, fetchImpl})` -> {title, what, brief, block(fence), allowedPaths, caps}; throws with the site's reason (never the report). `ref` = the card's 16-hex handle; `env` carries the run token's variables. */
export async function read(ref, {env = process.env, fetchImpl = fetch} = {}) {
  if (!REF.test(String(ref))) throw new Error('a feedback handle is 16 hex characters');
  const brief = redactBrief(await fetchBrief(ref, env, fetchImpl));
  return {title: `feedback ${ref}`, what: 'a bug a person reported in the app', brief, block: fence => reportBlock(brief, fence), allowedPaths: EDITABLE, caps: {...CAPS, maxFiles: MAX_FILES, maxBytes: MAX_PATCH_BYTES}};
}
