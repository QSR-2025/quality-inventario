/* ==========================================================================
   QUALITY INVENTARIO — libs.js  (Fase 2.6)
   Carga bajo demanda de Chart.js y jsPDF (+ autotable).

   ANTES: home.html descargaba y ejecutaba Chart.js, jsPDF y jspdf-autotable
   como <script> SÍNCRONOS antes de session.js/api.js/home.js. Hasta que las
   tres librerías (de CDN) terminaban, la aplicación no arrancaba, aunque el
   dashboard no las usa.
   AHORA: se cargan cuando el usuario entra a Movimientos o Vencimientos (que
   son las únicas pantallas que las usan), y al pasar el cursor/tocar esos
   menús para ganar tiempo.

   Los archivos movimientos.js, vencimientos.js y pdf-vencimientos.js NO se
   modificaron: aquí solo se envuelven (sin cambiar su lógica) las funciones
   que dibujan gráficas o generan PDF para esperar a que la librería exista.
========================================================================== */
(function (global) {
    "use strict";

    var LIBS = {
        chart: { urls: ["https://cdn.jsdelivr.net/npm/chart.js"], listo: function () { return typeof global.Chart !== "undefined"; } },
        pdf: {
            urls: [
                "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
                "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js"
            ],
            listo: function () { return !!(global.jspdf && global.jspdf.jsPDF); }
        }
    };

    var promesas = {};

    function cargarScript(url) {
        return new Promise(function (resolve, reject) {
            var s = document.createElement("script");
            s.src = url;
            s.async = false;
            s.onload = function () { resolve(); };
            s.onerror = function () { reject(new Error("No se pudo cargar " + url)); };
            document.head.appendChild(s);
        });
    }

    function asegurar(nombre) {
        var lib = LIBS[nombre];
        if (!lib) return Promise.reject(new Error("Librería desconocida: " + nombre));
        if (lib.listo()) return Promise.resolve();
        if (!promesas[nombre]) {
            var t = global.QIPerf ? QIPerf.inicio("libreria:" + nombre) : null;
            // En secuencia: autotable necesita que jsPDF ya exista.
            promesas[nombre] = lib.urls.reduce(function (p, url) {
                return p.then(function () { return cargarScript(url); });
            }, Promise.resolve()).then(function () {
                if (t) t();
            }, function (e) {
                delete promesas[nombre];   // permitir reintentar
                if (t) t({ error: true });
                throw e;
            });
        }
        return promesas[nombre];
    }

    /**
     * Sustituye una función global por otra que, si la librería ya está,
     * llama a la original de inmediato (mismo comportamiento síncrono que antes);
     * si no, espera a la librería y luego llama a la original.
     */
    function envolver(nombreFuncion, libreria, alFallar) {
        var original = global[nombreFuncion];
        if (typeof original !== "function" || original.__qiEnvuelta) return;
        var ultimo = 0;
        function envuelta() {
            var args = arguments, self = this;
            if (LIBS[libreria].listo()) return original.apply(self, args);
            var turno = ++ultimo;
            return asegurar(libreria).then(function () {
                if (libreria === "chart" && turno !== ultimo) return;   // solo la última llamada dibuja
                return original.apply(self, args);
            }, function (error) {
                console.error(error);
                if (alFallar) return alFallar(error);
                return original.apply(self, args);   // la función original ya avisa si falta la librería
            });
        }
        envuelta.__qiEnvuelta = true;
        global[nombreFuncion] = envuelta;
    }

    function instalar() {
        envolver("cargarGraficas", "chart");
        envolver("dibujarGraficaVencimientos", "chart");
        envolver("generarReportePDF", "pdf");
        envolver("generarPdfVencimientos", "pdf", function (error) {
            alert("No fue posible generar el PDF:\n\n" + error.message);
        });
    }

    function adelantar() { asegurar("chart").catch(function () {}); asegurar("pdf").catch(function () {}); }

    ["menuMovimientos", "menuVencimientos", "btnCentroReportes"].forEach(function (id) {
        document.addEventListener("pointerover", function (e) { if (e.target.closest && e.target.closest("#" + id)) adelantar(); }, { passive: true });
        document.addEventListener("touchstart", function (e) { if (e.target.closest && e.target.closest("#" + id)) adelantar(); }, { passive: true });
        document.addEventListener("click", function (e) { if (e.target.closest && e.target.closest("#" + id)) adelantar(); }, true);
    });

    instalar();

    global.QI_LIBS = { asegurar: asegurar, adelantar: adelantar };
})(window);
