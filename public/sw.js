const CACHE_NAME = 'voice-app-v1';
const urlsToCache = [
  '/',
  '/profile',
  '/dashboard',
  '/create',
  '/character',
  '/favicon.svg',
  '/manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      const cachePromises = urlsToCache.map(async url => {
        try {
          const response = await fetch(url, {
            redirect: 'follow'
          });
          
          // Only cache if it's a successful response AND not a redirect
          if (response.ok && response.status === 200 && response.type !== 'opaqueredirect') {
            await cache.put(url, response);
          }
        } catch (error) {
          console.error(`Failed to cache ${url}:`, error);
        }
      });
      
      return Promise.all(cachePromises);
    })
  );
  // Force the waiting service worker to become the active service worker
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  // Claim all clients immediately
  return self.clients.claim();
});

self.addEventListener('fetch', event => {
  // For navigation requests, always go to network first
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).then(response => {
        // If it's a redirect, just return it without caching
        if (response.type === 'opaqueredirect' || 
            response.status >= 300 && response.status < 400) {
          return response;
        }
        
        // Cache successful page loads
        if (response.ok && response.status === 200) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
        }
        
        return response;
      }).catch(() => {
        // If network fails, try cache
        return caches.match(event.request);
      })
    );
    return;
  }
  
  // For other requests (assets), cache-first strategy
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});