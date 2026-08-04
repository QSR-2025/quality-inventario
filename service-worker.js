const CACHE_NAME = "quality-inventario-v1";

const FILES = [
    "./",
    "./index.html",
    "./css/home.css",
    "./js/api.js",
    "./js/home.js",
    "./js/movimientos.js"
];

self.addEventListener("install", event => {

    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(FILES))
    );

});

self.addEventListener("fetch", event => {

    event.respondWith(
        caches.match(event.request)
            .then(response => response || fetch(event.request))
    );

});