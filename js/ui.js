/* ==========================================================
   QUALITY INVENTARIO — ui.js
   Detalles de interfaz: nombre/avatar del usuario y opción
   activa del menú lateral.
========================================================== */

document.addEventListener("DOMContentLoaded", () => {

    /* ---------- Usuario ---------- */

    const nombre =
        (localStorage.getItem("qualityNombre") || "").trim() ||
        (localStorage.getItem("qualityUsuario") || "").trim() ||
        "Usuario";

    const etiqueta = document.getElementById("nombreUsuario");
    const avatar = document.getElementById("avatarUsuario");

    if (etiqueta) etiqueta.textContent = nombre;

    if (avatar) {
        avatar.textContent = nombre.charAt(0).toUpperCase();
        avatar.title = (localStorage.getItem("qualityCargo") || "").trim();
    }

    /* ---------- Menú lateral: opción activa ---------- */

    const enlaces = document.querySelectorAll(".sidebar nav a");

    enlaces.forEach(enlace => {

        enlace.addEventListener("click", () => {

            // "Configuración" aún no tiene pantalla: no cambia la selección.
            if (!enlace.id) return;

            // Almacén puede rechazar el acceso por rol; en ese caso no se marca.
            enlaces.forEach(a => a.classList.remove("active"));
            enlace.classList.add("active");

        });

    });

});
