// CI's side of the AI broker (jobadabra-web workers/ai-broker; it answers on Codex, Claude or Free AI, one flag, 1 Nov 2026): a test-code Messages request becomes one broker call, and the broker's answer comes back in Messages shape.
// Why (28 Oct 2026, owner): CI's AI runs on his Codex plan; a job proves itself with GitHub's per-run OIDC token (the login never leaves the broker), and each workflow keeps its Claude tier:
// Haiku -> small (gpt-6-luna), Sonnet -> mid (gpt-6.1-sol), Opus -> large (gpt-6-astra) (jobadabra-web lib/tiers.mjs is the server's side of the same map).
// Job: report health
// Why (2 Nov 2026, ai-broker 6/7): the broker accepts both audiences until 7/7; the old one is dropped there.
export const AUDIENCE = 'jobadabra-ai-broker';
const GITHUB_RETRY_MS = 10000;   // GitHub's gateway 502/503/504 on the run token: one more try, as tools/gh_retry.py does for gh
const GITHUB_GATEWAY = [502, 503, 504];   // tools/gh_retry.py GATEWAY: a 500 is GitHub's own fault and would fail again
const RETRY_AFTER_MS = 30000;   // the one retry of a 5xx the broker gave no reason for (see askBroker's Why)
/** The broker's address: takes env, returns AI_BROKER_URL when set, else the old CODEX_BROKER_URL (still honoured), else the deployed workers.dev address (jobadabra-web workers/ai-broker). A wrong address fails as 'unreachable' in askBroker. */
export const BROKER_URL = env => env.AI_BROKER_URL || env.CODEX_BROKER_URL || 'https://jobadabra-ai-broker.jobpilotto.workers.dev';

/** A broker refusal's reason as one line: a failed Codex run's JSON event stream ("codex-failed:1 {"type":"thread.started",…} {"type":"error","message":"…"}") becomes its head plus the server's last "message". */
// Why (5 Nov 2026, run 42040707448): the stream's preamble filled the 160 characters a caller kept, so the cause was cut at "Selec"; the words that say why come last.
export function reasonOf(why) {
  const text = String(why), said = [...text.matchAll(/"message":"((?:[^"\\]|\\.)*)"/g)].map(found => { try { return JSON.parse(`"${found[1]}"`); } catch { return found[1]; } });   // a cut-off escape keeps the raw text
  return (said.length ? `${text.split(/\s*\{"type"/)[0]} ${said.at(-1)}` : text).replace(/\s+/g, ' ').trim();
}

/** A Claude model id -> the broker's tier name ('small' | 'mid' | 'large'); an unknown id runs on 'mid'. */
export const tierOf = id => (/haiku/i.test(id || '') ? 'small' : /opus/i.test(id || '') ? 'large' : 'mid');

/** A Messages tool is native web search when its versioned type starts with web_search; shared by relay validation and broker translation. */
export const isWebSearch = tool => String(tool?.type || '').startsWith('web_search');

const text = content => (typeof content === 'string' ? content : (content || []).filter(part => part.type !== 'image').map(part => part.text ?? '').join('\n'));

// Why (7 Nov 2026, work board draft on broker calls being ~5x slower than the plan path): the engine asks for `output_config.effort: 'low'` (src/ai/decide.py, enrich.py; Haiku 5.5 always) and the plan paths honour it, but this translation dropped it, so every relay call ran at Codex's default effort: 11.6 s p50 for a call run alone against 1.9 s on the plan path (1,680 broker calls, 24 h). The values are the broker's own (jobadabra-web workers/ai-broker/lib/tiers.mjs EFFORTS); any other value (Anthropic's 'max') is not sent, the call keeps the broker's default.
const BROKER_EFFORTS = ['low', 'medium', 'high', 'xhigh'];

/** A Messages request -> the broker's body: {tier, effort?, prompt, schema?, images?, search?: true, engine?, only?: true, subs?: true}. One system text, the turns in order, the pictures as base64; `session`/`delta`/`endSession` keep one Codex conversation (the broker's contract, jobadabra-web #409); `engine` names this call's own first choice, `only: true` makes it the whole chain and `subs: true` the two subscriptions, never Free AI (the broker refuses either without an engine). */
export function toBrokerCall(body) {
  const system = Array.isArray(body.system) ? body.system.map(block => block.text).join('\n\n') : body.system || '';
  const turns = body.messages.map(message => `${message.role === 'assistant' ? 'You' : 'User'}:\n${text(message.content)}`).join('\n\n');
  const images = body.messages.flatMap(message => (Array.isArray(message.content) ? message.content : []).filter(part => part.type === 'image')).map((part, i) => ({name: `image${i}.${String(part.source?.media_type || 'image/png').split('/')[1]}`, base64: part.source?.data}));   // numbered across all turns, so two pictures never share a name
  const schema = body.output_config?.format?.schema;
  const search = body.tools?.some(isWebSearch);
  const effort = BROKER_EFFORTS.includes(body.output_config?.effort) ? body.output_config.effort : null;
  return {tier: tierOf(body.model), ...(effort ? {effort} : {}), ...(search ? {search: true} : {}), ...(body.engine ? {engine: body.engine, ...(body.only ? {only: true} : {}), ...(body.subs ? {subs: true} : {})} : {}), ...(body.session ? {session: body.session, ...(body.delta ? {delta: body.delta} : {}), ...(body.endSession ? {endSession: true} : {})} : {}), prompt: [system, turns].filter(Boolean).join('\n\n'), ...(schema ? {schema} : {}), ...(images.length ? {images} : {})};
}

/** This run's OIDC token for the broker (the workflow needs `permissions: id-token: write`), or null outside such a job. Throws on a refusal, naming GitHub's status and words.
 * Invariant: a gateway 502/503/504 is asked once more after GITHUB_RETRY_MS; any other status, a 500 included, is never asked again. */
export async function runToken(env = process.env, fetchImpl = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  if (!env.ACTIONS_ID_TOKEN_REQUEST_URL || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) return null;
  const ask = () => fetchImpl(`${env.ACTIONS_ID_TOKEN_REQUEST_URL}&audience=${AUDIENCE}`, {headers: {authorization: `Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}`}});
  let answer = await ask();
  // Why (12 Nov 2026, press-tapes-auto run 43232268713): GitHub's token service answered "upstream connect error…" on 18 calls and tapes 10, 11, 14 were thrown away;
  //   the owner's "One retry on GitHub errors" (3 Nov 2026, tools/gh_retry.py) never reached this fetch, which also read the error page as JSON.
  if (GITHUB_GATEWAY.includes(answer.status)) { await sleep(GITHUB_RETRY_MS); answer = await ask(); }
  if (!answer.ok) throw new Error(`HTTP ${answer.status}: ${(await answer.text().catch(error => `(body unreadable: ${error.message})`)).slice(0, 80)}`);
  return (await answer.json()).value || null;
}

/**
 * The job label the broker counts this call under: takes env, returns {'x-jobadabra-job': <GITHUB_JOB>} inside an Actions job, {} elsewhere.
 * Why (5 Nov 2026, owner: "what job and how many tokens did it use? In the AI admin cost"): display only. The broker keeps a label of [a-z0-9-] (1-40 characters) and ignores any other; lane, caps and the workflow come from the signed run token alone.
 */
export const jobHeader = env => (env.GITHUB_JOB ? {'x-jobadabra-job': env.GITHUB_JOB} : {});

/** One line for the engine that answered, e.g. "AI: claude / claude-haiku-5-5 (codex ran-out)"; '' when the answer says nothing (an older broker sends no engine). */
export function aiLine(answer) {
  const {engine, model, fellBack = []} = answer || {};
  const who = [engine, model].filter(Boolean).join(' / ');
  if (!who) return '';
  const fell = fellBack.map(item => `${item.engine} ${item.why}`).join(', ');
  return `AI: ${who}${fell ? ` (${fell})` : ''}`;
}
// Why (2 Nov 2026, owner: CI should know which model answers): each distinct line is printed once per process, not per call (a persona press makes hundreds), so the job log says which AI did the work and what it fell back from.
const printed = new Set();
const told = answer => { const line = aiLine(answer); if (line && !printed.has(line)) { printed.add(line); console.log(line); } };
/** Forgets the lines already printed (tests). */
export const resetTold = () => printed.clear();

/**
 * Why a fetch failed, in the words of the layer that failed. Takes the caught error; returns e.g. "fetch failed (UND_ERR_SOCKET: other side closed)", or the message alone when no cause came with it.
 * Why (4 Nov 2026, a8 via mac-32): Node's fetch always says "fetch failed" and keeps the socket's code on error.cause (an AggregateError's first error when every address failed), so two night alerts carried no cause at all.
 */
export function failureOf(error) {
  const cause = error?.cause?.errors?.[0] || error?.cause;
  const said = [cause?.code, cause?.message].filter(Boolean).join(': ');
  return `${error?.message || error}${said ? ` (${said})` : ''}`;
}

/**
 * Asks the broker. -> {ok: true, message: {content, stop_reason, usage}, tier, model, engine?, fellBack?, ms} (ms is container Codex execution, excluding its later rate-limit lookup) or {ok: false, status, detail}.
 * status 'capped' = the broker's BUDGET said no (a reason starting `budget:`, 429 or 503: skip with the reason, never another provider); 'no-token' = not a job with id-token; 'unreachable' = no answer (the detail names the cause and how long the call was open; it says nothing about credit).
 * Any other refusal keeps its HTTP status and its reason (a lost login `login-lost`, a fallback that cannot answer `fallback:*`, `only-codex: unavailable`): a failure the job shows red, never a grey skip.
 * Invariant: a 5xx with no `why` of the broker's is asked once more after RETRY_AFTER_MS; a 502 `codex-failed:` on a conversation call (a Codex turn that crashed or stalled; the broker restarts the conversation from the full prompt, which the body carries) is asked once more at once; any other reason is never asked again. At most two HTTP calls, never both rules.
 */
export async function askBroker(body, {env = process.env, fetchImpl = fetch, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms))} = {}) {
  const token = await runToken(env, fetchImpl, sleep).catch(error => error);
  // Why (4 Nov 2026): a network failure on the way to GitHub's token service is not a job without id-token; the old catch said it was.
  if (token instanceof Error) return {ok: false, status: 'unreachable', detail: `no run token from GitHub: ${failureOf(token)}`};
  if (!token) return {ok: false, status: 'no-token', detail: 'no GitHub OIDC token here (the job needs permissions: id-token: write; a fork run has none)'};
  const started = now();
  const ask = async () => {
    const reply = await fetchImpl(`${BROKER_URL(env)}/call`, {method: 'POST', headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json', ...jobHeader(env)}, body: JSON.stringify(toBrokerCall(body)), signal: AbortSignal.timeout(180000)}).catch(error => error);
    return reply instanceof Error ? {answer: reply} : {answer: reply, data: await reply.json().catch(error => (reply.ok ? error : {}))};
  };
  let {answer, data} = await ask();
  // Why (4 Nov 2026, owner via mac-32): TREATS A SYMPTOM. While a deploy swaps the broker's container the platform answers 5xx for a few seconds with no reason of the broker's (6 calls in 24 s on 4 Nov); one more try
  // after 30 s rides it out. The cause, calls cut off by the swap, is JOB-274. A refusal that gave a reason (`why`) is a decision, not a swap: never asked again.
  if (!(answer instanceof Error) && answer.status >= 500 && !data?.why) { await sleep(RETRY_AFTER_MS); ({answer, data} = await ask()); }
  // Why (5 Nov 2026, a8 via mac-32; Gitar on #3272 put it here, the one owner of retries): TREATS A SYMPTOM. Why Codex stalls (3 in ~14 calls) is open with a8; this is the recovery the broker contract plans, so one stall is a `restarted` row and not a dead chain; a second failure is the caller's as before.
  else if (body.session && !(answer instanceof Error) && answer.status === 502 && /^codex-failed:/.test(String(data?.why || ''))) ({answer, data} = await ask());
  if (answer instanceof Error) return {ok: false, status: 'unreachable', detail: `no answer from the broker: ${failureOf(answer)} after ${Math.round((now() - started) / 1000)} s`};
  // Why (4 Nov 2026, review): a connection lost after the headers left an empty 200 that read as an answer with no text.
  if (data instanceof Error) return {ok: false, status: 'unreachable', detail: `the broker's answer was cut off: ${failureOf(data)} after ${Math.round((now() - started) / 1000)} s`};
  // Why (4 Nov 2026, owner via mac-32: "A check that keeps skipping in grey because its login is gone isn't measuring anything"): only the broker's budget is a skip; a lost login or a fallback that cannot answer is a failure the job shows.
  if ((answer.status === 429 || answer.status === 503) && /^budget:/.test(String(data.why || ''))) return {ok: false, status: 'capped', detail: `broker: ${data.why}`};
  if (!answer.ok) return {ok: false, status: answer.status, detail: `broker: ${reasonOf(data.why || data.error || answer.status)}`};
  told(data);
  return {ok: true, tier: data.tier, model: data.model, ...(data.engine ? {engine: data.engine} : {}), ...(data.fellBack?.length ? {fellBack: data.fellBack} : {}), ...(data.tokens ? {tokens: data.tokens} : {}), ...(data.session ? {session: data.session} : {}), ms: Number.isFinite(data.ms) ? data.ms : null, message: {content: [{type: 'text', text: data.reply}], stop_reason: 'end_turn', usage: {input_tokens: data.tokens?.input || 0, output_tokens: data.tokens?.output || 0}}};
}
