/* ==========================================================
   API - QUALITY INVENTARIO
   Comunicación con Google Apps Script
   Optimizada para reducir consultas y mejorar velocidad
========================================================== */

const API_URL = "https://script.google.com/macros/s/AKfycbyXeFe-zk6ZaCEgX8c6IAEX_wUvSsANLGIWhiknWaTKquB35SLjoTXsuhgoBIfgUk10/exec";

/* ==========================================================
   CONFIGURACIÓN DE CACHÉ
========================================================== */

const CACHE_TTL = {
    resumen: 30000,              // 30 segundos
    inventario: 30000,           // 30 segundos
    inventarioSPS: 30000,        // 30 segundos
    busqueda: 15000,             // 15 segundos
    movimientos: 30000,          // 30 segundos
    resumenMovimientos: 30000,   // 30 segundos
    mesesVencimientos: 300000,   // 5 minutos
    vencimientos: 60000          // 1 minuto
};

const apiCache = new Map();
const apiRequests = new Map();

/* ==========================================================
   FUNCIÓN GENERAL DE PETICIÓN
========================================================== */

async function apiFetch(url, cacheKey = null, ttl = 0, forzar = false) {

    /* ------------------------------------------------------
       1. Usar caché si todavía está vigente
    ------------------------------------------------------ */

    if (!forzar && cacheKey && apiCache.has(cacheKey)) {

        const cache = apiCache.get(cacheKey);

        if (Date.now() - cache.timestamp < ttl) {
            return cache.data;
        }

        apiCache.delete(cacheKey);
    }

    /* ------------------------------------------------------
       2. Si ya existe una petición idéntica en curso,
          reutilizarla en lugar de hacer otra consulta.
    ------------------------------------------------------ */

    if (!forzar && cacheKey && apiRequests.has(cacheKey)) {
        return apiRequests.get(cacheKey);
    }

    /* ------------------------------------------------------
       3. Crear petición
    ------------------------------------------------------ */

    const request = fetch(url, {
        method: "GET",
        cache: "no-store"
    })
        .then(async respuesta => {

            if (!respuesta.ok) {
                throw new Error(`HTTP ${respuesta.status}`);
            }

            const data = await respuesta.json();

            /* Guardar resultado */
            if (cacheKey) {
                apiCache.set(cacheKey, {
                    timestamp: Date.now(),
                    data
                });
            }

            return data;
        })
        .finally(() => {

            if (cacheKey) {
                apiRequests.delete(cacheKey);
            }

        });

    if (!forzar && cacheKey) {
        apiRequests.set(cacheKey, request);
    }

    return request;
}

/* ==========================================================
   LIMPIAR CACHÉ
========================================================== */

function limpiarCacheAPI() {

    apiCache.clear();

    console.log("Caché de API limpiada");

}

/* ==========================================================
   DASHBOARD
========================================================== */

async function obtenerResumen(forzar = false) {

    const url =
        `${API_URL}?action=getResumen` +
        `&forzar=${forzar ? 1 : 0}`;

    return await apiFetch(
        url,
        "resumen",
        CACHE_TTL.resumen,
        forzar
    );
}

/* ==========================================================
   INVENTARIO
========================================================== */

async function obtenerInventario(forzar = false) {

    const url =
        `${API_URL}?action=getInventario` +
        `&forzar=${forzar ? 1 : 0}`;

    return await apiFetch(
        url,
        "inventario",
        CACHE_TTL.inventario,
        forzar
    );
}

/* ==========================================================
   INVENTARIO BODEGA SPS
========================================================== */

async function obtenerInventarioSPS(forzar = false) {

    const url =
        `${API_URL}?action=getInventarioSPS` +
        `&forzar=${forzar ? 1 : 0}`;

    return await apiFetch(
        url,
        "inventarioSPS",
        CACHE_TTL.inventarioSPS,
        forzar
    );
}
/* ==========================================================
   CARGA INICIAL COMPLETA
   TEGUS + SPS + RESUMEN
========================================================== */

async function obtenerInicio(forzar = false) {

    const url =
        `${API_URL}?action=getInicio` +
        `&forzar=${forzar ? 1 : 0}`;

    return await apiFetch(
        url,
        "inicio",
        CACHE_TTL.inventario,
        forzar
    );
}

/* ==========================================================
   BÚSQUEDA EN SERVIDOR
========================================================== */

async function buscarProductosServidor(texto, forzar = false) {

    texto = String(texto || "").trim();

    if (!texto) {
        return [];
    }

    const cacheKey =
        `busqueda:${texto.toLowerCase()}`;

    const url =
        `${API_URL}?action=buscar` +
        `&q=${encodeURIComponent(texto)}` +
        `&forzar=${forzar ? 1 : 0}`;

    return await apiFetch(
        url,
        cacheKey,
        CACHE_TTL.busqueda,
        forzar
    );
}

/* ==========================================================
   BÚSQUEDA LOCAL
   Se mantiene porque es mucho más rápida que consultar
   Google Apps Script para cada búsqueda.
========================================================== */

function buscarProductos(productos, texto) {

    if (!texto || !texto.trim()) {
        return [];
    }

    texto = texto.toLowerCase().trim();

    return productos.filter(p => {

        const nombre =
            String(p.nombre || "").toLowerCase();

        const sku =
            String(p.sku || "").toLowerCase();

        const proveedor =
            String(p.proveedor || "").toLowerCase();

        const categoria =
            String(p.categoria || "").toLowerCase();

        const enLotes =
            (p.lotes || []).some(l =>
                String(l.numLote || "")
                    .toLowerCase()
                    .includes(texto)
            );

        return (
            nombre.includes(texto) ||
            sku.includes(texto) ||
            proveedor.includes(texto) ||
            categoria.includes(texto) ||
            enLotes
        );

    });

}

/* ==========================================================
   MOVIMIENTOS
========================================================== */

async function obtenerMovimientos(
    fecha = "",
    forzar = false
) {

    const url =
        `${API_URL}?action=getMovimientos` +
        `&fecha=${encodeURIComponent(fecha)}` +
        `&forzar=${forzar ? 1 : 0}`;

    const cacheKey =
        `movimientos:${fecha}`;

    return await apiFetch(
        url,
        cacheKey,
        CACHE_TTL.movimientos,
        forzar
    );
}

/* ==========================================================
   RESUMEN DE MOVIMIENTOS
========================================================== */

async function obtenerResumenMovimientos(
    fecha = "",
    forzar = false
) {

    const url =
        `${API_URL}?action=getResumenMovimientos` +
        `&fecha=${encodeURIComponent(fecha)}` +
        `&forzar=${forzar ? 1 : 0}`;

    const cacheKey =
        `resumenMovimientos:${fecha}`;

    return await apiFetch(
        url,
        cacheKey,
        CACHE_TTL.resumenMovimientos,
        forzar
    );
}

/* ==========================================================
   VENCIMIENTOS
========================================================== */

async function getMesesVencimientos(
    forzar = false
) {

    const url =
        `${API_URL}?action=getMesesVencimientos` +
        `&forzar=${forzar ? 1 : 0}`;

    return await apiFetch(
        url,
        "mesesVencimientos",
        CACHE_TTL.mesesVencimientos,
        forzar
    );
}

/* ==========================================================
   VENCIMIENTOS POR MES
========================================================== */

async function getVencimientos(
    mes,
    forzar = false
) {

    const url =
        `${API_URL}?action=getVencimientos` +
        `&mes=${encodeURIComponent(mes)}` +
        `&forzar=${forzar ? 1 : 0}`;

    const cacheKey =
        `vencimientos:${mes}`;

    return await apiFetch(
        url,
        cacheKey,
        CACHE_TTL.vencimientos,
        forzar
    );
}