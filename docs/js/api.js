/* ==========================================================
   API - QUALITY INVENTARIO
   Comunicación con Google Apps Script
   Optimizada para reducir consultas y mejorar velocidad
========================================================== */

const API_URL = "https://script.google.com/macros/s/AKfycbxOwlNF9n_g8tSrucJraLnN9BbbZp6QW_5G84sraw0Eb4s-YCBNlpbpTLFfCcTkSI_4/exec";

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
/* ==========================================================
   REGISTRO DE MOVIMIENTOS - ALMACÉN
========================================================== */

/** Envía un POST autenticado con el token de la sesión. */
async function postAutenticado(accion, datos) {

    const token = String(localStorage.getItem("qualityToken") || "").trim();

    // Sin token no hay sesión válida: no tiene sentido llamar al servidor.
    if (!token) {
        return {
            success: false,
            codigo: "SIN_TOKEN",
            message: "Esta sesión no tiene token de autenticación (la sesión local se perdió o el servidor de Apps Script desplegado es una versión anterior que no lo entrega). Cierre sesión e ingrese nuevamente; si se repite, actualice la implementación de Apps Script."
        };
    }

    let respuesta;

    try {
        respuesta = await fetch(API_URL, {
            method: "POST",
            body: JSON.stringify({
                action: accion,
                ...datos,
                // El token de la sesión autenticada siempre prevalece sobre
                // cualquier propiedad accidental dentro del objeto del movimiento.
                // El rol NO se envía: el servidor lo consulta en la hoja Usuarios.
                token: token
            })
        });
    } catch (errRed) {
        throw new Error("No se pudo conectar con Apps Script (sin red, URL incorrecta o implementación bloqueada): " + (errRed && errRed.message ? errRed.message : errRed));
    }

    if (!respuesta.ok) {
        throw new Error(`HTTP ${respuesta.status}`);
    }

    // Se lee como texto para poder explicar el error si el servidor NO devolvió JSON
    // (p. ej. una página de login de Google cuando la implementación no es pública).
    const textoRespuesta = await respuesta.text();
    let resultado;

    try {
        resultado = JSON.parse(textoRespuesta);
    } catch (errJson) {
        throw new Error("Apps Script no devolvió JSON válido. Verifique que la implementación esté publicada con acceso «Cualquier persona» y que la URL de api.js sea la de la implementación activa. Respuesta recibida: " + String(textoRespuesta).replace(/\s+/g, " ").slice(0, 160));
    }

    // El servidor indicó que la sesión ya no existe (venció o se reinició la
    // caché): descartar el token local para no reutilizarlo.
    if (resultado && (resultado.codigo === "SESION_INVALIDA" || resultado.codigo === "SIN_TOKEN")) {
        localStorage.removeItem("qualityToken");
    }

    // Si se registró algo, limpiar datos antiguos para que el inventario
    // se recargue actualizado.
    if (resultado && (resultado.success || resultado.procesados > 0)) {
        limpiarCacheAPI();
    }

    return resultado;
}

/** Registra UN movimiento (se conserva por compatibilidad). */
async function registrarMovimiento(datos) {
    return postAutenticado("registrarMovimiento", datos);
}

/**
 * Registra VARIOS productos de una misma factura/traslado en una sola
 * solicitud. `comunes` lleva tipo, bodega, cliente, documento y observación;
 * `items` solo lo propio de cada producto (producto, lote, cantidad, vencimiento).
 */
async function registrarMovimientosLote(comunes, items) {
    return postAutenticado("registrarMovimientos", { ...comunes, items });
}


/* ==========================================================
   LOGOTIPOS DE MARCAS (pestaña Marcas de Tegucigalpa)
========================================================== */
/*
   Lista de marcas y logotipos: dato que casi no cambia. Se guarda en
   localStorage (sin existencias ni URLs temporales: solo nombre, URL pública
   o coordenada de la celda). Estrategia "stale-while-revalidate":
     - < 10 min: se usa directo.
     - 10 min a 24 h: se usa de inmediato y se actualiza en segundo plano.
     - > 24 h o forzar: se pide al servidor.
   Con localStorage.qiOptimizacion = "off" se usa el comportamiento anterior.
*/
const MARCAS_CLAVE_LOCAL = "qi:cache:marcas:v1";
const MARCAS_FRESCO_MS = 10 * 60 * 1000;
const MARCAS_MAXIMO_MS = 24 * 60 * 60 * 1000;

function leerMarcasLocalQI() {
    try {
        const c = JSON.parse(localStorage.getItem(MARCAS_CLAVE_LOCAL) || "null");
        return (c && c.ts && c.data && Array.isArray(c.data.marcas)) ? c : null;
    } catch (e) { return null; }
}

async function pedirMarcasServidorQI(forzar) {
    const url = `${API_URL}?action=getMarcas&forzar=${forzar ? 1 : 0}`;
    const datos = await apiFetch(url, "marcas", 300000, forzar);
    if (datos && Array.isArray(datos.marcas)) {
        try { localStorage.setItem(MARCAS_CLAVE_LOCAL, JSON.stringify({ ts: Date.now(), data: datos })); } catch (e) {}
    }
    return datos;
}

async function obtenerMarcas(forzar = false) {

    if (localStorage.getItem("qiOptimizacion") === "off") {
        return await apiFetch(`${API_URL}?action=getMarcas`, "marcas", 300000, forzar);
    }

    if (!forzar) {
        const local = leerMarcasLocalQI();
        if (local) {
            const edad = Date.now() - local.ts;
            if (edad < MARCAS_FRESCO_MS) return local.data;
            if (edad < MARCAS_MAXIMO_MS) {
                // Se muestra lo guardado y se renueva sin que el usuario espere.
                pedirMarcasServidorQI(false).catch(() => {});
                return local.data;
            }
        }
    }

    return await pedirMarcasServidorQI(forzar);
}
