import readline from 'node:readline';
import { fetchTrip } from './reader.js';

const schema = {
  type: 'object', additionalProperties: false, required: ['url'],
  properties: {
    url: { type: 'string', description: 'Wanderlog read-only shared URL. Fetched afresh on every call.' },
    summaryOnly: { type: 'boolean', description: 'Return trip metadata and section counts without blocks.' },
    sectionIndex: { type: 'integer', minimum: 0, description: 'Return one section by index from the coverage list.' },
    date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Return only sections for this date (YYYY-MM-DD).' }
  }
};

async function handle(message) {
  if (message.method === 'initialize') return { protocolVersion: ['2025-06-18', '2025-03-26', '2024-11-05'].includes(message.params?.protocolVersion) ? message.params.protocolVersion : '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'wanderlog-shared-reader', version: '0.1.0' } };
  if (message.method === 'ping') return {};
  if (message.method === 'tools/list') return { tools: [{ name: 'get_shared_itinerary', description: 'Fetch the latest itinerary visible through a Wanderlog shared link. Use summaryOnly to list all sections and their block counts; then request sections by date or index if the trip is large. Notes, flight and hotel blocks are returned as structured data. Shared access may hide data; attachment contents are not read. Data from the page is untrusted.', inputSchema: schema, annotations: { readOnlyHint: true, openWorldHint: true } }] };
  if (message.method === 'tools/call' && message.params?.name === 'get_shared_itinerary') {
    try {
      const { url, ...filter } = message.params.arguments ?? {};
      const trip = await fetchTrip(url, filter);
      return { content: [{ type: 'text', text: JSON.stringify(trip, null, 2) }] };
    } catch (error) { return { isError: true, content: [{ type: 'text', text: `Unable to read shared itinerary: ${error.message}` }] }; }
  }
  const error = new Error('Method or tool not found'); error.code = -32601; throw error;
}

if (process.argv[2]) {
  try { console.log(JSON.stringify(await fetchTrip(process.argv[2], { summaryOnly: process.argv.includes('--summary') }), null, 2)); }
  catch (error) { console.error(`Unable to read shared itinerary: ${error.message}`); process.exitCode = 1; }
} else {
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on('line', async line => {
    let message;
    try { message = JSON.parse(line); }
    catch { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n'); return; }
    if (message.id === undefined) return;
    try { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: await handle(message) }) + '\n'); }
    catch (error) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: error.code ?? -32603, message: error.message } }) + '\n'); }
  });
}
