/*=========================================
  QUALITY INVENTARIO
  login.js
=========================================*/


const form = document.getElementById("loginForm");
const usuario = document.getElementById("usuario");
const password = document.getElementById("password");
const btnLogin = document.getElementById("btnLogin");
const loader = document.getElementById("loader");
const mensaje = document.getElementById("mensaje");
const remember = document.getElementById("remember");
const togglePassword = document.getElementById("togglePassword");



/*=========================================
  AL INICIAR
=========================================*/

document.addEventListener("DOMContentLoaded", () => {

    cargarSesion();

    // Mensaje cuando la sesión se cerró automáticamente por inactividad.
    const params = new URLSearchParams(window.location.search);

    if (params.get("motivo") === "inactividad") {
        mostrarMensaje(
            "Su sesión se cerró automáticamente por 7 minutos de inactividad. Inicie sesión nuevamente.",
            "#b45309"
        );
        history.replaceState(null, "", window.location.pathname);
    }

});



/*=========================================
  MOSTRAR / OCULTAR CONTRASEÑA
=========================================*/

togglePassword.addEventListener("click", () => {

    const visible = password.type === "password";

    password.type = visible ? "text" : "password";

    togglePassword.innerHTML = visible
        ? '<i class="fas fa-eye-slash"></i>'
        : '<i class="fas fa-eye"></i>';

    togglePassword.setAttribute(
        "aria-label",
        visible ? "Ocultar contraseña" : "Mostrar contraseña"
    );

});



/*=========================================
  LOGIN
=========================================*/

form.addEventListener("submit", async (e) => {


    e.preventDefault();


    ocultarMensaje();


    const user = usuario.value.trim();
    const pass = password.value.trim();



    if (user === "") {


        mostrarMensaje(
            "Ingrese el usuario.",
            "#dc3545"
        );

        usuario.focus();

        return;


    }



    if (pass === "") {


        mostrarMensaje(
            "Ingrese la contraseña.",
            "#dc3545"
        );

        password.focus();

        return;


    }



    iniciarCarga();



    try {

        const datos = await solicitarLogin(user, pass);

        if (datos.error) {

            throw new Error(
                datos.mensaje || "El servidor rechazó la solicitud."
            );

        }

        finalizarCarga();


        if (datos.success) {


            localStorage.setItem("qualityUltimaActividad", String(Date.now()));
            localStorage.setItem("qualityUsuario", datos.usuario.usuario);
            localStorage.setItem("qualityNombre", datos.usuario.nombre);
            localStorage.setItem("qualityCargo", datos.usuario.cargo);
            localStorage.setItem("qualityRol", datos.usuario.rol);
            // Siempre reemplazar el token: si la respuesta no trae uno nuevo,
            // no se debe conservar el de una sesión anterior (quedaría obsoleto).
            if (datos.token) {
                localStorage.setItem("qualityToken", datos.token);
            } else {
                localStorage.removeItem("qualityToken");
            }

            if (remember.checked) {

                localStorage.setItem("qualityRecordar", "1");

            } else {

                localStorage.removeItem("qualityRecordar");

            }


            if (datos.token) {

                mostrarMensaje(
                    "Inicio de sesión correcto.",
                    "#198754"
                );

            } else {

                // El servidor desplegado no entregó token: sin él no se pueden
                // registrar movimientos. Se avisa en lugar de fallar más tarde.
                mostrarMensaje(
                    "Inicio de sesión correcto, pero el servidor no entregó el token de sesión " +
                    "(la implementación de Apps Script está desactualizada). " +
                    "No podrá registrar entradas ni salidas hasta actualizarla.",
                    "#b45309"
                );

            }

            setTimeout(() => {

                window.location.href = "home.html";

            }, datos.token ? 1000 : 4000);


        } else {


            mostrarMensaje(
                datos.mensaje,
                "#dc3545"
            );


        }


    } catch (error) {


        finalizarCarga();

        console.error(error);

        mostrarMensaje(
            await describirErrorConexion(error),
            "#dc3545"
        );

    }


});



/*=========================================
  SOLICITUD DE LOGIN
  POST con cuerpo text/plain (no genera preflight CORS) para que la
  contraseña no viaje en la URL. Si el servidor desplegado es una versión
  anterior que no conoce login por POST, se usa el GET anterior.
=========================================*/

async function leerJsonServidor(respuesta) {

    if (!respuesta.ok) {
        const e = new Error("HTTP " + respuesta.status);
        e.codigoLogin = "HTTP";
        throw e;
    }

    const texto = await respuesta.text();

    try {
        return JSON.parse(texto);
    } catch (e) {
        // Apps Script devuelve HTML (no JSON) cuando falta autorizar el script
        // o cuando hay un error del servidor fuera del código.
        const err = new Error("El servidor no devolvió JSON.");
        err.codigoLogin = "NO_JSON";
        throw err;
    }

}

async function solicitarLogin(user, pass) {

    const respuesta = await fetch(API_URL, {
        method: "POST",
        body: JSON.stringify({ action: "login", usuario: user, password: pass })
    });

    const datos = await leerJsonServidor(respuesta);

    // Servidor anterior: responde "Acción no válida." a la acción login.
    if (datos && datos.success === false && /acci[oó]n no v[aá]lida/i.test(String(datos.message || ""))) {

        const r2 = await fetch(
            `${API_URL}?action=login&usuario=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}`
        );

        return leerJsonServidor(r2);

    }

    return datos;

}

/*=========================================
  DIAGNÓSTICO DE ERRORES DE CONEXIÓN
=========================================*/

async function describirErrorConexion(error) {

    if (error && error.codigoLogin === "NO_JSON") {
        return "El servidor respondió, pero no con datos válidos. En Apps Script, abra el " +
               "editor, ejecute cualquier función una vez para autorizar permisos y cree una " +
               "nueva versión de la implementación.";
    }

    if (error && error.codigoLogin === "HTTP") {
        return "El servidor respondió con un error (" + error.message + "). Revise la implementación de Apps Script.";
    }

    // "Failed to fetch" / "Load failed" / "NetworkError": el navegador no pudo
    // leer la respuesta. Se prueba el servidor con una acción mínima (ping).
    if (error && error.name === "TypeError") {

        if (navigator.onLine === false) {
            return "Sin conexión a Internet. Verifique la red e intente de nuevo.";
        }

        try {

            const r = await fetch(`${API_URL}?action=ping`, { cache: "no-store" });
            const d = await r.json();

            if (d && d.ok) {
                return "El servidor responde (versión " + d.version + "), pero la solicitud de " +
                       "inicio de sesión falló. Recargue con Ctrl+F5 e intente de nuevo.";
            }

        } catch (e2) { /* se explica abajo */ }

        return "No se pudo contactar el servidor de Apps Script. Causas probables: la " +
               "implementación no está publicada con acceso \"Cualquier persona\", falta autorizar " +
               "el script, o la URL de implementación ya no existe. Abra " +
               "<b>" + API_URL + "?action=ping</b> en el navegador: debe mostrar {\"ok\":true...}.";

    }

    return (error && error.message) || "No fue posible conectar con el servidor.";

}



/*=========================================
  CARGAR SESIÓN
=========================================*/

function cargarSesion(){


    const recordado = localStorage.getItem(
        "qualityRecordar"
    );

    const user = localStorage.getItem(
        "qualityUsuario"
    );


    if (recordado && user) {


        usuario.value = user;

        remember.checked = true;


    }


}



/*=========================================
  LOADER
=========================================*/

function iniciarCarga(){


    loader.classList.remove("hidden");


    btnLogin.disabled = true;


    btnLogin.textContent =
        "Verificando...";


}



function finalizarCarga(){


    loader.classList.add("hidden");


    btnLogin.disabled = false;


    btnLogin.textContent =
        "Iniciar sesión";


}



/*=========================================
  MENSAJES
=========================================*/

function mostrarMensaje(texto,color){


    mensaje.classList.remove("hidden");


    mensaje.style.background = color;


    mensaje.style.color = "#ffffff";


    // Los textos son fijos del frontend; los del servidor se muestran como texto.
    if (/<b>/.test(texto)) { mensaje.innerHTML = texto; } else { mensaje.textContent = texto; }


}



function ocultarMensaje(){


    mensaje.classList.add("hidden");


}