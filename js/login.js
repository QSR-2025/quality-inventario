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

form.addEventListener("submit", (e) => {


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



    // Simulación de conexión con Apps Script

    setTimeout(() => {



        finalizarCarga();



        // USUARIO TEMPORAL

        if (user === "admin" && pass === "1234") {



            // Guardar usuario siempre

            localStorage.setItem(
                "qualityUsuario",
                user
            );



            mostrarMensaje(
                "Inicio de sesión correcto.",
                "#198754"
            );



            setTimeout(() => {


                window.location.href = "home.html";


            },1200);



        } else {



            mostrarMensaje(
                "Usuario o contraseña incorrectos.",
                "#dc3545"
            );


        }



    },1800);



});



/*=========================================
  CARGAR SESIÓN
=========================================*/

function cargarSesion(){


    const user = localStorage.getItem(
        "qualityUsuario"
    );


    if(user){


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