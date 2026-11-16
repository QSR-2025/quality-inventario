/* ==========================================================================
   QUALITY INVENTARIO — imagenes.js  (Fase 2.6)
   Carga de imágenes: logotipos, fotos de Reactivos y imágenes incrustadas
   de Materiales/Repuestos.

   PROBLEMAS QUE RESUELVE (encontrados en la revisión del código anterior)
   1. Cada imagen incrustada en una celda hacía su PROPIA solicitud POST a
      Apps Script (autenticación + apertura del Spreadsheet + getImages() +
      descarga), y se pedía al crear la tarjeta aunque no estuviera visible.
      → Ahora: se pide solo lo visible (IntersectionObserver), agrupado en
        lotes de hasta 8 por solicitud, con máximo 2 lotes simultáneos.
   2. La caché era un Map en memoria con 30 s (URL temporal) o 5 min: se
      perdía al recargar y expiraba mientras se navegaba.
      → Ahora: memoria + Cache API del navegador (persistente entre visitas),
        guardando la IMAGEN (blob), nunca la URL temporal de Google.
   3. El mismo logotipo se pedía una vez por tarjeta de categoría.
      → Ahora: una sola descarga por imagen (deduplicación por clave).
   4. Una imagen lenta o fallida no debe bloquear nada: cada imagen se
      resuelve de forma independiente y la tarjeta ya está pintada.

   QUÉ NO CAMBIA
   - Los nombres y firmas de cargarImagenConRespaldoQI / obtenerImagenDriveQI
     se conservan: home.js y almacen.js siguen llamándolas igual.
   - Si el servidor aún tiene el Code.gs anterior (sin getImagenesLote), se
     usa automáticamente la solicitud individual getImagenDrive.
   - localStorage.qiOptimizacion = "off" reactiva el comportamiento anterior
     (para comparar tiempos en el mismo equipo).
========================================================================== */
(function (global) {
    "use strict";

    /* ------------------------------------------------------------------
       CONFIGURACIÓN
    ------------------------------------------------------------------ */
    var HORA = 60 * 60 * 1000;

    var CFG = {
        maxLote: 8,                 // imágenes por solicitud a Apps Script
        ventanaAgrupacionMs: 40,    // espera para juntar solicitudes en un lote
        lotesSimultaneos: 2,
        individualesSimultaneos: 3,
        reintentosLoteLleno: 3,
        dwellMs: 80,                // una imagen debe permanecer visible este tiempo antes de pedirse
        margenObservador: "400px 0px",
        negativoMs: 60 * 1000,      // no reintentar una imagen fallida durante 1 min
        temporalMs: 25 * 1000,      // vida de una URL temporal de Google en memoria
        maxMemoriaBytes: 80 * 1024 * 1024,
        maxEntradasPorCubo: 300,
        // Duración de la caché PERSISTENTE por tipo. Existencias, movimientos y
        // URLs temporales nunca se guardan aquí.
        ttl: {
            marcas: 24 * HORA,
            materiales: 6 * HORA,
            repuestos: 6 * HORA,
            reactivos: 12 * HORA,
            otros: 6 * HORA
        }
    };

    var CUBOS = {
        marcas: "qi-img-marcas-v1",
        materiales: "qi-img-materiales-v1",
        repuestos: "qi-img-repuestos-v1",
        reactivos: "qi-img-reactivos-v1",
        otros: "qi-img-otros-v1"
    };

    function optimizacionActiva() {
        try { return localStorage.getItem("qiOptimizacion") !== "off"; } catch (e) { return true; }
    }

    function ahora() { return (global.performance && performance.now) ? performance.now() : Date.now(); }

    function leerToken() {
        try { return String(localStorage.getItem("qualityToken") || "").trim(); } catch (e) { return ""; }
    }

    /* ------------------------------------------------------------------
       UTILIDADES DE URL (se movieron desde home.js sin cambiar su lógica)
    ------------------------------------------------------------------ */
    function extraerIdDriveQI(url) {
        var texto = String(url || "");
        var m = texto.match(/(?:\/file\/d\/|\/d\/|[?&]id=)([A-Za-z0-9_-]{10,})/);
        return m ? m[1] : "";
    }

    function esUrlProxyableQI(url) {
        try {
            var u = new URL(String(url || ""));
            var host = u.hostname.toLowerCase();
            return (host === "qualityhn.com" || host === "www.qualityhn.com") && u.pathname.toLowerCase().indexOf("/wp-content/uploads/") === 0;
        } catch (e) { return false; }
    }

    /** Punto de extensión: si WordPress genera miniaturas, se puede devolver otra URL (ver README). */
    function miniatura(url) {
        try {
            if (global.QI_IMG_CONFIG && typeof global.QI_IMG_CONFIG.miniatura === "function") {
                var r = global.QI_IMG_CONFIG.miniatura(url);
                if (r) return String(r);
            }
        } catch (e) {}
        return url;
    }

    function tipoDeFuente(fuente, opciones) {
        if (opciones && opciones.tipo && CUBOS[opciones.tipo]) return opciones.tipo;
        var hoja = String(fuente && fuente.hoja || "");
        if (hoja === "Marcas") return "marcas";
        if (/repuesto/i.test(hoja)) return "repuestos";
        if (hoja) return "materiales";
        return "otros";
    }

    function normalizar(v) {
        return String(v == null ? "" : v).trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    }

    /** Clave estable de una imagen de celda: no incluye la fila (puede cambiar) ni la URL temporal. */
    function claveFuente(f) {
        var ref = normalizar(f.ref);
        if (ref) return "celda|" + f.hoja + "|" + f.columna + "|" + ref;
        return "celda-fila|" + f.hoja + "|" + f.fila + "|" + f.columna;
    }

    function registrar(info) {
        try { if (global.QIPerf) QIPerf.registrarImagen(info); } catch (e) {}
    }

    /* ------------------------------------------------------------------
       CACHÉ EN MEMORIA (blob → object URL)
    ------------------------------------------------------------------ */
    var memoria = new Map();      // clave -> { src, ts, ttl, bytes, temporal }
    var memoriaBytes = 0;
    var negativos = new Map();    // clave -> ts del último fallo
    var enVuelo = new Map();      // clave -> Promise

    function memoriaVigente(clave) {
        var e = memoria.get(clave);
        if (!e) return null;
        if (Date.now() - e.ts >= e.ttl) { quitarMemoria(clave); return null; }
        return e;
    }

    function quitarMemoria(clave) {
        var e = memoria.get(clave);
        if (!e) return;
        memoria.delete(clave);
        memoriaBytes -= e.bytes || 0;
        if (!e.temporal && /^blob:/.test(e.src)) { try { URL.revokeObjectURL(e.src); } catch (x) {} }
    }

    function guardarMemoria(clave, blob, ttl) {
        quitarMemoria(clave);
        var src = URL.createObjectURL(blob);
        memoria.set(clave, { src: src, ts: Date.now(), ttl: ttl, bytes: blob.size || 0, temporal: false });
        memoriaBytes += blob.size || 0;
        // Si se supera el presupuesto de memoria se descartan las más antiguas.
        if (memoriaBytes > CFG.maxMemoriaBytes) {
            var orden = Array.from(memoria.entries()).sort(function (a, b) { return a[1].ts - b[1].ts; });
            for (var i = 0; i < orden.length && memoriaBytes > CFG.maxMemoriaBytes * 0.8; i++) {
                if (orden[i][0] !== clave) quitarMemoria(orden[i][0]);
            }
        }
        return src;
    }

    function guardarMemoriaTemporal(clave, urlTemporal) {
        quitarMemoria(clave);
        memoria.set(clave, { src: urlTemporal, ts: Date.now(), ttl: CFG.temporalMs, bytes: 0, temporal: true });
        return urlTemporal;
    }

    /* ------------------------------------------------------------------
       CACHE API (persistente entre visitas). Solo guarda imágenes (blob).
    ------------------------------------------------------------------ */
    var cubosAbiertos = {};

    function abrirCubo(tipo) {
        if (!global.caches || !global.caches.open) return Promise.resolve(null);
        if (!cubosAbiertos[tipo]) cubosAbiertos[tipo] = global.caches.open(CUBOS[tipo]).catch(function () { return null; });
        return cubosAbiertos[tipo];
    }

    function solicitudCubo(tipo, clave) {
        return new Request(global.location.origin + "/__qi_img__/" + tipo + "/" + encodeURIComponent(clave));
    }

    function leerCubo(tipo, clave) {
        return abrirCubo(tipo).then(function (cubo) {
            if (!cubo) return null;
            var req = solicitudCubo(tipo, clave);
            return cubo.match(req).then(function (resp) {
                if (!resp) return null;
                var ts = Number(resp.headers.get("X-QI-TS") || 0);
                var ttl = Number(resp.headers.get("X-QI-TTL") || 0);
                if (!ts || !ttl || Date.now() - ts >= ttl) { cubo.delete(req); return null; }
                return resp.blob().then(function (blob) { return { blob: blob, ts: ts, ttl: ttl }; });
            });
        }).catch(function () { return null; });
    }

    function escribirCubo(tipo, clave, blob, ttl) {
        return abrirCubo(tipo).then(function (cubo) {
            if (!cubo) return;
            var headers = { "Content-Type": blob.type || "image/jpeg", "X-QI-TS": String(Date.now()), "X-QI-TTL": String(ttl) };
            return cubo.put(solicitudCubo(tipo, clave), new Response(blob, { headers: headers }));
        }).catch(function () {});
    }

    /** Limpieza ocasional: borra caducadas y recorta cada cubo al máximo. Se ejecuta en reposo. */
    function podarCubos() {
        if (!global.caches || !global.caches.keys) return;
        global.caches.keys().then(function (nombres) {
            var vigentes = Object.keys(CUBOS).map(function (k) { return CUBOS[k]; });
            return Promise.all(nombres.map(function (n) {
                // Cubos de versiones anteriores de este mismo módulo.
                if (/^qi-img-/.test(n) && vigentes.indexOf(n) === -1) return global.caches.delete(n);
            }));
        }).then(function () {
            return Promise.all(Object.keys(CUBOS).map(function (tipo) {
                return abrirCubo(tipo).then(function (cubo) {
                    if (!cubo) return;
                    return cubo.keys().then(function (reqs) {
                        return Promise.all(reqs.map(function (req) {
                            return cubo.match(req).then(function (resp) {
                                if (!resp) return null;
                                var ts = Number(resp.headers.get("X-QI-TS") || 0);
                                var ttl = Number(resp.headers.get("X-QI-TTL") || 0);
                                if (!ts || !ttl || Date.now() - ts >= ttl) { cubo.delete(req); return null; }
                                return { req: req, ts: ts };
                            });
                        })).then(function (lista) {
                            var vivas = lista.filter(Boolean).sort(function (a, b) { return a.ts - b.ts; });
                            var sobran = vivas.length - CFG.maxEntradasPorCubo;
                            for (var i = 0; i < sobran; i++) cubo.delete(vivas[i].req);
                        });
                    });
                });
            }));
        }).catch(function () {});
    }

    /** Vacía todo lo guardado (memoria y Cache API). Úsese si se reemplazaron imágenes en Sheets. */
    function invalidar() {
        Array.from(memoria.keys()).forEach(quitarMemoria);
        negativos.clear();
        if (global.caches && global.caches.delete) {
            Object.keys(CUBOS).forEach(function (t) { delete cubosAbiertos[t]; global.caches.delete(CUBOS[t]); });
        }
        return true;
    }

    function dataUrlABlob(dataUrl) {
        return fetch(dataUrl).then(function (r) { return r.blob(); }).catch(function () {
            var i = dataUrl.indexOf(",");
            var mime = dataUrl.slice(5, i).split(";")[0];
            var bin = atob(dataUrl.slice(i + 1));
            var u8 = new Uint8Array(bin.length);
            for (var k = 0; k < bin.length; k++) u8[k] = bin.charCodeAt(k);
            return new Blob([u8], { type: mime });
        });
    }

    /* ------------------------------------------------------------------
       SOLICITUDES A APPS SCRIPT: lotes e individuales
    ------------------------------------------------------------------ */
    var soportaLote = true;       // pasa a false si el servidor responde "Acción no válida"
    var cola = [];                // elementos esperando ir en un lote
    var lotesActivos = 0;
    var temporizadorLote = null;
    var individualesActivos = 0;
    var colaIndividual = [];
    var secuencia = 0;

    function encolarLote(item) {
        return new Promise(function (resolve, reject) {
            item.resolve = resolve; item.reject = reject; item.orden = ++secuencia; item.intentos = 0;
            cola.push(item);
            programarVaciado();
        });
    }

    function programarVaciado() {
        if (temporizadorLote !== null) return;
        temporizadorLote = setTimeout(function () { temporizadorLote = null; vaciarCola(); }, CFG.ventanaAgrupacionMs);
    }

    function vaciarCola() {
        while (lotesActivos < CFG.lotesSimultaneos && cola.length) {
            // Primero lo más cercano a la vista; a igual prioridad, el que llegó antes.
            cola.sort(function (a, b) { return (a.prioridad - b.prioridad) || (a.orden - b.orden); });
            var lote = cola.splice(0, CFG.maxLote);
            enviarLote(lote);
        }
    }

    function rechazarTodos(items, mensaje) {
        items.forEach(function (it) {
            negativos.set(it.key, Date.now());
            it.reject(new Error(mensaje));
        });
    }

    function enviarLote(items) {
        lotesActivos++;
        var token = leerToken();
        if (!token) { rechazarTodos(items, "sin_token"); lotesActivos--; return; }
        if (!soportaLote) {
            items.forEach(individual);
            lotesActivos--;
            return;
        }
        fetch(API_URL, {
            method: "POST",
            body: JSON.stringify({
                action: "getImagenesLote",
                token: token,
                items: items.map(function (it) { return { hoja: it.fuente.hoja, fila: it.fuente.fila, columna: it.fuente.columna, ref: it.fuente.ref }; })
            })
        }).then(function (resp) {
            return resp.json().then(function (data) { return { resp: resp, data: data }; });
        }).then(function (r) {
            var data = r.data;
            if (r.resp.ok && data && data.success === true && Array.isArray(data.resultados)) {
                items.forEach(function (it, i) { procesarResultado(it, data.resultados[i] || { ok: false, motivo: "SIN_RESPUESTA" }); });
                return;
            }
            var msg = String(data && (data.message || data.mensaje) || "");
            if (/acci[oó]n no v[aá]lida/i.test(msg)) {
                // El Code.gs desplegado es anterior a la Fase 2.6: usar la solicitud individual.
                soportaLote = false;
                items.forEach(individual);
                return;
            }
            rechazarTodos(items, (data && data.codigo) || ("http_" + r.resp.status));
        }).catch(function () {
            rechazarTodos(items, "red");
        }).then(function () {
            lotesActivos--;
            vaciarCola();
        });
    }

    function procesarResultado(it, r) {
        if (r && r.ok && r.dataUrl) {
            dataUrlABlob(r.dataUrl).then(function (blob) {
                var ttl = CFG.ttl[it.tipo] || CFG.ttl.otros;
                escribirCubo(it.tipo, it.key, blob, ttl);
                var src = guardarMemoria(it.key, blob, ttl);
                it.resolve({ src: src, ruta: r.origen === "cache" ? "lote:cache-servidor" : "lote:origen" });
            }).catch(function () { negativos.set(it.key, Date.now()); it.reject(new Error("blob")); });
            return;
        }
        if (r && r.ok && r.imageUrl) {
            // URL temporal recién generada: se usa ahora, no se guarda de forma persistente.
            it.resolve({ src: guardarMemoriaTemporal(it.key, r.imageUrl), ruta: "lote:url-temporal" });
            return;
        }
        if (r && r.pendiente && it.intentos < CFG.reintentosLoteLleno) {
            it.intentos++; it.orden = ++secuencia; cola.push(it); programarVaciado();
            return;
        }
        negativos.set(it.key, Date.now());
        if (r && r.motivo === "FILA_DESACTUALIZADA") {
            try { document.dispatchEvent(new CustomEvent("qi-imagen-desactualizada", { detail: { hoja: it.fuente.hoja } })); } catch (e) {}
        }
        it.reject(new Error((r && r.motivo) || "sin_imagen"));
    }

    /** Solicitud individual (servidor anterior, o imágenes sin referencia de fila). */
    function individual(it) {
        colaIndividual.push(it);
        vaciarIndividuales();
    }

    function vaciarIndividuales() {
        while (individualesActivos < CFG.individualesSimultaneos && colaIndividual.length) {
            (function (it) {
                individualesActivos++;
                solicitudIndividual(it.url || "", it.fuente || null).then(function (r) {
                    if (r && (r.dataUrl || r.imageUrl)) {
                        if (r.dataUrl) {
                            return dataUrlABlob(r.dataUrl).then(function (blob) {
                                var ttl = CFG.ttl[it.tipo] || CFG.ttl.otros;
                                escribirCubo(it.tipo, it.key, blob, ttl);
                                it.resolve({ src: guardarMemoria(it.key, blob, ttl), ruta: "individual" });
                            });
                        }
                        it.resolve({ src: guardarMemoriaTemporal(it.key, r.imageUrl), ruta: "individual:url-temporal" });
                    } else {
                        negativos.set(it.key, Date.now());
                        it.reject(new Error("sin_imagen"));
                    }
                }).catch(function () {
                    negativos.set(it.key, Date.now());
                    it.reject(new Error("error"));
                }).then(function () { individualesActivos--; vaciarIndividuales(); });
            })(colaIndividual.shift());
        }
    }

    function solicitudIndividual(url, fuente) {
        var token = leerToken();
        if (!token) return Promise.resolve(null);
        var original = String(url || "").trim();
        var id = extraerIdDriveQI(original);
        return fetch(API_URL, {
            method: "POST",
            body: JSON.stringify({ action: "getImagenDrive", token: token, fileId: id, url: original, fuente: fuente ? { hoja: fuente.hoja, fila: fuente.fila, columna: fuente.columna } : null })
        }).then(function (resp) {
            return resp.json().then(function (data) { return (resp.ok && data && data.success) ? data : null; });
        });
    }

    /* ------------------------------------------------------------------
       RESOLUCIÓN DE UNA IMAGEN (memoria → Cache API → servidor)
    ------------------------------------------------------------------ */
    function resolver(clave, tipo, preparar) {
        var hit = memoriaVigente(clave);
        if (hit) return Promise.resolve({ src: hit.src, ruta: "memoria" });
        var neg = negativos.get(clave);
        if (neg && Date.now() - neg < CFG.negativoMs) return Promise.reject(new Error("negativo"));
        if (enVuelo.has(clave)) return enVuelo.get(clave).then(function (r) { return { src: r.src, ruta: "compartida" }; });
        var p = leerCubo(tipo, clave).then(function (guardada) {
            if (guardada) {
                var restante = Math.max(1000, guardada.ttl - (Date.now() - guardada.ts));
                return { src: guardarMemoria(clave, guardada.blob, restante), ruta: "cache-api" };
            }
            return preparar();
        });
        var envuelta = p.then(function (r) { enVuelo.delete(clave); return r; }, function (e) { enVuelo.delete(clave); throw e; });
        enVuelo.set(clave, envuelta);
        return envuelta;
    }

    function resolverCelda(fuente, opciones, prioridad) {
        var tipo = tipoDeFuente(fuente, opciones);
        var key = claveFuente(fuente);
        return resolver(key, tipo, function () {
            var item = { key: key, tipo: tipo, fuente: fuente, prioridad: prioridad };
            // Sin referencia (SKU/marca) el servidor no puede verificar la fila: solicitud individual.
            if (!normalizar(fuente.ref)) {
                return new Promise(function (resolve, reject) { item.resolve = resolve; item.reject = reject; individual(item); });
            }
            return encolarLote(item);
        });
    }

    function resolverUrlProxy(url, opciones, prioridad) {
        var tipo = (opciones && opciones.tipo && CUBOS[opciones.tipo]) ? opciones.tipo : "otros";
        var key = "url|" + url;
        return resolver(key, tipo, function () {
            return new Promise(function (resolve, reject) {
                individual({ key: key, tipo: tipo, url: url, fuente: null, prioridad: prioridad, resolve: resolve, reject: reject });
            });
        });
    }

    /* ------------------------------------------------------------------
       CARGA DIFERIDA: solo se pide lo que está (o está por estar) a la vista
    ------------------------------------------------------------------ */
    var observador = null;
    var manejadores = new WeakMap();   // img -> { visible, timer, iniciar }
    var observadas = new Set();        // para poder liberarlas

    function obtenerObservador() {
        if (!("IntersectionObserver" in global)) return null;
        if (observador) return observador;
        observador = new IntersectionObserver(function (entradas) {
            entradas.forEach(function (e) {
                var h = manejadores.get(e.target);
                if (!h) return;
                if (e.isIntersecting) {
                    h.visible = true;
                    var top = e.boundingClientRect.top;
                    var enPantalla = top >= 0 && top < (global.innerHeight || 800);
                    clearTimeout(h.timer);
                    h.timer = setTimeout(function () {
                        if (!h.visible) return;
                        observador.unobserve(e.target);
                        observadas.delete(e.target);
                        manejadores.delete(e.target);
                        h.iniciar(enPantalla ? 1 : 2);
                    }, CFG.dwellMs);
                } else {
                    h.visible = false;
                    clearTimeout(h.timer);
                }
            });
        }, { rootMargin: CFG.margenObservador });
        return observador;
    }

    function programar(img, prioridad, iniciar) {
        var obs = prioridad === "alta" ? null : obtenerObservador();
        if (!obs) { iniciar(0); return; }
        manejadores.set(img, { visible: false, timer: null, iniciar: iniciar });
        observadas.add(img);
        img.classList.add("qi-img-pendiente");
        obs.observe(img);
    }

    /** Deja de observar las imágenes de un contenedor que se va a vaciar. */
    function liberar(contenedor) {
        if (!contenedor || !observador) return;
        var lista = contenedor.querySelectorAll ? contenedor.querySelectorAll("img.qi-img-pendiente") : [];
        for (var i = 0; i < lista.length; i++) {
            var img = lista[i];
            var h = manejadores.get(img);
            if (h) clearTimeout(h.timer);
            observador.unobserve(img);
            observadas.delete(img);
            manejadores.delete(img);
        }
    }

    /* ------------------------------------------------------------------
       FUNCIÓN PÚBLICA: cargarImagenConRespaldoQI (misma firma que antes)
       opciones (opcional): { tipo, prioridad: "alta"|"normal", etiqueta }
    ------------------------------------------------------------------ */
    function cargarImagenConRespaldoQI(img, url, alFallar, fuenteCelda, opciones) {
        if (!optimizacionActiva()) return legacyCargar(img, url, alFallar, fuenteCelda);
        if (!img || (!url && !fuenteCelda)) { if (alFallar) alFallar(); return; }

        opciones = opciones || {};
        var original = String(url || "").trim();
        var instancia = Number(img.dataset.qiInstancia || 0) + 1;
        img.dataset.qiInstancia = String(instancia);
        var vigente = function () { return img.dataset.qiInstancia === String(instancia); };
        var finalizada = false;
        var tipoRegistro = opciones.tipo || (fuenteCelda ? tipoDeFuente(fuenteCelda, opciones) : (esUrlProxyableQI(original) ? "otros" : "reactivos"));
        var inicioMs = null;

        img.dataset.qiUrlOriginal = original;
        img.dataset.qiProxyIntentado = "0";
        img.referrerPolicy = "strict-origin-when-cross-origin";
        img.decoding = "async";
        img.classList.add("qi-img");
        img.classList.remove("qi-img-lista");

        var fallar = function () {
            if (finalizada || !vigente()) return;
            finalizada = true;
            img.classList.remove("qi-img-pendiente");
            registrar({ tipo: tipoRegistro, ruta: "fallo", ms: inicioMs === null ? 0 : ahora() - inicioMs, ok: false, t: ahora() });
            if (alFallar) alFallar();
        };

        var mostrar = function (src, ruta) {
            if (!vigente() || !src) return;
            var instante = inicioMs === null ? ahora() : inicioMs;
            img.onload = function () {
                if (!vigente()) return;
                img.classList.remove("qi-img-pendiente");
                img.classList.add("qi-img-lista");
                registrar({ tipo: tipoRegistro, ruta: ruta, ms: ahora() - instante, ok: true, t: ahora() });
            };
            img.onerror = function () { fallar(); };
            img.src = src;
        };

        var porCelda = function (prio) {
            img.dataset.qiProxyIntentado = "1";
            resolverCelda(fuenteCelda, opciones, prio).then(function (r) { mostrar(r.src, r.ruta); }, function () {
                // Última opción para una imagen con URL pública: intentarla directamente.
                if (original && !/googleusercontent\.com/i.test(original) && vigente()) {
                    mostrar(original, "directa-respaldo");
                } else { fallar(); }
            });
        };

        var porProxy = function (prio) {
            if (!esUrlProxyableQI(original)) { fallar(); return; }
            img.dataset.qiProxyIntentado = "1";
            resolverUrlProxy(original, opciones, prio).then(function (r) { mostrar(r.src, r.ruta); }, fallar);
        };

        var iniciar = function (prio) {
            if (!vigente()) return;
            inicioMs = ahora();
            var temporalGoogle = /googleusercontent\.com/i.test(original);
            if (fuenteCelda && (!original || temporalGoogle)) {
                // Imagen incrustada en celda: nunca se usa una URL temporal guardada.
                porCelda(prio);
            } else if (original) {
                // URL pública (WordPress, etc.): la descarga el navegador con su propia caché HTTP.
                img.fetchPriority = (opciones.prioridad === "alta") ? "high" : "low";
                img.onload = function () {
                    if (!vigente()) return;
                    img.classList.remove("qi-img-pendiente");
                    img.classList.add("qi-img-lista");
                    registrar({ tipo: tipoRegistro, ruta: "directa", ms: ahora() - inicioMs, ok: true, t: ahora() });
                };
                img.onerror = function () {
                    if (fuenteCelda) porCelda(prio); else porProxy(prio);
                };
                img.src = miniatura(original);
            } else {
                fallar();
            }
        };

        programar(img, opciones.prioridad || "normal", iniciar);
    }

    /* ------------------------------------------------------------------
       RUTA ANTERIOR (solo con localStorage.qiOptimizacion = "off")
       Copia de la lógica previa de home.js, para poder medir antes/después
       en el mismo equipo. No se usa en el funcionamiento normal.
    ------------------------------------------------------------------ */
    var cacheLegacy = new Map();

    function legacyObtenerImagenDrive(url, fuenteCelda) {
        var original = String(url || "").trim();
        var id = extraerIdDriveQI(original);
        if (!original && !fuenteCelda) return Promise.resolve("");
        var clave = fuenteCelda ? JSON.stringify(fuenteCelda) : (id || original);
        var cacheado = cacheLegacy.get(clave);
        if (cacheado && Date.now() - cacheado.timestamp < cacheado.ttl) return Promise.resolve(cacheado.src);
        var token = leerToken();
        if (!token) return Promise.resolve("");
        return fetch(API_URL, {
            method: "POST",
            body: JSON.stringify({ action: "getImagenDrive", token: token, fileId: id, url: original, fuente: fuenteCelda })
        }).then(function (resp) {
            return resp.json().then(function (data) {
                if (!resp.ok || !data || !data.success) return "";
                var src = String(data.dataUrl || data.imageUrl || "");
                if (src) {
                    var ttl = (data.temporal || /googleusercontent\.com/i.test(src)) ? 30 * 1000 : 5 * 60 * 1000;
                    cacheLegacy.set(clave, { timestamp: Date.now(), src: src, ttl: ttl });
                }
                return src;
            });
        }).catch(function () { return ""; });
    }

    function legacyCargar(img, url, alFallar, fuenteCelda) {
        if (!img || (!url && !fuenteCelda)) { if (alFallar) alFallar(); return; }
        var original = String(url || "").trim();
        var instancia = (Number(img.dataset.qiInstancia || 0) + 1);
        img.dataset.qiInstancia = String(instancia);
        var finalizada = false, proxyIntentado = false;
        var t0 = ahora();
        var tipo = fuenteCelda ? tipoDeFuente(fuenteCelda, null) : "reactivos";
        var fallar = function () { if (finalizada) return; finalizada = true; registrar({ tipo: tipo, ruta: "fallo", ms: ahora() - t0, ok: false, t: ahora() }); if (alFallar) alFallar(); };
        var asignar = function (src) {
            if (img.dataset.qiInstancia !== String(instancia) || !src) return;
            img.onload = function () { registrar({ tipo: tipo, ruta: "anterior", ms: ahora() - t0, ok: true, t: ahora() }); };
            img.onerror = function () { intentarProxy(); };
            img.src = src;
        };
        var intentarProxy = function () {
            if (proxyIntentado) { fallar(); return; }
            if (!fuenteCelda && !esUrlProxyableQI(original)) { fallar(); return; }
            proxyIntentado = true;
            img.dataset.qiProxyIntentado = "1";
            legacyObtenerImagenDrive(original, fuenteCelda).then(function (src) {
                if (img.dataset.qiInstancia !== String(instancia)) return;
                if (src) asignar(src); else fallar();
            });
        };
        img.dataset.qiUrlOriginal = original;
        img.dataset.qiProxyIntentado = "0";
        img.referrerPolicy = "strict-origin-when-cross-origin";
        var urlGoogleTemporal = /googleusercontent\.com/i.test(original);
        if (fuenteCelda && (!original || urlGoogleTemporal)) {
            proxyIntentado = true;
            img.dataset.qiProxyIntentado = "1";
            legacyObtenerImagenDrive(original, fuenteCelda).then(function (src) {
                if (img.dataset.qiInstancia !== String(instancia)) return;
                if (src) asignar(src); else if (original) asignar(original); else fallar();
            });
        } else if (original) {
            img.onload = function () { registrar({ tipo: tipo, ruta: "anterior-directa", ms: ahora() - t0, ok: true, t: ahora() }); };
            img.onerror = function () { intentarProxy(); };
            img.src = original;
        } else {
            intentarProxy();
        }
    }

    /** Misma firma que antes (compatibilidad). */
    function obtenerImagenDriveQI(url, fuenteCelda) {
        if (!optimizacionActiva()) return legacyObtenerImagenDrive(url, fuenteCelda);
        if (fuenteCelda && fuenteCelda.hoja) {
            return resolverCelda(fuenteCelda, null, 0).then(function (r) { return r.src; }, function () { return ""; });
        }
        return resolverUrlProxy(String(url || ""), null, 0).then(function (r) { return r.src; }, function () { return ""; });
    }

    /** Agrega la referencia (SKU / nombre de marca) que el servidor usa para verificar la fila. */
    function conReferencia(fuente, ref) {
        if (!fuente) return null;
        if (fuente.ref) return fuente;
        return { hoja: fuente.hoja, fila: fuente.fila, columna: fuente.columna, ref: String(ref || "") };
    }

    /* ------------------------------------------------------------------
       API GLOBAL
    ------------------------------------------------------------------ */
    global.extraerIdDriveQI = extraerIdDriveQI;
    global.esUrlProxyableQI = esUrlProxyableQI;
    global.obtenerImagenDriveQI = obtenerImagenDriveQI;
    global.cargarImagenConRespaldoQI = cargarImagenConRespaldoQI;

    global.QI_IMG = {
        config: CFG,
        cubos: CUBOS,
        liberar: liberar,
        invalidar: invalidar,
        conReferencia: conReferencia,
        optimizacionActiva: optimizacionActiva,
        estado: function () {
            return { enMemoria: memoria.size, bytesMemoria: memoriaBytes, enCola: cola.length, lotesActivos: lotesActivos, soportaLote: soportaLote, enVuelo: enVuelo.size };
        },
        // Solo para pruebas automáticas:
        _prueba: { claveFuente: claveFuente, memoria: memoria, negativos: negativos, resolverCelda: resolverCelda, dataUrlABlob: dataUrlABlob }
    };

    // Limpieza de cachés caducadas cuando el navegador está en reposo.
    var reposo = global.requestIdleCallback || function (fn) { return setTimeout(fn, 4000); };
    global.addEventListener("load", function () { reposo(function () { podarCubos(); }, { timeout: 10000 }); });

})(typeof window !== "undefined" ? window : globalThis);
