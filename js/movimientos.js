let chartEntradas = null;
let chartProductos = null;

// =====================================
// CENTRO DE REPORTES
// =====================================

async function cargarResumenMovimientos() {

    const fecha = document.getElementById("fechaMovimientos").value;

    if (!fecha) {

        document.getElementById("mensajeReporte").textContent =
            "Seleccione una fecha para visualizar las estadísticas y descargar el reporte del día.";

        document.getElementById("totalEntradas").textContent = "0";
        document.getElementById("totalSalidas").textContent = "0";
        document.getElementById("totalMovimientos").textContent = "0";
        document.getElementById("totalProductosMovimiento").textContent = "0";

        return;

    }

    try {

        document.getElementById("mensajeReporte").textContent =
            "Cargando estadísticas...";

        const resumen = await obtenerResumenMovimientos(fecha);

        document.getElementById("totalEntradas").textContent =
            resumen.entradas;

        document.getElementById("totalSalidas").textContent =
            resumen.salidas;

        document.getElementById("totalMovimientos").textContent =
            resumen.total;

        document.getElementById("totalProductosMovimiento").textContent =
            resumen.productos;

        // Dibujar gráficas
        cargarGraficas(resumen);

        document.getElementById("mensajeReporte").textContent =
            "Reporte del día cargado correctamente.";

    } catch (error) {

        console.error(error);

        document.getElementById("mensajeReporte").textContent =
            "No fue posible cargar el reporte.";

    }

}

document.addEventListener("DOMContentLoaded", () => {

    const fecha = document.getElementById("fechaMovimientos");

    if (fecha) {

        fecha.addEventListener("change", cargarResumenMovimientos);

    }

});

// =====================================
// GRÁFICAS
// =====================================

function cargarGraficas(resumen) {

    // -------- DONA --------

    if (chartEntradas) {
        chartEntradas.destroy();
    }

    chartEntradas = new Chart(
        document.getElementById("graficaEntradasSalidas"),
        {
            type: "doughnut",
            data: {
                labels: ["Entradas", "Salidas"],
                datasets: [{
                    data: [
                        resumen.entradas,
                        resumen.salidas
                    ],
                    backgroundColor: [
                        "#28a745",
                        "#dc3545"
                    ]
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: "60%",
                plugins: {
                    legend: {
                        position: "bottom"
                    }
                }
            }
        }
    );

    // -------- PRODUCTOS --------

    if (chartProductos) {
        chartProductos.destroy();
    }

    chartProductos = new Chart(
        document.getElementById("graficaProductos"),
        {
            type: "bar",
            data: {
                labels: resumen.topProductos.map(x => x[0]),
                datasets: [{
                    label: "Movimientos",
                    data: resumen.topProductos.map(x => x[1]),
                    backgroundColor: "#0d6efd"
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: "y",
                plugins: {
                    legend: {
                        display: false
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        ticks: {
                            precision: 0
                        }
                    },
                    y: {
                        ticks: {
                            callback: function (value) {

                                const texto = this.getLabelForValue(value);

                                return texto.length > 30
                                    ? texto.substring(0, 30) + "..."
                                    : texto;

                            }
                        }
                    }
                }
            }
        }
    );

}

// =====================================
// DESCARGAR REPORTE PDF
// =====================================

async function generarReportePDF() {

    const fecha = document.getElementById("fechaMovimientos").value;

    if (!fecha) {
        alert("Seleccione una fecha.");
        return;
    }

    const datos = await obtenerMovimientos(fecha);

    if (!datos.movimientos || datos.movimientos.length === 0) {
        alert("No existen movimientos para esa fecha.");
        return;
    }

    const { jsPDF } = window.jspdf;

    const doc = new jsPDF("p", "mm", "a4");

    doc.setFontSize(18);
    doc.text("QUALITY SISTEMAS Y REACTIVOS", 105, 15, { align: "center" });

    doc.setFontSize(14);
    doc.text("REPORTE DE MOVIMIENTOS", 105, 23, { align: "center" });

    doc.setFontSize(11);

    doc.text("Fecha: " + fecha, 14, 35);

    doc.text("Entradas: " + document.getElementById("totalEntradas").textContent, 14, 42);

    doc.text("Salidas: " + document.getElementById("totalSalidas").textContent, 14, 49);

    doc.text("Total: " + document.getElementById("totalMovimientos").textContent, 14, 56);

    doc.text("Productos: " + document.getElementById("totalProductosMovimiento").textContent, 14, 63);

    const filas = datos.movimientos.map(m => [

        m.fecha,
        m.usuario,
        m.producto,
        m.sku,
        m.lote,
        m.movimiento,
        m.stockAnterior,
        m.stockNuevo

    ]);

    doc.autoTable({

        startY: 72,

        head: [[

            "Fecha",
            "Usuario",
            "Producto",
            "SKU",
            "Lote",
            "Movimiento",
            "Anterior",
            "Nuevo"

        ]],

        body: filas,

        styles: {

            fontSize: 8

        }

    });

    doc.save("Reporte_Movimientos_" + fecha + ".pdf");

}

document.addEventListener("DOMContentLoaded", () => {

    const btn = document.getElementById("btnDescargarExcel");

    if (btn) {

        btn.addEventListener("click", generarReportePDF);

    }

});