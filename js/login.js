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

        console.log("API:", API_URL);
        const respuesta = await fetch(
            `${API_URL}?action=login&usuario=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}`
        );


        if (!respuesta.ok) {

            throw new Error(
                "No fue posible conectar con el servidor."
            );

        }


        const datos = await respuesta.json();

        console.log(datos);

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


            mostrarMensaje(
                "Inicio de sesión correcto.",
                "#198754"
            );

            setTimeout(() => {

                window.location.href = "home.html";

            }, 1000);


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
            error.message || "No fue posible conectar con el servidor.",
            "#dc3545"
        );


    }


});



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


    mensaje.innerHTML = texto;


}



function ocultarMensaje(){


    mensaje.classList.add("hidden");


}