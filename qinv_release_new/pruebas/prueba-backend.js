// Prueba del lote de imágenes de Code.gs con Google Apps Script SIMULADO (conteo de operaciones).
// Ejecutar: node prueba-backend.js
const fs = require("fs"), vm = require("vm"), path = require("path");
const crypto = require("crypto");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const cont = { openById: 0, getRange: 0, getImages: 0, fetch: 0, fetchAll: 0, fetchAllItems: 0, getFileById: 0, cacheGet: 0, cachePut: 0 };
const N = 60;
const filas = [["Código", "Nombre", "x", "x", "REF 1"]];
for (let i = 1; i <= N; i++) filas.push(["SKU" + i, "Producto " + i, "", "", { valueType: "IMAGE", getContentUrl: () => "https://lh3.googleusercontent.com/tmp" + i }]);
const hoja = { getName: () => "Materiales", getLastRow: () => filas.length, getLastColumn: () => 5,
  getRange: (f, c, nf, nc) => { cont.getRange++; return { getValues: () => filas.slice(f - 1, f - 1 + nf), getValue: () => filas[f - 1][c - 1], getFormula: () => "", getRichTextValue: () => null }; },
  getImages: () => { cont.getImages++; return []; }, getMaxRows: () => filas.length, getMaxColumns: () => 5 };
const almacen = new Map();
const cache = { get: k => { cont.cacheGet++; return almacen.get(k) ?? null; }, getAll: ks => { cont.cacheGet++; const o = {}; ks.forEach(k => { if (almacen.has(k)) o[k] = almacen.get(k); }); return o; },
  put: (k, v) => { cont.cachePut++; almacen.set(k, v); }, putAll: o => { cont.cachePut++; Object.entries(o).forEach(([k, v]) => almacen.set(k, v)); }, remove: k => almacen.delete(k) };
const resp = { getResponseCode: () => 200, getBlob: () => ({ getContentType: () => "image/png", getBytes: () => [...PNG] }) };
const ctx = vm.createContext({
  console, Logger: { log() {} }, Date, JSON, Math, Number, String, Object, Array, Set, Map, Error, isFinite, parseInt, RegExp, Promise,
  SpreadsheetApp: { openById: () => { cont.openById++; return { getSheetByName: n => n === "Materiales" ? hoja : null }; }, ValueType: { IMAGE: "IMAGE" } },
  CacheService: { getScriptCache: () => cache }, PropertiesService: { getScriptProperties: () => ({ getProperty() { return null; }, getProperties() { return {}; } }) },
  LockService: {}, ScriptApp: { getOAuthToken: () => "tok", getProjectTriggers: () => [] }, DriveApp: { getFileById() { cont.getFileById++; throw new Error("x"); } },
  UrlFetchApp: { fetch: () => { cont.fetch++; return resp; }, fetchAll: rs => { cont.fetchAll++; cont.fetchAllItems += rs.length; return rs.map(() => resp); } },
  Utilities: { computeDigest: (_a, s) => [...crypto.createHash("md5").update(s).digest()].map(b => b > 127 ? b - 256 : b), DigestAlgorithm: { MD5: 1 }, Charset: { UTF_8: 1 },
    base64Encode: b => Buffer.from(b).toString("base64"), getUuid: () => "u", formatDate: () => "" , newBlob: () => ({}) },
  Session: { getScriptTimeZone: () => "UTC" }, ContentService: {}, HtmlService: {}
});
const src = fs.readFileSync(path.join(__dirname, "../Code.gs"), "utf8") + "\n;this.__lote = obtenerImagenesLoteGestion_; this.__limpiar = limpiarUrlsTemporales_; this.__CONFIG = CONFIG;";
vm.runInContext(src, ctx);
const items = n => Array.from({ length: n }, (_, k) => ({ hoja: "Materiales", fila: 2 + k, columna: 5, ref: "SKU" + (1 + k) }));
let fallos = 0; const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✘ ") + m); if (!c) fallos++; };

console.log("Lote de 10 imágenes (filas contiguas)");
let r = ctx.__lote({ items: items(10) });
ok(r.success && r.resultados.every(x => x.ok && x.dataUrl.startsWith("data:image/png")), "10 imágenes entregadas como data URL");
console.log("  operaciones del servidor para 10 imágenes →", JSON.stringify(cont));
ok(cont.openById === 1 && cont.getRange === 1 && cont.getImages === 0, "1 apertura del Spreadsheet, 1 lectura de rango, 0 getImages()");
ok(cont.fetchAll === 1 && cont.fetchAllItems === 10 && cont.fetch === 0, "descargas en paralelo: 1 fetchAll con 10 URLs");
console.log("  (modo anterior, por la lectura de getImagenDrive: 10 aperturas + 10×getRange×4 + 10×getImages + 10 fetch secuenciales)");

console.log("Segundo pedido de las mismas imágenes (caché del servidor 6 h)");
Object.keys(cont).forEach(k => cont[k] = 0);
r = ctx.__lote({ items: items(10) });
ok(r.desdeCache === 10 && cont.openById === 0 && cont.fetchAll === 0, "10 desde caché: 0 aperturas del Spreadsheet, 0 descargas");

console.log("Verificación de fila (filas insertadas en la hoja)");
r = ctx.__lote({ items: [{ hoja: "Materiales", fila: 5, columna: 5, ref: "SKU999" }], forzar: true });
ok(r.resultados[0].ok === false && r.resultados[0].motivo === "FILA_DESACTUALIZADA", "una fila que ya no es ese SKU NO entrega la imagen de otro producto");

console.log("Validaciones");
r = ctx.__lote({ items: [{ hoja: "Usuarios", fila: 2, columna: 1, ref: "x" }, { hoja: "Materiales", fila: 2, columna: 5 }] });
ok(r.resultados.every(x => !x.ok && x.motivo === "REFERENCIA_NO_VALIDA"), "hoja no permitida o sin referencia → rechazada");
r = ctx.__lote({ items: items(25), forzar: true });
ok(r.resultados.length === 10, "máximo 10 por solicitud");

console.log("Limpieza de URLs temporales (caché/snapshot/respuesta)");
const d = { productos: [{ imagen: "https://lh3.googleusercontent.com/a", imagenFuente: { hoja: "Materiales" }, foto1: "https://lh3.googleusercontent.com/a", foto1Fuente: { hoja: "M" }, foto2: "https://qualityhn.com/wp-content/uploads/x.jpg", foto2Fuente: null }] };
ctx.__limpiar(d);
ok(d.productos[0].imagen === "" && d.productos[0].foto1 === "" && d.productos[0].foto2.includes("qualityhn"), "se borran solo las URLs temporales con coordenada; las públicas se conservan");
console.log(fallos ? `\n${fallos} FALLARON` : "\nTODAS LAS PRUEBAS DEL BACKEND SIMULADO PASARON");
process.exit(fallos ? 1 : 0);
