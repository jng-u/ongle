import test from 'node:test';
import assert from 'node:assert/strict';
import { labReferences, REFERENCE_SYNC_DATE, referenceCandidates, searchReferences, metricKey, groupLabs, rangeText, rangeStatus, validateLab, labFromForm, putLab, removeLab } from '../src/data/labRefs.js';

const form = overrides => ({ date: '2026-11-16', name: 'CRP', unit: 'mg/L', value: '0', low: '', high: '', ...overrides });

test('regular CRP uses a strictly exclusive 5 mg/L boundary, never hs-CRP', () => {
  const [ref] = referenceCandidates('CRP', 'mg/L');
  assert.equal(ref.high, 5);
  assert.equal(rangeText(ref), '< 5');
  assert.equal(rangeStatus({ ...ref, value: 4.99 }), '참고범위 안');
  assert.equal(rangeStatus({ ...ref, value: 5 }), '참고범위보다 높음');
  assert.deepEqual(referenceCandidates('hs-CRP', 'mg/L'), []);
  assert.deepEqual(referenceCandidates('CRP', 'mg/dL'), []);
  assert.deepEqual(referenceCandidates('CRP', 'mg/l'), []);
});

test('calprotectin includes explicit borderline endpoints and only synonymous unit spellings', () => {
  const [ref] = referenceCandidates('fecal calprotectin', 'µg/g');
  assert.equal(ref.high, 50);
  assert.equal(ref.highInclusive, false);
  assert.match(ref.bands, /50 ≤ 값 ≤ 120/);
  assert.match(ref.bands, /> 120/);
  assert.equal(rangeStatus({ ...ref, value: 50 }), '참고범위보다 높음');
  assert.equal(referenceCandidates('칼프로텍틴', 'μg/g')[0].id, ref.id);
  assert.deepEqual(referenceCandidates('칼프로텍틴', 'mg/kg'), []);
});

test('albumin reference keeps both endpoints inclusive and its age restriction', () => {
  const [ref] = referenceCandidates('ALB', 'g/dL');
  assert.match(ref.population, /12개월 이상/);
  assert.equal(rangeStatus({ ...ref, value: 3.5 }), '참고범위 안');
  assert.equal(rangeStatus({ ...ref, value: 5 }), '참고범위 안');
  assert.equal(rangeStatus({ ...ref, value: 3.49 }), '참고범위보다 낮음');
  assert.equal(rangeText(ref), '3.5 ≤ 값 ≤ 5');
});

test('manual reference supports one-sided, exclusive, inclusive and absent bounds', () => {
  assert.equal(rangeText({ low: 0, high: null }), '≥ 0');
  assert.equal(rangeStatus({ value: 0, low: 0, lowInclusive: false }), '참고범위보다 낮음');
  assert.equal(rangeText({ low: 0, high: 10, lowInclusive: false, highInclusive: false }), '0 < 값 < 10');
  assert.equal(rangeStatus({ value: 1, low: null, high: null }), '참고범위 없음');
});

test('grouping separates units and hs-CRP, combines only known aliases, preserves source arrays', () => {
  const records = [
    { id: 'a', date: '2026-11-16', name: 'CRP', unit: 'mg/L', value: 5 },
    { id: 'b', date: '2026-11-01', name: 'C-reactive protein', unit: 'mg/L', value: 2 },
    { id: 'c', date: '2026-11-02', name: 'CRP', unit: 'mg/dL', value: .2 },
    { id: 'd', date: '2026-11-02', name: 'hs-CRP', unit: 'mg/L', value: .2 },
  ];
  const original = structuredClone(records);
  const groups = groupLabs(records);
  assert.equal(groups.length, 3);
  assert.deepEqual(groups[0].records.map(row => row.id), ['b', 'a']);
  assert.notEqual(metricKey(records[0]), metricKey(records[2]));
  assert.deepEqual(records, original);
  assert.deepEqual(groupLabs([]), []);
});

test('input validation accepts zero and decimals but rejects nonfinite values and invalid ranges/dates', () => {
  assert.equal(validateLab(form()), '');
  assert.equal(validateLab(form({ value: '-0.002' })), '');
  for (const value of ['', ' ', null, 'Infinity', 'NaN', 'nonsense']) assert.ok(validateLab(form({ value })));
  for (const date of ['2026-02-30', '2026-13-01', '2026-1-2', '']) assert.ok(validateLab(form({ date })));
  assert.equal(validateLab(form({ date: '2024-02-29' })), '');
  assert.ok(validateLab(form({ name: ' ' })));
  assert.ok(validateLab(form({ unit: ' ' })));
  assert.ok(validateLab(form({ low: '10', high: '5' })));
  assert.ok(validateLab(form({ low: '5', high: '5', highInclusive: false })));
  assert.ok(validateLab(form({ high: 'Infinity' })));
  assert.equal(validateLab(form({ low: '0', high: '0' })), '');
});

test('CRUD stores numbers and reference snapshots without touching other records or schedules', () => {
  const reference = structuredClone(labReferences[0]);
  const record = labFromForm(form({ value: '1.25', high: '5', highInclusive: false, reference, source: 'Mayo', note: '메모' }), 'new');
  assert.equal(record.value, 1.25);
  assert.equal(record.low, null);
  assert.equal(record.high, 5);
  assert.equal(record.highInclusive, false);
  const draft = { labs: [{ ...record, id: 'other', value: 9 }], slots: [{ id: 'slot' }], checks: { unchanged: true } };
  const other = structuredClone(draft.labs[0]);
  putLab(draft, record);
  assert.equal(draft.labs.length, 2);
  putLab(draft, { ...record, value: 2 });
  assert.equal(draft.labs.length, 2);
  assert.equal(draft.labs[1].value, 2);
  assert.deepEqual(draft.labs[1].reference, reference);
  assert.deepEqual(draft.labs[0], other);
  removeLab(draft, 'new');
  assert.deepEqual(draft.labs, [other]);
  assert.deepEqual(draft.slots, [{ id: 'slot' }]);
  assert.deepEqual(draft.checks, { unchanged: true });
  assert.throws(() => labFromForm(form({ value: '' }), 'bad'));
});

test('official-source lookup is a dated, named snapshot with provenance on every candidate', () => {
  assert.equal(searchReferences('CRP')[0].id, 'mayo-crp');
  assert.equal(searchReferences('B12')[0].id, 'mayo-b12');
  assert.deepEqual(searchReferences('not-a-real-test'), []);
  assert.equal(searchReferences('').length, labReferences.length);
  for (const ref of labReferences) {
    assert.equal(new URL(ref.url).hostname, 'www.mayocliniclabs.com');
    assert.equal(ref.syncedAt, REFERENCE_SYNC_DATE);
    assert.ok(ref.publisher && ref.population && ref.caveat);
  }
});

test('React renders empty state, unit-specific chart, editing and missing-record states', async () => {
  const { build } = await import('esbuild');
  const { runInNewContext } = await import('node:vm');
  const { createRequire } = await import('node:module');
  const { fileURLToPath } = await import('node:url');
  const result = await build({
    stdin: { resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'jsx', contents: `
      import React from 'react';
      import {renderToString} from 'react-dom/server';
      import {AppProvider} from './src/core.jsx';
      import {Labs,LabDialog} from './src/features/Labs.jsx';
      import {blankJournal} from './src/model.js';
      import assert from 'node:assert/strict';
      globalThis.location = {hash:'#labs'};
      let data = blankJournal();
      globalThis.localStorage = {getItem:key=>key === 'ongyeol.journal.v1' ? JSON.stringify(data) : null};
      const render = child => renderToString(<AppProvider>{child}</AppProvider>).replace(/<!--.*?-->/g,'');
      assert.ok(render(<Labs/>).includes('첫 검사 결과를 남겨볼까요?'));
      data.labs = [{id:'a',name:'CRP',date:'2026-11-01',unit:'mg/L',value:5,low:null,high:5,highInclusive:false},{id:'b',name:'CRP',date:'2026-11-02',unit:'mg/dL',value:.5,low:null,high:null}];
      const chart = render(<Labs/>);
      assert.ok(chart.includes('mg/L (1)') && chart.includes('mg/dL (1)'));
      assert.ok(chart.includes('참고범위보다 높음'));
      assert.ok(chart.includes('2026년'));
      const edit = render(<LabDialog name="lab" payload={{id:'a'}}/>);
      assert.ok(edit.includes('검사 기록 수정'));
      assert.ok(edit.includes('공식 출처 참고자료 찾기'));
      assert.ok(render(<LabDialog name="lab" payload={{id:'missing'}}/>).includes('기록을 찾을 수 없어요'));
      assert.equal(render(<LabDialog name="med"/>), '');
      console.log('React rendering passed');
    ` }, bundle: true, platform: 'node', format: 'cjs', write: false,
    loader: { '.css': 'empty' }, logLevel: 'silent',
  });
  let rendered = false;
  runInNewContext(result.outputFiles[0].text, {
    require: createRequire(import.meta.url), process, TextEncoder, TextDecoder,
    Buffer, URL, setTimeout, clearTimeout, setImmediate, clearImmediate,
    console: { ...console, log: message => { rendered = message === 'React rendering passed'; } },
  });
  assert.equal(rendered, true);
});

// Minimal synthetic HTML fixtures; reference text independently checked against
// the official Mayo catalog on 2026-11-16 (linked in labRefs.js). These fixtures
// intentionally test a heading-bound section, not numbers found elsewhere.
const crpSection = '&lt;5.0 mg/L</p><p>Reference values apply to all ages.';
const calprotectinSection = '&lt;50.0 mcg/g (Normal)</p><p>50.0-120 mcg/g (Borderline)</p><p>&gt;120 mcg/g (Abnormal)</p><p>Reference values apply to all ages.';
const officialHtml = (section = crpSection, title = 'C-Reactive Protein (CRP), Serum') => `<html><body><h2>${title}</h2><h4>Method Name</h4><p>${title === 'Calprotectin, Feces' ? 'Enzyme-Linked Immunosorbent Assay (ELISA)' : 'Immunoturbidimetric'}</p><h4>Reporting Name</h4><h4>Reference Values</h4><div><p>${section}</p></div><h4>Interpretation</h4><p>Unrelated number 999 mg/L</p></body></html>`;

const { parseOnlineLabReference, getOnlineLabReference, isOnlineLabReference } = await import('../src/data/onlineLab.js');

test('online parser verifies exact section, comparator, units and population', () => {
  const checkedAt = '2026-11-16T00:00:00.000Z';
  const found = parseOnlineLabReference('mayo-crp', officialHtml(), checkedAt);
  assert.equal(found.high, 5);
  assert.equal(found.highInclusive, false);
  assert.equal(found.checkedAt, checkedAt);
  assert.equal(found.mode, 'online');
  assert.equal(isOnlineLabReference(found, 'mayo-crp'), true);
  const fecal = parseOnlineLabReference('mayo-calprotectin', officialHtml(calprotectinSection, 'Calprotectin, Feces'), checkedAt);
  assert.equal(fecal.high, 50);
  assert.equal(fecal.highInclusive, false);
  assert.match(fecal.bands, /50 ≤ 값 ≤ 120/);
  assert.throws(() => parseOnlineLabReference('mayo-crp', officialHtml(), 'not-a-date'));
});

test('online parser fails closed on changed range, unit, population, heading, ambiguity or unrelated values', () => {
  for (const changed of [
    officialHtml().replace('&lt;5.0', '&lt;=5.0'),
    officialHtml().replace('5.0 mg/L', '10.0 mg/L'),
    officialHtml().replace('5.0 mg/L', '5.0 mg/dL'),
    officialHtml().replace('all ages', 'adults only'),
    officialHtml().replace('Reference Values', 'Reference Range'),
    officialHtml().replace('Interpretation', 'Unexpected heading'),
    officialHtml().replace('<h4>Interpretation', '<h4>Reference Values</h4><p>&lt;5.0 mg/L</p><h4>Interpretation'),
    officialHtml().replace(crpSection, 'See interpretation.'),
    officialHtml().replace('C-Reactive Protein (CRP), Serum', 'High Sensitivity CRP'),
    '<html><h2>Request Rejected</h2><p>5.0 mg/L</p></html>',
    officialHtml().replace('</div><h4>Interpretation', '<p>Additional unexpected 12 mg/L</p></div><h4>Interpretation'),
  ]) assert.throws(() => parseOnlineLabReference('mayo-crp', changed));
  assert.throws(() => parseOnlineLabReference('https://private.example', officialHtml()));
  assert.throws(() => parseOnlineLabReference('__proto__', officialHtml()));
});

test('online server fetch uses only fixed allowlist URLs, and returns verified JSON directly', async () => {
  const calls = [];
  const result = await getOnlineLabReference('mayo-crp', async (url, options) => {
    calls.push({ url, options });
    return new Response(officialHtml(), { headers: { 'content-type': 'text/html; charset=utf-8' } });
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, labReferences[0].url);
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(isOnlineLabReference(result, 'mayo-crp'), true);
  let called = false;
  await assert.rejects(getOnlineLabReference('http://127.0.0.1/private', async () => { called = true; }));
  assert.equal(called, false);
});

test('online server can use fixed official mirror and rejects failed/layout-changed/non-HTML responses', async () => {
  const calls = [];
  const mirror = await getOnlineLabReference('mayo-crp', async url => {
    calls.push(url);
    return url.includes('testcatalog.org')
      ? new Response(officialHtml(), { headers: { 'content-type': 'text/html' } })
      : new Response('Forbidden', { status: 403 });
  });
  assert.equal(calls.length, 2);
  assert.equal(mirror.resolvedUrl, 'https://www.testcatalog.org/show/CRP');
  assert.equal(isOnlineLabReference(mirror, 'mayo-crp'), true);
  for (const response of [
    () => new Response('Forbidden', { status: 403 }),
    () => new Response('<h2>Request Rejected</h2>', { headers: { 'content-type': 'text/html' } }),
    () => new Response(officialHtml().replace('5.0 mg/L', '6.0 mg/L'), { headers: { 'content-type': 'text/html' } }),
    () => new Response(officialHtml(), { headers: { 'content-type': 'application/json' } }),
    () => new Response(officialHtml(), { headers: { 'content-type': 'text/html', 'content-length': '2000000' } }),
  ]) await assert.rejects(getOnlineLabReference('mayo-crp', async () => response()));
});

test('online server times out even when a fetcher ignores AbortSignal', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  const pending = getOnlineLabReference('mayo-crp', async (url, options) => { signal = options.signal; return new Promise(() => {}); });
  const rejection = assert.rejects(pending);
  t.mock.timers.tick(8001);
  await rejection;
  assert.equal(signal.aborted, true);
  t.mock.timers.reset();
});

test('client rejects altered references, cross-unit data, arbitrary links and wrong IDs', () => {
  const found = parseOnlineLabReference('mayo-crp', officialHtml());
  for (const changed of [
    { high: 8 }, { highInclusive: true }, { unit: 'mg/dL' }, { population: 'anyone' },
    { url: 'https://other.example/' }, { resolvedUrl: 'http://localhost/' },
    { mode: 'offline' }, { checkedAt: 'bad' }, { referenceVersion: 'future' }, { id: 'mayo-calprotectin' },
  ]) assert.equal(isOnlineLabReference({ ...found, ...changed }, 'mayo-crp'), false);
});

// Captured official HTML excerpts from successful fetch on 2026-11-15 15:52 UTC.
const capturedOfficialFixtures = {
  "mayo-crp": "<h2>C-Reactive Protein (CRP), Serum</h2><h4>\n\n    <div id=\"MethodName-title\">\n        <strong>Method Name</strong>\n\n            <div class=\"popover-info\">\n                <span class=\"icon icon-info\" data-toggle=\"popover\" data-original-title=\"\" title=\"\"></span>\n                <div class=\"popover-data\">\n                    <span class=\"icon icon-close\"></span>\n                    A short description of the method used to perform the test\n                </div>\n            </div>\n    </div>\n</h4>\n    <div id=\"MethodName-value\">\n        <p class=MsoNormal>Immunoturbidimetric<o:p></o:p></p>\n    </div>\n\n\n\n\n            \n\n<h4>\n\n    <div id=\"NYStateAvailable-title\">\n        <strong>NY State Available</strong>\n\n            <div class=\"popover-info\">\n                <span class=\"icon icon-info\" data-toggle=\"popover\" data-original-title=\"\" title=\"\"></span>\n                <div class=\"popover-data\">\n                    <span class=\"icon icon-close\"></span>\n                    Indicates the status of NY State approval and if the test is orderable for NY State clients.\n                </div>\n            </div>\n    </div>\n</h4><h4>\n\n    <div id=\"ReferenceValues-title\">\n        <strong>Reference Values</strong>\n\n            <div class=\"popover-info\">\n                <span class=\"icon icon-info\" data-toggle=\"popover\" data-original-title=\"\" title=\"\"></span>\n                <div class=\"popover-data\">\n                    <span class=\"icon icon-close\"></span>\n                    Describes reference intervals and additional information for interpretation of test results. May include intervals based on age and sex when appropriate. Intervals are Mayo-derived, unless otherwise designated. If an interpretive report is provided, the reference value field will state this.\n                </div>\n            </div>\n    </div>\n</h4>\n    <div id=\"ReferenceValues-value\">\n        <p class=MsoNormal style='line-height:normal;mso-layout-grid-align:none'><span style='mso-bidi-font-size:10.0pt;mso-fareast-font-family:\"Times New Roman\"; color:black'>&lt;5.0 mg/L<o:p></o:p></span></p>  <p class=MsoNormal style='line-height:normal;mso-layout-grid-align:none'><span style='mso-bidi-font-size:10.0pt;mso-fareast-font-family:\"Times New Roman\"; color:black'>Reference values apply to all ages.</span><span style='mso-bidi-font-size: 10.0pt;mso-fareast-font-family:\"Times New Roman\"'><o:p></o:p></span></p>\n    </div>\n\n\n\n\n            \n\n<h4>\n\n    <div id=\"Interpretation-title\">\n        <strong>Interpretation</strong>\n\n            <div class=\"popover-info\">\n                <span class=\"icon icon-info\" data-toggle=\"popover\" data-original-title=\"\" title=\"\"></span>\n                <div class=\"popover-data\">\n                    <span class=\"icon icon-close\"></span>\n                    Provides information to assist in interpretation of the test results\n                </div>\n            </div>\n    </div>\n</h4>",
  "mayo-calprotectin": "<h2>Calprotectin, Feces</h2><h4>\n\n    <div id=\"MethodName-title\">\n        <strong>Method Name</strong>\n\n            <div class=\"popover-info\">\n                <span class=\"icon icon-info\" data-toggle=\"popover\" data-original-title=\"\" title=\"\"></span>\n                <div class=\"popover-data\">\n                    <span class=\"icon icon-close\"></span>\n                    A short description of the method used to perform the test\n                </div>\n            </div>\n    </div>\n</h4>\n    <div id=\"MethodName-value\">\n        <p class=MsoNormal style='mso-outline-level:2'><span style='mso-bidi-font-size: 10.0pt;line-height:115%;mso-fareast-font-family:\"Times New Roman\"'>Enzyme-Linked Immunosorbent Assay (ELISA)<o:p></o:p></span></p>\n    </div>\n\n\n\n\n            \n\n<h4>\n\n    <div id=\"NYStateAvailable-title\">\n        <strong>NY State Available</strong>\n\n            <div class=\"popover-info\">\n                <span class=\"icon icon-info\" data-toggle=\"popover\" data-original-title=\"\" title=\"\"></span>\n                <div class=\"popover-data\">\n                    <span class=\"icon icon-close\"></span>\n                    Indicates the status of NY State approval and if the test is orderable for NY State clients.\n                </div>\n            </div>\n    </div>\n</h4><h4>\n\n    <div id=\"ReferenceValues-title\">\n        <strong>Reference Values</strong>\n\n            <div class=\"popover-info\">\n                <span class=\"icon icon-info\" data-toggle=\"popover\" data-original-title=\"\" title=\"\"></span>\n                <div class=\"popover-data\">\n                    <span class=\"icon icon-close\"></span>\n                    Describes reference intervals and additional information for interpretation of test results. May include intervals based on age and sex when appropriate. Intervals are Mayo-derived, unless otherwise designated. If an interpretive report is provided, the reference value field will state this.\n                </div>\n            </div>\n    </div>\n</h4>\n    <div id=\"ReferenceValues-value\">\n        <p class=MsoNormal>&lt;50.0 mcg/g (Normal)<o:p></o:p></p>  <p class=MsoNormal>50.0-120 mcg/g (Borderline)<o:p></o:p></p>  <p class=MsoNormal>&gt;120 mcg/g (Abnormal)<o:p></o:p></p>  <p class=MsoNormal><o:p>&nbsp;</o:p></p>  <p class=MsoNormal>Reference values apply to all ages.<o:p></o:p></p>\n    </div>\n\n\n\n\n            \n\n<h4>\n\n    <div id=\"Interpretation-title\">\n        <strong>Interpretation</strong>\n\n            <div class=\"popover-info\">\n                <span class=\"icon icon-info\" data-toggle=\"popover\" data-original-title=\"\" title=\"\"></span>\n                <div class=\"popover-data\">\n                    <span class=\"icon icon-close\"></span>\n                    Provides information to assist in interpretation of the test results\n                </div>\n            </div>\n    </div>\n</h4>"
};

test('actual official HTML fixtures preserve method, exact boundaries and source population', () => {
  for (const [id, html] of Object.entries(capturedOfficialFixtures)) {
    const reference = parseOnlineLabReference(id, html);
    assert.equal(isOnlineLabReference(reference, id), true);
    assert.throws(() => parseOnlineLabReference(id, html.replace('all ages', 'adults')));
    assert.throws(() => parseOnlineLabReference(id, html.replace('Method Name', 'New Method')));
    assert.throws(() => parseOnlineLabReference(id, html.replace(id === 'mayo-crp' ? 'Immunoturbidimetric' : 'Enzyme-Linked Immunosorbent Assay (ELISA)', 'Changed assay')));
  }
});
