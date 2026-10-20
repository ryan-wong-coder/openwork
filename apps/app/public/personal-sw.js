/* Cache only the public application shell. Credentials and user media stay out. */
const CACHE = 'zeno-personal-shell-v1';
const PRECACHE = ['/app/', '/app/personal.webmanifest', '/app/zeno-personal.svg'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PRECACHE))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('zeno-personal-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith('/app/') || url.search || url.pathname.includes('/api/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/app/').then(response => response || Response.error()))); return;
  }
  if (!['script','style','font','image'].includes(event.request.destination)) return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => { if (response.ok && response.type === 'basic') { const copy = response.clone(); void caches.open(CACHE).then(cache => cache.put(event.request, copy)); } return response; })));
});
