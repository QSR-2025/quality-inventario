// ========================================
// QUALITY INVENTARIO
// HOME.JS FINAL
// MARCA → CATEGORIA → PRODUCTOS
// BUSCADOR UNIVERSAL
// MODAL DETALLE
// ========================================


let inventario = [];


let rutaActual = {

    marca: "",
    categoria: ""

};


// ========================================
// INICIO
// ========================================


document.addEventListener("DOMContentLoaded", () => {

    cargarUsuario();

    iniciar();

    configurarMenu();

    configurarBuscador();

    configurarModal();

    configurarLogout();

});


// ========================================
// USUARIO
// ========================================


function cargarUsuario() {

    const usuario = localStorage.getItem("qualityUsuario");

    // Si no hay sesión, regresar al login
    if (!usuario) {

        window.location.href = "index.html";
        return;

    }

    const nombre = document.getElementById("nombreUsuario");

    if (nombre) {

        nombre.textContent = usuario;

    }

}


// ========================================
// CARGA SISTEMA
// ========================================


async function iniciar() {

    await cargarResumenRapido();

    await cargarInventarioCompleto();

}


// ========================================
// DASHBOARD
// ========================================


async function cargarResumenRapido() {

    try {

        const resumen = await obtenerResumen();

        if (!resumen) return;

        const elTotal = document.getElementById("totalProductos");
        if (elTotal) elTotal.textContent = resumen.total;

        const elStockBajo = document.getElementById("stockBajo");
        if (elStockBajo) elStockBajo.textContent = resumen.stockBajo;

        const elPorVencer = document.getElementById("porVencer");
        if (elPorVencer) elPorVencer.textContent = resumen.porVencer;

        const elMarcas = document.getElementById("marcas");
        if (elMarcas) elMarcas.textContent = resumen.marcas;

     } catch (error) {

     console.error(error);

     alert(
        "Error cargando resumen:\n\n" +
        error.message
    );

} 

}


// ========================================
// INVENTARIO
// ========================================


async function cargarInventarioCompleto() {

    try {

        const datos = await obtenerInventario();

        console.log("Respuesta API:", datos);

        inventario = datos.productos || [];

        console.log("Productos:", inventario);

        actualizarDashboard(datos);

        mostrarMarcas();

    } catch (error) {

    console.error(error);

    alert(
        "Error cargando inventario:\n\n" +
        error.message
    );

}

}


// ========================================
// ACTUALIZAR DASHBOARD (con inventario completo)
// ========================================


function actualizarDashboard(datos) {

    const productos = datos.productos || [];


    // TOTAL PRODUCTOS

    const elTotal = document.getElementById("totalProductos");

    if (elTotal) {

        elTotal.textContent = datos.total || productos.length;

    }



    // ==========================
    // CONTADORES DE LOTES
    // ==========================


    let lotesVigentes = 0;
    let lotesPorVencer = 0;
    let lotesUrgentes = 0;
    let lotesVencidos = 0;



    productos.forEach(producto => {


        if(producto.lotes && producto.lotes.length){


            producto.lotes.forEach(lote => {



                const dias = calcularDiasRestantes(
                    lote.vencimiento
                );


                const estado = calcularEstadoLote(
                    dias,
                    lote.alerta
                );



                switch(estado){


                    case "vigente":

                        lotesVigentes++;

                    break;



                    case "por_vencer":

                        lotesPorVencer++;

                    break;



                    case "urgente":

                        lotesUrgentes++;

                    break;



                    case "vencido":

                        lotesVencidos++;

                    break;


                }



            });


        }


    });





    // ==========================
    // MOSTRAR EN DASHBOARD
    // ==========================


    const elVigentes = document.getElementById(
        "lotesVigentes"
    );

    if(elVigentes){

        elVigentes.textContent = lotesVigentes;

    }




    const elPorVencer = document.getElementById(
        "lotesPorVencer"
    );

    if(elPorVencer){

        elPorVencer.textContent = lotesPorVencer;

    }





    const elUrgentes = document.getElementById(
        "lotesUrgentes"
    );

    if(elUrgentes){

        elUrgentes.textContent = lotesUrgentes;

    }





    const elVencidos = document.getElementById(
        "lotesVencidos"
    );

    if(elVencidos){

        elVencidos.textContent = lotesVencidos;

    }



}

// ========================================
// MENU
// ========================================

function configurarMenu() {

    const menuProductos = document.getElementById("menuProductos");
    const menuMovimientos = document.getElementById("menuMovimientos");

    // Productos
    if (menuProductos) {

        menuProductos.addEventListener("click", () => {
            document.getElementById("tituloPagina").textContent = "Productos";
document.getElementById("subtituloPagina").textContent = "Gestión de inventario y vencimientos";

            activarBuscador();

            document.getElementById("seccionResultados").style.display = "block";
            document.getElementById("seccionMovimientos").style.display = "none";

            mostrarMarcas();

        });

    }

    // Movimientos
    if (menuMovimientos) {

        menuMovimientos.addEventListener("click", () => {

            mostrarMovimientos();

        });

    }

}


// ========================================
// MOSTRAR MARCAS
// ========================================


function mostrarMarcas() {

    rutaActual.marca = "";
    rutaActual.categoria = "";

    mostrarDashboardCards(true);

    const contenedor = document.getElementById("productList");

    contenedor.innerHTML = "";

    const marcas = [...new Set(inventario.map(p => p.proveedor))]
        .filter(Boolean)
        .sort();

    marcas.forEach(marca => {

        const cantidad = inventario.filter(p => p.proveedor === marca).length;

        crearCarpeta(
            "📁 " + marca,
            cantidad + " productos",
            () => {

                rutaActual.marca = marca;
                rutaActual.categoria = "";

                mostrarCategorias(marca);

            }
        );

    });

    actualizarBreadcrumb();

}


// ========================================
// MOSTRAR CATEGORIAS
// ========================================


function mostrarCategorias(marca) {

    rutaActual.marca = marca;
    rutaActual.categoria = "";

    mostrarDashboardCards(false);

    const contenedor = document.getElementById("productList");

    contenedor.innerHTML = "";

    const categorias = [...new Set(
        inventario
            .filter(p => p.proveedor === marca)
            .map(p => p.categoria)
    )]
        .filter(Boolean)
        .sort();

    categorias.forEach(categoria => {

        const cantidad = inventario.filter(p =>
            p.proveedor === marca &&
            p.categoria === categoria
        ).length;

        crearCarpeta(
            "📂 " + categoria,
            cantidad + " productos",
            () => {

                rutaActual.categoria = categoria;

                mostrarProductos(marca, categoria);

            }
        );

    });

    actualizarBreadcrumb();

}


// ========================================
// MOSTRAR PRODUCTOS
// ========================================


function mostrarProductos(marca, categoria) {

    rutaActual.marca = marca;
    rutaActual.categoria = categoria;

    mostrarDashboardCards(false);

    const contenedor = document.getElementById("productList");

    contenedor.innerHTML = "";

    const productos = inventario.filter(p =>
        p.proveedor === marca &&
        p.categoria === categoria
    );

    if (productos.length === 0) {

        contenedor.innerHTML = "<p class='sin-resultados'>No hay productos en esta categoría.</p>";

    } else {

        productos.forEach(producto => {

            renderProductCard(producto, contenedor);

        });

    }

    actualizarBreadcrumb();

}


// ========================================
// CREAR CARPETAS (marcas / categorías)
// ========================================


function crearCarpeta(titulo, texto, accion) {

    const contenedor = document.getElementById("productList");

    const div = document.createElement("div");

    div.className = "product-card";

    div.innerHTML = `
        <div class="product-info">
            <h3>${titulo}</h3>
            <p>${texto}</p>
        </div>
        <button class="btn-detail">Abrir</button>
    `;

    div.onclick = accion;

    contenedor.appendChild(div);

}


// ========================================
// RENDER TARJETA DE PRODUCTO
// ========================================


function renderProductCard(producto, contenedor) {

    const div = document.createElement("div");

    div.className = "product-card";

    div.innerHTML = `
        <div class="product-info">
            <h3>${producto.nombre || "Sin nombre"}</h3>
            <p>SKU: ${producto.sku || "—"}</p>
            <p>Proveedor: ${producto.proveedor || "—"}</p>
            <p>Categoría: ${producto.categoria || "—"}</p>
            <p>Stock: ${producto.stockTotal || 0}</p>
        </div>
        <button class="btn-detail">
            <i class="fas fa-eye"></i>
            Ver detalles
        </button>
    `;

    div.querySelector(".btn-detail").onclick = (e) => {

        e.stopPropagation();

        verDetalleProducto(producto);

    };

    contenedor.appendChild(div);

}


// ========================================
// BREADCRUMB
// ========================================


function actualizarBreadcrumb() {

    const box = document.getElementById("breadcrumb");

    if (!box) return;

    box.innerHTML = "";

    crearBotonRuta("🏠 Inicio", () => {

        mostrarMarcas();

    });

    if (rutaActual.marca) {

        agregarSeparador();

        crearBotonRuta(rutaActual.marca, () => {

            mostrarCategorias(rutaActual.marca);

        });

    }

    if (rutaActual.categoria) {

        agregarSeparador();

        crearBotonRuta(rutaActual.categoria, () => {

            mostrarProductos(rutaActual.marca, rutaActual.categoria);

        });

    }

}


function agregarSeparador() {

    const box = document.getElementById("breadcrumb");

    const span = document.createElement("span");

    span.textContent = ">";

    box.appendChild(span);

}


function crearBotonRuta(texto, accion) {

    const box = document.getElementById("breadcrumb");

    const btn = document.createElement("button");

    btn.className = "crumb-btn";

    btn.textContent = texto;

    btn.onclick = accion;

    box.appendChild(btn);

}


// ========================================
// MOSTRAR / OCULTAR TARJETAS DEL DASHBOARD
// ========================================


function mostrarDashboardCards(mostrar) {

    const dashboard = document.getElementById("dashboardCards");

    if (!dashboard) return;

    const movimientos = document.getElementById("seccionMovimientos");

    // Si estamos en Movimientos, nunca mostrar las tarjetas
    if (movimientos && movimientos.style.display === "block") {

        dashboard.style.display = "none";
        return;

    }

    dashboard.style.display = mostrar ? "grid" : "none";

}


// ========================================
// BUSCADOR UNIVERSAL
// ========================================


function configurarBuscador() {

    const input = document.getElementById("buscador");

    if (!input) return;

    input.addEventListener("input", () => {

        const texto = input.value.toLowerCase().trim();

        // ¿Estamos en la pantalla de Movimientos?
        const enMovimientos =
            document.getElementById("seccionMovimientos").style.display === "block";

        // Si el buscador quedó vacío...
        if (texto === "") {

            // Si estoy en movimientos NO regresar al dashboard
            if (enMovimientos) return;

            mostrarDashboardCards(true);
            mostrarMarcas();
            return;
        }

        // Si estoy en movimientos todavía no existe buscador,
        // simplemente no hacer nada.
        if (enMovimientos) return;

        mostrarDashboardCards(false);

        const encontrados = inventario.filter(p =>

            (p.nombre || "").toLowerCase().includes(texto) ||
            (p.sku || "").toLowerCase().includes(texto) ||
            (p.proveedor || "").toLowerCase().includes(texto) ||
            (p.categoria || "").toLowerCase().includes(texto)

        );

        mostrarResultadosBusqueda(encontrados);

    });

}


function mostrarResultadosBusqueda(lista) {

    const contenedor = document.getElementById("productList");

    contenedor.innerHTML = "";

    if (lista.length === 0) {

        contenedor.innerHTML = "<p class='sin-resultados'>No se encontraron productos.</p>";

        return;

    }

    lista.forEach(producto => {

        renderProductCard(producto, contenedor);

    });

}


// ========================================
// MODAL DETALLE
// ========================================


// Mapa de meses en español usado por Code.gs (formatFecha),
// necesario para poder calcular días restantes a partir del
// texto "15 mar 2026" que llega ya formateado desde el backend.
const MESES_ES_MAP = {
    ene: 0, feb: 1, mar: 2, abr: 3, may: 4, jun: 5,
    jul: 6, ago: 7, sep: 8, oct: 9, nov: 10, dic: 11
};


function parseFechaEs(texto) {

    if (!texto || texto === "—") return null;

    const partes = String(texto).trim().toLowerCase().split(/\s+/);

    if (partes.length !== 3) return null;

    const dia = parseInt(partes[0], 10);
    const mes = MESES_ES_MAP[partes[1]];
    const anio = parseInt(partes[2], 10);

    if (isNaN(dia) || mes === undefined || isNaN(anio)) return null;

    return new Date(anio, mes, dia);

}


function calcularDiasRestantes(fechaTexto) {

    const fecha = parseFechaEs(fechaTexto);

    if (!fecha) return null;

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    fecha.setHours(0, 0, 0, 0);

    const diferencia = fecha - hoy;

    return Math.round(diferencia / (1000 * 60 * 60 * 24));

}


// ========================================
// ESTADO DE LOTES (basado en días restantes)
// Reemplaza la dependencia del campo "alerta" del backend
// por el cálculo directo a partir de la fecha de vencimiento,
// replicando la fórmula de Excel:
//   >= 121 días  -> VIGENTE
//   50 a 120     -> POR VENCER
//   1 a 49       -> URGENTE
//   <= 0         -> VENCIDO
// ========================================


function calcularEstadoLote(dias, alertaBackend) {

    // Si no se pudo calcular la fecha (texto vacío, "—" o formato
    // inválido), se usa el campo "alerta" del backend como respaldo
    // para no dejar la tarjeta sin clasificar.
    if (dias === null || dias === undefined) {

        const mapaRespaldo = {
            vencido: "vencido",
            urgente: "urgente",
            proximo: "por_vencer",
            ok: "vigente"
        };

        return mapaRespaldo[alertaBackend] || "vigente";

    }

    if (dias >= 121) return "vigente";

    if (dias >= 50) return "por_vencer";

    if (dias >= 1) return "urgente";

    return "vencido";

}


function textoEstadoLote(estado) {

    switch (estado) {

        case "vencido":
            return "Vencido";

        case "urgente":
            return "Urgente";

        case "por_vencer":
            return "Por vencer";

        case "vigente":
            return "Vigente";

        default:
            return "Vigente";
    }

}


function verDetalleProducto(producto) {


    // DATOS PRINCIPALES

    document.getElementById("detalleNombre").textContent =
        producto.nombre || "—";


    document.getElementById("detalleSKU").textContent =
        producto.sku || "—";


    document.getElementById("detalleProveedor").textContent =
        producto.proveedor || "—";


    document.getElementById("detalleCategoria").textContent =
        producto.categoria || "—";


    document.getElementById("detalleStock").textContent =
        producto.stockTotal || 0;


   
    // UBICACION

    const ubicacion = document.getElementById("detalleUbicacion");

    if (ubicacion) {

        ubicacion.textContent =
            producto.ubicacion || "No asignada";

    }



    // ==========================
    // LOTES
    // Campos reales que envía Code.gs por cada lote:
    // { numero, numLote, stock, vencimiento, alerta }
    // El estado mostrado (texto y color) ya NO depende de "alerta":
    // se calcula aquí mismo a partir de los días restantes.
    // ==========================


    const detalleLotes = document.getElementById("detalleLotes");

    if (detalleLotes) {

        detalleLotes.innerHTML = "";

        if (producto.lotes && producto.lotes.length) {

            producto.lotes.slice(0, 4).forEach((lote, index) => {

                const numeroLote = lote.numLote || "—";

                const cantidad = (lote.stock !== undefined && lote.stock !== null && lote.stock !== "—")
                    ? lote.stock
                    : 0;

                const fecha = lote.vencimiento || "Sin fecha";

                const dias = calcularDiasRestantes(fecha);

                const estado = calcularEstadoLote(dias, lote.alerta);

                const estadoLote = textoEstadoLote(estado);

                let diasTexto = "";

                if (dias !== null) {

                    if (dias > 0) {
                        diasTexto = `Vence en ${dias} día${dias === 1 ? "" : "s"}`;
                    } else if (dias === 0) {
                        diasTexto = "Vence hoy";
                    } else {
                        diasTexto = `Vencido hace ${Math.abs(dias)} día${Math.abs(dias) === 1 ? "" : "s"}`;
                    }

                }

                detalleLotes.innerHTML += `

                <div class="lote-modal-card estado-card-${estado}">

                    <div class="lote-header">

                        <span>L${index + 1}</span>

                        <strong>${numeroLote}</strong>

                        <b>${cantidad} u</b>

                    </div>

                    <div class="lote-footer">

                        <span>📅 ${fecha}</span>

                        <span class="estado-lote estado-${estado}">
                            ${estadoLote}
                        </span>

                    </div>

                    ${diasTexto ? `<div class="lote-dias">${diasTexto}</div>` : ""}

                </div>

                `;

            });

        } else {

            detalleLotes.innerHTML =
                "<p>No hay lotes registrados</p>";

        }

    }



    // MOSTRAR MODAL

    document.getElementById("modalProducto").style.display = "flex";


}


function configurarModal() {

    const cerrar = document.getElementById("cerrarModal");

    const modal = document.getElementById("modalProducto");

    if (cerrar) {

        cerrar.onclick = () => {

            modal.style.display = "none";

        };

    }

    window.onclick = (e) => {

        if (e.target === modal) {

            modal.style.display = "none";

        }

    };

}
// =====================================
// CLICK EN TARJETAS DEL DASHBOARD
// =====================================

// =====================================
// CLICK EN TARJETAS DEL DASHBOARD
// =====================================

document.querySelectorAll(".dashboard-filter")
.forEach(card => {


    card.addEventListener("click",()=>{


        const filtro = card.dataset.filtro;


        filtrarLotesPorEstado(filtro);


    });


});
// =====================================
// FILTRAR PRODUCTOS POR ESTADO DE LOTE
// =====================================

function filtrarLotesPorEstado(estado){


    mostrarDashboardCards(false);


    const contenedor = document.getElementById("productList");


    contenedor.innerHTML = "";
    const breadcrumb = document.getElementById("breadcrumb");

breadcrumb.innerHTML = `

<button class="crumb-btn active">

<i class="fas fa-house"></i>

Inicio

</button>


<button class="crumb-btn filtro-dashboard">

${textoEstadoLote(estado)}

</button>

`;

    const productosFiltrados = inventario.filter(producto => {


        if(!producto.lotes || !producto.lotes.length){

            return false;

        }


        return producto.lotes.some(lote => {


            const dias = calcularDiasRestantes(
                lote.vencimiento
            );


            const estadoCalculado = calcularEstadoLote(
                dias,
                lote.alerta
            );


            return estadoCalculado === estado;


        });


    });



    if(productosFiltrados.length === 0){


        contenedor.innerHTML = 
        "<p class='sin-resultados'>No hay productos con este estado.</p>";


        return;

    }



    productosFiltrados.forEach(producto => {


        renderProductCard(
            producto,
            contenedor
        );


    });



}
// =====================================
// MOSTRAR MOVIMIENTOS
// =====================================

// =====================================
// MOSTRAR MOVIMIENTOS
// =====================================
async function mostrarMovimientos() {
    document.getElementById("tituloPagina").textContent = "Centro de Reportes";
document.getElementById("subtituloPagina").textContent = "Estadísticas y movimientos del inventario";

    desactivarBuscador();

    // Ocultar dashboard
    mostrarDashboardCards(false);

    // Ocultar resultados
    document.getElementById("seccionResultados").style.display = "none";

    // Mostrar movimientos
    document.getElementById("seccionMovimientos").style.display = "block";

}
function activarBuscador() {

    const buscador = document.getElementById("buscador");

    if (!buscador) return;

    buscador.disabled = false;
    buscador.value = "";
    buscador.placeholder = "Buscar producto, SKU, lote, proveedor...";

}

function desactivarBuscador() {

    const buscador = document.getElementById("buscador");

    if (!buscador) return;

    buscador.value = "";
    buscador.disabled = true;
    buscador.placeholder = "No disponible en Centro de Reportes";

}
// ========================================
// CERRAR SESIÓN
// ========================================

function configurarLogout() {

    const btnLogout = document.getElementById("logout");

    if (!btnLogout) return;

    btnLogout.addEventListener("click", () => {

        if (!confirm("¿Desea cerrar la sesión?")) return;

        localStorage.removeItem("qualityUsuario");

        window.location.href = "index.html";

    });

}