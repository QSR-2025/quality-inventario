/* =============================================================================
   QUALITY INVENTARIO
   pdf-vencimientos.js
   -----------------------------------------------------------------------------
   Módulo independiente que genera el PDF del Reporte de Vencimientos.
   No modifica ningún otro archivo del proyecto. Se conecta al botón
   #btnPdfVencimientos y obtiene TODA su información directamente del DOM
   ya renderizado por home.js / vencimientos.js, sin depender de ninguna
   variable global (ni "window.datosVencimientos", ni
   "window.graficaVencimientos", ni "window.eval()" ni nada por el estilo).

   Esto es intencional: como en home.js esas variables están declaradas con
   "let" a nivel de módulo/script, NO cuelgan de "window", así que este
   archivo, para ser verdaderamente independiente, lee:

     - El mes seleccionado -> directo del <select id="mesVencimientos">
     - Los totales del resumen -> directo de los elementos con id
       "vProductos", "vLotes", "vUnidades", "vMarcas"
     - La gráfica -> directo del <canvas id="graficaVencimientos">,
       usando canvas.toDataURL(), que NO requiere tener la instancia de
       Chart.js a mano (funciona con cualquier canvas ya pintado)
     - La tabla de productos -> directo de las filas ya existentes en
       "#tablaVencimientos" (se lee el texto ya formateado que el usuario
       ve en pantalla, celda por celda)

   Dependencias: jsPDF y jspdf-autotable (ya cargados en home.html antes de
   este archivo). Este archivo no agrega ninguna dependencia nueva y no
   requiere ningún cambio en home.js ni en vencimientos.js.

   IMPORTANTE — instalación:
   Este archivo, por sí solo, no hace nada hasta que se incluya con un
   <script> en home.html. Agrega esta línea al final de home.html, DESPUÉS
   de chart.js, jspdf, jspdf-autotable, home.js y vencimientos.js:

       <script src="js/pdf-vencimientos.js"></script>
============================================================================= */


// =====================================
// CONFIGURACIÓN VISUAL DEL PDF
// =====================================

const PDF_COLOR_PRIMARIO = [15, 76, 129];   // #0F4C81
const PDF_COLOR_TEXTO    = [36, 59, 83];    // #243B53
const PDF_COLOR_GRIS     = [91, 103, 119];  // #5B6777
const PDF_COLOR_BORDE    = [238, 242, 247]; // #EEF2F7

const PDF_MARGEN = 40; // margen izquierdo/derecho en puntos (pt)


// =====================================
// CONEXIÓN AL BOTÓN
// -----------------------------------------------------------------------
// Se usa DELEGACIÓN DE EVENTOS sobre "document" en vez de buscar el botón
// una sola vez con getElementById + addEventListener. Esto es intencional
// y soluciona dos problemas reales de integración:
//
//   1) Si este <script> se agrega al FINAL de home.html (como se pidió),
//      es posible que "DOMContentLoaded" ya se haya disparado antes de
//      que este archivo termine de ejecutarse (por ejemplo si el HTML es
//      simple y el navegador ya terminó de parsear el documento). Con
//      "document.addEventListener('DOMContentLoaded', ...)" ese listener
//      NUNCA se ejecutaría en ese caso, y el botón quedaría sin conectar.
//
//   2) Si el botón #btnPdfVencimientos se re-renderiza dinámicamente
//      (ej. la vista de vencimientos se vuelve a pintar al cambiar de
//      mes), un listener puesto directo sobre el elemento se perdería al
//      reemplazarse el nodo. La delegación sobre "document" sigue
//      funcionando siempre, sin importar cuántas veces se recree el
//      botón.
//
// El listener se registra de inmediato, sin esperar ningún evento de
// carga, porque escuchar clicks en "document" es válido desde el primer
// momento en que el script se ejecuta.
// =====================================

document.addEventListener("click", (evento) => {

    const boton = evento.target.closest("#btnPdfVencimientos");

    if (!boton) return;

    try {

        generarPdfVencimientos();

    } catch (error) {

        console.error("Error generando PDF de vencimientos:", error);

        alert(
            "No fue posible generar el PDF:\n\n" +
            error.message
        );

    }

});


// =====================================
// FUNCIÓN PRINCIPAL
// =====================================

function generarPdfVencimientos() {

    // ----------------------------------
    // 1) LEER TODO DESDE EL DOM
    // ----------------------------------

    const mesActual = leerMesSeleccionado();
    const resumen = leerResumenDesdeTarjetas();
    const filasTabla = leerFilasDesdeTabla();

    if (!filasTabla.length) {
        alert("Todavía no hay datos de vencimientos cargados para generar el PDF.");
        return;
    }


    // ----------------------------------
    // 2) CREAR EL DOCUMENTO
    // ----------------------------------

    const { jsPDF } = window.jspdf;

    const doc = new jsPDF({
        orientation: "portrait",
        unit: "pt",
        format: "a4"
    });

    const anchoPagina = doc.internal.pageSize.getWidth();
    const altoPagina  = doc.internal.pageSize.getHeight();

    let cursorY = PDF_MARGEN;


    // ----------------------------------
    // 3) ENCABEZADO CORPORATIVO
    // ----------------------------------

    cursorY = dibujarEncabezado(doc, anchoPagina, mesActual, cursorY);


    // ----------------------------------
    // 4) TARJETAS DE RESUMEN
    // ----------------------------------

    cursorY = dibujarResumen(doc, resumen, anchoPagina, cursorY);


    // ----------------------------------
    // 5) GRÁFICA (capturada directo del canvas)
    // ----------------------------------

    cursorY = dibujarGrafica(doc, anchoPagina, altoPagina, cursorY);


    // ----------------------------------
    // 6) TABLA DE PRODUCTOS (leída del DOM)
    // ----------------------------------

    dibujarTabla(doc, filasTabla, cursorY);


    // ----------------------------------
    // 7) PIE DE PÁGINA (numeración)
    // ----------------------------------

    dibujarPiePagina(doc, anchoPagina, altoPagina);


    // ----------------------------------
    // 8) DESCARGAR
    // ----------------------------------

    const nombreArchivo =
        "Reporte_Vencimientos_" +
        String(mesActual).trim().replace(/\s+/g, "_") +
        ".pdf";

    doc.save(nombreArchivo);

}


// =====================================
// LECTURA DE DATOS DESDE EL DOM
// =====================================

// Mes actualmente seleccionado, leído directo del <select>, así siempre
// coincide exactamente con lo que el usuario está viendo.
function leerMesSeleccionado() {

    const select = document.getElementById("mesVencimientos");

    if (!select) return "SIN_MES";

    // Si el <select> tiene texto visible en la opción elegida, se usa
    // ese texto (más legible que el "value" interno, ej. "2026-08"
    // vs "Agosto 2026"); si no, se cae al value crudo.
    const opcionSeleccionada = select.options
        ? select.options[select.selectedIndex]
        : null;

    if (opcionSeleccionada && opcionSeleccionada.textContent.trim()) {
        return opcionSeleccionada.textContent.trim();
    }

    return select.value || "SIN_MES";

}


// Totales del resumen, leídos directo de las tarjetas ya pintadas en
// pantalla (ids: vProductos, vLotes, vUnidades, vMarcas).
function leerResumenDesdeTarjetas() {

    const leerValor = (id) => {
        const el = document.getElementById(id);
        if (!el) return "0";
        const texto = el.textContent.trim();
        return texto === "" ? "0" : texto;
    };

    return {
        productos: leerValor("vProductos"),
        lotes:     leerValor("vLotes"),
        unidades:  leerValor("vUnidades"),
        marcas:    leerValor("vMarcas")
    };

}


// Filas de la tabla, leídas directo de las <tr> ya existentes dentro de
// #tablaVencimientos (se toma el texto exacto que el usuario ve en cada
// celda, celda por celda, sin volver a formatear nada).
function leerFilasDesdeTabla() {

    const tabla = document.getElementById("tablaVencimientos");

    if (!tabla) return [];

    // Soporta que "tablaVencimientos" sea el <table> completo, el
    // <tbody>, o incluso el propio <tr> raíz de un framework de
    // renderizado; en cualquier caso, se buscan las <tr> con <td> reales
    // dentro del subárbol correspondiente.
    let filasDOM;

    if (tabla.tagName === "TBODY") {
        filasDOM = tabla.querySelectorAll("tr");
    } else if (tabla.tagName === "TABLE") {
        filasDOM = tabla.querySelectorAll("tbody tr");
    } else {
        // Contenedor genérico (ej. un <div> que envuelve la tabla):
        // se buscan las filas de datos en cualquier profundidad.
        filasDOM = tabla.querySelectorAll("tbody tr, tr");
    }

    const filas = [];

    filasDOM.forEach((fila) => {

        const celdas = fila.querySelectorAll("td");

        if (!celdas.length) return; // ignora filas de encabezado sueltas

        // Detecta filas de "estado vacío" tipo
        // <tr><td colspan="6">No hay productos por vencer</td></tr>,
        // que existen en varias tablas del proyecto para mostrar mensajes
        // cuando no hay datos. Se ignoran para no meterlas en el PDF como
        // si fueran un producto real.
        const esFilaDeEstadoVacio =
            celdas.length === 1 &&
            celdas[0].hasAttribute("colspan") &&
            parseInt(celdas[0].getAttribute("colspan"), 10) > 1;

        if (esFilaDeEstadoVacio) return;

        const valores = Array.from(celdas).map(td => td.textContent.trim());

        filas.push(valores);

    });

    return filas;

}


// Encabezados de columna, leídos directo del <thead> de la tabla (para
// que el PDF siempre coincida con las columnas reales que se muestran en
// pantalla, sin tener que mantenerlas hardcodeadas aquí).
function leerEncabezadosTabla() {

    const tabla = document.getElementById("tablaVencimientos");
    const encabezadosPorDefecto =
        ["Marca", "Código", "Producto", "Lote", "Fecha Venc.", "Cantidad"];

    if (!tabla) return encabezadosPorDefecto;

    const tablaCompleta = tabla.tagName === "TBODY"
        ? tabla.closest("table")
        : tabla;

    if (!tablaCompleta) return encabezadosPorDefecto;

    const celdasEncabezado = tablaCompleta.querySelectorAll("thead th");

    if (!celdasEncabezado.length) return encabezadosPorDefecto;

    return Array.from(celdasEncabezado).map(th => th.textContent.trim());

}


// =====================================
// BLOQUE: ENCABEZADO CORPORATIVO
// =====================================

function dibujarEncabezado(doc, anchoPagina, mesActual, cursorY) {

    doc.setFillColor(...PDF_COLOR_PRIMARIO);
    doc.rect(0, 0, anchoPagina, 70, "F");

    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("QUALITY SISTEMAS Y REACTIVOS", PDF_MARGEN, 32);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.text("Reporte de Vencimientos — Mes: " + mesActual, PDF_MARGEN, 50);

    const fechaTexto =
        "Generado: " +
        new Date().toLocaleString("es-HN", {
            day: "2-digit",
            month: "long",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        });

    doc.setFontSize(9);
    const anchoFecha = doc.getTextWidth(fechaTexto);
    doc.text(fechaTexto, anchoPagina - PDF_MARGEN - anchoFecha, 50);

    doc.setTextColor(...PDF_COLOR_TEXTO);

    return 70 + 25;

}


// =====================================
// BLOQUE: TARJETAS DE RESUMEN
// =====================================

function dibujarResumen(doc, resumen, anchoPagina, cursorY) {

    const tarjetas = [
        { etiqueta: "Productos", valor: resumen.productos },
        { etiqueta: "Lotes",     valor: resumen.lotes },
        { etiqueta: "Unidades",  valor: resumen.unidades },
        { etiqueta: "Marcas",    valor: resumen.marcas }
    ];

    const anchoUtil = anchoPagina - (PDF_MARGEN * 2);
    const espacio = 10;
    const anchoTarjeta = (anchoUtil - (espacio * (tarjetas.length - 1))) / tarjetas.length;
    const altoTarjeta = 50;

    tarjetas.forEach((tarjeta, i) => {

        const x = PDF_MARGEN + (i * (anchoTarjeta + espacio));

        doc.setDrawColor(...PDF_COLOR_BORDE);
        doc.setFillColor(250, 251, 253);
        doc.roundedRect(x, cursorY, anchoTarjeta, altoTarjeta, 6, 6, "FD");

        doc.setTextColor(...PDF_COLOR_PRIMARIO);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(18);
        doc.text(String(tarjeta.valor), x + 12, cursorY + 26);

        doc.setTextColor(...PDF_COLOR_GRIS);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.text(tarjeta.etiqueta, x + 12, cursorY + 40);

    });

    doc.setTextColor(...PDF_COLOR_TEXTO);

    return cursorY + altoTarjeta + 25;

}


// =====================================
// BLOQUE: GRÁFICA (capturada directo del canvas, sin Chart.js)
// =====================================

function dibujarGrafica(doc, anchoPagina, altoPagina, cursorY) {

    const canvas = document.getElementById("graficaVencimientos");

    // Si el canvas no existe o todavía no tiene nada pintado (ej. hoja
    // del mes sin productos), se omite este bloque en vez de romper el
    // PDF.
    if (!canvas || !canvas.width || !canvas.height) {
        return cursorY;
    }

    let imagenBase64;

    try {

        // toDataURL() es un método nativo del <canvas>: exporta el
        // contenido tal cual esté pintado en ESE momento. Como esta
        // función solo se ejecuta al hacer click en "Generar PDF" (ver
        // el listener delegado más arriba), y para ese punto Chart.js ya
        // terminó su animación inicial de dibujo (la gráfica lleva rato
        // visible en pantalla), no hace falta esperar ningún evento
        // adicional ni tener la instancia de Chart.js a mano: lo que hay
        // pintado en el canvas es exactamente lo que el usuario ve.
        imagenBase64 = canvas.toDataURL("image/png", 1.0);

    } catch (err) {

        // Esto solo puede fallar si el canvas quedó "tainted" (por
        // ejemplo si Chart.js dibujó una imagen cargada desde otro
        // dominio sin CORS habilitado). En ese caso se omite la gráfica
        // en vez de romper la generación del PDF; el resto del reporte
        // (encabezado, resumen y tabla) se genera con normalidad.
        console.warn("No se pudo capturar la gráfica de vencimientos:", err);
        return cursorY;

    }

    const anchoUtil = anchoPagina - (PDF_MARGEN * 2);

    const proporcion = canvas.height / canvas.width;
    let anchoImagen = anchoUtil;
    let altoImagen = anchoImagen * proporcion;

    const altoMaximo = 260;
    if (altoImagen > altoMaximo) {
        altoImagen = altoMaximo;
        anchoImagen = altoImagen / proporcion;
    }

    if (cursorY + altoImagen > altoPagina - PDF_MARGEN) {
        doc.addPage();
        cursorY = PDF_MARGEN;
    }

    doc.addImage(
        imagenBase64,
        "PNG",
        PDF_MARGEN,
        cursorY,
        anchoImagen,
        altoImagen
    );

    return cursorY + altoImagen + 20;

}


// =====================================
// BLOQUE: TABLA DE PRODUCTOS (jspdf-autotable, leída del DOM)
// =====================================

function dibujarTabla(doc, filas, cursorY) {

    const encabezados = leerEncabezadosTabla();

    doc.autoTable({

        head: [encabezados],
        body: filas,

        startY: cursorY,

        margin: { left: PDF_MARGEN, right: PDF_MARGEN, bottom: PDF_MARGEN + 20 },

        // Salto de página automático cuando la tabla no cabe en el
        // espacio restante.
        pageBreak: "auto",

        theme: "striped",

        styles: {
            font: "helvetica",
            fontSize: 9,
            textColor: PDF_COLOR_TEXTO,
            cellPadding: 6
        },

        headStyles: {
            fillColor: PDF_COLOR_PRIMARIO,
            textColor: [255, 255, 255],
            fontStyle: "bold"
        },

        alternateRowStyles: {
            fillColor: [248, 250, 252]
        },

        // La última columna (normalmente "Cantidad") se centra, sea cual
        // sea el índice real, para mantener el mismo look del diseño
        // original sin asumir un orden fijo de columnas.
        columnStyles: {
            [encabezados.length - 1]: { halign: "center" }
        },

        didDrawPage: () => {}

    });

}


// =====================================
// BLOQUE: PIE DE PÁGINA CON NUMERACIÓN
// =====================================

function dibujarPiePagina(doc, anchoPagina, altoPagina) {

    const totalPaginas = doc.internal.getNumberOfPages();

    for (let i = 1; i <= totalPaginas; i++) {

        doc.setPage(i);

        doc.setDrawColor(...PDF_COLOR_BORDE);
        doc.line(
            PDF_MARGEN, altoPagina - 30,
            anchoPagina - PDF_MARGEN, altoPagina - 30
        );

        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(...PDF_COLOR_GRIS);

        doc.text("Quality Sistemas y Reactivos", PDF_MARGEN, altoPagina - 18);

        const textoPagina = "Página " + i + " de " + totalPaginas;
        const anchoTexto = doc.getTextWidth(textoPagina);
        doc.text(
            textoPagina,
            anchoPagina - PDF_MARGEN - anchoTexto,
            altoPagina - 18
        );

    }

}