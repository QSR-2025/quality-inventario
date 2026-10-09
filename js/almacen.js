/* ==========================================
   ALMACÉN
   Entradas y Salidas
========================================== */


/* ==========================================
   NORMALIZAR BODEGA
========================================== */

/* Materiales/Repuestos: no manejan lotes. Se mueven por existencia de bodega. */
const LOTE_SIN_LOTE = "SIN_LOTE";

function esProductoSinLoteAlmacen(producto) {
    const tipo = String((producto && producto.tipo) || "").toLowerCase();
    return tipo === "material" || tipo === "repuesto";
}

function stockMaterialBodega(producto, bodega) {
    const b = normalizarBodega(bodega);
    const valor = b === "SPS"
        ? producto?.stockSPS
        : (producto?.stockTGU ?? producto?.stockTotal);
    const n = Number(valor);
    return Number.isFinite(n) ? n : 0;
}

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
        lote?.almacen,
        producto?.bodega,
        producto?.sucursal,
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


        /* Si el producto no tiene lotes en esta bodega (los materiales no
           tienen lotes y siempre se ofrecen) */

        /* En ENTRADAS se ofrecen también los productos sin lotes en la
           bodega (producto nuevo en la bodega); en SALIDAS solo los que
           tienen lotes ahí. */
        const esEntradaLista = idDatalist === "listaProductosEntrada";

        if (lotesBodega.length === 0 && !esEntradaLista && !esProductoSinLoteAlmacen(producto)) return;


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
    bodegaSeleccionada = "",
    permitirSinLotes = false
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

        /* Confirmar que tenga lotes en la bodega (los materiales no tienen).
           En ENTRADAS se permite un producto que todavía no tiene lotes en
           esa bodega (producto nuevo o que llega por primera vez). */
        if (bodega) {

            if (permitirSinLotes || esProductoSinLoteAlmacen(producto)) return true;

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

    // El botón "+ Lote nuevo" solo aplica a reactivos.
    const botonLoteNuevo = idLote === "entradaLote"
        ? document.getElementById("btnLoteNuevo")
        : null;

    if (botonLoteNuevo) botonLoteNuevo.style.display = "";

    if (!bodega) return;

    const producto =
        obtenerProductoPorTexto(
            inputProducto.value,
            bodega,
            idLote === "entradaLote"
        );

    if (!producto) return;

    if (esProductoSinLoteAlmacen(producto)) {

        selectLote.innerHTML =
            `<option value="${LOTE_SIN_LOTE}">Sin lote | Stock en bodega: ${stockMaterialBodega(producto, bodega)}</option>`;

        selectLote.value = LOTE_SIN_LOTE;

        if (botonLoteNuevo) botonLoteNuevo.style.display = "none";

        if (idLote === "entradaLote") alternarCamposLoteNuevo(false);

        const skuMat = String(producto.sku || producto.codigo || "").trim();
        const nombreMat = String(producto.nombre || producto.producto || "").trim();
        const valorMat = String(inputProducto.value || "").trim();

        if (skuMat && (valorMat === skuMat || valorMat.toLowerCase() === nombreMat.toLowerCase())) {
            inputProducto.value = `${skuMat} - ${nombreMat}`;
        }

        return;
    }


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

        const vencimientoLote = lote.vencimiento || lote.vence || lote.fechaVencimiento || "";
        const textoVencimiento = vencimientoLote
            ? ` | Vence: ${new Date(vencimientoLote).toLocaleDateString("es-HN")}`
            : "";
        option.textContent =
            `${numeroLote} | Stock: ${stock}${textoVencimiento}`;

        selectLote.appendChild(option);

    });


    // El alta de lotes nuevos se hace únicamente con el botón #btnLoteNuevo.
    // No agregar una segunda opción dentro del desplegable.

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
    bodega,
    permitirSinLotes = false
) {

    const producto =
        obtenerProductoPorTexto(
            textoProducto,
            bodega,
            permitirSinLotes
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
   MOVIMIENTOS AGRUPADOS POR DOCUMENTO
========================================== */
const entradasPendientes = [];
const salidasPendientes = [];

function buscarProductoAlmacen(texto, bodega, permitirSinLotes = false) {
    return obtenerProductoPorTexto(texto, bodega, permitirSinLotes);
}
function resolverNombreProducto(producto) {
    return String(producto?.nombre || producto?.producto || producto?.descripcion || producto?.name || producto?.descripcionProducto || '').trim();
}
function actualizarProductoDesdeSku(tipo) {
    const prefijo = tipo === 'entrada' ? 'entrada' : 'salida';
    const bodega = document.getElementById(prefijo + 'Bodega')?.value || '';
    const sku = document.getElementById(prefijo + 'Sku')?.value.trim() || '';
    const producto = buscarProductoAlmacen(sku, bodega, tipo === 'entrada');
    document.getElementById(prefijo + 'Producto').value = producto ? String(producto.sku || producto.codigo || producto.code || sku) : '';
    document.getElementById(prefijo + 'Nombre').value = producto ? resolverNombreProducto(producto) : '';
    cargarLotesDesdeInput(prefijo + 'Producto', prefijo + 'Bodega', prefijo + 'Lote');
}
function alternarCamposLoteNuevo(mostrar) {
    const campos = document.getElementById('camposLoteNuevo');
    const fecha = document.getElementById('entradaVencimiento');
    const numero = document.getElementById('entradaNuevoLote');
    if (campos) campos.hidden = !mostrar;
    if (!mostrar) { if (fecha) fecha.value = ''; if (numero) numero.value = ''; }
}

document.addEventListener('change', e => {
    if (e.target?.id === 'entradaLote') {
        const nuevo = e.target.value === '__NUEVO_LOTE__';
        alternarCamposLoteNuevo(nuevo);
        if (nuevo) document.getElementById('entradaNuevoLote')?.focus();
    }
});
document.addEventListener('click', e => {
    if (e.target.closest('#btnLoteNuevo')) {
        const select = document.getElementById('entradaLote');
        if (select) select.value = '__NUEVO_LOTE__';
        alternarCamposLoteNuevo(true);
        document.getElementById('entradaNuevoLote')?.focus();
    }
});
alternarCamposLoteNuevo(false);

['entrada','salida'].forEach(tipo => {
    document.addEventListener('change', e => {
        if (e.target?.id === tipo + 'Sku') actualizarProductoDesdeSku(tipo);
        if (e.target?.id === tipo + 'Bodega') {
            const sku = document.getElementById(tipo + 'Sku');
            if (sku) actualizarProductoDesdeSku(tipo);
            cargarProductosAlmacen(e.target.value, tipo === 'entrada' ? 'listaProductosEntrada' : 'listaProductosSalida');
        }
    });
    document.addEventListener('input', e => {
        if (e.target?.id === tipo + 'Sku') actualizarProductoDesdeSku(tipo);
    });
});
const registroEnCurso = { entrada: false, salida: false };
const intentosPendientes = { entrada: null, salida: null };
function obtenerRequestId(tipo, comunes, items) {
    const firma = JSON.stringify([comunes, items]);
    const previo = intentosPendientes[tipo];
    if (previo && previo.firma === firma) return previo.id;
    const id = 'req-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 8);
    intentosPendientes[tipo] = { firma, id };
    return id;
}
function pintarLista(tipo) {
    const lista = tipo === 'entrada' ? entradasPendientes : salidasPendientes;
    const cont = document.getElementById(tipo === 'entrada' ? 'listaEntradasPendientes' : 'listaSalidasPendientes');
    if (!cont) return;
    if (!lista.length) { cont.innerHTML = '<p>No hay productos agregados.</p>'; return; }
    cont.innerHTML = `<table class="tabla-pendientes"><thead><tr><th>SKU</th><th>Producto</th><th>Lote</th><th>Cantidad</th><th>Vencimiento</th><th></th></tr></thead><tbody>${lista.map((x,i)=>`<tr><td>${escapeHtmlAlmacen(x.producto)}</td><td>${escapeHtmlAlmacen(x.nombre)}</td><td>${x.lote === LOTE_SIN_LOTE ? 'Sin lote' : escapeHtmlAlmacen(x.lote)}</td><td>${x.cantidad}</td><td>${escapeHtmlAlmacen(x.vencimiento || '—')}</td><td><button type="button" data-quitar="${i}" data-tipo="${tipo}">Quitar</button></td></tr>`).join('')}</tbody></table>`;
}
function escapeHtmlAlmacen(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
document.addEventListener('click', async event => {
    const quitar = event.target.closest('[data-quitar]');
    if (quitar) { const arr = quitar.dataset.tipo === 'entrada' ? entradasPendientes : salidasPendientes; arr.splice(Number(quitar.dataset.quitar),1); pintarLista(quitar.dataset.tipo); return; }
    const agregarEntrada = event.target.closest('#btnAgregarEntrada');
    const agregarSalida = event.target.closest('#btnAgregarSalida');
    if (agregarEntrada || agregarSalida) {
        const tipo = agregarEntrada ? 'entrada' : 'salida';
        const pref = tipo;
        const bodega = document.getElementById(pref+'Bodega').value;
        const skuIngresado = document.getElementById(pref+'Sku')?.value.trim() || '';
        const skuCampo = document.getElementById(pref+'Producto')?.value.trim() || '';
        const sku = obtenerSkuProducto(skuCampo || skuIngresado, bodega, tipo === 'entrada') || skuCampo || skuIngresado;
        const selectLote = document.getElementById(pref+'Lote');
        let lote = selectLote?.value || '';
        const camposNuevo = document.getElementById('camposLoteNuevo');
        const numeroLoteNuevo = document.getElementById('entradaNuevoLote')?.value.trim() || '';
        // El botón puede mostrar los campos aunque el select no conserve su valor.
        const prodSinLote = esProductoSinLoteAlmacen(buscarProductoAlmacen(sku, bodega, tipo === 'entrada'));
        if (prodSinLote) lote = LOTE_SIN_LOTE;
        const loteNuevo = !prodSinLote && tipo === 'entrada' && (
            lote === '__NUEVO_LOTE__' ||
            (camposNuevo && !camposNuevo.hidden && numeroLoteNuevo.length > 0)
        );
        const prod = loteNuevo ? obtenerProductoPorTexto(sku, '') : buscarProductoAlmacen(sku, bodega, tipo === 'entrada');
        const cantidad = Number(document.getElementById(pref+'Cantidad').value);
        if (loteNuevo) lote = numeroLoteNuevo;
        if (!bodega || !sku || !prod || !lote || !(cantidad > 0)) { alert('Complete bodega, SKU válido, lote y cantidad antes de agregar.'); return; }
        const nombre = resolverNombreProducto(prod) || document.getElementById(pref+'Nombre').value;
        const arr = tipo === 'entrada' ? entradasPendientes : salidasPendientes;
        const vencimiento = tipo === 'entrada' && loteNuevo ? (document.getElementById('entradaVencimiento')?.value || '') : '';
        if (loteNuevo && !numeroLoteNuevo) { alert('Ingrese el número del lote nuevo.'); return; }
        if (loteNuevo && !vencimiento) { alert('Indique el vencimiento del lote nuevo.'); return; }
        arr.push({tipo,bodega:normalizarBodega(bodega),producto:sku,nombre,lote,cantidad,vencimiento,loteNuevo});
        pintarLista(tipo);
        document.getElementById(pref+'Sku').value=''; document.getElementById(pref+'Producto').value=''; document.getElementById(pref+'Nombre').value=''; document.getElementById(pref+'Cantidad').value='';
        if (tipo === 'entrada') { alternarCamposLoteNuevo(false); document.getElementById('entradaLote').value=''; }
        return;
    }
    const boton = event.target.closest('#btnRegistrarEntrada, #btnRegistrarSalida');
    if (!boton) return;
    const tipo = boton.id === 'btnRegistrarEntrada' ? 'entrada' : 'salida';
    const arr = tipo === 'entrada' ? entradasPendientes : salidasPendientes;
    const pref = tipo;
    const bodega = normalizarBodega(document.getElementById(pref+'Bodega').value);
    const documento = document.getElementById(pref+'Documento').value.trim();
    const cliente = tipo === 'salida' ? document.getElementById('salidaCliente').value.trim() : '';
    const observacion = document.getElementById(pref+'Observacion').value.trim();
    if (!bodega || !documento || !arr.length || (tipo === 'salida' && !cliente)) { alert(`Complete bodega, número de ${tipo === 'entrada' ? 'traslado' : 'factura'}${tipo === 'salida' ? ' y cliente' : ''}, y agregue al menos un producto.`); return; }
    // Validar stock localmente antes de enviar salidas.
    if (tipo === 'salida') {
        for (const item of arr) {
            const prod = buscarProductoAlmacen(item.producto, bodega);
            if (esProductoSinLoteAlmacen(prod)) {
                if (stockMaterialBodega(prod, bodega) < item.cantidad) { alert(`Existencia insuficiente para SKU ${item.producto} en la bodega seleccionada (disponible: ${stockMaterialBodega(prod, bodega)}). No se registró la factura.`); return; }
                continue;
            }
            // El mismo número de lote puede existir en Tegus y en SPS:
            // se valida contra el lote de la bodega seleccionada.
            const lot = (prod?.lotes || []).find(l => obtenerNumeroLote(l) === item.lote && obtenerBodegaLote(l, prod) === bodega);
            if (!lot || obtenerStockLote(lot) < item.cantidad) { alert(`Existencia insuficiente para SKU ${item.producto}, lote ${item.lote}. No se registró la factura.`); return; }
        }
    }
    // Evita un segundo envío mientras hay uno en curso (doble clic / toques repetidos).
    if (registroEnCurso[tipo]) return;
    registroEnCurso[tipo] = true;
    boton.disabled = true; const textoOriginal = boton.innerHTML;
    const total = arr.length;
    const TAMANO_LOTE = 25; // productos por solicitud: rápido y muy por debajo del límite de 6 min del servidor
    let registrados = 0;
    try {
        const advertencias = [];
        const comunes = { tipo, bodega, cliente, documento, factura: documento, observacion: `${observacion || ''}` };
        while (arr.length) {
            const bloque = arr.slice(0, TAMANO_LOTE);
            boton.textContent = `Registrando ${registrados + 1}-${registrados + bloque.length} de ${total}...`;
            if (typeof registrarActividad === 'function') registrarActividad(); // una operación larga cuenta como actividad
            const itemsEnvio = bloque.map(i => ({ producto: i.producto, lote: i.lote, cantidad: i.cantidad, vencimiento: i.vencimiento || '' }));
            // Mismo identificador si se reintenta exactamente la misma tanda tras un corte de red.
            const requestId = obtenerRequestId(tipo, comunes, itemsEnvio);
            const resultado = await registrarMovimientosLote({ ...comunes, requestId }, itemsEnvio);
            intentosPendientes[tipo] = null; // el servidor respondió: el próximo envío es nuevo
            // Quitar de la lista los productos que el servidor YA procesó, para que
            // un reintento no los registre dos veces.
            const hechos = Math.min(Number(resultado?.procesados) || (resultado?.success ? bloque.length : 0), bloque.length);
            arr.splice(0, hechos);
            registrados += hechos;
            if (resultado?.advertencia) advertencias.push(resultado.advertencia);
            pintarLista(tipo);
            if (!resultado?.success) {
                const e = new Error(resultado?.message || 'No se pudo registrar el movimiento');
                e.parcial = registrados > 0;
                throw e;
            }
        }
        alert(`${tipo === 'entrada' ? 'Entrada' : 'Salida'} registrada correctamente para ${documento} (${registrados} producto${registrados === 1 ? '' : 's'}).` + (advertencias.length ? `\n\nATENCIÓN:\n${[...new Set(advertencias)].join('\n')}` : ''));
        document.getElementById(pref+'Observacion').value='';
        if (tipo === 'salida') document.getElementById('salidaCliente').value='';
        document.getElementById(pref+'Documento').value='';
        // Refrescar existencias sin hacer esperar al usuario.
        if (typeof actualizarInventario === 'function') actualizarInventario({ forzar: false, silencioso: true });
        cargarProductosAlmacen(bodega, tipo === 'entrada' ? 'listaProductosEntrada' : 'listaProductosSalida');
    } catch (error) {
        console.error(error);
        const quedan = arr.length;
        const errorDeRed = error instanceof TypeError || /^HTTP/.test(String(error.message || ''));
        alert(`No se completó el registro: ${error.message || 'error inesperado'}.` +
            (errorDeRed ? '\n\nLa conexión se interrumpió: es posible que el servidor sí haya procesado esta tanda. Revise el reporte de Movimientos antes de reintentar.' : '') +
            (registrados > 0 ? `\n\nYa se registraron ${registrados} producto(s). En la lista quedan ${quedan} pendiente(s): corrija el problema y vuelva a presionar Registrar (los ya registrados no se repetirán).` : (errorDeRed ? '' : '\n\nNo se registró ningún producto de esta lista.')));
        if (registrados > 0 && typeof actualizarInventario === 'function') actualizarInventario({ forzar: false, silencioso: true });
    }
    finally { registroEnCurso[tipo] = false; boton.disabled=false; boton.innerHTML=textoOriginal; }
});
pintarLista('entrada'); pintarLista('salida');
