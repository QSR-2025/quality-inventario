const CACHE_NAME = "quality-inventario-v2";

const FILES = [
    "./",
    "./index.html",
    "./home.html",
    "./manifest.json",

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

        caches.match(event.request)
            .then(response => {

                return response || fetch(event.request);

            })

    );

});