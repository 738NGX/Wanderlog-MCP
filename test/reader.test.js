import test from 'node:test';
import assert from 'node:assert/strict';
import { parseState, tripFromHtml, validateUrl } from '../src/reader.js';

const fixture = {
  tripPlanStore: { data: { tripPlan: {
    title: 'Trip', startDate: '2026-11-13', endDate: '2026-11-14',
    itinerary: { sections: [
      { id: 1, date: '2026-11-13', blocks: [{ type: 'note', text: { ops: [{ insert: 'Quotes " and } inside text' }] } }] },
      { id: 2, date: '2026-11-14', blocks: [{ type: 'place', place: { name: 'Station' } }, { type: 'note' }] }
    ] }
  } } }
};
const html = `<script>window.__MOBX_STATE__ = ${JSON.stringify(fixture)}; window.other = {};</script>`;

test('parses JSON safely and preserves text containing braces and quotes', () => {
  assert.deepEqual(parseState(html), fixture);
  const result = tripFromHtml(html, { date: '2026-11-13' });
  assert.equal(result.coverage.sectionCount, 2);
  assert.equal(result.coverage.blockCount, 3);
  assert.equal(result.sections.length, 1);
  assert.equal(result.sections[0].blocks[0].text.ops[0].insert, 'Quotes " and } inside text');
});

test('summaries and section selection retain coverage of the whole trip', () => {
  assert.equal(tripFromHtml(html, { summaryOnly: true }).sections, undefined);
  assert.equal(tripFromHtml(html, { sectionIndex: 1 }).sections[0].blocks.length, 2);
  assert.throws(() => tripFromHtml(html, { sectionIndex: 9 }), /out of range/);
  assert.throws(() => tripFromHtml(html, { date: '2026-11-15' }), /No section/);
});

test('rejects untrusted hosts and malformed or incomplete pages', () => {
  assert.equal(validateUrl('https://wanderlog.com/view/abc/name/shared').hostname, 'wanderlog.com');
  for (const url of ['http://wanderlog.com/view/a/b/shared', 'https://wanderlog.com.evil.example/view/a/b/shared', 'https://wanderlog.com@evil.example/view/a/b/shared', 'https://wanderlog.com/api/tripPlans']) assert.throws(() => validateUrl(url));
  assert.throws(() => parseState('<html>login</html>'), /not found/);
  assert.throws(() => parseState('window.__MOBX_STATE__ = {"a":'), /incomplete/);
  assert.throws(() => tripFromHtml('window.__MOBX_STATE__ = {}'), /not available/);
});
