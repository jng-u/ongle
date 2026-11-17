import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {runInNewContext} from 'node:vm';

// Exercise the generated deployment worker, rather than a separate cache policy.
async function generatedWorker(base = '/') {
  const root = await mkdtemp(join(tmpdir(), 'ongyeol-offline-test-'));
  try {
    for (const dir of ['dist/client/assets', 'public', 'server', '.openai']) await mkdir(join(root, dir), {recursive:true});
    await writeFile(join(root, 'public/sw.js'), await readFile(new URL('../public/sw.js', import.meta.url)));
    await writeFile(join(root, 'dist/client/index.html'), '<html>new shell</html>');
    await writeFile(join(root, 'dist/client/assets/drugSearchWorker-new.js'), 'new catalog worker');
    await writeFile(join(root, 'dist/client/sw.js'), '// source worker');
    await writeFile(join(root, 'server/worker.js'), "import assets from 'virtual:ongyeol-assets'; export default assets;");
    await writeFile(join(root, '.openai/hosting.json'), '{}');
    const result = spawnSync(process.execPath, [new URL('../scripts/offline.mjs', import.meta.url).pathname, '--base=' + base, '--static'], {cwd:root, encoding:'utf8'});
    assert.equal(result.status, 0, result.stderr);
    return await readFile(join(root, 'dist/client/sw.js'), 'utf8');
  } finally { await rm(root, {recursive:true, force:true}); }
}
const source = await generatedWorker();
const origin = 'https://ongyeol.test';
function harness({windows = [{}], failInstall = false, active = false, stores = new Map(), script = source, base = '/'} = {}) {
  const listeners = new Map();
  const calls = {skipWaiting:0, claimed:0, network:[]};
  const key = input => new URL(typeof input === 'string' ? input : input.url, origin).pathname;
  const caches = {
    async keys() {return [...stores.keys()];},
    async delete(name) {return stores.delete(name);},
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        async delete(req) {return entries.delete(key(req));},
        async addAll(requests) {
          if (failInstall) throw new Error('precache failed');
          for (const req of requests) entries.set(key(req), new Response(key(req)));
        },
        async match(req) {return entries.get(key(req))?.clone();},
        async put(req, response) {entries.set(key(req), response);},
      };
    },
  };
  const self = {
    location:{origin},
    registration:{active, scope:origin + base},
    addEventListener(type, handler) {listeners.set(type, [...(listeners.get(type) || []), handler]);},
    async skipWaiting() {calls.skipWaiting++;},
    clients:{async matchAll() {return windows;}, async claim() {calls.claimed++;}},
  };
  class BrowserRequest extends Request {
    constructor(input, options) {super(typeof input === 'string' ? new URL(input, origin) : input, options);}
  }
  runInNewContext(script, {self, caches, URL, Request:BrowserRequest, Response, fetch:async req => {
    calls.network.push(req.url); throw new Error('offline');
  }});
  return {caches, calls, stores, async dispatch(type, request) {
    const pending = [];
    let response;
    for (const handler of listeners.get(type) || []) handler({request,
      waitUntil(promise) {pending.push(promise);}, respondWith(promise) {response = promise;},
    });
    await Promise.all(pending);
    return response;
  }};
}

test('production install waits without claiming existing pages', async () => {
  const h = harness();
  await h.dispatch('install');
  assert.equal(h.calls.skipWaiting, 0);
  assert.equal(h.calls.claimed, 0);
});

test('activation removes obsolete shells even when a new uncontrolled page exists', async () => {
  const h = harness();
  await h.caches.open('ongyeol-shell-previous');
  await h.caches.open('other-app');
  await h.dispatch('install');
  await h.dispatch('activate');
  const keys = await h.caches.keys();
  assert.ok(!keys.includes('ongyeol-shell-previous'));
  assert.ok(keys.includes('other-app'));
  assert.equal(keys.filter(k => k.startsWith('ongyeol-shell-')).length, 1);
});

test('navigation uses the active cached HTML while deployment serves another version', async () => {
  const h = harness();
  await h.dispatch('install');
  await h.dispatch('activate');
  const response = await h.dispatch('fetch', {url:origin + '/', method:'GET', mode:'navigate'});
  assert.equal(await response.text(), '/index.html');
  assert.deepEqual(h.calls.network, []);
  assert.equal(await h.dispatch('fetch', new Request(origin + '/api/lab-reference')), undefined);
  assert.equal(await h.dispatch('fetch', new Request('https://external.test/assets/worker.js')), undefined);
  const worker = await h.dispatch('fetch', new Request(origin + '/assets/drugSearchWorker-new.js'));
  assert.match(await worker.text(), /drugSearchWorker-new/);
});

test('Pages subpath precaches and serves its own HTML and assets offline', async () => {
  const h = harness({script:await generatedWorker('/ongle/'), base:'/ongle/'});
  await h.dispatch('install');
  await h.dispatch('activate');
  const response = await h.dispatch('fetch', {url:origin + '/ongle/', method:'GET', mode:'navigate'});
  assert.equal(await response.text(), '/ongle/index.html');
  const worker = await h.dispatch('fetch', new Request(origin + '/ongle/assets/drugSearchWorker-new.js'));
  assert.match(await worker.text(), /ongle\/assets\/drugSearchWorker-new/);
  assert.deepEqual(h.calls.network, []);
  assert.equal(await h.dispatch('fetch', {url:origin + '/', method:'GET', mode:'navigate'}), undefined);
  assert.equal(await h.dispatch('fetch', new Request(origin + '/assets/other-app.js')), undefined);
  assert.equal(await h.dispatch('fetch', new Request(origin + '/ongle/api/lab-reference')), undefined);
});

test('failed precache never skips the waiting phase or claims clients', async () => {
  const h = harness({failInstall:true});
  await assert.rejects(h.dispatch('install'), /precache failed/);
  assert.equal(h.calls.skipWaiting, 0);
  assert.equal(h.calls.claimed, 0);
});

test('successive waiting updates retain at most active, previous waiting and installing shells', async () => {
  const h = harness();
  await h.dispatch('install');
  await h.dispatch('activate');
  let latest;
  for (let version = 0; version < 6; version++) {
    latest = harness({stores:h.stores, active:true, script:source.replace(/ongyeol-shell-[a-f0-9]+/, 'ongyeol-shell-release' + version)});
    await latest.dispatch('install');
    const keys = (await h.caches.keys()).filter(k => k.startsWith('ongyeol-shell-'));
    assert.ok(keys.length <= 3, keys.join(', '));
    assert.ok(keys.some(k => !k.includes('release')), 'active version survives all pending updates');
  }
  await latest.dispatch('activate');
  assert.deepEqual((await h.caches.keys()).filter(k => k.startsWith('ongyeol-shell-')), ['ongyeol-shell-release5']);
});

test('legacy migration protection is frozen once, then cleaned at safe activation', async () => {
  const h = harness({active:true});
  await h.caches.open('ongyeol-shell-legacy');
  await h.dispatch('install');
  for (let version = 0; version < 5; version++) {
    const update = harness({stores:h.stores, active:true, script:source.replace(/ongyeol-shell-[a-f0-9]+/, 'ongyeol-shell-migration' + version)});
    await update.dispatch('install');
    const keys = (await h.caches.keys()).filter(k => k.startsWith('ongyeol-shell-'));
    assert.ok(keys.includes('ongyeol-shell-legacy'));
    assert.ok(keys.length <= 3, keys.join(', '));
  }
});

test('activation preserves a concurrently installing shell', async () => {
  const h = harness();
  await h.dispatch('install');
  const policy = await h.caches.open('ongyeol-policy');
  await policy.put('/__ongyeol_shell_installing', new Response(JSON.stringify('ongyeol-shell-concurrent')));
  await h.caches.open('ongyeol-shell-concurrent');
  await h.caches.open('ongyeol-shell-obsolete');
  await h.dispatch('activate');
  const keys = await h.caches.keys();
  assert.ok(keys.includes('ongyeol-shell-concurrent'));
  assert.ok(!keys.includes('ongyeol-shell-obsolete'));
});

test('candidate beginning during activation cleanup is not deleted', async () => {
  const h = harness();
  await h.dispatch('install');
  const policy = await h.caches.open('ongyeol-policy');
  const keys = h.caches.keys;
  let injected = false;
  h.caches.keys = async () => {
    if (!injected) {
      injected = true;
      await policy.put('/__ongyeol_shell_installing', new Response(JSON.stringify('ongyeol-shell-racing')));
      await h.caches.open('ongyeol-shell-racing');
    }
    return keys();
  };
  await h.dispatch('activate');
  assert.ok((await keys()).includes('ongyeol-shell-racing'));
});
