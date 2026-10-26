// 오프라인 캐시: 앱 파일만 캐시 (OneDrive/Graph 요청은 건드리지 않음)
const V = 'wordapp-v9';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'modes.js', 'core.js', 'cloud.js', 'lib/xlsx.full.min.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  if (e.request.headers.has('range')) { e.respondWith(caches.match(e.request.url).then(m => m || fetch(e.request))); return; }
  // 네트워크 우선(새 버전 반영) → 실패 시 캐시
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => { if (r.status === 200) { const cp = r.clone(); caches.open(V).then(c => c.put(e.request, cp)); } return r; })
    .catch(() => caches.match(e.request).then(m => m || caches.match('index.html'))));
});
