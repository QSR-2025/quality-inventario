const CACHE_NAME = "quality-inventario-v4";

const FILES = [
    "./",
    "./index.html",
    "./home.html",
    "./manifest.json",

    "./css/login.css",
    "./css/home.css",

    "./js/api.js",
    "./js/login.js",
    "./js/home.js",
    "./js/movimientos.js",

    "./assets/logo.png",
    "./assets/icon-192.png",
    "./assets/icon-512.png"
];

/* ==========================
   INSTALACIÓN
========================== */

self.addEventListener("install", event => {

    self.skipWaiting();

    event.waitUntil(

        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(FILES))

    );

});

/* ==========================
   ACTIVACIÓN
========================== */

self.addEventListener("activate", event => {

    event.waitUntil(

        caches.keys().then(keys => {

            return Promise.all(

                keys.map(key => {

                    if (key !== CACHE_NAME) {
                        return caches.delete(key);
                    }

                })

            );

        })

    );

    self.clients.claim();

});

/* ==========================
   FETCH
========================== */

self.addEventListener("fetch", event => {

    if (event.request.method !== "GET") return;

    event.respondWith(

        fetch(event.request)
            .then(response => {

                const copia = response.clone();

                caches.open(CACHE_NAME)
                    .then(cache => cache.put(event.request, copia));

                return response;

            })
            .catch(() => {

                return caches.match(event.request);

            })

    );

});