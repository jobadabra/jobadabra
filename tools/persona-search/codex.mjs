// Runs a persona command behind CI's Codex Messages relay; GitHub OIDC stays in the parent and no API credential or fallback reaches the child.
import {spawn} from 'node:child_process';
import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {aiProvider} from '../../desktop/e2e/lib/ai-provider.mjs';
import {aiLine, askBroker, toBrokerCall} from '../../desktop/e2e/lib/broker-client.mjs';
import {answerViaBroker} from '../../desktop/e2e/lib/broker-relay.mjs';

/** The answer's output tokens (the model's tier is already on the line as `small`), or null when the call failed: the per-call cost table is measured, not estimated (#2913). */
function outputTokens(counted) {
  try { return JSON.parse(counted)?.usage?.output_tokens ?? null; } catch { return null; }
}

/** The broker's reason in a refused call's error body, on one line, or '' (no prompt text: the body carries only the broker's reason). */
// Why (8 Nov 2026, run 42457460368): persona 12's recording lost 3 scout calls to 503 after 50-60 s and the line said only "status 503"; the reason is the cause to fix.
function refusalOf(body) {
  try { return String(JSON.parse(String(body))?.error?.message || '').replace(/\s+/g, ' ').trim().slice(0, 200); } catch { return ''; }
}

/**
 * The engines every call of a run may use, from JOBADABRA_CHECK_CHAIN (set by search-personas.yml), as the broker fields, or null (other callers keep the broker's chain).
 * `codex,claude` (either order) = the two subscriptions, that one first, never Free AI (`subs`, jobadabra-web lib/engines.mjs); one engine = that engine alone (`only`).
 * Why (10 Nov 2026, owner on #3703: "I don't want to depend just on Codex? Claude should be at any times a replacement. Free AI is good, except when we need higher
 * intelligence models"): from 7 to 10 Nov the check's AI changed under it 4 times, a whole night on Free AI (3 of 18 measured); each row now says which engine answered.
 */
export function checkChain(env = process.env) {
  const raw = String(env.JOBADABRA_CHECK_CHAIN || '').trim();
  if (!raw) return null;
  const names = raw.split(',').map(name => name.trim());
  if (names.length === 1 && ['codex', 'claude', 'free-ai'].includes(names[0])) return {engine: names[0], only: true};
  if (names.length === 2 && names.includes('codex') && names.includes('claude')) return {engine: names[0], subs: true};
  throw new Error(`JOBADABRA_CHECK_CHAIN "${raw.slice(0, 30)}" is not a chain the broker knows (codex,claude; claude,codex; or one engine)`);
}

/** Measure each relay call without changing its answer (beyond keeping it on the run's chain, checkChain). `waited` is the client residual, not a measurement of queue time alone; `engine` is the one that answered (gate.py counts them per person); no prompt text is logged. */
export function timedRelay({env = process.env, ask = askBroker, now = Date.now, log = line => console.error(line)} = {}) {
  let inFlight = 0;
  const pinned = checkChain(env);
  return async (asked, kind = 'unlabelled') => {
    const body = pinned ? {...asked, ...pinned} : asked;
    const started = now(), call = toBrokerCall(body);
    let chars = call.prompt.length, brokerMs = null, sent = false, status = 'error', outTokens = null, why = '', engine = '';
    inFlight++;
    try {
      const answer = await answerViaBroker(body, {env, ask: async (wire, options) => {
        chars = toBrokerCall(wire).prompt.length;
        sent = true;
        const result = await ask(wire, options);
        if (Number.isFinite(result.ms)) brokerMs = result.ms;
        if (result.engine) engine = String(result.engine).replace(/[^a-z-]/g, '').slice(0, 20);
        return result;
      }});
      status = answer.status;
      outTokens = outputTokens(answer.counted);
      if (status !== 200) why = refusalOf(answer.body);
      return answer;
    } finally {
      const total = now() - started;
      const label = String(kind).replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 64);
      log(`relay: ${call.tier} total ${total} broker ${brokerMs ?? 'na'} waited ${brokerMs === null ? 'na' : total - brokerMs} in-flight ${inFlight} prompt-chars ${chars} kind ${label} start ${started} status ${status} sent ${sent ? 'yes' : 'no'} tools ${body.tools?.length || 0} out-tokens ${outTokens ?? 'na'}${engine ? ` engine ${engine}` : ''}${why ? ` why ${why}` : ''}`);
      inFlight--;
    }
  };
}

/** Run one command on the Codex relay and return its exit code. Invariant: every proxy request uses the broker; no API fallback, even on refusal. */
export async function runOnCodex(command, args, {env = process.env, ask = askBroker} = {}) {
  if (!env.CI || aiProvider(env).provider !== 'codex' || !env.ACTIONS_ID_TOKEN_REQUEST_URL || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
    throw new Error('the persona Codex relay requires CI, the Codex provider and GitHub OIDC');
  }
  // Why (30 Oct 2026, Gitar on #2635): persona quality must be live; the e2e proxy's golden answers, stale stamps and replay cache cannot measure a changed search.
  const relay = timedRelay({env, ask});
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    try {
      const answer = await relay(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'), request.headers['x-jp-action'] || 'unlabelled');
      response.writeHead(answer.status, {'content-type': answer.contentType});
      response.end(answer.body);
    } catch (error) {
      response.writeHead(502, {'content-type': 'application/json'});
      response.end(JSON.stringify({type: 'error', error: {type: 'api_error', message: `relay: ${error.message}`}}));
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const childEnv = Object.fromEntries(Object.entries(env).filter(([name]) => !name.endsWith('_KEY') && !name.endsWith('_TOKEN') && !name.endsWith('_SECRET') && !name.startsWith('ANTHROPIC_') && !name.startsWith('ACTIONS_ID_TOKEN_')));
    Object.assign(childEnv, {JOBADABRA_PERSONA_CODEX: '1', ANTHROPIC_BASE_URL: url, JOBADABRA_E2E: '1', JOBADABRA_E2E_AI_BASE_URL: url, JOBADABRA_NO_DOTENV: '1'});
    return await new Promise((resolve, reject) => {
      const child = spawn(command, args, {env: childEnv, stdio: 'inherit'});
      child.once('error', reject);
      child.once('exit', code => resolve(code ?? 1));
    });
  } finally { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); }
}

/** The --proof line: which AI answered (engine / model / what it fell back from), never "Codex" when Claude did (Gitar on #2947). */
export const proofLine = answer => `AI broker answered (${aiLine(answer) || answer.model || answer.tier}); no API key used`;

/**
 * The --proof request: one tiny call on the run's chain (checkChain), the same pin timedRelay puts on every search call.
 * Why (13 Nov 2026, Gitar on #3971): the proof asked with no engine, so it showed the broker's default chain and could neither prove nor refute the AI a run pinned.
 */
export const proofRequest = (env = process.env) => ({model: 'claude-haiku-5-5', max_tokens: 8, messages: [{role: 'user', content: 'Answer ok.'}], ...checkChain(env)});

async function main() {
  if (process.argv[2] === '--proof') {
    const answer = await askBroker(proofRequest());
    if (!answer.ok) throw new Error(`AI broker: ${answer.status}: ${answer.detail}`);
    console.log(proofLine(answer));
    return 0;
  }
  if (process.argv[2] !== '--' || !process.argv[3]) throw new Error('usage: codex.mjs -- <command> [args] | --proof');
  return runOnCodex(process.argv[3], process.argv.slice(4));
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 1; });
