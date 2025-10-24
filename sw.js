const APP_SHELL_CACHE = 'app-shell-v4';
const DYNAMIC_CACHE = 'dynamic-resources-v4';

const appShellAssets = [
    './', 
    'index.html',
    'pages/otro.html',
    'main.js',
    'sw.js',
    'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css'
];

//Su objetivo es guardar los recursos del App Shell en el caché
self.addEventListener('install', event => {
    console.log('[SW] Instalando y precacheando el App Shell...');
    event.waitUntil(
        caches.open(APP_SHELL_CACHE)
            .then(cache => cache.addAll(appShellAssets))
            .then(() => self.skipWaiting())
    );
});

// Su objetivo es eliminar cachés obsoletas de versiones anteriores.
self.addEventListener('activate', event => {
    console.log('[SW] Activando y limpiando caches antiguas...');
    const allowlist = [APP_SHELL_CACHE, DYNAMIC_CACHE];
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.map(k => allowlist.indexOf(k) === -1 ? caches.delete(k) : Promise.resolve())
            )
        ).then(() => self.clients.claim())
    );
});

// Decide si la respuesta viene del CACHÉ o de la RED, implementando las estrategias definidas.
self.addEventListener('fetch', event => {
    const requestUrl = new URL(event.request.url);
    const pathname = requestUrl.pathname;

    const isAppShellRequest = appShellAssets.some(asset =>
        (requestUrl.href === asset) ||
        (pathname === asset) ||
        (pathname.substring(1) === asset)
    );


// --- ESTRATEGIA 1: CACHE FIRST (Para App Shell) ---
    if (isAppShellRequest) {
        console.log(`[SW] App Shell (cache-first): ${requestUrl.href}`);
        event.respondWith(
            caches.match(event.request).then(resp => resp || fetch(event.request))
        );
        return;
    }

// --- ESTRATEGIA 2: CACHE - SI NO RED (Dynamic Cache) ---
    console.log(`[SW] Dinámico (cache-then-network): ${requestUrl.href}`);
    event.respondWith(
        caches.match(event.request).then(cachedResponse => {
            if (!cachedResponse) {
                return caches.match(event.request.url).then(cachedByUrl => {
                    if (cachedByUrl) {
                        // Notifica al cliente que vino desde cache
                        if (event.clientId) {
                            clients.get(event.clientId).then(client => {
                                if (client) client.postMessage({ url: event.request.url, cached: true });
                            });
                        }
                        console.log(`[SW] Encontrado en cache (por URL): ${event.request.url}`);
                        return cachedByUrl;
                    }
                    // No estaba en cache -> ir a la red
                    return fetchAndCache(event);
                });
            } else {
                // Encontrado en cache (por Request)
                if (event.clientId) {
                    clients.get(event.clientId).then(client => {
                        if (client) client.postMessage({ url: event.request.url, cached: true });
                    });
                }
                console.log(`[SW] Encontrado en cache (por Request): ${event.request.url}`);
                return cachedResponse;
            }
        })
    );

    function fetchAndCache(event) {
        return fetch(event.request).then(networkResponse => {
            const isValid = networkResponse &&
                ((networkResponse.status >= 200 && networkResponse.status < 300) ||
                    networkResponse.type === 'opaque');

            if (!isValid) {
                console.log(`[SW] Respuesta de red no válida (no cacheo):`, networkResponse && networkResponse.status, networkResponse && networkResponse.type);
                return networkResponse;
            }

            const responseToCache = networkResponse.clone();

            // Aseguramos que el SW espere a que termine el guardado en cache
            const cachePromise = caches.open(DYNAMIC_CACHE).then(cache => {
                return cache.put(event.request.url, responseToCache).then(() => {
                    console.log(`[SW] Guardado en Dynamic Cache: ${event.request.url}`);
                });
            });

            event.waitUntil(cachePromise);

            return networkResponse;
        }).catch(err => {
            console.error('[SW] Fallo de red al intentar fetchAndCache para', event.request.url, err);
            return caches.match('/home.html');
        });
    }
});
