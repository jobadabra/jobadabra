// Free AI: an Anthropic Messages request in, a Workers AI chat request out, and the answer back in Anthropic's shape, so both SDKs (the app's JS and the Python pipeline) keep working unchanged.
// Pure functions; the PDF reader (env.AI.toMarkdown) is passed in. A block no open model here can read is refused in words, never dropped silently.
import {PROMPT_JSON_MODELS, modelFor, temperatureFor} from './free-ai-models.js';

export class Unsupported extends Error {}

export const MIN_JSON_TOKENS = 1024;   // the least output room a prompt-JSON model is given, whatever the caller asked
const SCHEMA_ASK ='Reply with ONE JSON object only, no other text, matching this JSON schema exactly: ';

/**
 * A reply without the markdown fence a model wraps JSON in (```json … ```). Linear in the reply's length.
 * Why (8 Nov 2026, fr, code review of the broker's copy): a trailing-fence regex (`\s*```\s*$`) is quadratic on a long whitespace run, and a model that loops on blank lines produces exactly that.
 */
export function stripFence(text) {
  let reply = String(text ?? '').trim();
  const open = /^```(?:json)?\s*/i.exec(reply);
  if (open) reply = reply.slice(open[0].length);
  if (reply.endsWith('```')) reply = reply.slice(0, -3);
  return reply.trim();
}

// Qwen3 and GLM think before they answer, and the thinking counts against max_tokens: a live call with max_tokens 200 came back empty (16 Oct 2026, ~450-550 tokens of thinking for a
// one-line answer). The model gets this much more room on top of the caller's limit (the answers the app asks for are short).
export const REASONING_ROOM = 2000;

const textOf = content => (typeof content === 'string' ? content : (content || []).map(block => (block?.type === 'text' ? block.text : '')).join(''));

// -> {messages, response_format?, max_tokens, temperature?, chat_template_kwargs?}. `readPdf(base64) -> text` turns a document block into text; `action` is the step (the x-jp-action header):
// a reading step answers at temperature 0 unless the caller set one (free-ai-models.js temperatureFor).
// `model` shapes the request (default: the model the table gives this step): a model in PROMPT_JSON_MODELS (Gemma 4) gets thinking off, no reasoning room, and its schema written into the last user message instead of a forced `response_format`.
export async function toWorkersAi(body, readPdf, action = '', model = modelFor(action)) {
  const messages = await chatMessages(body, readPdf);
  const schema = body.output_config?.format?.schema;
  const temperature = body.temperature ?? temperatureFor(action);
  const withTemperature = temperature != null ? {temperature} : {};
  if (PROMPT_JSON_MODELS.has(model)) {
    if (schema) putSchemaInPrompt(messages, schema);
    // Why (8 Nov 2026, fr, code review): no reasoning room (it does not think), but a floor: three app asks cap at 300 tokens (format-judge, missing-facts, zone-suggest), and a JSON answer plus its fence can run past that; a cut reply is invalid JSON, paid twice, then a 502. The floor is only a ceiling: Gemma stops when it has answered.
    return {messages, max_tokens: Math.max(body.max_tokens || 1024, MIN_JSON_TOKENS), chat_template_kwargs: {enable_thinking: false}, ...withTemperature};
  }
  return {messages, max_tokens: (body.max_tokens || 1024) + REASONING_ROOM,
    ...(schema ? {response_format: {type: 'json_schema', json_schema: {name: 'answer', schema}}} : {}),
    ...withTemperature};
}

// The Anthropic system and messages as chat messages; a PDF block is read as text, any other block no open model here can read is refused in words.
async function chatMessages(body, readPdf) {
  const messages = [];
  const system = textOf(body.system);
  if (system) messages.push({role: 'system', content: system});
  for (const message of body.messages || []) {
    if (typeof message.content === 'string') { messages.push({role: message.role, content: message.content}); continue; }
    const parts = [];
    for (const block of message.content || []) {
      if (block.type === 'text') parts.push(block.text);
      else if (block.type === 'document' && block.source?.type === 'base64') parts.push(await readPdf(block.source.data));
      else throw new Unsupported(`Free AI cannot read a ${block.type} here.`);
    }
    messages.push({role: message.role, content: parts.join('\n\n')});
  }
  return messages;
}

// The schema goes at the end of the last user message (a new one when there is none): a model in PROMPT_JSON_MODELS loops on blank lines when it is forced by `response_format`.
function putSchemaInPrompt(messages, schema) {
  const ask = `${SCHEMA_ASK}${JSON.stringify(schema)}`, last = messages.findLast(message => message.role === 'user');
  if (last) last.content = `${last.content}\n\n${ask}`; else messages.push({role: 'user', content: ask});
}

// Workers AI answers in the OpenAI chat shape (or {response} on older models). Reasoning text never reaches the caller.
// `json` = the ask wanted JSON: a PROMPT_JSON_MODELS model's markdown fence is then stripped, so the caller parses bare JSON.
export function fromWorkersAi(result, model, json = false) {
  const raw = result?.choices?.[0]?.message?.content ?? result?.response ?? '';
  const said = (typeof raw === 'string' ? raw : JSON.stringify(raw)).replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const text = json && PROMPT_JSON_MODELS.has(model) ? stripFence(said) : said;
  const usage = {input_tokens: result?.usage?.prompt_tokens || 0, output_tokens: result?.usage?.completion_tokens || 0};
  const finish = result?.choices?.[0]?.finish_reason;
  return {id: `msg_free_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`, type: 'message', role: 'assistant', model, content: [{type: 'text', text}],
    stop_reason: finish === 'length' ? 'max_tokens' : 'end_turn', stop_sequence: null, usage};
}

// A streamed ask (the strategy draft's progress bar) is answered whole and replayed as the SDK's events: one text delta, then the usage.
export function asStream(message) {
  const event = (type, data) => `event: ${type}\ndata: ${JSON.stringify({type, ...data})}\n\n`;
  return event('message_start', {message: {...message, content: [], usage: {input_tokens: message.usage.input_tokens, output_tokens: 0}}})
    + event('content_block_start', {index: 0, content_block: {type: 'text', text: ''}})
    + event('content_block_delta', {index: 0, delta: {type: 'text_delta', text: message.content[0].text}})
    + event('content_block_stop', {index: 0})
    + event('message_delta', {delta: {stop_reason: message.stop_reason, stop_sequence: null}, usage: {output_tokens: message.usage.output_tokens}})
    + event('message_stop', {});
}
