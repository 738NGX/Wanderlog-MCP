import { createRemoteJWKSet, jwtVerify } from 'jose';

// Auth0 is the authorization server; this service only verifies its access tokens.
export function createAuth({ domain, resource, subjects, jwks }) {
  if (typeof domain !== 'string' || !/^[a-z0-9][a-z0-9.-]*\.auth0\.com$/i.test(domain)) throw new Error('AUTH0_DOMAIN must be an Auth0 tenant domain.');
  let url;
  try { url = new URL(resource); } catch { throw new Error('MCP_PUBLIC_URL must be an HTTPS URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/mcp')) throw new Error('MCP_PUBLIC_URL must be an HTTPS MCP URL ending in /mcp without query or fragment.');
  if (!Array.isArray(subjects) || !subjects.length || subjects.some(x => typeof x !== 'string' || !x.trim())) throw new Error('AUTH0_ALLOWED_SUBJECTS must include at least one exact Auth0 user ID.');
  const issuer = `https://${domain.toLowerCase()}/`;
  const audience = url.href;
  const scope = 'read:itinerary';
  const metadataPath = `/.well-known/oauth-protected-resource${url.pathname}`;
  const metadataUrl = new URL(metadataPath, url.origin).href;
  const keySet = jwks || createRemoteJWKSet(new URL('.well-known/jwks.json', issuer), { timeoutDuration: 5000 });
  const allowed = new Set(subjects);
  return {
    path: url.pathname,
    metadataPath,
    metadata: { resource: audience, authorization_servers: [issuer], scopes_supported: [scope], bearer_methods_supported: ['header'] },
    challenge: `Bearer resource_metadata="${metadataUrl}", scope="${scope}"`,
    async verify(header) {
      if (typeof header !== 'string') return false;
      const match = /^Bearer ([A-Za-z0-9._~-]+)$/i.exec(header);
      if (!match) return false;
      try {
        const { payload } = await jwtVerify(match[1], keySet, { issuer, audience, algorithms: ['RS256'], requiredClaims: ['exp', 'sub'] });
        const scopes = typeof payload.scope === 'string' ? payload.scope.split(' ') : [];
        return allowed.has(payload.sub) && scopes.includes(scope);
      } catch { return false; }
    }
  };
}

export function authFromEnv(env) {
  const any = env.AUTH0_DOMAIN || env.MCP_PUBLIC_URL || env.AUTH0_ALLOWED_SUBJECTS;
  if (!any) return null;
  return createAuth({ domain: env.AUTH0_DOMAIN, resource: env.MCP_PUBLIC_URL, subjects: (env.AUTH0_ALLOWED_SUBJECTS || '').split(',').map(s => s.trim()).filter(Boolean) });
}
