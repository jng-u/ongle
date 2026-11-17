// Development uses reminders only. scripts/offline.mjs injects public build assets.
const shell = null;
const base = new URL(self.registration.scope || '/', self.location.origin).pathname;
const shellPrefix = 'ongyeol-shell-';
// Tiny lifecycle markers are separate from the large public asset caches.
const policyCache = 'ongyeol-policy';
const marker = name => '/__ongyeol_shell_' + name;
async function readMarker(policy, name, fallback) {
  const response = await policy.match(marker(name));
  return response ? response.json() : fallback;
}
async function writeMarker(policy, name, value) {
  await policy.put(marker(name), new Response(JSON.stringify(value)));
}
async function pruneShells(keep, keys = null) {
  keys ||= await caches.keys();
  await Promise.all(keys.filter(key => key.startsWith(shellPrefix) && key !== policyCache && !keep.includes(key)).map(key => caches.delete(key)));
}
self.addEventListener('install', event => event.waitUntil((async () => {
  if (!shell) { await self.skipWaiting(); return; }
  const policy = await caches.open(policyCache);
  // First upgrade from a legacy SW: freeze its existing caches once. Later
  // waiting replacements cannot keep adding to this migration protection set.
  let active = await readMarker(policy, 'active', null);
  if (!active) {
    active = self.registration.active ? (await caches.keys()).filter(key => key.startsWith(shellPrefix) && key !== policyCache) : [];
    await writeMarker(policy, 'active', active);
  }
  await writeMarker(policy, 'installing', shell.current);
  try {
    const cache = await caches.open(shell.current);
    await cache.addAll(shell.files.map(path => new Request(path, {cache:'reload'})));
  } catch (error) {
    await caches.delete(shell.current);
    await policy.delete(marker('installing'));
    throw error;
  }
  // The previous waiting worker can still activate until this install completes.
  // Keep it as well as the active shell and this candidate: at most 3 shells
  // after migration. A later install removes redundant waiting candidates.
  active = await readMarker(policy, 'active', active);
  const waiting = await readMarker(policy, 'waiting', null);
  await pruneShells([...active, waiting, shell.current]);
  await writeMarker(policy, 'waiting', shell.current);
  // Production uses the browser's default waiting lifecycle, never skipWaiting.
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  if (shell) {
    // With no skipWaiting, old controlled clients have gone before activation.
    // A newer candidate may be installing concurrently; preserve that cache.
    const policy = await caches.open(policyCache);
    await writeMarker(policy, 'active', [shell.current]);
    // Snapshot cache names BEFORE reading the installing marker. An install
    // writes its marker before opening its cache, so this cannot delete a
    // candidate that starts concurrently with activation cleanup.
    const keys = await caches.keys();
    const installing = await readMarker(policy, 'installing', null);
    await pruneShells([shell.current, installing], keys);
  }
  await self.clients.claim();
})()));
if (shell) self.addEventListener('fetch', event => {
  const req = event.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(base) || url.pathname.startsWith(base+'api/')) return;
  if (req.mode === 'navigate' && (url.pathname === base || url.pathname === base+'index.html')) {
    // Keep the HTML and its lazily loaded assets on the same active revision.
    event.respondWith(caches.open(shell.current).then(async cache => (await cache.match(base+'index.html')) || Response.error()));
  } else if (!url.search && (shell.files.includes(url.pathname) || url.pathname.startsWith(base+'assets/'))) {
    event.respondWith((async () => {
      const current = await caches.open(shell.current);
      const hit = await current.match(url.pathname);
      if (hit) return hit;
      return fetch(req);
    })());
  }
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const url = new URL(base+'#today', self.location.origin).href;
    const windows = await self.clients.matchAll({type:'window', includeUncontrolled:true});
    const app = windows.find(client=>{
      const candidate = new URL(client.url);
      return candidate.origin === self.location.origin && candidate.pathname.startsWith(base);
    });
    if (app) { await app.navigate(url); return app.focus(); }
    return self.clients.openWindow(url);
  })());
});
