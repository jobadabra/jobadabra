// Which Workers AI model answers which AI step of the Free engine, and what a call costs us (USD per million tokens, Cloudflare list prices).
// The names here come from tools/free-ai-eval.mjs (private spec jobadabra-lab:docs/specs/2026-10-16-free-workers-ai.md "Quality"), not from a shortlist.
// Why (8 Nov 2026, fr; owner: "Gemma 4 for every ask", then "Open it now" for the app's own Free AI): Qwen3-30B and glm-5.3-flash stop answering on 20 Nov 2026 (Cloudflare's planned deprecations, HTTP 410).
// Measured on the fixed Free AI cases (tools/free-ai-*cases, fictional data, 139 calls, 0 errors): extraction 100% right (Qwen3 94%), form answers 83-88% (Qwen3 50-67%), scoring rank 0.94 (0.92), the 150-PR digest 6/6, about $0.0005 a call like Qwen3.
// glm-5.3 was not an option: 20 calls a minute, and it spends 10-12k tokens thinking before it answers (no answer in 10,000). The writing head-to-head against Sonnet 5.5: deepseek-v4.1-flash lost 57 to 15, gpt-oss-120b lost 10 to 0.
export const SMALL = '@cf/google/gemma-4-26b-a4b-it';
export const STRONG = SMALL;   // one model for every step; the STRONG_ON switch stays so a stronger model can come back as one line here
export const OSS = '@cf/openai/gpt-oss-120b';   // measured 16 Oct 2026 (tools/free-ai-writing-eval.mjs): clearly better than SMALL at the rejection review only; Cloudflare keeps it
export const QWEN3 = '@cf/qwen/qwen3-30b-a3b-fp8';   // the old SMALL: priced for the cost history, and a thinking model the translator still knows how to ask (until 20 Nov 2026)
const PRICES = {[SMALL]: [0.1, 0.3], [QWEN3]: [0.0509, 0.335], ['@cf/zai-org/glm-5.3-flash']: [0.15, 0.5], [OSS]: [0.35, 0.75]};

// Models that read their JSON schema in the prompt, with thinking off, instead of a forced `response_format`.
// Why (8 Nov 2026, fr): Gemma 4 with a forced schema looped on blank lines to the token limit (extraction 0% valid, ~85 s a call); with the schema in the prompt and thinking off it answered cleanly (it wraps the JSON in a markdown fence, which fromWorkersAi strips).
export const PROMPT_JSON_MODELS = new Set([SMALL]);

// Steps that read a page, a mail or a job (short, structured answers) run on the small model; writing a CV, a kit, a strategy or an answer for a form runs on the stronger one.
export const STRONG_STEPS = new Set(['kit', 'prep', 'insight', 'interview', 'interview_patterns', 'opportunity', 'review', 'tailor', 'cover_letter', 'job_cover_letter', 'answer', 'answer_review']);

// Every other step reads or judges (a score, job facts, a mail, a title, a decision): it answers at temperature 0 (owner, 26 Oct 2026: "Reading + judging steps").
// Measured 26 Oct 2026 (690 draws on CI's quality fixtures): at the model's default 0.6, 26% of score texts invented a fact; at 0, 11%. Writing keeps the default.
// Guard: desktop/test/unit/main/free-ai-temperature.test.js.
// The interview review judges a call's notes for gaps and practice steps (owner, 26 Oct 2026: "Yes, temp 0 for interview"; beta 3's Windows run named no gap):
// it keeps the stronger model when that is on, but answers at 0.
const JUDGED_WRITING = new Set(['interview', 'interview_patterns']);
export const temperatureFor = action => (STRONG_STEPS.has(String(action ?? '')) && !JUDGED_WRITING.has(String(action ?? '')) ? undefined : 0);

// Per step (owner, 16 Oct 2026: "Yes, that step only"): the rejection review ('review') runs on gpt-oss-120b, every other step on SMALL (or STRONG when STRONG_ON). STEP_MODELS=off puts it back on SMALL.
export const STEP_MODELS = {review: OSS};
export const modelFor = (action, env = {}) => (env.STEP_MODELS !== 'off' && STEP_MODELS[String(action)]) || (STRONG_STEPS.has(String(action)) && env.STRONG_ON === 'on' ? STRONG : SMALL);

export function costUsd(model, usage = {}) {
  const [input, output] = PRICES[model] || [0.5, 1.5];   // an unknown model is charged like a dear one so it can never dodge the daily line
  return ((usage.input_tokens || 0) * input + (usage.output_tokens || 0) * output) / 1e6;
}

// The Workers Free plan answers up to 10,000 neurons a day (resets 00:00 UTC); 1 neuron = $0.000011, so a call's neurons follow from its cost. Past it Cloudflare refuses until the next day.
export const FREE_NEURONS_PER_DAY = 10_000;
export const NEURON_USD = 0.000011;
export const neuronsOf = usd => usd / NEURON_USD;
