import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './mcp.js';
import { authFromEnv } from './auth.js';
import { fetchTrip } from './reader.js';

const BODY_LIMIT = 64 * 1024;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function respond(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function validHost(header, allowedHosts) {
  if (!header || /[\s/@?#\\]/.test(header)) return false;
  try { return allowedHosts.has(new URL(`http://${header}`).hostname.toLowerCase()); }
  catch { return false; }
}

async function readJson(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) { const e = new Error('Request too large'); e.status = 413; throw e; }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { const e = new Error('Invalid JSON'); e.status = 400; throw e; }
}

export function createHttpServer({ readTrip = fetchTrip, allowedHosts, allowedOrigins = [], auth = null, maxCallsPerMinute = 30, maxConcurrentCalls = 4 } = {}) {
  const hosts = allowedHosts ? new Set(allowedHosts.map(x => x.toLowerCase())) : null;
  const origins = new Set(allowedOrigins);
  let calls = [], activeCalls = 0;
  const limitedReadTrip = async (...args) => {
    const now = Date.now();
    calls = calls.filter(timestamp => now - timestamp < 60000);
    if (calls.length >= maxCallsPerMinute || activeCalls >= maxConcurrentCalls) throw new Error('Service is busy or its request limit has been reached; please try again later.');
    calls.push(now);
    activeCalls++;
    try { return await readTrip(...args); } finally { activeCalls--; }
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (hosts && !validHost(req.headers.host, hosts)) return respond(res, 403, { error: 'Host not allowed' });
    if (req.headers.origin && !origins.has(req.headers.origin)) return respond(res, 403, { error: 'Origin not allowed' });
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/health' && req.method === 'GET') return respond(res, 200, { status: 'ok' });
    if (auth && path === auth.metadataPath && req.method === 'GET') return respond(res, 200, auth.metadata);
    if (path !== (auth?.path || '/mcp')) return respond(res, 404, { error: 'Not found' });
    if (auth && !(await auth.verify(req.headers.authorization))) {
      res.setHeader('WWW-Authenticate', auth.challenge);
      return respond(res, 401, { jsonrpc: '2.0', error: { code: -32000, message: 'Authentication required' }, id: null });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return respond(res, 405, { jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
    }
    if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) return respond(res, 415, { error: 'Expected application/json' });
    let body;
    try { body = await readJson(req); }
    catch (error) { return respond(res, error.status || 400, { error: error.message }); }
    const mcp = createMcpServer(limitedReadTrip);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { void mcp.close(); });
    try {
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch {
      if (!res.headersSent) respond(res, 500, { jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
      else res.end();
    }
  });
  server.requestTimeout = 35000;
  server.headersTimeout = 10000;
  return server;
}

export function startHttpServer(env = process.env) {
  const host = env.HOST || '127.0.0.1';
  const port = Number(env.PORT || '3000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
  const local = LOOPBACK_HOSTS.has(host);
  const auth = authFromEnv(env);
  if (env.MCP_REQUIRE_AUTH === 'true' && !auth) throw new Error('MCP_REQUIRE_AUTH is enabled but OAuth configuration is missing.');
  if (!local && !auth && env.ALLOW_UNAUTHENTICATED_REMOTE !== 'true') throw new Error('Remote binding is unauthenticated. Set ALLOW_UNAUTHENTICATED_REMOTE=true only after reviewing the deployment documentation.');
  const allowedHosts = env.ALLOWED_HOSTS ? env.ALLOWED_HOSTS.split(',').map(x => x.trim()).filter(Boolean) : local ? [...LOOPBACK_HOSTS] : undefined;
  const allowedOrigins = env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(',').map(x => x.trim()).filter(Boolean) : [];
  const server = createHttpServer({ allowedHosts, allowedOrigins, auth });
  server.listen(port, host, () => console.error(`Wanderlog MCP listening on ${host}:${port}${auth?.path || '/mcp'} (${auth ? 'OAuth required' : 'no authentication'})`));
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { startHttpServer(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
