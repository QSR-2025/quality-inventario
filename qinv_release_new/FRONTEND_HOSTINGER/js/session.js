/* ==========================================================
   QUALITY INVENTARIO — session.js
   Cierre automático de sesión por inactividad.

   - La sesión se cierra tras 7 minutos sin actividad.
   - Un minuto antes se muestra un aviso con cuenta regresiva.
   - Se guarda la última actividad en localStorage con marcas de
     tiempo (no solo con setTimeout), de modo que también se cierra
     si el equipo estuvo suspendido o la pestaña en segundo plano.
   - Cualquier pestaña abierta cuenta como actividad.
========================================================== */

(function () {

    "use strict";

    var INACTIVIDAD_MS = 7 * 60 * 1000;   // cierre a los 7 minutos
    var AVISO_MS = 60 * 1000;             // aviso 60 s antes del cierre
    var CLAVE_ACTIVIDAD = "qualityUltimaActividad";

    var CLAVES_SESION = [
        "qualityUsuario",
        "qualityNombre",
        "qualityCargo",
        "qualityRol",
        "qualityToken",
        CLAVE_ACTIVIDAD
    ];

    var ultimoGuardado = 0;
    var aviso = null;
    var cerrando = false;

    function leerUltimaActividad() {
        try {
            var v = Number(localStorage.getItem(CLAVE_ACTIVIDAD));
            return isFinite(v) && v > 0 ? v : 0;
        } catch (e) { return 0; }
    }

    function guardarActividad(ahora) {
        ultimoGuardado = ahora;
        try { localStorage.setItem(CLAVE_ACTIVIDAD, String(ahora)); } catch (e) {}
    }

    /** Registra actividad del usuario (se limita a 1 escritura por segundo). */
    function registrarActividad(forzar) {
        if (cerrando) return;
        var ahora = Date.now();
        if (forzar || ahora - ultimoGuardado >= 1000) {
            guardarActividad(ahora);
        }
        if (aviso) ocultarAviso();
    }

    /** Borra la sesión local y vuelve al inicio de sesión. */
    function cerrarSesionLocal(motivo) {
        if (cerrando) return;
        cerrando = true;
        CLAVES_SESION.forEach(function (k) {
            try { localStorage.removeItem(k); } catch (e) {}
        });
        window.location.replace("index.html" + (motivo ? "?motivo=" + encodeURIComponent(motivo) : ""));
    }

    /* ---------- Aviso previo al cierre ---------- */

    function formatear(ms) {
        var s = Math.max(0, Math.ceil(ms / 1000));
        return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
    }

    function mostrarAviso(restante) {

        if (!aviso) {
            aviso = document.createElement("div");
            aviso.className = "sesion-aviso";
            aviso.setAttribute("role", "alertdialog");
            aviso.setAttribute("aria-live", "assertive");
            aviso.innerHTML =
                '<div class="sesion-aviso-caja">' +
                    '<div class="sesion-aviso-icono"><i class="fas fa-hourglass-half"></i></div>' +
                    '<h3>¿Sigue ahí?</h3>' +
                    '<p>Por seguridad, su sesión se cerrará por inactividad en</p>' +
                    '<div class="sesion-aviso-tiempo" id="sesionAvisoTiempo">1:00</div>' +
                    '<button type="button" id="sesionAvisoContinuar">Continuar en la sesión</button>' +
                '</div>';
            document.body.appendChild(aviso);
            document.getElementById("sesionAvisoContinuar")
                .addEventListener("click", function () { registrarActividad(true); });
        }

        var t = document.getElementById("sesionAvisoTiempo");
        if (t) t.textContent = formatear(restante);
    }

    function ocultarAviso() {
        if (aviso && aviso.parentNode) aviso.parentNode.removeChild(aviso);
        aviso = null;
    }

    /* ---------- Revisión periódica ---------- */

    function revisar() {

        if (cerrando) return;

        var ultima = leerUltimaActividad();

        // Sin sesión iniciada no hay nada que vigilar.
        if (!localStorage.getItem("qualityUsuario")) return;

        if (!ultima) {          // sesión anterior a esta versión
            guardarActividad(Date.now());
            return;
        }

        var inactivo = Date.now() - ultima;

        if (inactivo >= INACTIVIDAD_MS) {
            ocultarAviso();
            cerrarSesionLocal("inactividad");
            return;
        }

        if (inactivo >= INACTIVIDAD_MS - AVISO_MS) {
            mostrarAviso(INACTIVIDAD_MS - inactivo);
        } else if (aviso) {
            ocultarAviso();   // otra pestaña tuvo actividad
        }
    }

    /* ---------- Arranque ---------- */

    function iniciar() {

        if (!localStorage.getItem("qualityUsuario")) return;

        // Si la página se abre con la sesión ya vencida, cerrarla de inmediato.
        var ultima = leerUltimaActividad();
        if (ultima && Date.now() - ultima >= INACTIVIDAD_MS) {
            cerrarSesionLocal("inactividad");
            return;
        }

        registrarActividad(true);

        ["mousemove", "mousedown", "keydown", "wheel", "touchstart", "click", "input"]
            .forEach(function (ev) {
                document.addEventListener(ev, function () { registrarActividad(false); }, { passive: true, capture: true });
            });

        window.addEventListener("scroll", function () { registrarActividad(false); }, { passive: true, capture: true });

        // Al volver a la pestaña o reactivar el equipo se revisa de inmediato.
        document.addEventListener("visibilitychange", revisar);
        window.addEventListener("focus", revisar);

        setInterval(revisar, 1000);
    }

    window.registrarActividad = function () { registrarActividad(true); };
    window.cerrarSesionLocal = cerrarSesionLocal;
    window.SESION_INACTIVIDAD_MS = INACTIVIDAD_MS;

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", iniciar);
    } else {
        iniciar();
    }

})();
