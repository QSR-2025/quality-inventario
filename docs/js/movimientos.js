let chartEntradas = null;
let chartProductos = null;
let movimientosDiaCache = [];

async function cargarResumenMovimientos() {
    const fecha = document.getElementById('fechaMovimientos').value;
    if (!fecha) {
        document.getElementById('mensajeReporte').textContent = 'Seleccione una fecha para visualizar las estadísticas y descargar el reporte del día.';
        ['totalEntradas','totalSalidas','totalMovimientos','totalProductosMovimiento'].forEach(id => document.getElementById(id).textContent = '0');
        movimientosDiaCache = [];
        cargarGraficas({entradas:0,salidas:0,topProductos:[]});
        return;
    }
    try {
        document.getElementById('mensajeReporte').textContent = 'Cargando estadísticas...';
        const respuesta = await obtenerMovimientos(fecha, true);
        movimientosDiaCache = respuesta.movimientos || [];
        const productos = {};
        let entradas = 0, salidas = 0;
        movimientosDiaCache.forEach(m => {
            const tipo = String(m.movimiento || '').toLowerCase();
            if (tipo === 'entrada') entradas++;
            if (tipo === 'salida') salidas++;
            const nombre = m.producto || 'Producto sin nombre';
            productos[nombre] = (productos[nombre] || 0) + 1;
        });
        const resumen = {entradas, salidas, total:movimientosDiaCache.length, productos:Object.keys(productos).length,
            topProductos:Object.entries(productos).sort((a,b)=>b[1]-a[1]).slice(0,8)};
        document.getElementById('totalEntradas').textContent = resumen.entradas;
        document.getElementById('totalSalidas').textContent = resumen.salidas;
        document.getElementById('totalMovimientos').textContent = resumen.total;
        document.getElementById('totalProductosMovimiento').textContent = resumen.productos;
        cargarGraficas(resumen);
        document.getElementById('mensajeReporte').textContent = `Reporte del ${fecha} cargado: ${resumen.total} movimientos.`;
    } catch (error) {
        console.error(error);
        document.getElementById('mensajeReporte').textContent = 'No fue posible cargar el reporte.';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const fecha = document.getElementById('fechaMovimientos');
    if (fecha) fecha.addEventListener('change', cargarResumenMovimientos);
});

function cargarGraficas(resumen) {
    const ctxDona = document.getElementById('graficaEntradasSalidas');
    const ctxBarras = document.getElementById('graficaProductos');
    if (!ctxDona || !ctxBarras || typeof Chart === 'undefined') return;
    if (chartEntradas) chartEntradas.destroy();
    chartEntradas = new Chart(ctxDona, {
        type:'doughnut',
        data:{labels:['Entradas','Salidas'],datasets:[{data:[resumen.entradas,resumen.salidas],backgroundColor:['#2563eb','#f59e0b'],hoverOffset:10,borderWidth:0,spacing:3}]},
        options:{responsive:true,maintainAspectRatio:false,cutout:'68%',plugins:{legend:{position:'bottom',labels:{usePointStyle:true,pointStyle:'circle',padding:22,boxWidth:8,font:{size:12,weight:'600'}}},tooltip:{padding:12,cornerRadius:10}},animation:{duration:650}}
    });
    if (chartProductos) chartProductos.destroy();
    chartProductos = new Chart(ctxBarras, {
        type:'bar',
        data:{labels:resumen.topProductos.map(x=>x[0]),datasets:[{label:'Movimientos',data:resumen.topProductos.map(x=>x[1]),backgroundColor:resumen.topProductos.map((_,i)=>`rgba(37,99,235,${Math.max(.48,1-i*.065)})`),borderRadius:7,borderSkipped:false,maxBarThickness:28}]},
        options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{padding:10,cornerRadius:8,displayColors:false}},layout:{padding:{right:12}},scales:{x:{beginAtZero:true,grid:{color:'rgba(148,163,184,.18)'},border:{display:false},ticks:{precision:0,color:'#64748b'}},y:{grid:{display:false},border:{display:false},ticks:{color:'#475569',font:{size:11},callback:function(value){const t=this.getLabelForValue(value);return t.length>32?t.slice(0,29)+'…':t;}}}},animation:{duration:650}}
    });
}

async function generarReportePDF() {
    const fecha = document.getElementById('fechaMovimientos').value;
    if (!fecha) { alert('Seleccione una fecha.'); return; }
    // Siempre se consulta de nuevo: movimientosDiaCache se llena al elegir la
    // fecha y no incluye los movimientos registrados después (p. ej. una salida
    // hecha en Almacén con el reporte ya cargado).
    let movimientos = movimientosDiaCache;
    try {
        const respuesta = await obtenerMovimientos(fecha, true);
        movimientos = respuesta.movimientos || [];
        movimientosDiaCache = movimientos;
    } catch (e) {
        if (!movimientos.length) { alert('No se pudieron consultar los movimientos de esa fecha.'); return; }
    }
    // El servidor ya devuelve solo los movimientos de la fecha pedida (en la
    // zona horaria del script). No se vuelve a filtrar aquí: comparar con
    // toISOString() usa UTC y descartaba todo movimiento hecho desde las
    // 18:00 hora de Honduras (UTC-6), porque en UTC ya es el día siguiente.
    const delDia = movimientos;
    if (!delDia.length) { alert('No hay movimientos para la fecha seleccionada.'); return; }
    if (!window.jspdf || !window.jspdf.jsPDF) { alert('No se pudo cargar el generador PDF.'); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p','mm','a4');
    const entradas = delDia.filter(m => String(m.movimiento || '').toLowerCase() === 'entrada');
    const salidas = delDia.filter(m => String(m.movimiento || '').toLowerCase() === 'salida');
    const titulo = 'QUALITY SISTEMAS Y REACTIVOS';
    doc.setFillColor(18,63,145); doc.rect(0,0,210,31,'F');
    doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(16); doc.text(titulo,105,13,{align:'center'});
    doc.setFontSize(11); doc.text('REPORTE DE MOVIMIENTOS DE INVENTARIO',105,22,{align:'center'});
    doc.setTextColor(40,55,75); doc.setFont('helvetica','normal'); doc.setFontSize(10);
    doc.text('Fecha: ' + fecha,14,40);
    doc.text(`Entradas: ${entradas.length}   |   Salidas: ${salidas.length}   |   Total: ${delDia.length}`,14,47);
    let y = 56;
    const pagina = () => { if (y > 255) { doc.addPage(); y=18; } };
    const tabla = (encabezado, lista, grupos) => {
        pagina();
        doc.setFillColor(18,63,145); doc.roundedRect(14,y,182,9,2,2,'F');
        doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.text(encabezado,18,y+6.2); y+=13;
        if (!lista.length) { doc.setTextColor(100); doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.text('Sin movimientos.',16,y); y+=8; return; }
        const porGrupo = {};
        lista.forEach(m => {
            const grupo = grupos(m) || 'Sin especificar';
            (porGrupo[grupo] ||= []).push(m);
        });
        Object.keys(porGrupo).sort((a,b)=>a.localeCompare(b,'es')).forEach(grupo => {
            pagina();
            doc.setFillColor(232,240,254); doc.roundedRect(14,y,182,8,1.5,1.5,'F');
            doc.setTextColor(18,63,145); doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.text(grupo,17,y+5.5); y+=10;
            const filas = porGrupo[grupo].map(m => [m.fecha || fecha, m.usuario || '—', m.producto || '—', m.sku || '—', m.lote || '—', String(m.cantidad ?? Math.abs(Number(m.stockNuevo||0)-Number(m.stockAnterior||0))), m.observacion || '—']);
            doc.autoTable({startY:y,head:[['Fecha','Usuario','Producto','SKU','Lote','Cantidad','Observación']],body:filas,theme:'grid',styles:{fontSize:7.5,cellPadding:2,overflow:'linebreak',textColor:[51,65,85],lineColor:[226,232,240]},headStyles:{fillColor:[37,99,235],textColor:[255,255,255],fontStyle:'bold'},alternateRowStyles:{fillColor:[248,250,252]},columnStyles:{0:{cellWidth:20},1:{cellWidth:25},2:{cellWidth:49},3:{cellWidth:20},4:{cellWidth:22},5:{cellWidth:17},6:{cellWidth:29}},margin:{left:14,right:14},didDrawPage:()=>{doc.setFontSize(8);doc.setTextColor(120);doc.text('Quality Inventario · Reporte de movimientos',14,290);}});
            y = doc.lastAutoTable.finalY + 7;
        });
    };
    tabla('ENTRADAS', entradas, m => `Transferencia: ${m.transferencia || m.numeroTransferencia || m.documento || m.factura || m.observacion || 'Sin número de transferencia'}`);
    y += 2;
    tabla('SALIDAS', salidas, m => `Cliente: ${m.cliente || 'Cliente no especificado'}  |  Factura: ${m.factura || m.documento || 'Sin factura'}`);
    doc.save('Reporte_Movimientos_' + fecha + '.pdf');
}

document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('btnDescargarExcel');
    if (btn) btn.addEventListener('click', generarReportePDF);
});
