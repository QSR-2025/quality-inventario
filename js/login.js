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

});



/*=========================================
  MOSTRAR / OCULTAR CONTRASEÑA
=========================================*/

togglePassword.addEventListener("click", () => {


    if (password.type === "password") {


        password.type = "text";
        togglePassword.textContent = "🙈";


    } else {


        password.type = "password";
        togglePassword.textContent = "👁";


    }


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


            localStorage.setItem("qualityUsuario", datos.usuario.usuario);
            localStorage.setItem("qualityNombre", datos.usuario.nombre);
            localStorage.setItem("qualityCargo", datos.usuario.cargo);
            localStorage.setItem("qualityRol", datos.usuario.rol);

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