/* ==========================================================================
   QUALITY INVENTARIO — rendimiento.js  (Fase 2.6)
   Medición de rendimiento para comparar ANTES / DESPUÉS con datos reales.

   Qué hace
   - Registra marcas y duraciones (performance.mark/measure) de los puntos
     que importan: apertura inicial, categorías, logotipos, imágenes de
     Materiales/Repuestos, ficha de producto y cambio de módulo.
   - Cuenta las solicitudes a Apps Script y cuánto tardó cada una.
   - Registra cada imagen: ruta usada (memoria, Cache API, lote, directa,
     solicitud individual), tiempo hasta mostrarse y si falló.
   - No cambia el comportamiento de la aplicación. Si falla, la app sigue.

   Cómo se usa
   - Abrir la app con  ?perf=1  (o Ctrl+Alt+P) para ver el panel.
   - Modo de comparación en el mismo equipo y los mismos datos:
       localStorage.qiOptimizacion = "off"   → ruta de imágenes y render anteriores
       localStorage.qiOptimizacion = "on"    → ruta nueva (predeterminada)
     (el botón del panel lo cambia y recarga).
   - QIPerf.exportar() descarga un JSON; herramientas/comparar-rendimiento.html
     compara dos JSON (antes / después).
========================================================================== */
(function (global) {
    "use strict";

    var VERSION_MEDICION = 1;
    var CLAVE_LOG = "qiPerfRegistros";
    var MAX_REGISTROS = 30;

    var t0 = (global.performance && performance.timeOrigin) ? 0 : 0;   // los tiempos son relativos a navigationStart
    var metricas = [];        // { nombre, ms, extra }
    var abiertos = {};        // nombre -> inicio (ms)
    var imagenes = [];        // { tipo, ruta, ms, ok, hoja }
    var peticiones = [];      // { accion, ms, ok, metodo }
    var larga = { n: 0, ms: 0 };
    var lcp = null;

    function ahora() { return (global.performance && performance.now) ? performance.now() : Date.now(); }

    function modo() {
        try { return localStorage.getItem("qiOptimizacion") === "off" ? "anterior" : "optimizado"; } catch (e) { return "optimizado"; }
    }

    function marca(nombre, extra) {
        var t = ahora();
        try { performance.mark("qi:" + nombre); } catch (e) {}
        metricas.push({ nombre: nombre, ms: Math.round(t * 10) / 10, extra: extra || null, tipo: "marca" });
        refrescarPanel();
        return t;
    }

    /** Empieza a medir una duración con nombre. Devuelve una función que la cierra. */
    function inicio(nombre) {
        abiertos[nombre] = ahora();
        return function fin(extra) { return cerrar(nombre, extra); };
    }

    function cerrar(nombre, extra) {
        if (abiertos[nombre] === undefined) return null;
        var d = ahora() - abiertos[nombre];
        delete abiertos[nombre];
        metricas.push({ nombre: nombre, ms: Math.round(d * 10) / 10, extra: extra || null, tipo: "duracion" });
        refrescarPanel();
        return d;
    }

    /** Cierra la duración cuando el navegador ya pintó (dos requestAnimationFrame). */
    function cerrarTrasPintar(nombre, extra) {
        if (abiertos[nombre] === undefined) return;
        requestAnimationFrame(function () { requestAnimationFrame(function () { cerrar(nombre, extra); }); });
    }

    function registrarImagen(info) {
        imagenes.push(info);
        if (imagenes.length > 2000) imagenes.shift();
        refrescarPanel();
    }

    function registrarPeticion(info) {
        peticiones.push(info);
        if (peticiones.length > 2000) peticiones.shift();
        refrescarPanel();
    }

    /* ---------- observadores del navegador ---------- */
    try {
        if ("PerformanceObserver" in global) {
            try {
                new PerformanceObserver(function (lista) {
                    lista.getEntries().forEach(function (e) { larga.n++; larga.ms += e.duration; });
                }).observe({ type: "longtask", buffered: true });
            } catch (e) {}
            try {
                new PerformanceObserver(function (lista) {
                    var ent = lista.getEntries();
                    if (ent.length) lcp = Math.round(ent[ent.length - 1].startTime);
                }).observe({ type: "largest-contentful-paint", buffered: true });
            } catch (e) {}
        }
    } catch (e) {}

    /* ---------- estadísticas ---------- */
    function pct(arr, p) {
        if (!arr.length) return null;
        var o = arr.slice().sort(function (a, b) { return a - b; });
        var i = Math.min(o.length - 1, Math.max(0, Math.ceil(p / 100 * o.length) - 1));
        return Math.round(o[i]);
    }

    function resumenImagenes() {
        var grupos = {};
        imagenes.forEach(function (im) {
            var k = im.tipo || "otros";
            (grupos[k] = grupos[k] || { n: 0, fallidas: 0, ms: [], rutas: {}, ts: [] });
            var g = grupos[k];
            g.n++;
            if (im.t !== undefined) g.ts.push(im.t);
            if (!im.ok) g.fallidas++;
            else g.ms.push(im.ms);
            g.rutas[im.ruta] = (g.rutas[im.ruta] || 0) + 1;
        });
        var salida = {};
        Object.keys(grupos).forEach(function (k) {
            var g = grupos[k];
            salida[k] = { n: g.n, fallidas: g.fallidas, p50: pct(g.ms, 50), p95: pct(g.ms, 95), max: g.ms.length ? Math.round(Math.max.apply(null, g.ms)) : null,
                primeraMs: g.ts.length ? Math.round(Math.min.apply(null, g.ts)) : null, ultimaMs: g.ts.length ? Math.round(Math.max.apply(null, g.ts)) : null, rutas: g.rutas };
        });
        return salida;
    }

    function resumenPeticiones() {
        var grupos = {};
        peticiones.forEach(function (p) {
            var k = (p.metodo || "GET") + " " + (p.accion || "?");
            (grupos[k] = grupos[k] || { n: 0, ms: [], errores: 0 });
            grupos[k].n++;
            grupos[k].ms.push(p.ms);
            if (!p.ok) grupos[k].errores++;
        });
        var salida = {}, total = 0;
        Object.keys(grupos).forEach(function (k) {
            var g = grupos[k];
            total += g.n;
            salida[k] = { n: g.n, errores: g.errores, p50: pct(g.ms, 50), p95: pct(g.ms, 95), max: Math.round(Math.max.apply(null, g.ms)) };
        });
        return { total: total, porAccion: salida };
    }

    function entorno() {
        var c = global.navigator && navigator.connection ? navigator.connection : {};
        return {
            userAgent: navigator.userAgent,
            memoriaGB: navigator.deviceMemory || null,
            nucleos: navigator.hardwareConcurrency || null,
            conexion: c.effectiveType || null,
            rttMs: c.rtt || null,
            bajadaMbps: c.downlink || null,
            ancho: global.innerWidth, alto: global.innerHeight, dpr: global.devicePixelRatio || 1,
            modoLigero: !!(document.body && document.body.classList.contains("qi-lite")),
            movil: /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)
        };
    }

    function reporte() {
        var nav = null;
        try { nav = performance.getEntriesByType("navigation")[0] || null; } catch (e) {}
        var r = {
            version: VERSION_MEDICION,
            fecha: new Date().toISOString(),
            modo: modo(),
            pagina: location.pathname.split("/").pop() || "index",
            entorno: entorno(),
            navegacion: nav ? {
                domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
                load: Math.round(nav.loadEventEnd),
                transferenciaHtml: nav.transferSize || null
            } : null,
            lcp: lcp,
            tareasLargas: { cantidad: larga.n, msTotales: Math.round(larga.ms) },
            metricas: metricas.slice(),
            imagenes: resumenImagenes(),
            peticiones: resumenPeticiones()
        };
        return r;
    }

    function guardarEnRegistro() {
        try {
            var lista = JSON.parse(localStorage.getItem(CLAVE_LOG) || "[]");
            lista.push(reporte());
            while (lista.length > MAX_REGISTROS) lista.shift();
            localStorage.setItem(CLAVE_LOG, JSON.stringify(lista));
        } catch (e) {}
    }

    function exportar() {
        var datos = JSON.stringify(reporte(), null, 2);
        var blob = new Blob([datos], { type: "application/json" });
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "rendimiento-" + modo() + "-" + (new Date().toISOString().replace(/[:.]/g, "-")) + ".json";
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    }

    /* ---------- fetch instrumentado (solo para medir llamadas a Apps Script) ---------- */
    (function instrumentarFetch() {
        if (!global.fetch || global.fetch.__qiPerf) return;
        var original = global.fetch.bind(global);
        function envoltura(entrada, opciones) {
            var url = typeof entrada === "string" ? entrada : (entrada && entrada.url) || "";
            if (url.indexOf("script.google.com") === -1) return original(entrada, opciones);
            var metodo = (opciones && opciones.method) || (entrada && entrada.method) || "GET";
            var accion = "";
            try {
                if (metodo === "GET") { var m = url.match(/[?&]action=([^&]+)/); accion = m ? m[1] : "?"; }
                else if (opciones && typeof opciones.body === "string") { var j = JSON.parse(opciones.body); accion = j.action || "?"; }
            } catch (e) { accion = "?"; }
            var t = ahora();
            return original(entrada, opciones).then(function (r) {
                registrarPeticion({ accion: accion, metodo: metodo, ms: ahora() - t, ok: r.ok });
                return r;
            }, function (err) {
                registrarPeticion({ accion: accion, metodo: metodo, ms: ahora() - t, ok: false });
                throw err;
            });
        }
        envoltura.__qiPerf = true;
        global.fetch = envoltura;
    })();

    /* ---------- panel opcional ---------- */
    var panel = null;
    var pendienteRefresco = false;

    function panelActivo() {
        try { return /[?&]perf=1/.test(location.search) || localStorage.getItem("qiPerf") === "1"; } catch (e) { return false; }
    }

    function refrescarPanel() {
        if (!panel || pendienteRefresco) return;
        pendienteRefresco = true;
        setTimeout(function () { pendienteRefresco = false; dibujarPanel(); }, 400);
    }

    function dibujarPanel() {
        if (!panel) return;
        var r = reporte();
        var filas = r.metricas.filter(function (m) { return m.tipo === "duracion"; }).slice(-14).map(function (m) {
            return "<tr><td>" + m.nombre + "</td><td>" + m.ms + " ms</td></tr>";
        }).join("");
        var imgs = Object.keys(r.imagenes).map(function (k) {
            var g = r.imagenes[k];
            return "<tr><td>img " + k + "</td><td>" + g.n + " · p50 " + g.p50 + " · p95 " + g.p95 + " ms" + (g.fallidas ? " · " + g.fallidas + " fallidas" : "") + "</td></tr>";
        }).join("");
        var peti = "<tr><td>Solicitudes a Apps Script</td><td>" + r.peticiones.total + "</td></tr>";
        panel.querySelector(".qi-perf-cuerpo").innerHTML =
            "<table>" + "<tr><td>Modo</td><td><b>" + r.modo + "</b></td></tr>" +
            "<tr><td>LCP</td><td>" + (r.lcp === null ? "—" : r.lcp + " ms") + "</td></tr>" +
            "<tr><td>Tareas largas</td><td>" + r.tareasLargas.cantidad + " (" + r.tareasLargas.msTotales + " ms)</td></tr>" +
            peti + filas + imgs + "</table>";
    }

    function crearPanel() {
        if (panel || !document.body) return;
        panel = document.createElement("div");
        panel.className = "qi-perf-panel";
        panel.setAttribute("role", "complementary");
        panel.innerHTML =
            '<div class="qi-perf-barra"><strong>Rendimiento</strong>' +
            '<span><button type="button" data-a="modo">Cambiar modo</button> <button type="button" data-a="exportar">Exportar</button> <button type="button" data-a="cerrar">×</button></span></div>' +
            '<div class="qi-perf-cuerpo"></div>';
        var css = document.createElement("style");
        css.textContent =
            ".qi-perf-panel{position:fixed;right:10px;bottom:10px;z-index:99999;width:min(360px,calc(100vw - 20px));max-height:60vh;overflow:auto;background:#0b1b3a;color:#e8f0ff;border-radius:12px;font:12px/1.4 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.35)}" +
            ".qi-perf-barra{display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.15)}" +
            ".qi-perf-barra button{background:#145be2;color:#fff;border:0;border-radius:6px;padding:3px 8px;font:inherit;cursor:pointer}" +
            ".qi-perf-cuerpo{padding:6px 10px}.qi-perf-cuerpo table{width:100%;border-collapse:collapse}.qi-perf-cuerpo td{padding:2px 0;vertical-align:top}.qi-perf-cuerpo td:last-child{text-align:right}";
        document.head.appendChild(css);
        document.body.appendChild(panel);
        panel.addEventListener("click", function (e) {
            var a = e.target && e.target.getAttribute && e.target.getAttribute("data-a");
            if (a === "exportar") exportar();
            if (a === "cerrar") { panel.remove(); panel = null; try { localStorage.removeItem("qiPerf"); } catch (x) {} }
            if (a === "modo") {
                try { localStorage.setItem("qiOptimizacion", modo() === "optimizado" ? "off" : "on"); } catch (x) {}
                location.reload();
            }
        });
        dibujarPanel();
    }

    document.addEventListener("keydown", function (e) {
        if (e.ctrlKey && e.altKey && (e.key === "p" || e.key === "P")) {
            if (panel) { panel.remove(); panel = null; } else { try { localStorage.setItem("qiPerf", "1"); } catch (x) {} crearPanel(); }
        }
    });

    document.addEventListener("DOMContentLoaded", function () { if (panelActivo()) crearPanel(); });
    global.addEventListener("pagehide", guardarEnRegistro);

    global.QIPerf = {
        marca: marca, inicio: inicio, cerrar: cerrar, cerrarTrasPintar: cerrarTrasPintar,
        registrarImagen: registrarImagen, registrarPeticion: registrarPeticion,
        reporte: reporte, exportar: exportar, modo: modo,
        registros: function () { try { return JSON.parse(localStorage.getItem(CLAVE_LOG) || "[]"); } catch (e) { return []; } },
        reiniciar: function () { metricas.length = 0; imagenes.length = 0; peticiones.length = 0; larga.n = 0; larga.ms = 0; refrescarPanel(); }
    };

    marca("script:rendimiento-cargado");
})(window);
