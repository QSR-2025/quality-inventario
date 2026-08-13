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

/* ==========================================================
   ÍNDICES DE INVENTARIO
   Evitan recorrer todo el inventario repetidamente
========================================================== */

let indiceMarcas = new Map();
let indiceCategorias = new Map();

function construirIndicesInventario() {

    indiceMarcas.clear();
    indiceCategorias.clear();

    inventario.forEach(producto => {

        const marca = producto.proveedor || "";
        const categoria = producto.categoria || "";

        if (marca) {

            if (!indiceMarcas.has(marca)) {
                indiceMarcas.set(marca, []);
            }

            indiceMarcas.get(marca).push(producto);
        }

        if (marca && categoria) {

            const clave = `${marca}|||${categoria}`;

            if (!indiceCategorias.has(clave)) {
                indiceCategorias.set(clave, []);
            }

            indiceCategorias.get(clave).push(producto);
        }

    });

}
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

    await Promise.all([
        cargarResumenRapido(),
        cargarInventarioCompleto()
    ]);

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
        
        const elVigentes = document.getElementById("lotesVigentes");
if (elVigentes) {
    elVigentes.textContent = resumen.lotesVigentes ?? 0;
}

const elPorVencerLotes = document.getElementById("lotesPorVencer");
if (elPorVencerLotes) {
    elPorVencerLotes.textContent = resumen.lotesPorVencer ?? 0;
}

const elUrgentes = document.getElementById("lotesUrgentes");
if (elUrgentes) {
    elUrgentes.textContent = resumen.lotesUrgentes ?? 0;
}

const elVencidos = document.getElementById("lotesVencidos");
if (elVencidos) {
    elVencidos.textContent = resumen.lotesVencidos ?? 0;
}

     } catch (error) {

     console.error(error);

     alert(
        "Error cargando resumen:\n\n" +
        error.message
    );

} 

}


// ========================================
// INVENTARIO COMPLETO
// TEGUS + SPS EN PARALELO
// ========================================

async function cargarInventarioCompleto() {

    try {

        // ========================================
        // CARGAR TEGUS + SPS AL MISMO TIEMPO
        // ========================================

        const [resultadoTegus, resultadoSPS] =
            await Promise.allSettled([
                obtenerInventario(),
                obtenerInventarioSPS()
            ]);


        // ========================================
        // INVENTARIO TEGUS
        // ========================================

        let datosTegus = null;
        let productosTegus = [];

        if (resultadoTegus.status === "fulfilled") {

            datosTegus = resultadoTegus.value;

            productosTegus =
                datosTegus?.productos || [];

        } else {

            console.error(
                "No se pudo cargar el inventario Tegus:",
                resultadoTegus.reason
            );

        }


        // ========================================
        // INVENTARIO SPS
        // ========================================

        let productosSPS = [];

        if (resultadoSPS.status === "fulfilled") {

            productosSPS =
                resultadoSPS.value?.productos || [];

        } else {

            console.warn(
                "No se pudo cargar el inventario SPS:",
                resultadoSPS.reason
            );

        }


        // ========================================
        // MARCAR BODEGA
        // ========================================

        const tegusConBodega =
            productosTegus.map(producto => ({

                ...producto,

                bodega: "Tegus"

            }));


        const spsConBodega =
            productosSPS.map(producto => ({

                ...producto,

                bodega: "SPS"

            }));


        // ========================================
        // UNIR TEGUS + SPS
        // ========================================

        const todosLosProductos = [
            ...tegusConBodega,
            ...spsConBodega
        ];


        // ========================================
        // AGRUPAR POR SKU
        // ========================================

        const productosAgrupados = new Map();


        todosLosProductos.forEach(producto => {

            const sku = String(
                producto.sku ||
                producto.codigo ||
                producto.code ||
                ""
            )
            .trim()
            .toUpperCase();


            // ==================================
            // PRODUCTO SIN SKU
            // ==================================

            if (!sku) {

                inventario.push(producto);

                return;

            }


            // ==================================
            // PRODUCTO NUEVO
            // ==================================

            if (!productosAgrupados.has(sku)) {

                productosAgrupados.set(
                    sku,
                    {

                        ...producto,

                        sku: sku,

                        stockTotal: 0,

                        lotes: []

                    }
                );

            }


            const productoFinal =
                productosAgrupados.get(sku);


            // ==================================
            // SUMAR STOCK
            // ==================================

            const stockProducto = Number(
                producto.stockTotal ??
                producto.stock ??
                producto.cantidad ??
                0
            );


            productoFinal.stockTotal +=
                isNaN(stockProducto)
                    ? 0
                    : stockProducto;


            // ==================================
            // COPIAR LOTES
            // ==================================

            if (
                Array.isArray(producto.lotes) &&
                producto.lotes.length
            ) {

                producto.lotes.forEach(lote => {

                    productoFinal.lotes.push({

                        ...lote,

                        // Cada lote conserva su bodega

                        bodega:
                            lote.bodega ||
                            producto.bodega ||
                            "Tegus"

                    });

                });

            } else {

                // ==================================
                // PRODUCTO SIN LOTES
                // ==================================

                productoFinal.lotes.push({

                    lote:
                        producto.lote ||
                        producto.numeroLote ||
                        producto.codigoLote ||
                        "—",

                    stock: stockProducto,

                    cantidad: stockProducto,

                    vencimiento:
                        producto.vencimiento ||
                        producto.fechaVencimiento ||
                        "Sin fecha",

                    fechaVencimiento:
                        producto.fechaVencimiento ||
                        producto.vencimiento ||
                        "Sin fecha",

                    alerta:
                        producto.alerta ||
                        "",

                    estado:
                        producto.estado ||
                        "Vigente",

                    bodega:
                        producto.bodega ||
                        "Tegus"

                });

            }

        });


        // ==================================
        // CONVERTIR MAP A ARRAY
        // ==================================

        inventario = Array.from(
            productosAgrupados.values()
        );



        // Construir índices para acelerar
        // marcas, categorías y productos
        construirIndicesInventario();


        // ==================================
        // LOG DE CONTROL
        // ==================================

        console.log(
            "Productos Tegus:",
            productosTegus.length
        );

        console.log(
            "Productos SPS:",
            productosSPS.length
        );

        console.log(
            "Productos combinados:",
            inventario.length
        );


        // ==================================
        // DASHBOARD
        // ==================================

    
        // ==================================
        // MOSTRAR MARCAS
        // ==================================

        mostrarMarcas();


    } catch (error) {

        console.error(
            "Error cargando inventario:",
            error
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
    const menuVencimientos = document.getElementById("menuVencimientos");
    

    // Productos
    if (menuProductos) {

        menuProductos.addEventListener("click", () => {
            document.getElementById("tituloPagina").textContent = "Productos";
document.getElementById("subtituloPagina").textContent = "Gestión de inventario y vencimientos";

            activarBuscador();

            document.getElementById("seccionResultados").style.display = "block";
            document.getElementById("seccionMovimientos").style.display = "none";
            document.getElementById("seccionVencimientos").style.display = "none";

            mostrarMarcas();

        });

    }

    // Movimientos
    if (menuMovimientos) {

        menuMovimientos.addEventListener("click", () => {

            mostrarMovimientos();

        });

    }
    // Vencimientos
    if (menuVencimientos) {

         menuVencimientos.addEventListener("click", () => {

            mostrarVencimientos();

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

    const contenedor =
        document.getElementById("productList");

    if (!contenedor) return;

    contenedor.innerHTML = "";

    const marcas =
        Array.from(indiceMarcas.keys())
            .filter(Boolean)
            .sort();

    const fragment =
        document.createDocumentFragment();

    marcas.forEach(marca => {

        const cantidad =
            indiceMarcas.get(marca)?.length || 0;

        const div =
            document.createElement("div");

        div.className = "product-card";

        div.innerHTML = `
            <div class="product-info">
                <h3>📁 ${marca}</h3>
                <p>${cantidad} productos</p>
            </div>

            <button class="btn-detail">
                Abrir
            </button>
        `;

        div.onclick = () => {

            rutaActual.marca = marca;
            rutaActual.categoria = "";

            mostrarCategorias(marca);

        };

        fragment.appendChild(div);

    });

    contenedor.appendChild(fragment);

    actualizarBreadcrumb();

}
function mostrarCategorias(marca) {

    rutaActual.marca = marca;
    rutaActual.categoria = "";

    mostrarDashboardCards(false);

    const contenedor =
        document.getElementById("productList");

    if (!contenedor) return;

    contenedor.innerHTML = "";

    const productosMarca =
        indiceMarcas.get(marca) || [];

    const categorias = [
        ...new Set(
            productosMarca
                .map(p => p.categoria)
                .filter(Boolean)
        )
    ].sort();

    const fragment =
        document.createDocumentFragment();

    categorias.forEach(categoria => {

        const cantidad =
            indiceCategorias
                .get(`${marca}|||${categoria}`)
                ?.length || 0;

        const div =
            document.createElement("div");

        div.className = "product-card";

        div.innerHTML = `
            <div class="product-info">
                <h3>📂 ${categoria}</h3>
                <p>${cantidad} productos</p>
            </div>

            <button class="btn-detail">
                Abrir
            </button>
        `;

        div.onclick = () => {

            rutaActual.categoria = categoria;

            mostrarProductos(
                marca,
                categoria
            );

        };

        fragment.appendChild(div);

    });

    contenedor.appendChild(fragment);

    actualizarBreadcrumb();

}
// ========================================
// MOSTRAR PRODUCTOS
// ========================================


function mostrarProductos(marca, categoria) {

    rutaActual.marca = marca;
    rutaActual.categoria = categoria;

    mostrarDashboardCards(false);

    const contenedor =
        document.getElementById("productList");

    if (!contenedor) return;

    contenedor.innerHTML = "";

    const productos =
        indiceCategorias.get(
            `${marca}|||${categoria}`
        ) || [];

    if (productos.length === 0) {

        contenedor.innerHTML =
            "<p class='sin-resultados'>No hay productos en esta categoría.</p>";

        actualizarBreadcrumb();

        return;
    }

    const fragment =
        document.createDocumentFragment();

    productos.forEach(producto => {

        renderProductCard(
            producto,
            fragment
        );

    });

    contenedor.appendChild(fragment);

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
    const vencimientos = document.getElementById("seccionVencimientos");

    if (
        (movimientos && movimientos.style.display === "block") ||
        (vencimientos && vencimientos.style.display === "block")
    ) {

        dashboard.style.display = "none";
        return;

    }

    dashboard.style.display = mostrar ? "grid" : "none";

}


// ========================================
// BUSCADOR UNIVERSAL
// ========================================


function configurarBuscador() {

    const input =
        document.getElementById("buscador");

    if (!input) return;

    let timeoutBusqueda = null;

    input.addEventListener("input", () => {

        clearTimeout(timeoutBusqueda);

        const texto =
            input.value.toLowerCase().trim();

        timeoutBusqueda = setTimeout(() => {

            ejecutarBusqueda(texto);

        }, 120);

    });

}
function ejecutarBusqueda(texto) {

    const movimientos =
        document.getElementById("seccionMovimientos");

    const vencimientos =
        document.getElementById("seccionVencimientos");

    const enMovimientos =
        movimientos?.style.display === "block";

    const enVencimientos =
        vencimientos?.style.display === "block";

    if (enMovimientos || enVencimientos) {
        return;
    }

    if (!texto) {

        mostrarDashboardCards(true);

        mostrarMarcas();

        return;
    }

    mostrarDashboardCards(false);

    const encontrados =
        buscarProductos(
            inventario,
            texto
        );

    mostrarResultadosBusqueda(
        encontrados
    );

}


function mostrarResultadosBusqueda(lista) {

    const contenedor =
        document.getElementById("productList");

    if (!contenedor) return;

    contenedor.innerHTML = "";

    if (!lista.length) {

        contenedor.innerHTML =
            "<p class='sin-resultados'>No se encontraron productos.</p>";

        return;
    }

    const fragment =
        document.createDocumentFragment();

    lista.forEach(producto => {

        renderProductCard(
            producto,
            fragment
        );

    });

    contenedor.appendChild(fragment);

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

            producto.lotes.forEach((lote, index) => {

                const numeroLote = lote.numLote || "—";

                const cantidad = (lote.stock !== undefined && lote.stock !== null && lote.stock !== "—")
                    ? lote.stock
                    : 0;

                const fecha = lote.vencimiento || "Sin fecha";
                const bodega = lote.bodega || producto.bodega || "Tegus";

                    const ubicacionLote =
                    lote.ubicacion ||
                    producto.ubicacion ||
                    "No asignada";

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

                        <span>🏢 ${bodega}</span>

                        <span>📍 ${ubicacionLote}</span>

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
async function mostrarMovimientos() {
    document.getElementById("tituloPagina").textContent = "Centro de Reportes";
document.getElementById("subtituloPagina").textContent = "Estadísticas y movimientos del inventario";

    desactivarBuscador();

    // Ocultar dashboard
    mostrarDashboardCards(false);

    // Ocultar resultados
    document.getElementById("seccionResultados").style.display = "none";
    document.getElementById("seccionVencimientos").style.display = "none";

    // Mostrar movimientos
    document.getElementById("seccionMovimientos").style.display = "block";

}
// =====================================
// MOSTRAR VENCIMIENTOS
// =====================================

async function mostrarVencimientos() {

    document.getElementById("tituloPagina").textContent =
        "Reporte de Vencimientos";

    document.getElementById("subtituloPagina").textContent =
        "Productos vencidos por mes";

    desactivarBuscador();

    mostrarDashboardCards(false);

    document.getElementById("seccionResultados").style.display = "none";
    document.getElementById("seccionMovimientos").style.display = "none";
    document.getElementById("seccionVencimientos").style.display = "block";

    // ==========================
    // CARGAR MESES
    // ==========================

    const meses = await getMesesVencimientos();

    const select = document.getElementById("mesVencimientos");

    select.innerHTML = "";

    meses.forEach(mes => {

        select.innerHTML += `
            <option value="${mes}">
                ${mes}
            </option>
        `;

    });

    // Cargar automáticamente el primer mes

    if (meses.length > 0) {

        await cargarVencimientos(meses[0]);

    }

    // Cuando cambie el mes

    select.onchange = async () => {

        await cargarVencimientos(select.value);

    };

} // ← aquí termina mostrarVencimientos

let datosVencimientos = null;
let graficaVencimientos = null;

function dibujarGraficaVencimientos(productos){

    const conteo = {};

productos
    .filter(p =>
        p.marca &&
        p.marca.trim() !== "" &&
        p.marca.toUpperCase() !== "MARCA"
    )
    .forEach(p => {

        conteo[p.marca] = (conteo[p.marca] || 0) + 1;

    });

    const ordenados = Object.entries(conteo)
    .sort((a, b) => b[1] - a[1]);

const labels = ordenados.map(item => item[0]);

const valores = ordenados.map(item => item[1]);

    const ctx = document
        .getElementById("graficaVencimientos")
        .getContext("2d");

    if(graficaVencimientos){

        graficaVencimientos.destroy();

    }

    graficaVencimientos = new Chart(ctx, {

    type: "bar",

data: {

    labels,

    datasets: [{

        label: "Productos vencidos",

        data: valores,

        borderRadius: 10,

        borderSkipped: false,

        barThickness: 34,

        maxBarThickness: 40,

hoverBackgroundColor: "#003F8A",

backgroundColor: [
    "#0F4C81",
    "#1565C0",
    "#1976D2",
    "#1E88E5",
    "#42A5F5",
    "#64B5F6",
    "#90CAF9",
    "#BBDEFB"
]

    }]

},

    options: {

    indexAxis: 'y',

    responsive: true,

    maintainAspectRatio: false,

    scales: {

        x: {

            beginAtZero: true,

            ticks: {

                precision: 0,

                color: "#5B6777"

            },

            grid: {

                color: "#EEF2F7"

            }

        },

        y: {

            ticks: {

                color: "#243B53",

                font: {

                    size: 15,

                    weight: "600"

                }

            },

            grid: {

                display: false

            }

        }

    },

    plugins: {

        legend: {

            display: false

        },

        title: {

            display: true,

            text: "Top de productos vencidos por marca",

            color: "#183153",

            font: {

                size: 22,

                weight: "bold"

            }

        },

        tooltip: {

            callbacks: {

                label(context) {

                    return context.raw + " productos";

                }

            }

        }

    }

}

});

}

// =====================================
// CARGAR VENCIMIENTOS
// =====================================

async function cargarVencimientos(mes) {

    const datos = await getVencimientos(mes);

    document.getElementById("vProductos").textContent =
        datos.resumen.productos || 0;

    document.getElementById("vLotes").textContent =
        datos.resumen.lotes || 0;

    document.getElementById("vUnidades").textContent =
        datos.resumen.unidades || 0;

    document.getElementById("vMarcas").textContent =
        datos.resumen.marcas || 0;

    console.log("Vencimientos:", datos);

    // Dibujar gráfica
dibujarGraficaVencimientos(datos.productos);

// Llenar tabla
llenarTablaVencimientos(datos.productos);
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
function llenarTablaVencimientos(productos){

    const tbody = document.querySelector("#tablaVencimientos tbody");

    if(!tbody) return;

    tbody.innerHTML = "";

    productos.slice(1).forEach(producto=>{

        const fila = document.createElement("tr");

        fila.innerHTML = `

            <tr>

                <td>${producto.marca || "-"}</td>

                <td>${producto.codigo || "-"}</td>

                <td>${producto.producto || "-"}</td>

                <td>${producto.lote || "-"}</td>

                <td>${new Date(producto.fecha).toLocaleDateString("es-HN")}</td>

                <td style="text-align:center">
                    ${producto.cantidad || 0}
                </td>

            </tr>

        `;

        tbody.appendChild(fila);

    });

}