import test from 'node:test';
import assert from 'node:assert/strict';
import { isAndroidPackage, getAndroidLabReference } from '../src/data/androidReference.js';
import { isOnlineLabReference } from '../src/data/onlineLab.js';

const sources = {
  'mayo-crp': ['C-Reactive Protein (CRP), Serum', 'Immunoturbidimetric', '&lt;5.0 mg/L', 'https://www.mayocliniclabs.com/test-catalog/Overview/9731'],
  'mayo-calprotectin': ['Calprotectin, Feces', 'Enzyme-Linked Immunosorbent Assay (ELISA)', '&lt;50.0 mcg/g (Normal) 50.0-120 mcg/g (Borderline) &gt;120 mcg/g (Abnormal)', 'https://www.testcatalog.org/show/CALPR'],
};
function sourceResponse(id, { html, status = 200, headers = {} } = {}) {
  const [title, method, range, url] = sources[id];
  return new Response(html ?? `<h2>${title}</h2><h4>Method Name</h4><p>${method}</p><h4>Reporting Name</h4><h4>Reference Values</h4><p>${range} Reference values apply to all ages.</p><h4>Interpretation</h4>`, {
    status, headers: { 'content-type': 'text/html; charset=utf-8', 'X-Resolved-Url': url, ...headers },
  });
}

test('Android package detection requires the exact virtual HTTPS origin', () => {
  assert.equal(isAndroidPackage({ origin: 'https://appassets.androidplatform.net' }), true);
  for (const origin of ['http://appassets.androidplatform.net', 'https://appassets.androidplatform.net.evil.test', 'https://example.org', 'null']) {
    assert.equal(isAndroidPackage({ origin }), false);
  }
  assert.equal(isAndroidPackage(null), false);
});

test('Android fetch sends only the allowlisted ID and parses both exact official sources', async () => {
  for (const id of Object.keys(sources)) {
    const controller = new AbortController();
    const found = await getAndroidLabReference(id, controller.signal, async (url, options) => {
      assert.equal(url, `/android-source?id=${id}`);
      assert.deepEqual(options, { signal: controller.signal, headers: { Accept: 'text/html' } });
      return sourceResponse(id);
    });
    assert.equal(isOnlineLabReference(found, id), true);
    assert.equal(found.resolvedUrl, sources[id][3]);
    assert.equal(found.highInclusive, false);
  }
  let called = false;
  await assert.rejects(getAndroidLabReference('private-value', undefined, async () => { called = true; }));
  assert.equal(called, false);
});

test('Android fetch rejects missing/wrong provenance, changed HTML, non-HTML and failed responses', async () => {
  for (const options of [
    { headers: { 'X-Resolved-Url': '' } },
    { headers: { 'X-Resolved-Url': 'https://www.testcatalog.org/show/CALPR' } },
    { headers: { 'X-Resolved-Url': 'https://evil.test/' } },
    { headers: { 'content-type': 'application/json' } },
    { headers: { 'content-length': '1500001' } },
    { html: await sourceResponse('mayo-crp').text().then(text => text.replace('5.0 mg/L', '8.0 mg/L')) },
    { html: 'x'.repeat(1500001) },
    { status: 503 },
  ]) {
    await assert.rejects(getAndroidLabReference('mayo-crp', undefined, async () => sourceResponse('mayo-crp', options)));
  }
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(getAndroidLabReference('mayo-crp', controller.signal, async (_, { signal }) => {
    signal.throwIfAborted();
  }));
});

test('reminder settings distinguish native background alarms from browser and optional calendar alarms', async () => {
  const { build } = await import('esbuild');
  const { runInNewContext } = await import('node:vm');
  const { createRequire } = await import('node:module');
  const { fileURLToPath } = await import('node:url');
  const result = await build({
    stdin: { resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'jsx', contents: `
      import React from 'react';
      import {renderToString} from 'react-dom/server';
      import {AppProvider} from './src/core.jsx';
      import {ReminderSettings} from './src/features/Reminders.jsx';
      import {blankJournal} from './src/model.js';
      import assert from 'node:assert/strict';
      globalThis.localStorage = {getItem:()=>JSON.stringify(blankJournal())};
      globalThis.location = {hash:'#settings', origin:'https://appassets.androidplatform.net'};
      const render = () => renderToString(<AppProvider><ReminderSettings/></AppProvider>);
      const android = render();
      assert.ok(android.includes('앱을 닫거나 화면을 잠가도 동작'));
      assert.ok(android.includes('캘린더 파일'));
      assert.ok(android.includes('알림 권한 허용하기'));
      assert.ok(!android.includes('iPhone') && !android.includes('HTTPS로 접속'));
      assert.ok(android.includes('기기 알림 켜기'));
      globalThis.location.origin = 'https://example.org';
      const browser = render();
      assert.ok(browser.includes('iPhone·iPad') && browser.includes('HTTPS로 접속'));
      assert.ok(!browser.includes('Android 앱에서는'));
    ` }, bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent',
  });
  runInNewContext(result.outputFiles[0].text, {
    require: createRequire(import.meta.url), process, TextEncoder, TextDecoder,
    Buffer, URL, setTimeout, clearTimeout, setImmediate, clearImmediate, console,
  });
});
