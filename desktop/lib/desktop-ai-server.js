// The app's side of "let the Claude desktop app help": two routes on the existing loopback server, /desktop-ai/v1/pair (a one-time code becomes a token) and /desktop-ai/v1/mcp (MCP JSON-RPC over HTTP).
// Spec: docs/superpowers/specs/2026-11-03-desktop-ai-mcp-design.md ("Trust" rule 6). Invariants: no CORS header is ever sent; a request with an Origin (a web page) or a Host other than 127.0.0.1 is refused
// before anything else; /mcp needs the desktop AI's own token (never the extension's); the tool list is lib/desktop-ai-tools.js and nothing else; a log line names the tool, never a value.
import {TOOLS, TOOL_NAMES, callTool} from './desktop-ai-tools.js';
import {redeem, verifyToken, noteUse} from './desktop-ai-pairing.js';
import {log as appLog} from './log.js';

export const BRIDGE_VERSION = '1';   // the helper file's protocol; an older helper against a newer app gets 426 and says "press Connect again"
export const isDesktopAiRoute = url => String(url || '').startsWith('/desktop-ai/v1/');
let sources = null;   // set by lib/desktop-ai-handlers.js once the app is up; null in demo mode (every tool then says it is not available)
export const setDesktopAiSources = value => { sources = value; };

const send = (res, status, value) => { res.writeHead(status, {'Content-Type': 'application/json'}); res.end(value === undefined ? '' : JSON.stringify(value)); };
const rpcResult = (id, result) => ({jsonrpc: '2.0', id, result});
const rpcError = (id, code, message) => ({jsonrpc: '2.0', id, error: {code, message}});
const parse = body => { try { return JSON.parse(body?.toString() || '{}'); } catch { return null; } };

/** One MCP message in, the JSON-RPC reply out (null for a notification). The helper answers initialize and tools/list itself; the app answers them too so any MCP client works. */
export async function handleRpc(message, {src = sources, home} = {}) {
  if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return rpcError(message?.id ?? null, -32600, 'Invalid request');
  const {id, method, params} = message;
  if (id === undefined) return null;
  if (method === 'initialize') return rpcResult(id, {protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: {tools: {}}, serverInfo: {name: 'jobadabra', version: BRIDGE_VERSION}});
  if (method === 'ping') return rpcResult(id, {});
  if (method === 'tools/list') return rpcResult(id, {tools: TOOLS.map(({name, description, inputSchema}) => ({name, description, inputSchema}))});
  if (method === 'tools/call') {
    const started = Date.now();
    const done = await callTool(params?.name, params?.arguments, src || {}, {home});
    if (!done) return rpcError(id, -32602, `Unknown tool. Available: ${TOOL_NAMES.join(', ')}`);
    appLog('desktop-ai', `tool ${params.name}${done.isError ? ' (refused or failed)' : ''}`, {ms: Date.now() - started});
    return rpcResult(id, {content: [{type: 'text', text: done.text}], isError: done.isError});
  }
  return rpcError(id, -32601, `Unknown method ${method}`);
}

/** The route handler for /desktop-ai/v1/*: (req, res, body, {storage, PORT}). */
export async function handleDesktopAi(req, res, body, {storage, PORT}) {
  if (req.headers.origin !== undefined) return send(res, 403, {error: 'Not allowed'});   // a web page always sends one; the helper never does
  const host = String(req.headers.host || '');
  if (host !== `127.0.0.1:${PORT}` && host !== '127.0.0.1') return send(res, 403, {error: 'Not allowed'});   // a rebinding page reaches 127.0.0.1 under its own name
  if (req.method !== 'POST') return send(res, 405, {error: 'POST only'});
  if (req.url === '/desktop-ai/v1/pair') {
    const token = redeem(storage, parse(body)?.code);
    if (!token) return send(res, 401, {error: 'Unknown or expired code. Press Connect in Jobadabra again.'});
    appLog('desktop-ai', 'connected');
    return send(res, 200, {token, tools: TOOL_NAMES});
  }
  if (req.url !== '/desktop-ai/v1/mcp') return send(res, 404, {error: 'Not found'});
  const bearer = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
  if (!verifyToken(storage, bearer)) return send(res, 401, {error: 'disconnected', message: 'Disconnected. Press Connect in Jobadabra again.'});
  if (req.headers['x-desktop-ai-bridge'] !== BRIDGE_VERSION) return send(res, 426, {error: 'outdated', message: 'This connection is out of date. Press Connect in Jobadabra again.'});
  const message = parse(body);
  noteUse(storage);
  const reply = await handleRpc(message, {home: undefined});
  return reply ? send(res, 200, reply) : send(res, 202);
}
