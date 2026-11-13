const CACHE_NAME = "quality-inventario-v2-6";

const FILES = [
    "./",
    "./index.html",
    "./home.html",
    "./manifest.json",

    "./css/login.css",
    "./css/home.css",
    "./css/tema-quality.css",

    "./js/api.js",
    "./js/login.js",
    "./js/session.js",
    "./js/home.js",
    "./js/almacen.js",
    "./js/movimientos.js",
    "./js/vencimientos.js",
    "./js/pdf-vencimientos.js",
    "./js/ui.js",
    "./js/gestion.js",

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

    const req = event.request;

    if (req.method !== "GET") return;

    // Solo se gestionan archivos de ESTA aplicación. Las llamadas al backend
    // (script.google.com) y recursos externos pasan directo al navegador:
    // no se guardan en caché (contienen datos y credenciales) y un fallo de red
    // ya no se convierte en un "Failed to fetch" sin explicación.
    if (new URL(req.url).origin !== self.location.origin) return;

    event.respondWith(

        fetch(req)
            .then(response => {

                if (response && response.ok) {
                    const copia = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(req, copia));
                }

                return response;

            })
            .catch(() =>
                caches.match(req).then(cached => cached || Response.error())
            )

    );

});
