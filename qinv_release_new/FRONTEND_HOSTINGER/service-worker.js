/* Quality Inventario — Service Worker (Fase 2.7)
   - Archivos de la app (HTML/JS/CSS): red primero, con respaldo en caché si la red
     tarda más de 4 s o falla (mantiene la corrección del error de archivos viejos).
   - Iconos/logo: caché primero (cambian muy rara vez).
   - Backend (script.google.com) y recursos externos: NO se interceptan.
   - Solo se borran cachés propias de versiones anteriores del SW; las cachés de
     imágenes (qi-img-*) pertenecen a js/imagenes.js y NO se tocan. */
const CACHE_NAME = "quality-inventario-v3-1";
const V = "?v=3.1.0";

const FILES = [
    "./", "./index.html", "./home.html", "./manifest.json",
    "./css/login.css", "./css/home.css" + V, "./css/tema-quality.css" + V,
    "./js/rendimiento.js" + V, "./js/session.js" + V, "./js/api.js" + V, "./js/imagenes.js" + V,
    "./js/home.js" + V, "./js/almacen.js" + V, "./js/movimientos.js" + V, "./js/vencimientos.js" + V,
    "./js/pdf-vencimientos.js" + V, "./js/ui.js" + V, "./js/gestion.js" + V, "./js/libs.js" + V,
    "./js/login.js", "./css/directorio.css" + V, "./js/directorio.js" + V,
    "./assets/logo.png", "./assets/icon-192.png", "./assets/icon-512.png"
];

const ESPERA_RED_MS = 4000;

self.addEventListener("install", event => {
    self.skipWaiting();
    // Un archivo que falle no debe impedir la instalación.
    event.waitUntil(caches.open(CACHE_NAME).then(cache =>
        Promise.allSettled(FILES.map(f => cache.add(f)))));
});

self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys().then(keys => Promise.all(keys.map(key =>
            (key.indexOf("quality-inventario-") === 0 && key !== CACHE_NAME) ? caches.delete(key) : null))));
    self.clients.claim();
});

function esRecursoEstatico(url) {
    return /\/assets\//.test(url.pathname);
}

self.addEventListener("fetch", event => {
    const req = event.request;
    if (req.method !== "GET") return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;

    // Imágenes propias de la app: caché primero.
    if (esRecursoEstatico(url)) {
        event.respondWith(caches.match(req).then(c => c || fetch(req).then(r => {
            if (r && r.ok) { const copia = r.clone(); caches.open(CACHE_NAME).then(cache => cache.put(req, copia)); }
            return r;
        })));
        return;
    }

    // Resto: red primero con tiempo máximo.
    event.respondWith(new Promise(resolve => {
        let resuelto = false;
        const temporizador = setTimeout(() => {
            caches.match(req).then(c => { if (c && !resuelto) { resuelto = true; resolve(c); } });
        }, ESPERA_RED_MS);
        fetch(req).then(r => {
            clearTimeout(temporizador);
            if (r && r.ok) { const copia = r.clone(); caches.open(CACHE_NAME).then(cache => cache.put(req, copia)); }
            if (!resuelto) { resuelto = true; resolve(r); }
        }).catch(() => {
            clearTimeout(temporizador);
            caches.match(req).then(c => { if (!resuelto) { resuelto = true; resolve(c || Response.error()); } });
        });
    }));
});
