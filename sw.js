// HAMKKE Service Worker v0.3
// #19: 離線支援 — 快取頁面與 CDN 資源，確保關鍵資料離線可檢視

const CACHE_NAME = 'hamkke-v4';
const PRECACHE_URLS = [
  './',
  './index.html',
  './style.css',
  './firebase.js',
  './manifest.json',
  './icons/icon-192.png',
  'https://unpkg.com/vue@3/dist/vue.global.prod.js',
  'https://unpkg.com/lucide@0.468.0/dist/umd/lucide.js',
  'https://unpkg.com/lz-string@1.5.0/libs/lz-string.min.js',
  'https://unpkg.com/html2canvas@1.4.1/dist/html2canvas.min.js',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js'
];

// 安裝：預先快取核心資源
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS);
    }).then(() => self.skipWaiting())
  );
});

// 啟動：清除舊版 cache
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// 攔截請求：Cache First + Network Fallback
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // 跳過非 GET 請求
  if (request.method !== 'GET') return;

  // Firestore API 請求不攔截，讓 SDK 自己管理離線快取
  if (request.url.includes('firestore.googleapis.com') || request.url.includes('identitytoolkit.googleapis.com') || request.url.includes('securetoken.googleapis.com')) {
    return;
  }

  // Google Fonts: runtime cache (stale-while-revalidate)
  if (request.url.includes('fonts.googleapis.com') || request.url.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.match(request).then((cached) => {
          const fetchPromise = fetch(request).then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          }).catch(() => cached);
          return cached || fetchPromise;
        });
      })
    );
    return;
  }

  // 天氣 API: Network First (即時性重要，離線時用 cache)
  if (request.url.includes('api.open-meteo.com')) {
    event.respondWith(
      fetch(request).then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        return response;
      }).catch(() => caches.match(request))
    );
    return;
  }

  // 其他資源: Cache First, Network Fallback
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        // 快取成功的同源或 CDN 回應
        if (response.ok && (request.url.startsWith(self.location.origin) || request.url.includes('unpkg.com') || request.url.includes('gstatic.com/firebasejs'))) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      }).catch(() => {
        // 離線 fallback: 對導航請求回傳快取的 index.html
        if (request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
