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


        /* Si el producto no tiene lotes en esta bodega (los materiales no
           tienen lotes y siempre se ofrecen) */

        if (lotesBodega.length === 0 && !esProductoSinLoteAlmacen(producto)) return;


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

        /* Confirmar que tenga lotes en la bodega (los materiales no tienen) */
        if (bodega) {

            if (esProductoSinLoteAlmacen(producto)) return true;

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
            bodega
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
   MOVIMIENTOS AGRUPADOS POR DOCUMENTO
========================================== */
const entradasPendientes = [];
const salidasPendientes = [];

function buscarProductoAlmacen(texto, bodega) {
    return obtenerProductoPorTexto(texto, bodega);
}
function resolverNombreProducto(producto) {
    return String(producto?.nombre || producto?.producto || producto?.descripcion || producto?.name || producto?.descripcionProducto || '').trim();
}
function actualizarProductoDesdeSku(tipo) {
    const prefijo = tipo === 'entrada' ? 'entrada' : 'salida';
    const bodega = document.getElementById(prefijo + 'Bodega')?.value || '';
    const sku = document.getElementById(prefijo + 'Sku')?.value.trim() || '';
    const producto = buscarProductoAlmacen(sku, bodega);
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
        const sku = obtenerSkuProducto(skuCampo || skuIngresado, bodega) || skuCampo || skuIngresado;
        const selectLote = document.getElementById(pref+'Lote');
        let lote = selectLote?.value || '';
        const camposNuevo = document.getElementById('camposLoteNuevo');
        const numeroLoteNuevo = document.getElementById('entradaNuevoLote')?.value.trim() || '';
        // El botón puede mostrar los campos aunque el select no conserve su valor.
        const prodSinLote = esProductoSinLoteAlmacen(buscarProductoAlmacen(sku, bodega));
        if (prodSinLote) lote = LOTE_SIN_LOTE;
        const loteNuevo = !prodSinLote && tipo === 'entrada' && (
            lote === '__NUEVO_LOTE__' ||
            (camposNuevo && !camposNuevo.hidden && numeroLoteNuevo.length > 0)
        );
        const prod = loteNuevo ? obtenerProductoPorTexto(sku, '') : buscarProductoAlmacen(sku, bodega);
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
            const lot = (prod?.lotes || []).find(l => obtenerNumeroLote(l) === item.lote);
            if (!lot || obtenerStockLote(lot) < item.cantidad) { alert(`Existencia insuficiente para SKU ${item.producto}, lote ${item.lote}. No se registró la factura.`); return; }
        }
    }
    boton.disabled = true; const textoOriginal = boton.textContent; boton.textContent = 'Registrando...';
    try {
        // Cada movimiento conserva el documento compartido en la observación y el historial individual.
        const advertencias = [];
        for (const item of arr) {
            const resultado = await registrarMovimiento({...item, tipo, bodega, cliente, documento, factura: documento, observacion: `${observacion || ''}`, vencimiento:item.vencimiento || ''});
            if (!resultado?.success) throw new Error(resultado?.message || `No se pudo registrar SKU ${item.producto}`);
            if (resultado.advertencia) advertencias.push(`SKU ${item.producto}: ${resultado.advertencia}`);
        }
        alert(`${tipo === 'entrada' ? 'Entrada' : 'Salida'} registrada correctamente para ${documento}.` + (advertencias.length ? `\n\nATENCIÓN:\n${advertencias.join('\n')}` : ''));
        arr.length = 0; pintarLista(tipo);
        document.getElementById(pref+'Observacion').value='';
        if (tipo === 'salida') document.getElementById('salidaCliente').value='';
        document.getElementById(pref+'Documento').value='';
        limpiarCacheAPI(); if (typeof cargarInventarioCompleto === 'function') await cargarInventarioCompleto();
        cargarProductosAlmacen(bodega, tipo === 'entrada' ? 'listaProductosEntrada' : 'listaProductosSalida');
    } catch (error) { console.error(error); alert(`No se completó el registro: ${error.message || 'error inesperado'}. Revisa el historial antes de reintentar, porque los movimientos anteriores podrían haberse procesado.`); }
    finally { boton.disabled=false; boton.textContent=textoOriginal; }
});
pintarLista('entrada'); pintarLista('salida');
