// One check of CI's AI before a gate's whole matrix starts: a refused Free AI token stops the run with one line, not as ~60 red jobs (run 11, 23 Oct 2026).
// CI on Free AI (owner, 26 Oct 2026: "Let's just switch to Free AI"): with CI's Workers AI token set, the suites run on the relay, so the token is what is checked (Cloudflare's free verify call).
// Why (3 Nov 2026, owner: "We should not use API Keys at all anymore. Everything should be around the ai-broker."): this also checked the Claude and OpenAI test keys. CI holds neither now; under Codex
// the AI broker answers and its own refusals are said and skipped by the call (lib/ai-cap.mjs), so there is no key to check before the matrix.
// Job: run the backbone
import {freeAiPlanned, freeToken} from './lib/engine.mjs';
import {checkFreeToken} from './lib/free-ai-check.mjs';

const summary = line => console.log(line);
const stop = (title, error) => { summary(`### ❌ ${title}, so no suite was started\n\n${error.message}`); console.error(`::error::${error.message}`); process.exit(1); };
if (freeAiPlanned()) {
  try { await checkFreeToken({token: freeToken()}); } catch (error) { stop('CI\'s Free AI token is refused', error); }
  console.log('preflight: CI runs on Free AI; its Workers AI token is active');
} else {
  console.log('preflight: no Free AI token here; the suites ask the AI broker (CI_AI_PROVIDER=codex) or have no AI key and skip their AI steps');
}
