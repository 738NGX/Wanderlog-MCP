const MAX_BYTES = 20 * 1024 * 1024;
const MARKER = 'window.__MOBX_STATE__';

export function validateUrl(input) {
  let url;
  try { url = new URL(input); } catch { throw new Error('Invalid URL.'); }
  if (url.protocol !== 'https:' || url.hostname !== 'wanderlog.com' || url.port || url.username || url.password || !/^\/(view|plan)\/[^/]+\/.+\/shared\/?$/.test(url.pathname)) {
    throw new Error('Expected an HTTPS Wanderlog /view/.../shared or /plan/.../shared URL.');
  }
  url.hash = '';
  return url;
}

export function parseState(html) {
  const marker = html.indexOf(MARKER);
  if (marker < 0) throw new Error('Wanderlog initialization data was not found; the page may require access or its format may have changed.');
  let pos = marker + MARKER.length;
  while (/\s/.test(html[pos] ?? '')) pos++;
  if (html[pos++] !== '=') throw new Error('Unexpected initialization data format.');
  while (/\s/.test(html[pos] ?? '')) pos++;
  const start = pos;
  if (html[start] !== '{') throw new Error('Expected a JSON object in initialization data.');
  let depth = 0, quoted = false, escaped = false;
  for (; pos < html.length; pos++) {
    const c = html[pos];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try { return JSON.parse(html.slice(start, pos + 1)); }
      catch { throw new Error('Could not parse initialization data as JSON.'); }
    }
  }
  throw new Error('Initialization data is incomplete.');
}

export function tripFromHtml(html, filter = {}) {
  const data = parseState(html)?.tripPlanStore?.data;
  const trip = data?.tripPlan;
  const sections = trip?.itinerary?.sections;
  if (!trip || !Array.isArray(sections) || sections.some(s => !s || !Array.isArray(s.blocks))) {
    throw new Error('Shared itinerary data was not available or has an unexpected format.');
  }
  const availableSections = sections.map((s, index) => ({ index, id: s.id, heading: s.heading, date: s.date ?? null, type: s.type, mode: s.mode, blockCount: s.blocks.length }));
  let selected = sections.map((section, index) => ({ index, ...section }));
  if (filter.sectionIndex !== undefined) {
    if (!Number.isInteger(filter.sectionIndex) || filter.sectionIndex < 0 || filter.sectionIndex >= sections.length) throw new Error('sectionIndex is out of range.');
    selected = selected.filter(s => s.index === filter.sectionIndex);
  }
  if (filter.date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(filter.date)) throw new Error('date must be YYYY-MM-DD.');
    selected = selected.filter(s => s.date === filter.date);
    if (!selected.length) throw new Error('No section matches the requested date and section index.');
  }
  return {
    fetchedAt: new Date().toISOString(),
    source: 'Wanderlog shared-page initialization state',
    scope: 'Only data available through the shared link. Completeness against the owner view is not verified.',
    trip: { title: trip.title, startDate: trip.startDate, endDate: trip.endDate, editedAt: trip.editedAt, placeCount: trip.placeCount },
    coverage: { sectionCount: sections.length, blockCount: sections.reduce((n, s) => n + s.blocks.length, 0), availableSections },
    ...(filter.summaryOnly ? {} : { sections: selected }),
    warnings: ['Images and attachments may be represented by references; their contents are not extracted.', 'Fields hidden by Wanderlog sharing settings cannot be retrieved.']
  };
}

export async function fetchTrip(input, filter = {}) {
  let url = validateUrl(input);
  const signal = AbortSignal.timeout(30000);
  let response;
  for (let i = 0; i < 4; i++) {
    response = await fetch(url, { signal, redirect: 'manual', headers: { 'Accept': 'text/html', 'Cache-Control': 'no-cache' } });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get('location');
    if (!location || i === 3) throw new Error('Too many redirects or invalid redirect.');
    url = validateUrl(new URL(location, url).href);
  }
  if (!response.ok) throw new Error(`Wanderlog returned HTTP ${response.status}.`);
  if (!(response.headers.get('content-type') || '').includes('text/html')) throw new Error('Wanderlog did not return an HTML page.');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_BYTES) throw new Error('Wanderlog response exceeds the size limit.');
    chunks.push(chunk);
  }
  return tripFromHtml(Buffer.concat(chunks).toString('utf8'), filter);
}
