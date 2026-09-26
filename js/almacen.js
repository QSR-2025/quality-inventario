/* ==========================================
   ALMACÉN
   Entradas y Salidas
========================================== */


/* ==========================================
   NORMALIZAR BODEGA
========================================== */

function normalizarBodega(bodega) {

    const valor = String(bodega || "")
        .trim()
        .toLowerCase();

    if (
        valor === "tegus" ||
        valor === "tegucigalpa" ||
        valor.includes("tegucigalpa")
    ) {
        return "Tegus";
    }

    if (
        valor === "sps" ||
        valor === "san pedro sula" ||
        valor.includes("san pedro")
    ) {
        return "SPS";
    }

    return "";
}


/* ==========================================
   OBTENER BODEGA DEL LOTE
========================================== */

function obtenerBodegaLote(lote, producto) {

    const posiblesBodegas = [
        lote?.bodega,
        lote?.sucursal,
        lote?.ubicacion,
        lote?.almacen,
        producto?.bodega,
        producto?.sucursal,
        producto?.ubicacion,
        producto?.almacen
    ];

    for (const valor of posiblesBodegas) {

        const bodegaNormalizada =
            normalizarBodega(valor);

        if (bodegaNormalizada) {
            return bodegaNormalizada;
        }

    }

    return "";

}


/* ==========================================
   OBTENER NÚMERO DE LOTE
========================================== */

function obtenerNumeroLote(lote) {

    return String(
        lote?.numLote ??
        lote?.lote ??
        lote?.numeroLote ??
        lote?.codigoLote ??
        ""
    ).trim();

}


/* ==========================================
   OBTENER STOCK DEL LOTE
========================================== */

function obtenerStockLote(lote) {

    const stock = Number(
        lote?.cantidad ??
        lote?.stock ??
        lote?.existencia ??
        lote?.stockTotal ??
        lote?.cantidadActual ??
        0
    );

    return isNaN(stock) ? 0 : stock;

}


/* ==========================================
   LIMPIAR PRODUCTO Y LOTES
========================================== */

function limpiarFormularioProducto(idProducto, idLote) {

    const producto = document.getElementById(idProducto);
    const lote = document.getElementById(idLote);

    if (producto) {
        producto.value = "";
    }

    if (lote) {
        lote.innerHTML =
            '<option value="">Seleccione un lote</option>';
    }

}


/* ==========================================
   CARGAR PRODUCTOS SEGÚN BODEGA
========================================== */

function cargarProductosAlmacen(
    bodegaSeleccionada = "",
    idDatalist = ""
) {

    /*
     * Si esta función es llamada sin parámetros,
     * por ejemplo después de cargar nuevamente
     * el inventario de Tegus + SPS:
     *
     * cargarProductosAlmacen();
     *
     * se actualizan automáticamente las bodegas
     * seleccionadas en Entrada y Salida.
     */
    if (!bodegaSeleccionada || !idDatalist) {

        const entradaBodega =
            document.getElementById("entradaBodega");

        const salidaBodega =
            document.getElementById("salidaBodega");


        /* Actualizar productos de Entrada */

        if (
            entradaBodega &&
            entradaBodega.value
        ) {

            cargarProductosAlmacen(
                entradaBodega.value,
                "listaProductosEntrada"
            );

        }


        /* Actualizar productos de Salida */

        if (
            salidaBodega &&
            salidaBodega.value
        ) {

            cargarProductosAlmacen(
                salidaBodega.value,
                "listaProductosSalida"
            );

        }

        return;
    }


    const datalist = document.getElementById(idDatalist);

    if (!datalist) return;

    datalist.innerHTML = "";


    /* Confirmar que el inventario esté disponible */

    if (
        !Array.isArray(inventario) ||
        inventario.length === 0
    ) {

        console.warn(
            "Inventario todavía no está disponible."
        );

        return;
    }


    /* Normalizar bodega seleccionada */

    const bodega =
        normalizarBodega(bodegaSeleccionada);

    if (!bodega) return;


    /* Evitar productos repetidos */

    const productosAgregados = new Set();


    /* Recorrer inventario completo */

    inventario.forEach(producto => {

        /*
         * Obtener únicamente los lotes que
         * pertenecen a la bodega seleccionada.
         *
         * Esto funciona tanto para:
         * Tegus / Tegucigalpa
         * como para:
         * SPS / San Pedro Sula
         */

        const lotesBodega =
            (producto.lotes || []).filter(lote =>
                obtenerBodegaLote(
                    lote,
                    producto
                ) === bodega
            );


        /* Si el producto no tiene lotes en esta bodega */

        if (lotesBodega.length === 0) return;


        /* Obtener SKU */

        const sku = String(
            producto.sku ||
            producto.codigo ||
            producto.code ||
            ""
        ).trim();


        /* Obtener nombre */

        const nombre = String(
            producto.nombre ||
            producto.producto ||
            producto.descripcion ||
            ""
        ).trim();


        /* No agregar productos vacíos */

        if (!sku && !nombre) return;


        /* Formato mostrado en el datalist */

        const valor = sku
            ? `${sku} - ${nombre}`
            : nombre;


        /* Evitar duplicados */

        if (productosAgregados.has(valor)) return;

        productosAgregados.add(valor);


        /* Crear opción */

        const option =
            document.createElement("option");

        option.value = valor;

        datalist.appendChild(option);

    });


    console.log(
        `Productos cargados para ${bodega}:`,
        productosAgregados.size
    );

}


/* ==========================================
   BUSCAR PRODUCTO POR CÓDIGO O NOMBRE
========================================== */

function obtenerProductoPorTexto(
    texto,
    bodegaSeleccionada = ""
) {

    if (!Array.isArray(inventario)) {
        return null;
    }

    const busqueda = String(texto || "")
        .trim()
        .toLowerCase();

    if (!busqueda) return null;

    const bodega = normalizarBodega(bodegaSeleccionada);

    /* Si viene: 126360 - NOMBRE */
    const codigoEscrito = busqueda
        .split(" - ")[0]
        .trim();

    return inventario.find(producto => {

        const sku = String(
            producto.sku ||
            producto.codigo ||
            producto.code ||
            ""
        )
        .trim()
        .toLowerCase();

        const nombre = String(
            producto.nombre ||
            producto.producto ||
            producto.descripcion ||
            ""
        )
        .trim()
        .toLowerCase();

        const textoCompleto = `${sku} - ${nombre}`;

        const coincideProducto =

            sku === busqueda ||

            sku === codigoEscrito ||

            nombre === busqueda ||

            textoCompleto === busqueda ||

            sku.includes(busqueda) ||

            nombre.includes(busqueda);

        if (!coincideProducto) {
            return false;
        }

        /* Confirmar que tenga lotes en la bodega */
        if (bodega) {

            return (producto.lotes || []).some(lote =>
                obtenerBodegaLote(
                    lote,
                    producto
                ) === bodega
            );

        }

        return true;

    });

}


/* ==========================================
   CARGAR LOTES DEL PRODUCTO
========================================== */

function cargarLotesDesdeInput(
    idProducto,
    idBodega,
    idLote
) {

    const inputProducto =
        document.getElementById(idProducto);

    const selectBodega =
        document.getElementById(idBodega);

    const selectLote =
        document.getElementById(idLote);

    if (
        !inputProducto ||
        !selectBodega ||
        !selectLote
    ) {
        return;
    }

    const bodega =
        normalizarBodega(selectBodega.value);

    selectLote.innerHTML =
        '<option value="">Seleccione un lote</option>';

    if (!bodega) return;

    const producto =
        obtenerProductoPorTexto(
            inputProducto.value,
            bodega
        );

    if (!producto) return;


    /* Completar automáticamente SKU + nombre */

    const sku = String(
        producto.sku ||
        producto.codigo ||
        producto.code ||
        ""
    ).trim();

    const nombre = String(
        producto.nombre ||
        producto.producto ||
        producto.descripcion ||
        ""
    ).trim();

    const valorActual =
        String(inputProducto.value || "")
        .trim();

    if (
        sku &&
        (
            valorActual === sku ||
            valorActual.toLowerCase() === nombre.toLowerCase()
        )
    ) {

        inputProducto.value =
            `${sku} - ${nombre}`;

    }


    /* Obtener únicamente los lotes de la bodega */

    const lotesEncontrados = (producto.lotes || [])
        .filter(lote =>
            obtenerBodegaLote(
                lote,
                producto
            ) === bodega
        );


    lotesEncontrados.forEach(lote => {

        const numeroLote =
            obtenerNumeroLote(lote);

        if (!numeroLote) return;

        const stock =
            obtenerStockLote(lote);

        const option =
            document.createElement("option");

        option.value = numeroLote;

        option.textContent =
            `${numeroLote} | Stock: ${stock}`;

        selectLote.appendChild(option);

    });


    console.log(
        `Lotes encontrados para ${sku} en ${bodega}:`,
        lotesEncontrados.length
    );

}


/* ==========================================
   OBTENER SKU REAL
========================================== */

function obtenerSkuProducto(
    textoProducto,
    bodega
) {

    const producto =
        obtenerProductoPorTexto(
            textoProducto,
            bodega
        );

    if (!producto) return "";

    return String(
        producto.sku ||
        producto.codigo ||
        producto.code ||
        ""
    ).trim();

}


/* ==========================================
   ESPERAR A QUE EL INVENTARIO ESTÉ LISTO
========================================== */

function esperarInventarioAlmacen() {

    return new Promise(resolve => {

        /* Si ya está cargado */
        if (
            Array.isArray(inventario) &&
            inventario.length > 0
        ) {

            resolve(true);
            return;

        }

        let intentos = 0;

        const intervalo = setInterval(() => {

            intentos++;

            if (
                Array.isArray(inventario) &&
                inventario.length > 0
            ) {

                clearInterval(intervalo);

                console.log(
                    "Inventario listo para Almacén:",
                    inventario.length
                );

                resolve(true);
                return;

            }

            /* Máximo 30 segundos */
            if (intentos >= 60) {

                clearInterval(intervalo);

                console.warn(
                    "El inventario tardó demasiado en cargar."
                );

                resolve(false);

            }

        }, 500);

    });

}


/* ==========================================
   INICIALIZAR ALMACÉN
========================================== */

document.addEventListener("DOMContentLoaded", async () => {

    const btnEntrada =
        document.getElementById("tabEntrada");

    const btnSalida =
        document.getElementById("tabSalida");

    const formEntrada =
        document.getElementById("formEntrada");

    const formSalida =
        document.getElementById("formSalida");

    const entradaBodega =
        document.getElementById("entradaBodega");

    const salidaBodega =
        document.getElementById("salidaBodega");

    const entradaProducto =
        document.getElementById("entradaProducto");

    const salidaProducto =
        document.getElementById("salidaProducto");


    /* ==========================================
       CAMBIAR ENTRE ENTRADA Y SALIDA
    ========================================== */

    if (btnEntrada && btnSalida) {

        btnEntrada.addEventListener("click", () => {

            btnEntrada.classList.add("active");
            btnSalida.classList.remove("active");

            if (formEntrada) {
                formEntrada.style.display = "grid";
            }

            if (formSalida) {
                formSalida.style.display = "none";
            }

        });


        btnSalida.addEventListener("click", () => {

            btnSalida.classList.add("active");
            btnEntrada.classList.remove("active");

            if (formEntrada) {
                formEntrada.style.display = "none";
            }

            if (formSalida) {
                formSalida.style.display = "grid";
            }

        });

    }


    /* ==========================================
       CAMBIO DE BODEGA EN ENTRADA
    ========================================== */

    if (entradaBodega) {

        entradaBodega.addEventListener("change", () => {

            limpiarFormularioProducto(
                "entradaProducto",
                "entradaLote"
            );

            cargarProductosAlmacen(
                entradaBodega.value,
                "listaProductosEntrada"
            );

        });

    }


    /* ==========================================
       CAMBIO DE BODEGA EN SALIDA
    ========================================== */

    if (salidaBodega) {

        salidaBodega.addEventListener("change", () => {

            limpiarFormularioProducto(
                "salidaProducto",
                "salidaLote"
            );

            cargarProductosAlmacen(
                salidaBodega.value,
                "listaProductosSalida"
            );

        });

    }


    /* ==========================================
       PRODUCTO ENTRADA
    ========================================== */

    if (entradaProducto) {

        entradaProducto.addEventListener("input", () => {

            cargarLotesDesdeInput(
                "entradaProducto",
                "entradaBodega",
                "entradaLote"
            );

        });

        entradaProducto.addEventListener("change", () => {

            cargarLotesDesdeInput(
                "entradaProducto",
                "entradaBodega",
                "entradaLote"
            );

        });

    }


    /* ==========================================
       PRODUCTO SALIDA
    ========================================== */

    if (salidaProducto) {

        salidaProducto.addEventListener("input", () => {

            cargarLotesDesdeInput(
                "salidaProducto",
                "salidaBodega",
                "salidaLote"
            );

        });

        salidaProducto.addEventListener("change", () => {

            cargarLotesDesdeInput(
                "salidaProducto",
                "salidaBodega",
                "salidaLote"
            );

        });

    }


    /* ==========================================
       ESPERAR INVENTARIO
    ========================================== */

    const inventarioListo =
        await esperarInventarioAlmacen();

    if (!inventarioListo) return;


    /* Cargar sugerencias si ya hay bodega */

    if (
        entradaBodega &&
        entradaBodega.value
    ) {

        cargarProductosAlmacen(
            entradaBodega.value,
            "listaProductosEntrada"
        );

    }


    if (
        salidaBodega &&
        salidaBodega.value
    ) {

        cargarProductosAlmacen(
            salidaBodega.value,
            "listaProductosSalida"
        );

    }

});


/* ==========================================
   REGISTRAR ENTRADA
========================================== */

document.addEventListener("click", async event => {

    const boton =
        event.target.closest("#btnRegistrarEntrada");

    if (!boton) return;


    const bodega =
        document.getElementById(
            "entradaBodega"
        )?.value || "";

    const productoTexto =
        document.getElementById(
            "entradaProducto"
        )?.value || "";

    const producto =
        obtenerSkuProducto(
            productoTexto,
            bodega
        );

    const lote =
        document.getElementById(
            "entradaLote"
        )?.value || "";

    const cantidad =
        Number(
            document.getElementById(
                "entradaCantidad"
            )?.value
        );

    const observacion =
        document.getElementById(
            "entradaObservacion"
        )?.value || "";


    if (!bodega) {

        alert("Seleccione la bodega.");
        return;

    }


    if (!producto || !lote || cantidad <= 0) {

        alert(
            "Complete producto, lote y cantidad."
        );

        return;

    }


    try {

        boton.disabled = true;
        boton.textContent = "Registrando...";


        const resultado =
            await registrarMovimiento({

                tipo: "entrada",

                bodega:
                    normalizarBodega(bodega),

                producto,
                lote,
                cantidad,
                observacion

            });


        if (resultado.success) {

            alert(
                "Entrada registrada correctamente."
            );


            document.getElementById(
                "entradaCantidad"
            ).value = "";

            document.getElementById(
                "entradaObservacion"
            ).value = "";


            limpiarCacheAPI();


            if (
                typeof cargarInventarioCompleto ===
                "function"
            ) {

                await cargarInventarioCompleto();

            }


            cargarProductosAlmacen(
                bodega,
                "listaProductosEntrada"
            );

            cargarLotesDesdeInput(
                "entradaProducto",
                "entradaBodega",
                "entradaLote"
            );

        } else {

            alert(
                resultado.message ||
                "No fue posible registrar la entrada."
            );

        }

    } catch (error) {

        console.error(error);

        alert(
            "Error al registrar la entrada."
        );

    } finally {

        boton.disabled = false;
        boton.textContent =
            "Registrar entrada";

    }

});


/* ==========================================
   REGISTRAR SALIDA
========================================== */

document.addEventListener("click", async event => {

    const boton =
        event.target.closest("#btnRegistrarSalida");

    if (!boton) return;


    const cliente =
        document.getElementById(
            "salidaCliente"
        )?.value.trim() || "";

    const bodega =
        document.getElementById(
            "salidaBodega"
        )?.value || "";

    const productoTexto =
        document.getElementById(
            "salidaProducto"
        )?.value || "";

    const producto =
        obtenerSkuProducto(
            productoTexto,
            bodega
        );

    const lote =
        document.getElementById(
            "salidaLote"
        )?.value || "";

    const cantidad =
        Number(
            document.getElementById(
                "salidaCantidad"
            )?.value
        );

    const observacion =
        document.getElementById(
            "salidaObservacion"
        )?.value || "";


    if (!cliente) {

        alert(
            "Ingrese el nombre del cliente."
        );

        return;

    }


    if (!bodega) {

        alert(
            "Seleccione la bodega."
        );

        return;

    }


    if (!producto || !lote || cantidad <= 0) {

        alert(
            "Complete producto, lote y cantidad."
        );

        return;

    }


    try {

        boton.disabled = true;
        boton.textContent = "Registrando...";


        const resultado =
            await registrarMovimiento({

                tipo: "salida",

                cliente,

                bodega:
                    normalizarBodega(bodega),

                producto,
                lote,
                cantidad,
                observacion

            });


        if (resultado.success) {

            alert(
                "Salida registrada correctamente."
            );


            document.getElementById(
                "salidaCliente"
            ).value = "";

            document.getElementById(
                "salidaCantidad"
            ).value = "";

            document.getElementById(
                "salidaObservacion"
            ).value = "";


            limpiarCacheAPI();


            if (
                typeof cargarInventarioCompleto ===
                "function"
            ) {

                await cargarInventarioCompleto();

            }


            cargarProductosAlmacen(
                bodega,
                "listaProductosSalida"
            );

            cargarLotesDesdeInput(
                "salidaProducto",
                "salidaBodega",
                "salidaLote"
            );

        } else {

            alert(
                resultado.message ||
                "No fue posible registrar la salida."
            );

        }

    } catch (error) {

        console.error(error);

        alert(
            "Error al registrar la salida."
        );

    } finally {

        boton.disabled = false;
        boton.textContent =
            "Registrar salida";

    }

});