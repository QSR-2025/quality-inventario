/* ==========================================================
   QUALITY INVENTARIO — gestión de pedidos dentro de Almacén
   Los mínimos se consultan solo para sugerencias y nunca son existencias.
========================================================== */
(function () {
    "use strict";
    var estado = { repo: null };
    function $(id) { return document.getElementById(id); }
    function el(tag, cls, txt) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (txt !== undefined && txt !== null) e.textContent = txt;
        return e;
    }
    function num(v) { return v === null || v === undefined ? "—" : Number(v).toLocaleString("es-HN"); }
    async function postGestion(accion, datos) {
        var token = String(localStorage.getItem("qualityToken") || "").trim();
        if (!token) return { success: false, message: "La sesión no tiene token. Cierre sesión e ingrese nuevamente." };
        var r = await fetch(API_URL, { method: "POST", body: JSON.stringify(Object.assign({}, datos, { action: accion, token: token })) });
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
    }
    function mensaje(cont, texto, clase) {
        if (!cont) return;
        cont.replaceChildren(el("div", "gestion-msg " + (clase || ""), texto));
    }
    function tabla(columnas, filas) {
        var t = el("table", "tabla-gestion"), th = el("thead"), trh = el("tr");
        columnas.forEach(function (c) { trh.appendChild(el("th", c.cls || "", c.t)); });
        th.appendChild(trh); t.appendChild(th);
        var tb = el("tbody");
        filas.forEach(function (f) {
            var tr = el("tr");
            columnas.forEach(function (c) {
                var td = el("td", c.cls || ""), v = c.f(f);
                if (v instanceof Node) td.appendChild(v); else td.textContent = v === null || v === undefined ? "—" : String(v);
                td.setAttribute("data-etiqueta", c.t); tr.appendChild(td);
            });
            tb.appendChild(tr);
        });
        t.appendChild(tb); return t;
    }
    var ESTADOS = {
        completo: ["Cubre la necesidad", "ok"], parcial: ["Parcial: SPS no alcanza", "warn"],
        sin_disponibilidad: ["Sin disponibilidad en SPS", "bad"], sin_registro_sps: ["No existe en SPS", "muted"], pedido: ["Pedir", "warn"]
    };
    function insignia(clave) { var e = ESTADOS[clave] || [clave, "muted"]; return el("span", "insignia " + e[1], e[0]); }
    async function cargarSugerenciaPedido(forzar) {
        var cont = $("tablaReposicionReactivos"), cont2 = $("tablaReposicionMateriales");
        if (!cont || !cont2) return;
        mensaje(cont, "Calculando sugerencias de pedido…"); cont2.replaceChildren();
        try {
            var r = await postGestion("getSugerenciasReposicion", { forzar: !!forzar });
            if (!r.success) { mensaje(cont, r.message || "No se pudo calcular la sugerencia de pedido.", "error"); return; }
            estado.repo = r; pintarSugerenciaPedido();
        } catch (e) { mensaje(cont, "No se pudo contactar el servidor: " + e.message, "error"); }
    }
    function pintarSugerenciaPedido() {
        var r = estado.repo; if (!r) return;
        var filtro = $("filtroReposicion"), q = (filtro ? filtro.value : "").trim().toLowerCase();
        var filtra = function (x) { return !q || (x.codigo + " " + x.producto + " " + x.marca + " " + x.categoria).toLowerCase().indexOf(q) !== -1; };
        var rs = r.resumen || {};
        var resumen = $("resumenReposicion");
        if (resumen) resumen.replaceChildren.apply(resumen, [
            ["Reactivos a pedir", rs.reactivosAReponer], ["Materiales a pedir", rs.materialesAReponer],
            ["Cumplen su mínimo", rs.cumplenMinimo], ["Sin mínimo definido", rs.sinMinimoDefinido]
        ].map(function (p) { var d = el("div", "kpi-mini"); d.appendChild(el("b", "", num(p[1] || 0))); d.appendChild(el("span", "", p[0])); return d; }));
        var reac = (r.reactivos || []).filter(filtra), mat = (r.materiales || []).filter(filtra);
        var c1 = $("tablaReposicionReactivos"), c2 = $("tablaReposicionMateriales");
        if (!reac.length) mensaje(c1, "No hay reactivos por pedir con este filtro.");
        else c1.replaceChildren(tabla([
            { t: "Código", f: x => x.codigo }, { t: "Producto", f: x => x.producto }, { t: "Marca", f: x => x.marca },
            { t: "Existencias TGU", cls: "n", f: x => num(x.existenciasTGU) }, { t: "Mínimo TGU", cls: "n", f: x => num(x.minimoTGU) },
            { t: "Necesidad", cls: "n", f: x => num(x.necesidad) }, { t: "Disponible SPS", cls: "n", f: x => num(x.existenciasSPS) },
            { t: "Sugerido a trasladar", cls: "n fuerte", f: x => num(x.sugerido) }, { t: "Estado", f: x => insignia(x.estado) }
        ], reac));
        if (!mat.length) mensaje(c2, "No hay materiales por pedir con este filtro.");
        else c2.replaceChildren(tabla([
            { t: "Código", f: x => x.codigo }, { t: "Producto", f: x => x.producto }, { t: "Categoría", f: x => x.categoria },
            { t: "Existencias TGU", cls: "n", f: x => num(x.existenciasTGU) }, { t: "Mínimo TGU", cls: "n", f: x => num(x.minimoTGU) },
            { t: "Necesidad", cls: "n fuerte", f: x => num(x.necesidad) }, { t: "Estado", f: () => insignia("pedido") }
        ], mat));
    }

    // ---------- Exportación Excel real (.xlsx), sin dependencias externas ----------
    function textoExcel(v) { return String(v === null || v === undefined ? "" : v); }
    function escaparXml(v) {
        return textoExcel(v).replace(/&/g, "&amp;").replace(/</g, "&lt;")
            .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
    }
    function columnaExcel(n) {
        var s = "";
        while (n > 0) { var r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
        return s;
    }
    function crearHojaExcel(filas, anchos, conFiltro) {
        var xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
            '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>';
        if (anchos && anchos.length) {
            xml += '<cols>' + anchos.map(function (a, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + a + '" customWidth="1"/>'; }).join("") + '</cols>';
        }
        xml += '<sheetData>';
        filas.forEach(function (fila, ri) {
            var rn = ri + 1;
            xml += '<row r="' + rn + '">';
            fila.forEach(function (valor, ci) {
                if (valor === null || valor === undefined || valor === "") return;
                var ref = columnaExcel(ci + 1) + rn;
                if (typeof valor === "number" && Number.isFinite(valor)) {
                    xml += '<c r="' + ref + '"' + (ri === 0 ? ' s="1"' : '') + '><v>' + valor + '</v></c>';
                } else {
                    xml += '<c r="' + ref + '" t="inlineStr"' + (ri === 0 ? ' s="1"' : '') + '><is><t xml:space="preserve">' + escaparXml(valor) + '</t></is></c>';
                }
            });
            xml += '</row>';
        });
        xml += '</sheetData>';
        if (conFiltro && filas.length > 1) xml += '<autoFilter ref="A1:' + columnaExcel(filas[0].length) + filas.length + '"/>';
        xml += '<pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/></worksheet>';
        return xml;
    }
    function unirBytes(partes) {
        var total = partes.reduce(function (n, p) { return n + p.length; }, 0), salida = new Uint8Array(total), pos = 0;
        partes.forEach(function (p) { salida.set(p, pos); pos += p.length; });
        return salida;
    }
    function crc32(bytes) {
        var crc = -1;
        for (var i = 0; i < bytes.length; i++) {
            crc ^= bytes[i];
            for (var j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
        }
        return (crc ^ -1) >>> 0;
    }
    function crearZipSinCompresion(archivos) {
        var encoder = new TextEncoder(), locales = [], centrales = [], offset = 0;
        var ahora = new Date(), dosTime = (ahora.getHours() << 11) | (ahora.getMinutes() << 5) | Math.floor(ahora.getSeconds() / 2);
        var dosDate = (((Math.max(1980, ahora.getFullYear()) - 1980) & 127) << 9) | ((ahora.getMonth() + 1) << 5) | ahora.getDate();
        archivos.forEach(function (archivo) {
            var nombre = encoder.encode(archivo.nombre), datos = encoder.encode(archivo.contenido), crc = crc32(datos);
            var local = new Uint8Array(30 + nombre.length + datos.length), lv = new DataView(local.buffer);
            lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true);
            lv.setUint16(8, 0, true); lv.setUint16(10, dosTime, true); lv.setUint16(12, dosDate, true);
            lv.setUint32(14, crc, true); lv.setUint32(18, datos.length, true); lv.setUint32(22, datos.length, true);
            lv.setUint16(26, nombre.length, true); lv.setUint16(28, 0, true);
            local.set(nombre, 30); local.set(datos, 30 + nombre.length); locales.push(local);
            var central = new Uint8Array(46 + nombre.length), cv = new DataView(central.buffer);
            cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
            cv.setUint16(8, 0x0800, true); cv.setUint16(10, 0, true); cv.setUint16(12, dosTime, true); cv.setUint16(14, dosDate, true);
            cv.setUint32(16, crc, true); cv.setUint32(20, datos.length, true); cv.setUint32(24, datos.length, true);
            cv.setUint16(28, nombre.length, true); cv.setUint16(30, 0, true); cv.setUint16(32, 0, true);
            cv.setUint16(34, 0, true); cv.setUint16(36, 0, true); cv.setUint32(38, 0, true); cv.setUint32(42, offset, true);
            central.set(nombre, 46); centrales.push(central); offset += local.length;
        });
        var centralBytes = unirBytes(centrales), localBytes = unirBytes(locales), fin = new Uint8Array(22), fv = new DataView(fin.buffer);
        fv.setUint32(0, 0x06054b50, true); fv.setUint16(4, 0, true); fv.setUint16(6, 0, true);
        fv.setUint16(8, archivos.length, true); fv.setUint16(10, archivos.length, true);
        fv.setUint32(12, centralBytes.length, true); fv.setUint32(16, localBytes.length, true); fv.setUint16(20, 0, true);
        return unirBytes([localBytes, centralBytes, fin]);
    }
    function filasReactivosExcel(lista) {
        var filas = [["Código", "Producto", "Marca", "Categoría", "Existencias TGU", "Mínimo TGU", "Necesidad", "Disponible SPS", "Sugerido a trasladar", "Pendiente", "Estado"]];
        lista.forEach(function (x) {
            var estadoTexto = (ESTADOS[x.estado] || [x.estado || "—"])[0];
            filas.push([x.codigo, x.producto, x.marca, x.categoria, Number(x.existenciasTGU || 0), Number(x.minimoTGU || 0),
                Number(x.necesidad || 0), x.existenciasSPS === null || x.existenciasSPS === undefined ? "No registrado" : Number(x.existenciasSPS),
                Number(x.sugerido || 0), Number(x.pendiente || 0), estadoTexto]);
        });
        return filas;
    }
    function filasMaterialesExcel(lista) {
        var filas = [["Código", "Producto", "Categoría", "Existencias TGU", "Mínimo TGU", "Necesidad de pedido"]];
        lista.forEach(function (x) { filas.push([x.codigo, x.producto, x.categoria, Number(x.existenciasTGU || 0), Number(x.minimoTGU || 0), Number(x.necesidad || 0)]); });
        return filas;
    }
    function descargarSugerenciaExcel() {
        if (!estado.repo) { alert("Primero actualice la sugerencia de pedido."); return; }
        var filtro = $("filtroReposicion"), q = (filtro ? filtro.value : "").trim().toLowerCase();
        var coincide = function (x) { return !q || (String(x.codigo || "") + " " + String(x.producto || "") + " " + String(x.marca || "") + " " + String(x.categoria || "")).toLowerCase().indexOf(q) !== -1; };
        var reactivos = (estado.repo.reactivos || []).filter(coincide), materiales = (estado.repo.materiales || []).filter(coincide);
        if (!reactivos.length && !materiales.length) { alert("No hay productos por pedir para exportar con el filtro actual."); return; }
        var rs = estado.repo.resumen || {}, fecha = new Date();
        var fechaTexto = fecha.toLocaleString("es-HN", { dateStyle: "medium", timeStyle: "short" });
        var resumen = [
            ["QUALITY INVENTARIO — REPORTE DE SUGERENCIA DE PEDIDO"],
            ["Fecha de generación", fechaTexto],
            ["Reactivos incluidos", reactivos.length],
            ["Materiales incluidos", materiales.length],
            ["Cumplen su mínimo", Number(rs.cumplenMinimo || 0)],
            ["Sin mínimo definido", Number(rs.sinMinimoDefinido || 0)],
            ["Nota", "Los mínimos se utilizan únicamente para calcular pedidos; no forman parte de las existencias."],
            ["Filtro aplicado", q || "Ninguno"]
        ];
        var archivos = [
            { nombre: "[Content_Types].xml", contenido: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
            { nombre: "_rels/.rels", contenido: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
            { nombre: "xl/workbook.xml", contenido: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Resumen" sheetId="1" r:id="rId1"/><sheet name="Reactivos" sheetId="2" r:id="rId2"/><sheet name="Materiales" sheetId="3" r:id="rId3"/></sheets></workbook>' },
            { nombre: "xl/_rels/workbook.xml.rels", contenido: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
            { nombre: "xl/styles.xml", contenido: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF145BE2"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"><color rgb="FFDCE6F4"/></left><right style="thin"><color rgb="FFDCE6F4"/></right><top style="thin"><color rgb="FFDCE6F4"/></top><bottom style="thin"><color rgb="FFDCE6F4"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' },
            { nombre: "xl/worksheets/sheet1.xml", contenido: crearHojaExcel(resumen, [48, 34], false) },
            { nombre: "xl/worksheets/sheet2.xml", contenido: crearHojaExcel(filasReactivosExcel(reactivos), [18, 44, 22, 24, 18, 16, 15, 18, 22, 15, 28], true) },
            { nombre: "xl/worksheets/sheet3.xml", contenido: crearHojaExcel(filasMaterialesExcel(materiales), [18, 44, 24, 18, 16, 22], true) }
        ];
        var zip = crearZipSinCompresion(archivos), blob = new Blob([zip], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        var url = URL.createObjectURL(blob), a = document.createElement("a"), stamp = fecha.getFullYear() + "-" + String(fecha.getMonth() + 1).padStart(2, "0") + "-" + String(fecha.getDate()).padStart(2, "0");
        a.href = url; a.download = "Sugerencia_de_Pedido_" + stamp + ".xlsx"; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    }

    document.addEventListener("DOMContentLoaded", function () {
        var actualizar = $("btnActualizarReposicion"), filtro = $("filtroReposicion");
        if (actualizar) actualizar.addEventListener("click", function () { cargarSugerenciaPedido(true); });
        if (filtro) filtro.addEventListener("input", pintarSugerenciaPedido);
        var exportar = $("btnExportarSugerenciaExcel");
        if (exportar) exportar.addEventListener("click", descargarSugerenciaExcel);
    });
    window.cargarSugerenciaPedido = cargarSugerenciaPedido;
})();
