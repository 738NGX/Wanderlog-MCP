import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose';
import { createAuth, authFromEnv } from '../src/auth.js';
import { createHttpServer, startHttpServer } from '../src/http.js';

const domain = 'example.us.auth0.com';
const resource = 'https://mcp.example.org/wanderlog/mcp';
const issuer = `https://${domain}/`;
const subject = 'auth0|example';

test('OAuth requires a valid signed token for this resource, authorized user and scope', async t => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const publicJwk = await exportJWK(publicKey); publicJwk.kid = 'test-key';
  const jwks = createLocalJWKSet({ keys: [publicJwk] });
  const auth = createAuth({ domain, resource, subjects: [subject], jwks });
  const token = async (overrides = {}) => new SignJWT({ scope: overrides.scope ?? 'read:itinerary' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuer(overrides.issuer ?? issuer)
    .setAudience(overrides.audience ?? resource).setSubject(overrides.subject ?? subject)
    .setExpirationTime(overrides.exp ?? '5m').sign(privateKey);
  const server = createHttpServer({ allowedHosts: ['127.0.0.1'], auth, readTrip: async () => ({ ok: true }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${base}/wanderlog/mcp`, { method: 'POST' });
  assert.equal(response.status, 401);
  assert.match(response.headers.get('www-authenticate'), /oauth-protected-resource\/wanderlog\/mcp/);
  const metadata = await (await fetch(`${base}${auth.metadataPath}`)).json();
  assert.equal(metadata.resource, resource);
  assert.deepEqual(metadata.authorization_servers, [issuer]);
  assert.equal(await auth.verify(`Bearer ${await token()}`), true);
  for (const changes of [{ audience: 'https://other.example/mcp' }, { issuer: 'https://evil.example/' }, { subject: 'auth0|other' }, { scope: 'openid' }, { exp: '1s ago' }]) {
    assert.equal(await auth.verify(`Bearer ${await token(changes)}`), false);
  }
  assert.equal(await auth.verify('Bearer invalid'), false);
  const good = await fetch(`${base}/wanderlog/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${await token()}`, accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
  assert.equal(good.status, 200);
  assert.equal((await good.json()).result.tools[0].name, 'get_shared_itinerary');
});

test('OAuth configuration fails closed when incomplete or not enabled', () => {
  assert.throws(() => authFromEnv({ AUTH0_DOMAIN: domain }), /MCP_PUBLIC_URL/);
  assert.throws(() => createAuth({ domain, resource, subjects: [] }), /AUTH0_ALLOWED_SUBJECTS/);
  assert.throws(() => createAuth({ domain: 'evil.example', resource, subjects: [subject] }), /AUTH0_DOMAIN/);
  assert.throws(() => startHttpServer({ MCP_REQUIRE_AUTH: 'true' }), /OAuth configuration is missing/);
});
