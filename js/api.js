/* ==========================================================
   API - QUALITY INVENTARIO
   Comunicación con Google Apps Script
========================================================== */

const API_URL = "https://script.google.com/macros/s/AKfycbxsTwd1nXyYnIzHFuZn5suqY-2oC-gZnQ9kaBi_te3KLMlpViCXcs5VQmNQL13NPdkZ/exec";

/* ==========================================================
   DASHBOARD
========================================================== */

async function obtenerResumen(forzar = false) {

    const url = `${API_URL}?action=getResumen&forzar=${forzar ? 1 : 0}`;

    const respuesta = await fetch(url);

    if (!respuesta.ok) {
        throw new Error(`HTTP ${respuesta.status}`);
    }

    return await respuesta.json();

}

async function obtenerInventario(forzar = false) {

    const url = `${API_URL}?action=getInventario&forzar=${forzar ? 1 : 0}`;

    const respuesta = await fetch(url);

    if (!respuesta.ok) {
        throw new Error(`HTTP ${respuesta.status}`);
    }

    return await respuesta.json();

}

/* ==========================================================
   BÚSQUEDA
========================================================== */

async function buscarProductosServidor(texto, forzar = false) {

    const url =
        `${API_URL}?action=buscar&q=${encodeURIComponent(texto)}` +
        `&forzar=${forzar ? 1 : 0}`;

    const respuesta = await fetch(url);

    if (!respuesta.ok) {
        throw new Error(`HTTP ${respuesta.status}`);
    }

    return await respuesta.json();

}

function buscarProductos(productos, texto) {

    if (!texto.trim()) return [];

    texto = texto.toLowerCase();

    return productos.filter(p => {

        const enLotes = (p.lotes || []).some(l =>
            String(l.numLote || "").toLowerCase().includes(texto)
        );

        return (

            (p.nombre || "").toLowerCase().includes(texto) ||

            (p.sku || "").toLowerCase().includes(texto) ||

            (p.proveedor || "").toLowerCase().includes(texto) ||

            (p.categoria || "").toLowerCase().includes(texto) ||

            enLotes

        );

    });

}

/* ==========================================================
   MOVIMIENTOS
========================================================== */

async function obtenerMovimientos(fecha = "", forzar = false) {

    const url =
        `${API_URL}?action=getMovimientos` +
        `&fecha=${encodeURIComponent(fecha)}` +
        `&forzar=${forzar ? 1 : 0}`;

    const respuesta = await fetch(url);

    if (!respuesta.ok) {
        throw new Error(`HTTP ${respuesta.status}`);
    }

    return await respuesta.json();

}

/* ==========================================================
   RESUMEN MOVIMIENTOS
========================================================== */

async function obtenerResumenMovimientos(fecha = "") {

    const url =
        `${API_URL}?action=getResumenMovimientos` +
        `&fecha=${encodeURIComponent(fecha)}`;

    const respuesta = await fetch(url);

    if (!respuesta.ok) {
        throw new Error(`HTTP ${respuesta.status}`);
    }

    return await respuesta.json();

}
