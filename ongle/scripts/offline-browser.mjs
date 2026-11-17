// Uses an already installed Playwright/Chromium; does not download dependencies.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs
// CHROMIUM_EXECUTABLE=/absolute/path/to/chrome node scripts/offline-browser.mjs
import assert from 'node:assert/strict';
import {cp, mkdtemp, readFile, writeFile, symlink, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {spawnSync} from 'node:child_process';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('..', import.meta.url));
const temp = await mkdtemp(join(tmpdir(), 'ongyeol-offline-browser-'));
async function waitFor(check) {
  const deadline = Date.now() + 20000;
  while (!await check()) {
    assert.ok(Date.now() < deadline, 'browser lifecycle check timed out');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}
let browser, server;
try {
  for (const name of ['src', 'public', 'server', '.openai', 'index.html']) await cp(join(root, name), join(temp, name), {recursive:true});
  await symlink(join(root, 'node_modules'), join(temp, 'node_modules'), 'dir');
  await writeFile(join(temp, 'package.json'), '{"type":"module"}');
  const workerPath = join(temp, 'src/data/drugSearchWorker.js');
  const workerSource = await readFile(workerPath, 'utf8');
  // Distinct content hash simulates an older app whose Worker has never started.
  await writeFile(workerPath, 'self.__previousOfflineFixture = true;\n' + workerSource);
  const {build} = await import('vite');
  async function buildSnapshot(name) {
    await build({root:temp, configFile:false, logLevel:'error', build:{outDir:'dist/client', reportCompressedSize:false}});
    const result = spawnSync(process.execPath, [join(root, 'scripts/offline.mjs')], {cwd:temp, encoding:'utf8'});
    assert.equal(result.status, 0, result.stderr);
    const target = join(temp, name);
    await cp(join(temp, 'dist/client'), target, {recursive:true});
    return target;
  }
  const oldRoot = await buildSnapshot('old');
  // Model the previously shipped SW lifecycle, including eager cache cleanup.
  const generated = await readFile(join(oldRoot, 'sw.js'), 'utf8');
  const config = JSON.parse(generated.match(/const shell = (.*);/)[1]);
  await writeFile(join(oldRoot, 'sw.js'), `const current=${JSON.stringify(config.current)},files=${JSON.stringify(config.files)};
self.addEventListener('install',e=>e.waitUntil(caches.open(current).then(c=>c.addAll(files)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('ongyeol-shell-')&&k!==current).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(u.origin!==self.location.origin||e.request.method!=='GET')return;if(e.request.mode==='navigate')e.respondWith(fetch(e.request).catch(()=>caches.open(current).then(c=>c.match('/index.html'))));else if(files.includes(u.pathname))e.respondWith(caches.open(current).then(c=>c.match(u.pathname)).then(r=>r||fetch(e.request)));});`);
  await writeFile(workerPath, workerSource);
  const newRoot = await buildSnapshot('new');
  let serving = oldRoot;
  const mime = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.webmanifest':'application/manifest+json', '.svg':'image/svg+xml', '.png':'image/png'};
  server = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    try {
      assert.ok(!pathname.includes('..'));
      const path = pathname === '/' ? '/index.html' : pathname;
      const body = await readFile(serving + path);
      res.writeHead(200, {'content-type':mime[extname(path)] || 'application/octet-stream', 'cache-control':'no-store'});
      res.end(body);
    } catch {res.writeHead(404); res.end();}
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({...(process.env.CHROMIUM_EXECUTABLE ? {executablePath:process.env.CHROMIUM_EXECUTABLE} : {}), args:['--no-sandbox']});
  const context = await browser.newContext();
  let page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errors = [], workers = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('worker', worker => workers.push(worker.url()));
  await page.goto(origin + '/#meds');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, {once:true}));
    localStorage.setItem('offline-upgrade-marker', 'preserved');
  });
  assert.equal(workers.length, 0, 'old page must not warm up drug search');
  const holding = await context.newPage();
  await holding.goto(origin + '/#meds');
  serving = newRoot;
  await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update(); });
  await waitFor(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).waiting?.state === 'installed'));
  assert.equal(await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()).waiting), true);
  const candidate = context.serviceWorkers().at(-1);
  await context.setOffline(true);
  async function firstSearch(expectedWorker) {
    await page.getByRole('button', {name:'약 추가', exact:true}).first().click();
    await page.getByPlaceholder('제품명 또는 성분명 검색').fill('펜타사');
    await page.locator('.medicine-result button').first().waitFor();
    assert.match(await page.locator('.medicine-results').innerText(), /펜타사/);
    assert.match(workers.at(-1), expectedWorker);
  }
  const oldWorker = config.files.find(p => /drugSearchWorker-.*\.js$/.test(p));
  await firstSearch(new RegExp(oldWorker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'));
  console.log('PASS: update waits; old controlled page completes its first offline search');
  await page.close();
  assert.equal(await holding.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()).waiting), true);
  await holding.close();
  await waitFor(() => candidate.evaluate(() => self.registration.active?.state === 'activated' && !self.registration.waiting));
  // Closing the final controlled client lets the browser activate the waiting SW.
  page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('worker', worker => workers.push(worker.url()));
  await page.goto(origin + '/#meds');
  await waitFor(() => page.evaluate(async () => (await caches.keys()).filter(k => k.startsWith('ongyeol-shell-')).length === 1));
  assert.equal(await page.evaluate(() => localStorage.getItem('offline-upgrade-marker')), 'preserved');
  await firstSearch(/drugSearchWorker-.*\.js$/);
  assert.notEqual(new URL(workers.at(-1)).pathname, oldWorker);
  console.log('PASS: last old tab closes; new shell activates offline, old caches removed, first search succeeds');
  await context.setOffline(false);
  // Repeated deployments while this tab stays open must not accumulate catalogs.
  const newSW = await readFile(join(newRoot, 'sw.js'), 'utf8');
  for (let version = 0; version < 5; version++) {
    await writeFile(join(newRoot, 'sw.js'), newSW.replace(/ongyeol-shell-[a-f0-9]+/, 'ongyeol-shell-browser' + version));
    await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update(); });
    await waitFor(() => page.evaluate(async version => {
      const policy = await caches.open('ongyeol-policy');
      const pending = await policy.match('/__ongyeol_shell_waiting');
      return (await navigator.serviceWorker.getRegistration()).waiting?.state === 'installed' && pending && await pending.json() === 'ongyeol-shell-browser' + version;
    }, version));
    const keys = await page.evaluate(async () => (await caches.keys()).filter(k => k.startsWith('ongyeol-shell-')));
    assert.ok(keys.length <= 3, keys.join(', '));
  }
  // The active worker must serve its cached HTML even while the server deploys.
  await writeFile(join(newRoot, 'index.html'), '<html>WRONG DEPLOYMENT HTML</html>');
  await page.reload();
  await firstSearch(/drugSearchWorker-.*\.js$/);
  console.log('PASS: five waiting replacements keep at most 3 shells; online navigation stays on active HTML');
  assert.deepEqual(errors, []);
  console.log('PASS: storage preserved; no page errors');
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await rm(temp, {recursive:true, force:true});
}
