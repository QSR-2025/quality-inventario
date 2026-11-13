// ========================================
// QUALITY INVENTARIO
// HOME.JS FINAL
// MARCA → CATEGORIA → PRODUCTOS
// BUSCADOR UNIVERSAL
// MODAL DETALLE
// ========================================


let inventario = [];


// Estado del filtro de tarjetas (Vigente, Por vencer...) para poder refrescar la misma vista.
let filtroEstadoActivo = "";

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
let indiceLogosMarcas = new Map();
const cacheImagenesDriveQI = new Map();
// ==========================================================
// RENDERIZADO PROGRESIVO DE PRODUCTOS
// Evita crear cientos de tarjetas al mismo tiempo
// ==========================================================

let renderVersion = 0;

function renderProductosProgresivo(productos, contenedor, lote = 30) {

    renderVersion++;

    const versionActual = renderVersion;

    contenedor.innerHTML = "";

    let posicion = 0;

    function renderSiguienteLote() {

        // Si el usuario cambió de categoría o búsqueda,
        // cancelamos este render anterior.
        if (versionActual !== renderVersion) {
            return;
        }

        const fragment = document.createDocumentFragment();

        const limite = Math.min(
            posicion + lote,
            productos.length
        );

        for (; posicion < limite; posicion++) {

            renderProductCard(
                productos[posicion],
                fragment
            );

        }

        contenedor.appendChild(fragment);

        if (posicion < productos.length) {

            requestAnimationFrame(
                renderSiguienteLote
            );

        }

    }

    requestAnimationFrame(
        renderSiguienteLote
    );
}
function construirIndicesInventario() {

    indiceMarcas.clear();
    indiceCategorias.clear();

    inventario.forEach(producto => {

        const marca = producto.marca || producto.proveedor || "";
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

    await cargarInicio();

}

async function cargarInicio() {

    console.time("⏱️ CARGA INICIAL");

    try {

        const [datos, datosMarcas] = await Promise.all([
            obtenerInicio(),
            (typeof obtenerMarcas === "function" ? obtenerMarcas().catch(error => {
                console.warn("No se pudieron cargar los logotipos de marcas:", error);
                return { marcas: [] };
            }) : Promise.resolve({ marcas: [] }))
        ]);

        indiceLogosMarcas.clear();
        (Array.isArray(datosMarcas?.marcas) ? datosMarcas.marcas : []).forEach(item => {
            const clave = normalizarMarcaQI(item?.nombre);
            if (clave && item?.imagen) indiceLogosMarcas.set(clave, { url: String(item.imagen), fuente: item.imagenFuente || null });
        });

        inventario =
            Array.isArray(datos?.productos)
                ? datos.productos
                : [];

        construirIndicesInventario();

        console.log(
            "Productos combinados:",
            inventario.length
        );

        pintarResumenInicio(datos?.resumen);

        mostrarMarcas();

        marcarInventarioActualizado();

    } catch (error) {

        console.error(
            "Error cargando inicio:",
            error
        );

        alert(
            "Error cargando inventario:\n\n" +
            error.message
        );

    } finally {

        console.timeEnd("⏱️ CARGA INICIAL");

    }

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

    console.time("⏱️ INVENTARIO COMPLETO");

    try {

        // ========================================
        // CARGAR TEGUS + SPS AL MISMO TIEMPO
        // ========================================

       console.time("⏱️ TEGUS + SPS");

const [resultadoTegus, resultadoSPS] =
    await Promise.allSettled([
        obtenerInventario(),
        obtenerInventarioSPS()
    ]);

console.timeEnd("⏱️ TEGUS + SPS");        
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
        console.time("⏱️ PROCESAMIENTO PRODUCTOS");
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
            const tipoProducto = String(producto.tipo || "reactivo").toLowerCase();
            // Reactivos y Materiales son catálogos distintos: no fusionar
            // productos solo porque compartan el mismo código.
            const claveProducto = `${tipoProducto}|${sku}`;


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

            if (!productosAgrupados.has(claveProducto)) {

                productosAgrupados.set(
                    claveProducto,
                    {
                        ...producto,
                        sku: sku,
                        stockTotal: 0,
                        stockTGU: 0,
                        // SPS Materiales no está integrado todavía: null
                        // evita presentar un cero que no proviene de la hoja.
                        stockSPS: tipoProducto === "material" ? null : 0,
                        lotes: []
                    }
                );

            }


            const productoFinal =
                productosAgrupados.get(claveProducto);


            // ==================================
            // SUMAR STOCK
            // ==================================

            const stockProducto = Number(
                producto.stockTotal ??
                producto.stock ??
                producto.cantidad ??
                0
            );


            const stockSeguro = isNaN(stockProducto) ? 0 : stockProducto;
            productoFinal.stockTotal += stockSeguro;

            // Materiales/repuestos no manejan lotes: acumular el stock
            // según la fuente de la que proviene cada registro.
            const tipoSinLotes =
                ["material", "repuesto"].includes(String(producto.tipo || "").toLowerCase()) ||
                ["material", "repuesto"].includes(String(productoFinal.tipo || "").toLowerCase());
            if (tipoSinLotes) {
                const bodegaProducto = String(producto.bodega || "Tegus").toUpperCase();
                if (bodegaProducto === "SPS" || bodegaProducto.includes("SAN PEDRO")) {
                    productoFinal.stockSPS = (Number(productoFinal.stockSPS) || 0) + stockSeguro;
                } else {
                    productoFinal.stockTGU = (Number(productoFinal.stockTGU) || 0) + stockSeguro;
                }
                // No crear lotes ficticios para Materiales ni Repuestos.
                return;
            }

            // ==================================
            // COPIAR LOTES DE REACTIVOS
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
                            "Tegus",

                        // Cada lote conserva la ubicación de SU bodega.
                        // Nunca se hereda la del producto de otra bodega.
                        ubicacion:
                            lote.ubicacion ||
                            producto.ubicacion ||
                            ""

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
                        "Tegus",

                    ubicacion:
                        producto.ubicacion ||
                        ""

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
        console.timeEnd("⏱️ PROCESAMIENTO PRODUCTOS");
        console.timeEnd("⏱️ INVENTARIO COMPLETO");


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


    // ==================================
// ACTUALIZAR PRODUCTOS DE ALMACÉN
// ==================================

if (typeof cargarProductosAlmacen === "function") {
    cargarProductosAlmacen();
}
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

// Oculta todas las secciones principales antes de abrir la seleccionada.
function ocultarSeccionesPrincipales() {
    ["seccionResultados", "seccionAlmacen", "seccionMovimientos", "seccionVencimientos", "seccionConfiguracion"].forEach(id => {
        const elemento = document.getElementById(id);
        if (elemento) elemento.style.display = "none";
    });
}


// El menú de reportes se configura de forma independiente para que siga
// funcionando incluso si otra carga inicial presenta un error.
function configurarCentroReportesQI() {
    const boton = document.getElementById("btnCentroReportes");
    const grupo = document.getElementById("grupoReportes");
    const submenu = document.getElementById("subReportes");
    if (!boton || !grupo || !submenu || boton.dataset.qiReportBound === "1") return;
    boton.dataset.qiReportBound = "1";
    const abiertoInicial = grupo.classList.contains("open");
    submenu.hidden = !abiertoInicial;
    submenu.style.display = abiertoInicial ? "flex" : "none";
    boton.setAttribute("aria-expanded", abiertoInicial ? "true" : "false");
    boton.addEventListener("click", (evento) => {
        evento.preventDefault();
        const abierto = boton.getAttribute("aria-expanded") !== "true";
        grupo.classList.toggle("open", abierto);
        submenu.hidden = !abierto;
        submenu.style.display = abierto ? "flex" : "none";
        boton.setAttribute("aria-expanded", abierto ? "true" : "false");
    });
}
document.addEventListener("DOMContentLoaded", configurarCentroReportesQI);

// ========================================
// MENU
// ========================================

function configurarMenu() {

    const menuProductos = document.getElementById("menuProductos");
    const menuAlmacen = document.getElementById("menuAlmacen");
    const menuMovimientos = document.getElementById("menuMovimientos");
    const menuVencimientos = document.getElementById("menuVencimientos");
    const rol = String(localStorage.getItem("qualityRol") || "").trim().toLowerCase();
    const puedeGestionarAlmacen = ["administrador", "bodega"].includes(rol);
    if (menuAlmacen) menuAlmacen.style.display = puedeGestionarAlmacen ? "" : "none";

    // Productos
    if (menuProductos) {

        menuProductos.addEventListener("click", () => {
            ocultarSeccionesPrincipales();
            mostrarDashboardCards(true);
            document.getElementById("tituloPagina").textContent = "Productos";
document.getElementById("subtituloPagina").textContent = "Gestión de inventario y vencimientos";

            activarBuscador();

            document.getElementById("seccionResultados").style.display = "block";
            document.getElementById("seccionMovimientos").style.display = "none";
            document.getElementById("seccionVencimientos").style.display = "none";
            document.getElementById("seccionAlmacen").style.display = "none";

            mostrarMarcas();

        });

    }
// Almacén
if (menuAlmacen) {

    menuAlmacen.addEventListener("click", () => {
        const rolActual = String(localStorage.getItem("qualityRol") || "").trim().toLowerCase();
        if (!["administrador", "bodega"].includes(rolActual)) {
            alert("No tienes permiso para acceder al Almacén.");
            return;
        }
        ocultarSeccionesPrincipales();
        mostrarDashboardCards(false);
        document.getElementById("tituloPagina").textContent =
            "Almacén";

        document.getElementById("subtituloPagina").textContent =
            "Registro de entradas y salidas de inventario";

        document.getElementById("seccionResultados").style.display = "none";
        document.getElementById("seccionAlmacen").style.display = "block";
        document.getElementById("seccionMovimientos").style.display = "none";
        document.getElementById("seccionVencimientos").style.display = "none";

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


// Normalización para emparejar marcas del inventario con la pestaña Marcas de TGU.
function normalizarMarcaQI(valor) {
    return String(valor || "").trim().normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function extraerIdDriveQI(url) {
    const texto = String(url || "");
    const m = texto.match(/(?:\/file\/d\/|\/d\/|[?&]id=)([A-Za-z0-9_-]{10,})/);
    return m ? m[1] : "";
}

async function obtenerImagenDriveQI(url, fuenteCelda = null) {
    const original = String(url || "").trim();
    const id = extraerIdDriveQI(original);
    if (!original && !fuenteCelda) return "";
    const clave = fuenteCelda ? JSON.stringify(fuenteCelda) : (id || original);
    const cacheado = cacheImagenesDriveQI.get(clave);
    if (cacheado && Date.now() - cacheado.timestamp < cacheado.ttl) return cacheado.src;
    const token = String(localStorage.getItem("qualityToken") || "").trim();
    if (!token) return "";
    try {
        const resp = await fetch(API_URL, {
            method: "POST",
            body: JSON.stringify({ action: "getImagenDrive", token, fileId: id, url: original, fuente: fuenteCelda })
        });
        const data = await resp.json();
        if (!resp.ok || !data?.success) {
            console.warn("No se pudo recuperar la imagen desde el servidor:", data?.message || ("HTTP " + resp.status));
            return "";
        }
        const src = String(data.dataUrl || data.imageUrl || "");
        if (src) {
            // Las content URLs de Google son temporales; no conservarlas tanto
            // como los data URLs que ya contienen la imagen.
            const ttl = (data.temporal || /googleusercontent\.com/i.test(src)) ? 30 * 1000 : 5 * 60 * 1000;
            cacheImagenesDriveQI.set(clave, { timestamp: Date.now(), src, ttl });
        }
        return src;
    } catch (error) {
        console.warn("No se pudo recuperar la imagen protegida de Drive/Sheets:", error);
        return "";
    }
}

function esUrlProxyableQI(url) {
    try {
        const u = new URL(String(url || ""));
        const host = u.hostname.toLowerCase();
        return (host === "qualityhn.com" || host === "www.qualityhn.com") && u.pathname.toLowerCase().startsWith("/wp-content/uploads/");
    } catch (e) { return false; }
}

function cargarImagenConRespaldoQI(img, url, alFallar, fuenteCelda = null) {
    if (!img || (!url && !fuenteCelda)) { if (alFallar) alFallar(); return; }
    const original = String(url || "").trim();
    const instancia = (Number(img.dataset.qiInstancia || 0) + 1);
    img.dataset.qiInstancia = String(instancia);
    let finalizada = false;
    let proxyIntentado = false;
    const fallar = () => { if (finalizada) return; finalizada = true; if (alFallar) alFallar(); };
    const asignar = (src) => {
        if (img.dataset.qiInstancia !== String(instancia) || !src) return;
        img.onerror = () => intentarProxy();
        img.src = src;
    };
    const intentarProxy = () => {
        if (proxyIntentado) { fallar(); return; }
        // Resolver mediante Apps Script solo si es una imagen insertada en celda,
        // o si una URL pública de Quality no pudo cargarse directamente.
        if (!fuenteCelda && !esUrlProxyableQI(original)) { fallar(); return; }
        proxyIntentado = true;
        img.dataset.qiProxyIntentado = "1";
        obtenerImagenDriveQI(original, fuenteCelda).then(src => {
            if (img.dataset.qiInstancia !== String(instancia)) return;
            if (src) asignar(src); else fallar();
        }).catch(fallar);
    };

    img.dataset.qiUrlOriginal = original;
    img.dataset.qiProxyIntentado = "0";
    img.referrerPolicy = "strict-origin-when-cross-origin";

    // CellImage: no usar el content URL guardado en caché. Solicitar al backend
    // una URL fresca de la celda, o el blob convertido a data URL.
    const urlGoogleTemporal = /googleusercontent\.com/i.test(original);
    if (fuenteCelda && (!original || urlGoogleTemporal)) {
        proxyIntentado = true;
        img.dataset.qiProxyIntentado = "1";
        obtenerImagenDriveQI(original, fuenteCelda).then(src => {
            if (img.dataset.qiInstancia !== String(instancia)) return;
            if (src) asignar(src);
            else if (original) asignar(original);
            else fallar();
        }).catch(() => { if (original) asignar(original); else fallar(); });
    } else if (original) {
        img.onerror = () => intentarProxy();
        img.src = original;
    } else {
        intentarProxy();
    }
}

function crearLogoMarcaQI(marca, clase = "brand-logo") {
    const caja = document.createElement("div");
    caja.className = clase;
    const logo = indiceLogosMarcas.get(normalizarMarcaQI(marca));
    const url = logo && logo.url ? logo.url : "";
    if (url) {
        const img = document.createElement("img");
        img.alt = "Logotipo " + marca;
        img.loading = "lazy";
        cargarImagenConRespaldoQI(img, url, () => {
            img.remove();
            const icono = document.createElement("i");
            icono.className = "fas fa-tag";
            icono.setAttribute("aria-hidden", "true");
            caja.appendChild(icono);
        }, logo.fuente || null);
        caja.appendChild(img);
    } else {
        const icono = document.createElement("i");
        icono.className = "fas fa-tag";
        icono.setAttribute("aria-hidden", "true");
        caja.appendChild(icono);
    }
    return caja;
}

function obtenerDatosImagenPrincipalQI(producto) {
    if (!producto) return { url: "", fuente: null };
    if (producto.imagen || producto.imagenFuente) return { url: String(producto.imagen || ""), fuente: producto.imagenFuente || null };
    const refs = [
        [producto.foto1 || producto.ref1 || producto.referencia1, producto.foto1Tipo, producto.foto1Fuente],
        [producto.foto2 || producto.ref2 || producto.referencia2, producto.foto2Tipo, producto.foto2Fuente]
    ];
    for (const [valor, clase, fuente] of refs) {
        const ref = String(valor || "").trim();
        const tipoRef = String(clase || "").toLowerCase();
        if ((ref || fuente) && (tipoRef === "imagen" || !!fuente || esUrlDeImagen(ref) ||
            /drive\.google\.com\/(?:file\/d|thumbnail|uc|open)/i.test(ref) ||
            /googleusercontent\.com/i.test(ref))) {
            return { url: ref, fuente: fuente || null };
        }
    }
    return { url: "", fuente: null };
}

function obtenerImagenPrincipalQI(producto) {
    return obtenerDatosImagenPrincipalQI(producto).url;
}

function abrirVisorReferenciaQI(src, titulo, fuenteCelda = null) {
    let visor = document.getElementById("visorReferenciaQI");
    if (!visor) {
        visor = document.createElement("div");
        visor.id = "visorReferenciaQI";
        visor.className = "qi-image-viewer";
        visor.innerHTML = '<button type="button" class="qi-image-viewer-close" aria-label="Cerrar imagen">×</button><img alt="Referencia ampliada"><p></p>';
        document.body.appendChild(visor);
        visor.querySelector("button").addEventListener("click", () => visor.classList.remove("open"));
        visor.addEventListener("click", e => { if (e.target === visor) visor.classList.remove("open"); });
        document.addEventListener("keydown", e => { if (e.key === "Escape") visor.classList.remove("open"); });
    }
    const img = visor.querySelector("img");
    img.alt = titulo || "Referencia";
    cargarImagenConRespaldoQI(img, src, () => { img.alt = "No se pudo cargar la imagen"; }, fuenteCelda);
    visor.querySelector("p").textContent = titulo || "Referencia";
    visor.classList.add("open");
}

// ========================================
// MOSTRAR MARCAS
// ========================================
function mostrarMarcas() {
    filtroEstadoActivo = "";
    rutaActual.marca = "";
    rutaActual.categoria = "";
    mostrarDashboardCards(true);
    const contenedor = document.getElementById("productList");
    if (!contenedor) return;
    contenedor.innerHTML = "";
    const marcas = Array.from(indiceMarcas.keys()).filter(Boolean).sort();
    const fragment = document.createDocumentFragment();
    marcas.forEach(marca => {
        const cantidad = indiceMarcas.get(marca)?.length || 0;
        const div = document.createElement("div");
        div.className = "product-card catalog-card brand-card";
        div.appendChild(crearLogoMarcaQI(marca));
        const info = document.createElement("div");
        info.className = "product-info";
        const h3 = document.createElement("h3"); h3.textContent = marca;
        const p = document.createElement("p"); p.textContent = cantidad + " productos";
        info.append(h3, p);
        div.appendChild(info);
        const btn = document.createElement("button"); btn.className = "btn-detail"; btn.type = "button"; btn.textContent = "Abrir";
        btn.addEventListener("click", e => { e.stopPropagation(); div.click(); });
        div.appendChild(btn);
        div.addEventListener("click", () => {
            rutaActual.marca = marca; rutaActual.categoria = ""; mostrarCategorias(marca);
        });
        fragment.appendChild(div);
    });
    contenedor.appendChild(fragment);
    actualizarBreadcrumb();
}
function mostrarCategorias(marca) {

    filtroEstadoActivo = "";

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

        div.className = "product-card catalog-card category-card";
        div.appendChild(crearLogoMarcaQI(marca, "brand-logo category-logo"));
        const infoCategoria = document.createElement("div");
        infoCategoria.className = "product-info";
        const tituloCategoria = document.createElement("h3"); tituloCategoria.textContent = categoria;
        const textoCategoria = document.createElement("p"); textoCategoria.textContent = cantidad + " productos";
        infoCategoria.append(tituloCategoria, textoCategoria);
        div.appendChild(infoCategoria);
        const btnCategoria = document.createElement("button");
        btnCategoria.className = "btn-detail"; btnCategoria.type = "button"; btnCategoria.textContent = "Abrir";
        btnCategoria.addEventListener("click", e => { e.stopPropagation(); div.click(); });
        div.appendChild(btnCategoria);

        div.onclick = () => {
            rutaActual.categoria = categoria;
            mostrarProductos(marca, categoria);
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

    filtroEstadoActivo = "";

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

   renderProductosProgresivo(
    productos,
    contenedor,
    30
);

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
    const div = document.createElement("article");
    div.className = "product-card product-card-product";
    const datosImagen = obtenerDatosImagenPrincipalQI(producto);
    const urlImagen = datosImagen.url;
    const marco = document.createElement("div");
    marco.className = "product-thumb";
    if (urlImagen || datosImagen.fuente) {
        const img = document.createElement("img");
        img.alt = producto.nombre || "Imagen del producto";
        img.loading = "lazy";
        img.decoding = "async";
        cargarImagenConRespaldoQI(img, urlImagen, () => {
            marco.classList.add("sin-imagen");
            marco.replaceChildren();
            const icono = document.createElement("i"); icono.className = "fas fa-box-open";
            marco.appendChild(icono);
        }, datosImagen.fuente);
        marco.appendChild(img);
    } else {
        marco.classList.add("sin-imagen");
        const icono = document.createElement("i"); icono.className = "fas fa-box-open";
        marco.appendChild(icono);
    }
    const info = document.createElement("div");
    info.className = "product-info";
    const h3 = document.createElement("h3"); h3.textContent = producto.nombre || "Sin nombre";
    const detalles = [
        ["SKU", producto.sku || "—"],
        ["Marca", producto.marca || producto.proveedor || "—"],
        ["Categoría", producto.categoria || "—"],
        ["Existencias", producto.stockTotal ?? 0]
    ];
    info.appendChild(h3);
    detalles.forEach(([label, value]) => {
        const p = document.createElement("p");
        const strong = document.createElement("strong"); strong.textContent = label + ": ";
        p.append(strong, document.createTextNode(String(value)));
        info.appendChild(p);
    });
    const btn = document.createElement("button");
    btn.className = "btn-detail"; btn.type = "button";
    btn.innerHTML = '<i class="fas fa-eye" aria-hidden="true"></i> Ver detalles';
    btn.addEventListener("click", e => { e.stopPropagation(); verDetalleProducto(producto); });
    div.append(marco, info, btn);
    div.addEventListener("click", () => verDetalleProducto(producto));
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
    const almacen = document.getElementById("seccionAlmacen");

    // Las tarjetas de Productos nunca se muestran en Almacén, Movimientos ni
    // Vencimientos (mostrarMarcas() y la recarga tras registrar las reactivaban).
    if (
        (movimientos && movimientos.style.display === "block") ||
        (vencimientos && vencimientos.style.display === "block") ||
        (almacen && almacen.style.display === "block")
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

    const enAlmacen =
        document.getElementById("seccionAlmacen")?.style.display === "block";

    if (enMovimientos || enVencimientos || enAlmacen) {
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


let productoDetalleActual = null;

/** Nombre legible de la bodega (el backend usa "Tegus" y "SPS"). */
function nombreBodegaVisible(valor) {
    const v = String(valor || "").trim().toUpperCase();
    if (v === "SPS" || v.includes("SAN PEDRO")) return "San Pedro Sula";
    if (v === "TEGUS" || v === "TGU" || v.includes("TEGUCIGALPA")) return "Tegucigalpa";
    return String(valor || "").trim() || "Tegucigalpa";
}

function esProductoSinLotes(producto) {
    const tipo = String((producto && producto.tipo) || "").toLowerCase();
    return tipo === "material" || tipo === "repuesto";
}

/**
 * Existencias por bodega tal como las entrega el backend (stockTGU/stockSPS).
 * No se reparte ni se supone ninguna cantidad: si el backend no envió el dato
 * de una bodega, se devuelve null y la pantalla muestra "—".
 */
function obtenerStockPorBodega(producto) {
    const numero = v => {
        if (v === undefined || v === null || v === "") return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    };
    return {
        tgu: numero(producto.stockTGU ?? producto.stockTegucigalpa),
        sps: numero(producto.stockSPS ?? producto.stockSanPedroSula)
    };
}

function textoCantidad(valor) {
    return valor === null || valor === undefined ? "—" : String(valor);
}

/**
 * Texto del portapapeles. NUNCA incluye Referencia 1, Referencia 2 ni
 * ubicaciones internas (aunque la ficha las muestre).
 */
function construirTextoCopia(p) {
    const lineas = [
        `Producto: ${p.nombre || "—"}`,
        `SKU: ${p.sku || "—"}`,
        `Proveedor: ${p.proveedor || "—"}`,
        `Categoría: ${p.categoria || "—"}`,
        `Stock total: ${p.stockTotal ?? 0}`
    ];
    if (esProductoSinLotes(p)) {
        const stock = obtenerStockPorBodega(p);
        lineas.push(`Tegucigalpa: ${textoCantidad(stock.tgu)}`);
        lineas.push(`San Pedro Sula: ${textoCantidad(stock.sps)}`);
    } else {
        lineas.push("Lotes:", ...(p.lotes || []).map((l, i) =>
            `  Lote ${i + 1}: ${l.numLote || l.numero || l.lote || "—"} | Bodega: ${nombreBodegaVisible(l.bodega || p.bodega)} | Cantidad: ${l.stock ?? l.cantidad ?? 0} | Vencimiento: ${l.vencimiento || "—"}`));
    }
    return lineas.join("\n");
}

async function copiarDetalleProducto() {
    const p = productoDetalleActual;
    if (!p) return;
    const texto = construirTextoCopia(p);
    try { await navigator.clipboard.writeText(texto); alert("Información del producto copiada."); }
    catch (e) { const ta=document.createElement("textarea"); ta.value=texto; document.body.appendChild(ta); ta.select(); const ok=document.execCommand("copy"); ta.remove(); alert(ok ? "Información del producto copiada." : "No se pudo copiar la información."); }
}

document.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("btnCopiarDetalle");
    if (btn) btn.addEventListener("click", copiarDetalleProducto);
});

/** Detecta URL de imagen, incluidos enlaces de Drive sin extensión visible. */
function esUrlDeImagen(texto) {
    if (/^data:image\//i.test(String(texto || ""))) return true;
    const t = String(texto || "").trim();
    if (!/^https?:\/\//i.test(t)) return false;
    return /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(t)
        || /drive\.google\.com\/(thumbnail|uc|file)\b/i.test(t)
        || /googleusercontent\.com\//i.test(t)
        || /[?&]id=[A-Za-z0-9_-]{10,}/i.test(t);
}

function crearBloqueReferencia(titulo, valor, tipo, fuenteCelda = null) {
    const clase = String(tipo || (typeof valor === "object" ? valor.tipo : "") || "").toLowerCase();
    const tieneFuenteImagen = !!fuenteCelda && clase === "imagen";
    if ((valor === null || valor === undefined || valor === "") && !tieneFuenteImagen) return null;
    const contenido = (typeof valor === "object" && valor.url) ? String(valor.url) : String(valor || "").trim();
    if (!contenido && !tieneFuenteImagen) return null;
    const bloque = document.createElement("div");
    bloque.className = "referencia-material";
    const etiqueta = document.createElement("strong");
    etiqueta.textContent = titulo;
    bloque.appendChild(etiqueta);

    const esImagen = clase === "imagen" || tieneFuenteImagen || esUrlDeImagen(contenido) ||
        /drive\.google\.com\/(?:file\/d|thumbnail|uc)/i.test(contenido) || /googleusercontent\.com/i.test(contenido);
    const esEnlace = !esImagen && (clase === "enlace" || /^https?:\/\//i.test(contenido));
    if (esImagen) {
        const boton = document.createElement("button");
        boton.type = "button"; boton.className = "referencia-imagen-btn";
        boton.setAttribute("aria-label", "Ampliar " + titulo);
        const img = document.createElement("img");
        img.src = ""; img.alt = titulo; img.loading = "lazy"; img.decoding = "async";
        cargarImagenConRespaldoQI(img, contenido, () => {
            if (/^https?:\/\//i.test(contenido) && clase !== "imagen") {
                const a = document.createElement("a");
                a.href = contenido; a.target = "_blank"; a.rel = "noopener noreferrer";
                a.textContent = "Abrir referencia";
                bloque.replaceChildren(etiqueta, a);
            } else {
                boton.classList.add("referencia-sin-imagen");
                img.remove();
                const aviso = document.createElement("span"); aviso.textContent = "No se pudo cargar la imagen";
                boton.appendChild(aviso);
            }
        }, fuenteCelda);
        boton.appendChild(img);
        boton.addEventListener("click", () => abrirVisorReferenciaQI(img.src || contenido, titulo, fuenteCelda));
        bloque.appendChild(boton);
    } else if (esEnlace) {
        const a = document.createElement("a"); a.href = contenido; a.target = "_blank"; a.rel = "noopener noreferrer";
        a.textContent = "Abrir referencia"; bloque.appendChild(a);
    } else {
        const div = document.createElement("div"); div.className = "referencia-texto"; div.textContent = contenido;
        bloque.appendChild(div);
    }
    return bloque;
}

function verDetalleProducto(producto) {
    productoDetalleActual = producto;


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
        producto.stockTotal ?? 0;

    const esMaterial = esProductoSinLotes(producto);

    // Mostrar la imagen principal también en la ficha, antes de los datos.
    let cajaImagenProducto = document.getElementById("detalleImagenProducto");
    if (!cajaImagenProducto) {
        cajaImagenProducto = document.createElement("div");
        cajaImagenProducto.id = "detalleImagenProducto";
        cajaImagenProducto.className = "detalle-imagen-producto";
        const titulo = document.getElementById("detalleNombre");
        if (titulo) titulo.insertAdjacentElement("afterend", cajaImagenProducto);
    }
    cajaImagenProducto.replaceChildren();
    const datosImagenDetalle = obtenerDatosImagenPrincipalQI(producto);
    const imagenDetalle = datosImagenDetalle.url;
    if (imagenDetalle || datosImagenDetalle.fuente) {
        const imgDetalle = document.createElement("img");
        imgDetalle.alt = "Imagen de " + (producto.nombre || "producto");
        imgDetalle.loading = "eager";
        imgDetalle.decoding = "async";
        cargarImagenConRespaldoQI(imgDetalle, imagenDetalle, () => {
            cajaImagenProducto.style.display = "none";
            cajaImagenProducto.replaceChildren();
        }, datosImagenDetalle.fuente);
        cajaImagenProducto.appendChild(imgDetalle);
        cajaImagenProducto.style.display = "flex";
        imgDetalle.addEventListener("click", () => abrirVisorReferenciaQI(imgDetalle.src || imagenDetalle, producto.nombre || "Producto", datosImagenDetalle.fuente));
    } else {
        cajaImagenProducto.style.display = "none";
    }

    // Los bloques existen en home.html; si el navegador conserva un home.html
    // antiguo en caché, se crean aquí en el mismo orden (stock > bodegas >
    // ubicación > referencias).
    const pStock = document.getElementById("detalleStock")?.closest("p");
    const insertarDespues = (ancla, el) => { if (ancla && ancla.insertAdjacentElement) ancla.insertAdjacentElement("afterend", el); return el; };

    let stockBodegas = document.getElementById("detalleStockBodegas");
    if (!stockBodegas) {
        stockBodegas = document.createElement("div");
        stockBodegas.id = "detalleStockBodegas";
        stockBodegas.className = "detalle-stock-bodegas";
        insertarDespues(pStock, stockBodegas);
    }

    let spanUbicacion = document.getElementById("detalleUbicacion");
    if (!spanUbicacion) {
        const fila = document.createElement("p");
        fila.id = "detalleFilaUbicacion";
        fila.innerHTML = "<strong>Ubicación:</strong> <span id=\"detalleUbicacion\"></span>";
        insertarDespues(stockBodegas, fila);
        spanUbicacion = document.getElementById("detalleUbicacion");
    }
    const filaUbicacion = spanUbicacion ? spanUbicacion.closest("p") : null;

    let referencias = document.getElementById("detalleReferencias");
    if (!referencias) {
        referencias = document.createElement("div");
        referencias.id = "detalleReferencias";
        referencias.className = "detalle-referencias";
        insertarDespues(filaUbicacion || stockBodegas, referencias);
    }

    // ---- Existencias por bodega (solo Materiales/Repuestos) ----
    if (esMaterial) {
        const stock = obtenerStockPorBodega(producto);
        const filasStock = [`<div><strong>Tegucigalpa:</strong> ${textoCantidad(stock.tgu)}</div>`];
        // Materiales solo tiene fuente integrada de TGU en esta fase. No mostrar
        // una fila SPS vacía ni sugerir que ese inventario fue consultado.
        if (stock.sps !== null && stock.sps !== undefined) {
            filasStock.push(`<div><strong>San Pedro Sula:</strong> ${textoCantidad(stock.sps)}</div>`);
        }
        stockBodegas.innerHTML = filasStock.join("");
        stockBodegas.style.display = "grid";
    } else {
        stockBodegas.innerHTML = "";
        stockBodegas.style.display = "none";
    }

    // ---- Ubicación general: solo Materiales. En Reactivos la ubicación
    //      se muestra dentro de cada lote, no arriba. ----
    if (filaUbicacion) filaUbicacion.style.display = esMaterial ? "block" : "none";
    if (spanUbicacion) spanUbicacion.textContent = esMaterial ? (producto.ubicacion || "No asignada") : "";

    // ---- Referencias 1 y 2: solo Materiales; cada una es independiente ----
    referencias.innerHTML = "";
    let hayReferencias = false;
    if (esMaterial) {
        [["Referencia 1", producto.foto1 ?? producto.ref1 ?? producto.referencia1, producto.foto1Tipo, producto.foto1Fuente],
         ["Referencia 2", producto.foto2 ?? producto.ref2 ?? producto.referencia2, producto.foto2Tipo, producto.foto2Fuente]].forEach(([titulo, valor, tipo, fuente]) => {
            const bloque = crearBloqueReferencia(titulo, valor, tipo, fuente);
            if (bloque) { referencias.appendChild(bloque); hayReferencias = true; }
        });
    }
    referencias.style.display = hayReferencias ? "grid" : "none";

    // ==========================
    // LOTES (solo reactivos)
    // Campos reales que envía Code.gs por cada lote:
    // { numero, numLote, stock, vencimiento, alerta }
    // El estado mostrado (texto y color) ya NO depende de "alerta":
    // se calcula aquí mismo a partir de los días restantes.
    // ==========================


    const detalleLotes = document.getElementById("detalleLotes");

    const contenedorLotes = detalleLotes ? detalleLotes.closest(".lotes-modal") : null;
    if (contenedorLotes) contenedorLotes.style.display = esMaterial ? "none" : "block";
    if (detalleLotes) {

        detalleLotes.innerHTML = "";

        if (producto.lotes && producto.lotes.length) {

            producto.lotes.forEach((lote, index) => {

                const numeroLote = lote.numLote || "—";

                const cantidad = (lote.stock !== undefined && lote.stock !== null && lote.stock !== "—")
                    ? lote.stock
                    : 0;

                const fecha = lote.vencimiento || "Sin fecha";
                const bodega = nombreBodegaVisible(lote.bodega || producto.bodega);

                    // La ubicación pertenece al lote (a su bodega). No se usa la
                    // ubicación general del producto: es la de la primera bodega
                    // que se leyó y aparecería repetida en la otra bodega.
                    const ubicacionLote =
                    String(lote.ubicacion || "").trim() ||
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

                        <span><i class="fas fa-warehouse"></i> ${bodega}</span>

                        <span><i class="fas fa-location-dot"></i> ${ubicacionLote}</span>

                    </div>

                    <div class="lote-footer">

                        <span><i class="fas fa-calendar-days"></i> ${fecha}</span>

                        <span class="estado-lote estado-${estado}">
                       ${estadoLote}
                        </span>

                    </div>

                    ${diasTexto ? `<div class="lote-dias">${diasTexto}</div>` : ""}

                </div>

                `;

            });

        } else if (!esMaterial) {
            detalleLotes.innerHTML = "<p>No hay lotes registrados</p>";
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

    filtroEstadoActivo = estado;


    mostrarDashboardCards(false);


    const contenedor = document.getElementById("productList");


    contenedor.innerHTML = "";
    // Migas de pan con acciones reales: "Inicio" vuelve a la lista de marcas
    // y el filtro actual se puede volver a abrir.
    rutaActual.marca = "";
    rutaActual.categoria = "";

    const breadcrumb = document.getElementById("breadcrumb");

    if (breadcrumb) {

        breadcrumb.innerHTML = "";

        crearBotonRuta("🏠 Inicio", () => {
            mostrarMarcas();
        });

        agregarSeparador();

        crearBotonRuta(textoEstadoLote(estado), () => {
            filtrarLotesPorEstado(estado);
        });

    }

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
    ocultarSeccionesPrincipales();
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

    ocultarSeccionesPrincipales();
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

        if (typeof cerrarSesionLocal === "function") {
            cerrarSesionLocal();
        } else {
            localStorage.removeItem("qualityUsuario");
            localStorage.removeItem("qualityToken");
            window.location.href = "index.html";
        }

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


/* ==========================================================
   ACTUALIZACIÓN DEL INVENTARIO (manual y automática)
   - Botón "Actualizar" en Productos.
   - Cada cierto tiempo, y al volver a la pestaña, se refrescan las
     existencias sin recargar la página ni perder la vista actual.
========================================================== */

const AUTO_ACTUALIZAR_MS = 5 * 60 * 1000;      // refresco automático cada 5 min
const REVISION_AUTO_MS = 60 * 1000;            // se revisa cada minuto
const FORZAR_LECTURA_TRAS_MS = 60 * 60 * 1000; // tras 1 h (o cambio de día) se lee directo de las hojas

let actualizandoInventario = false;
let ultimaActualizacionInventario = Date.now();
let diaUltimaActualizacion = new Date().toDateString();

/** Muestra en las tarjetas del inicio los totales calculados por el servidor. */
function pintarResumenInicio(resumen) {

    if (!resumen) return;

    const poner = (id, valor) => {
        const el = document.getElementById(id);
        if (el) el.textContent = valor;
    };

    poner("totalProductos", resumen.total ?? inventario.length);
    poner("stockBajo", resumen.stockBajo ?? 0);
    poner("porVencer", resumen.porVencer ?? 0);
    poner("marcas", resumen.marcas ?? 0);
    poner("lotesVigentes", resumen.lotesVigentes ?? 0);
    poner("lotesPorVencer", resumen.lotesPorVencer ?? 0);
    poner("lotesUrgentes", resumen.lotesUrgentes ?? 0);
    poner("lotesVencidos", resumen.lotesVencidos ?? 0);
}

function marcarInventarioActualizado() {

    ultimaActualizacionInventario = Date.now();
    diaUltimaActualizacion = new Date().toDateString();

    const estado = document.getElementById("estadoActualizacion");

    if (estado) {
        const ahora = new Date();
        estado.textContent = "Actualizado " +
            String(ahora.getHours()).padStart(2, "0") + ":" +
            String(ahora.getMinutes()).padStart(2, "0");
    }
}

function hayModalAbierto() {
    return Array.from(document.querySelectorAll(".modal")).some(m =>
        m.style.display === "flex" || m.style.display === "block"
    );
}

/** Vuelve a dibujar lo que el usuario estaba viendo con los datos nuevos. */
function refrescarVistaActual() {

    const resultados = document.getElementById("seccionResultados");

    // Solo se redibuja la pantalla de Productos; Almacén, Movimientos y
    // Vencimientos no se tocan (los datos nuevos quedan en memoria).
    if (!resultados || resultados.style.display === "none") return;

    const texto = String(document.getElementById("buscador")?.value || "").trim().toLowerCase();

    if (texto) {
        ejecutarBusqueda(texto);
    } else if (filtroEstadoActivo) {
        filtrarLotesPorEstado(filtroEstadoActivo);
    } else if (rutaActual.categoria) {
        mostrarProductos(rutaActual.marca, rutaActual.categoria);
    } else if (rutaActual.marca) {
        mostrarCategorias(rutaActual.marca);
    } else {
        mostrarMarcas();
    }
}

/** Valida la respuesta del servidor y la aplica a la pantalla. */
function aplicarDatosInicio(datos) {

    if (!Array.isArray(datos?.productos)) {
        throw new Error(datos?.mensaje || "Respuesta no válida del servidor");
    }

    // Si llega una lista vacía y ya había productos, se conserva lo anterior.
    if (!datos.productos.length && inventario.length) {
        throw new Error("El servidor devolvió el inventario vacío");
    }

    inventario = datos.productos;

    construirIndicesInventario();
    pintarResumenInicio(datos.resumen);
    refrescarVistaActual();

    if (typeof cargarProductosAlmacen === "function") {
        cargarProductosAlmacen();
    }

    marcarInventarioActualizado();
}

async function actualizarInventario({ forzar = true, silencioso = false } = {}) {

    if (actualizandoInventario) return false;

    actualizandoInventario = true;

    const boton = document.getElementById("btnActualizarInventario");
    const estado = document.getElementById("estadoActualizacion");

    if (boton) {
        boton.disabled = true;
        boton.classList.add("actualizando");
    }

    if (estado && !silencioso) estado.textContent = "Actualizando...";

    try {

        limpiarCacheAPI();

        if (forzar && !silencioso) {

            // FASE 1 (instantánea): copia guardada en el servidor. El usuario
            // ve datos casi al momento en vez de esperar la lectura completa.
            const inicio = Date.now();

            const rapido = await obtenerInicio(false);

            aplicarDatosInicio(rapido);

            // Si el servidor tuvo que leer las hojas (no había copia), ya
            // son datos frescos y no hace falta repetir la lectura.
            if (Date.now() - inicio < 4000) {

                // FASE 2 (en segundo plano): leer las hojas para captar
                // cambios hechos a mano directamente en Google Sheets.
                if (estado) estado.textContent = "Sincronizando con las hojas...";

                try {
                    aplicarDatosInicio(await obtenerInicio(true));
                } catch (errorFase2) {
                    console.warn("Sincronización completa no disponible:", errorFase2);
                    if (estado) estado.textContent = "Mostrando última copia guardada";
                }
            }

        } else {

            aplicarDatosInicio(await obtenerInicio(forzar));

        }

        return true;

    } catch (error) {

        console.error("Error actualizando inventario:", error);

        if (estado) estado.textContent = "No se pudo actualizar";

        if (!silencioso) {
            alert("No se pudo actualizar el inventario: " + (error.message || error));
        }

        return false;

    } finally {

        actualizandoInventario = false;

        if (boton) {
            boton.disabled = false;
            boton.classList.remove("actualizando");
        }
    }
}

function revisarAutoActualizacion() {

    if (document.visibilityState === "hidden") return;
    if (actualizandoInventario || hayModalAbierto()) return;

    const edad = Date.now() - ultimaActualizacionInventario;
    const cambioDeDia = new Date().toDateString() !== diaUltimaActualizacion;

    if (!cambioDeDia && edad < AUTO_ACTUALIZAR_MS) return;

    actualizarInventario({
        forzar: cambioDeDia || edad >= FORZAR_LECTURA_TRAS_MS,
        silencioso: true
    });
}

document.addEventListener("click", evento => {
    if (evento.target.closest && evento.target.closest("#btnActualizarInventario")) {
        actualizarInventario({ forzar: true });
    }
});

setInterval(revisarAutoActualizacion, REVISION_AUTO_MS);
document.addEventListener("visibilitychange", revisarAutoActualizacion);
window.addEventListener("focus", revisarAutoActualizacion);
