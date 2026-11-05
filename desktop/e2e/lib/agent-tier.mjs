// Which model tier the AI user agent acts on, and the hard token cap of one run: every call of a run (actor, screen reader, second opinion) counts against 250,000 tokens and the run stops cleanly at it; what every call carries before the page is at most 20,000.
// Job: report health
// Why (5 Nov 2026, owner via mac-32: "cap each run at 200k tokens", then "we can start with 250k tokens then. Assuming the initial context/harness would be max 20k"; he found a share of a weekly allowance "variable, confusing, abstract"): one number per run, counted in the tokens the broker reports, input plus output, for every call of the run together. A call is refused BEFORE it is made when its worst case (its request plus the broker's output limit) would pass the cap, so the total never goes over; the actor and the reader keep a reserve so the notes already made can still be judged (a note is never filed unjudged); the second opinion may use the reserve.
// The run's loop reads a refusal as the end: the actor's turn ends the session with `stopped at the cap`, the reader notes nothing, a note left unjudged is held, never filed. What is measured: a Board-style run is 40-80k tokens; a full seeded session on the small tier was 1.3-1.9M (5 Nov 2026), so a full night stops at this cap after its first goals.
export const RUN_CAP_TOKENS = 250_000;
export const HARNESS_MAX_TOKENS = 20_000;   // what each call carries before the page: instructions, answer shape, goal and what is known (owner, 5 Nov 2026)
export const JUDGE_RESERVE_TOKENS = 40_000;   // Why (5 Nov 2026, code review on #3240): a judge call now carries the area's rules (sent whole, about 0.3k today) and notes trimmed so the text fits 1k, beside its picture and report, about 5k worst case; 40k keeps room for 8 notes

export const MAX_OUTPUT_TOKENS = 1024;   // the first call's answer headroom (brokerAsk asks max_tokens 1024, but the broker does not forward it); raised by the largest answer seen
export const CAP_REACHED = 'the run token cap was reached';   // the refusal the loops read as "stop here"; a read it refused made no call
const IMAGE_TOKENS = 1_500;   // a screenshot costs about this, whatever its bytes: its base64 text must not be counted as words

/** The acting tier of a run: what the dispatch asked for, else large for a night (kind 'night', set by the workflow) and small for anything else, so a run with no kind (a local one) never spends the large tier by default. */
export const actorTierOf = ({requested = '', kind = ''} = {}) => requested || (kind === 'night' ? 'large' : 'small');


/**
 * The engine that answers the actor's calls: '' = the broker's own order (Codex first), 'claude' = Claude alone. A dispatch can ask for it (`requested`), and the repository variable AI_USER_AGENT_CLAUDE_ON (a UTC date) turns it on for the night of that date only, so the night after is Codex again with nothing to switch off.
 * Why (5 Nov 2026, owner: "Try Claude on one night (Recommended)"; the Codex engine carries ~12k tokens of its own context in every ~16k call, Claude's ~0.4k): one night on Claude, same goals and same cap, to compare steps per run and notes. Any other word fails the run.
 */
export function actorEngineOf({requested = '', claudeOn = '', today = new Date().toISOString().slice(0, 10)} = {}) {
  const asked = String(requested || '').trim() || (String(claudeOn || '').trim() === today ? 'claude' : '');
  if (!['', 'claude'].includes(asked)) throw new Error(`AGENT_ENGINE must be empty or claude, got "${asked}"`);
  return asked;
}

const partTokens = part => part?.type === 'image' ? IMAGE_TOKENS : Math.ceil(String(part?.text ?? part ?? '').length / 4);
/** What a request costs going in: its words at 4 characters a token plus a flat price per picture. */
const requestTokens = args => Math.ceil((String(args?.system ?? '').length + JSON.stringify(args?.schema ?? '').length) / 4)
  + (args?.messages ?? []).reduce((sum, message) => sum + (Array.isArray(message.content) ? message.content.reduce((inner, part) => inner + partTokens(part), 0) : partTokens(message.content)), 0);
// Why (5 Nov 2026, code review): the broker client reads a missing token count as 0 (broker-client.mjs), and a cap that counts 0 never trips; an answer with no count is charged its request plus its text; a Codex conversation call comes with `tokens.counted`, what the turn ADDED (input - cached + output, broker contract #409), and the cap counts that first, or a warm goal would hit 250k at a third of its real use.
const tokensOf = (answer, args) => (answer?.tokens?.counted > 0 ? answer.tokens.counted : 0) || ((answer?.usage?.input_tokens || 0) + (answer?.usage?.output_tokens || 0)) || requestTokens(args) + Math.ceil(String(answer?.text ?? '').length / 4);

/**
 * The input a call really added, to compare with its estimate: the metered count less the answer when the broker gave one (a resumed turn's `usage.input_tokens` is the whole thread, cached part included), else the reported input.
 * Why (5 Nov 2026, code review on SC 2/2, simulated): calibrating from the whole thread's input grew the worst case to 60-90k on 2.6k calls and stopped a run at 108k of 250k; a restart's full cost is still seen, because the opening call is metered in full.
 */
const calibrationInput = answer => (answer?.tokens?.counted > 0 ? Math.max(0, answer.tokens.counted - (answer.usage?.output_tokens || 0)) : answer?.usage?.input_tokens || 0);

/**
 * The run's token meter and the three asks that spend against it. -> {actor(ask), reader(ask), judge(ask), state}: each takes an `ask({system, messages, schema})` and returns one that counts every answer and refuses (throws CAP_REACHED, nothing sent) a call whose worst case would pass the cap;
 * `actor` and `reader` leave the judge's reserve free, `judge` may use it. `state` {capTokens, used: {actor, reader, judge}, total, calls, stoppedAtCap} is read after the session for the report.
 * Why (5 Nov 2026, code review on the 250k cap): the broker does not forward max_tokens and the Claude engine counts its thinking as output, and its input count includes a wrapper the estimate does not see; so the worst case of a call is its estimate plus the largest gap seen so far between a real count and the estimate (added or in proportion), plus the largest answer seen so far (at least 1,024). The first call of a run is the only one judged on the flat estimate; one answer larger than any before it can still pass the cap by its excess, and the report then shows the total over the cap.
 */
export function runBudget({capTokens = RUN_CAP_TOKENS, reserve = JUDGE_RESERVE_TOKENS} = {}) {
  const state = {capTokens, used: {actor: 0, reader: 0, judge: 0}, total: 0, calls: 0, stoppedAtCap: false};
  const seen = {output: MAX_OUTPUT_TOKENS, add: 0, mul: 0};
  const counted = (part, ask, kept) => async args => {
    const estimate = requestTokens(args), worst = estimate + Math.max(seen.add, Math.ceil(estimate * seen.mul)) + seen.output;
    if (state.total + worst > state.capTokens - kept) { state.stoppedAtCap = true; throw new Error(CAP_REACHED); }
    state.calls++;
    const answer = await ask(args), spent = tokensOf(answer, args), input = calibrationInput(answer);
    if (input) { seen.add = Math.max(seen.add, input - estimate); seen.mul = Math.max(seen.mul, input / Math.max(1, estimate) - 1); }
    seen.output = Math.max(seen.output, answer?.usage?.output_tokens || 0);
    state.used[part] += spent; state.total += spent;
    return answer;
  };
  return {actor: ask => counted('actor', ask, reserve), reader: ask => counted('reader', ask, reserve), judge: ask => counted('judge', ask, 0), state};
}

/** The reason a session ended, with a stop that was the cap's refusal of the actor's call named as the cap (and a real broker failure left as it is, even when an earlier reader or judge call had hit the cap). */
export const stoppedLabel = (stopped, state) => String(stopped).startsWith('api:') && String(stopped).includes(CAP_REACHED) ? `stopped at the ${Math.round(state.capTokens / 1000)}k token cap` : stopped;

/** Whether a session's stop reason is the run cap's label (see stoppedLabel). */
export const isCapStop = stopped => /^stopped at the \d+k token cap$/.test(String(stopped));

/**
 * The fixed part every actor call carries before the page and the history: the instructions, the shape of the answer and the goal with what is known. -> the largest over the goals' intros, in tokens (4 characters a token).
 * Throws when it is over HARNESS_MAX_TOKENS: a run whose harness alone is that big would spend its cap on the same words again and again, so it fails at start, before any call.
 */
export function harnessTokens({system, schema, intros}, max = HARNESS_MAX_TOKENS) {
  const fixed = Math.ceil((String(system).length + JSON.stringify(schema).length) / 4);
  const worst = fixed + Math.max(0, ...intros.map(intro => Math.ceil(String(intro).length / 4)));
  if (worst > max) throw new Error(`the harness alone is ${worst} tokens, over the ${max} each call may carry before the page: shorten the instructions or the knowledge`);
  return worst;
}

const k = tokens => `${Math.round(tokens / 1000).toLocaleString('en-US')}k`;

/** The tokens line of the run report: the total against the cap and each part's share, or that the run stopped at the cap; then the actor's tier. */
export function tokensLine(state, tier) {
  const {actor, reader, judge} = state.used, parts = `actor ${k(actor)}, screen reader ${k(reader)}, second opinion ${k(judge)}`;
  const head = state.stoppedAtCap ? `Stopped at the ${k(state.capTokens)} cap: ${k(state.total)} / ${k(state.capTokens)} tokens; the notes made so far are kept` : `Tokens: ${k(state.total)} / ${k(state.capTokens)}`;
  return `${head} (${parts}). Actor tier: ${tier}.`;
}

/**
 * The report line of the Codex conversations (one per goal): how many calls opened one, resumed one or restarted it (and why), and the tokens the meter counted per call kind. '' when no call was in a conversation.
 * Why (5 Nov 2026, owner via mac-32: "demo it immediately"): the saving is the point of the change, so the report shows it per run, not only in the trace.
 */
export function conversationLine(trace) {
  const rows = trace.filter(row => row.mode);
  if (!rows.length) return '';
  const count = mode => rows.filter(row => row.mode === mode), counted = list => list.reduce((sum, row) => sum + (row.counted || 0), 0);
  const why = {}; for (const row of count('restarted')) why[row.reason || 'unknown'] = (why[row.reason || 'unknown'] || 0) + 1;
  const restarts = Object.entries(why).map(([reason, n]) => `${reason} ${n}`).join(', ');
  const avg = list => (list.length ? `${Math.round(counted(list) / list.length / 100) / 10}k` : '-');
  return `Codex conversations: ${count('opened').length} opened (${avg(count('opened'))} counted each), ${count('resumed').length} resumed (${avg(count('resumed'))} each), ${count('restarted').length} restarted${restarts ? ` (${restarts})` : ''}${count('ended').length ? `, ${count('ended').length} ended` : ''}.`;
}

/** The report line of a night on one engine ('' for the broker's own order): the numbers the owner compares, and that they are not comparable with a Codex night. */
export function engineLine({engine, steps, actorTokens}) {
  return engine ? `Engine: ${engine}, not comparable with Codex nights: ${steps} steps, ${steps ? Math.round(actorTokens / steps / 100) / 10 : 0}k tokens per actor call.` : '';
}
