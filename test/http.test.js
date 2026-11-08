import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createHttpServer, startHttpServer } from '../src/http.js';

test('MCP HTTP client can initialize, list the tool and request fresh itinerary data', async t => {
  const calls = [];
  const server = createHttpServer({ allowedHosts: ['127.0.0.1'], readTrip: async (url, filter) => {
    calls.push({ url, filter });
    return { fetchedAt: `read-${calls.length}`, coverage: { sectionCount: 1, blockCount: 1 }, sections: [{ date: filter.date, blocks: [{ type: 'note', text: 'sample' }] }] };
  } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = new URL(`http://127.0.0.1:${server.address().port}/mcp`);
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(url));
  t.after(() => client.close());
  const tools = await client.listTools();
  assert.equal(tools.tools[0].name, 'get_shared_itinerary');
  assert.equal(tools.tools[0].annotations.readOnlyHint, true);
  const args = { url: 'https://wanderlog.com/view/key/title/shared', date: '2026-11-14' };
  const first = await client.callTool({ name: 'get_shared_itinerary', arguments: args });
  const second = await client.callTool({ name: 'get_shared_itinerary', arguments: args });
  assert.equal(JSON.parse(first.content[0].text).fetchedAt, 'read-1');
  assert.equal(JSON.parse(second.content[0].text).fetchedAt, 'read-2');
  assert.deepEqual(calls[0], { url: args.url, filter: { date: args.date } });
  assert.equal(calls.length, 2);
});

test('HTTP endpoint blocks browser origins, unexpected hosts and oversized requests', async t => {
  const server = createHttpServer({ allowedHosts: ['127.0.0.1'] });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.equal((await fetch(`${base}/mcp`, { headers: { origin: 'https://attacker.example' } })).status, 403);
  const badHost = await new Promise((resolve, reject) => {
    http.get(`${base}/mcp`, { headers: { host: 'attacker.example' } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject);
  });
  assert.equal(badHost, 403);
  assert.equal((await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ payload: 'x'.repeat(70000) }) })).status, 413);
  assert.equal((await fetch(`${base}/mcp`)).status, 405);
});

test('remote binding requires explicit unauthenticated opt-in', () => {
  assert.throws(() => startHttpServer({ HOST: '0.0.0.0', PORT: '3000' }), /unauthenticated/);
});

test('HTTP service limits itinerary fetches across MCP requests', async t => {
  let calls = 0;
  const server = createHttpServer({ maxCallsPerMinute: 1, readTrip: async () => ({ count: ++calls }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const client = new Client({ name: 'limit-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.address().port}/mcp`)));
  t.after(() => client.close());
  const request = { name: 'get_shared_itinerary', arguments: { url: 'https://wanderlog.com/view/key/title/shared' } };
  assert.equal((await client.callTool(request)).isError, undefined);
  const limited = await client.callTool(request);
  assert.equal(limited.isError, true);
  assert.match(limited.content[0].text, /request limit/);
  assert.equal(calls, 1);
});
