// Pruebas lógicas de js/imagenes.js con navegador y servidor SIMULADOS (Node).
// Ejecutar:  node prueba-imagenes.js
const fs = require("fs"), vm = require("vm"), path = require("path");
const realFetch = fetch;
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function crearEntorno({ backend = "nuevo", lat = 0 } = {}, cubos) {
  const peticiones = [];
  const store = cubos || new Map();
  const caches = {
    open: async n => ({
      match: async r => store.get(n + r.url)?.clone(),
      put: async (r, resp) => { store.set(n + r.url, resp); },
      delete: async r => store.delete(n + r.url),
      keys: async () => []
    }),
    keys: async () => [], delete: async () => true
  };
  const ls = new Map([["qualityToken", "T"]]);
  const win = {
    location: { origin: "https://app.test" }, innerHeight: 800, caches,
    addEventListener() {}, requestIdleCallback: f => f(),
    localStorage: { getItem: k => ls.get(k) ?? null, setItem: (k, v) => ls.set(k, v) }
  };
  win.window = win;
  const ctx = vm.createContext({
    window: win, globalThis: win, console, setTimeout, clearTimeout, Promise, URL, Blob, Request, Response, atob, Uint8Array,
    localStorage: win.localStorage, document: { dispatchEvent() {} }, CustomEvent: class { constructor(n, d) { this.n = n; this.d = d; } },
    API_URL: "https://script.google.com/x/exec", navigator: {}, performance,
    fetch: async (u, o) => {
      if (typeof u === "string" && u.startsWith("data:")) return realFetch(u);
      await new Promise(r => setTimeout(r, lat));
      const b = JSON.parse(o.body); peticiones.push(b);
      if (b.action === "getImagenesLote") {
        if (backend === "viejo") return { ok: true, json: async () => ({ success: false, message: "Acción no válida." }) };
        return { ok: true, json: async () => ({ success: true, resultados: b.items.map(i => i.ref === "MALO" ? { ok: false, motivo: "SIN_IMAGEN" } : { ok: true, dataUrl: PNG, origen: "origen" }) }) };
      }
      return { ok: true, json: async () => ({ success: true, dataUrl: PNG }) };
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../version actual/js/imagenes.js"), "utf8"), ctx);
  return { win, ctx, peticiones, store };
}
function img() { const i = { dataset: {}, classList: { add() {}, remove() {} } };
  Object.defineProperty(i, "src", { set(v) { i._src = v; setTimeout(() => i.onload && i.onload(), 1); }, get() { return i._src; } }); return i; }
const fuente = n => ({ hoja: "Materiales", fila: 10 + n, columna: 5, ref: "SKU" + n });
const cargar = (env, f, op = { prioridad: "alta" }) => new Promise(res => { const i = img(); env.win.cargarImagenConRespaldoQI(i, "", () => res("fallo"), f, op); const t = setInterval(() => { if (i._src) { clearInterval(t); setTimeout(() => res("ok"), 5); } }, 2); });
let fallos = 0; const ok = (c, m) => { console.log((c ? "  ✔ " : "  ✘ ") + m); if (!c) fallos++; };
const lotes = e => e.peticiones.filter(p => p.action === "getImagenesLote").length;
const indiv = e => e.peticiones.filter(p => p.action === "getImagenDrive").length;

(async () => {
  console.log("1) 20 imágenes de Materiales visibles a la vez");
  let e = crearEntorno(); let r = await Promise.all(Array.from({ length: 20 }, (_, n) => cargar(e, fuente(n))));
  ok(r.every(x => x === "ok"), "las 20 se muestran");
  ok(lotes(e) === 3 && indiv(e) === 0, `solicitudes a Apps Script: ${lotes(e)} lotes (8+8+4) en vez de 20 individuales`);
  const lim = e.peticiones.every(p => p.items.length <= 8); ok(lim, "ningún lote supera 8 imágenes");

  console.log("2) Mismo logotipo en 12 tarjetas (deduplicación)");
  e = crearEntorno(); r = await Promise.all(Array.from({ length: 12 }, () => cargar(e, { hoja: "Marcas", fila: 2, columna: 3, ref: "ABBOTT" }, { tipo: "marcas", prioridad: "alta" })));
  ok(r.every(x => x === "ok") && e.peticiones.length === 1 && e.peticiones[0].items.length === 1, "1 solicitud con 1 imagen para 12 tarjetas");

  console.log("3) Segunda visita (memoria vacía, Cache API conservada)");
  const e1 = crearEntorno(); await cargar(e1, fuente(1));
  const e2 = crearEntorno({}, e1.store); r = await cargar(e2, fuente(1));
  ok(r === "ok" && e2.peticiones.length === 0, "0 solicitudes a Apps Script: la imagen sale de la Cache API");

  console.log("4) Caché persistente vencida (>6 h) vuelve a pedirse");
  const e3 = crearEntorno(); await cargar(e3, fuente(1));
  for (const [k, v] of e3.store) { const h = new Headers(v.headers); h.set("X-QI-TS", String(Date.now() - 7 * 3600 * 1000)); e3.store.set(k, new Response(await v.clone().blob(), { headers: h })); }
  const e4 = crearEntorno({}, e3.store); await cargar(e4, fuente(1));
  ok(e4.peticiones.length === 1, "caducada → 1 solicitud nueva");

  console.log("5) Servidor con Code.gs anterior (sin getImagenesLote)");
  e = crearEntorno({ backend: "viejo" }); r = await Promise.all([cargar(e, fuente(1)), cargar(e, fuente(2))]);
  ok(r.every(x => x === "ok") && indiv(e) === 2, "respaldo automático a getImagenDrive (2 individuales)");

  console.log("6) Imagen sin archivo no bloquea a las demás ni se reintenta enseguida");
  e = crearEntorno(); r = await Promise.all([cargar(e, fuente(1)), cargar(e, { ...fuente(2), ref: "MALO" }), cargar(e, fuente(3))]);
  ok(r[0] === "ok" && r[1] === "fallo" && r[2] === "ok", "1 falla, 2 se muestran");
  const antes = e.peticiones.length; await cargar(e, { ...fuente(2), ref: "MALO" });
  ok(e.peticiones.length === antes, "reintento inmediato bloqueado (caché negativa 60 s)");

  console.log("7) Modo anterior (qiOptimizacion = off): una solicitud por imagen");
  e = crearEntorno(); e.win.localStorage.setItem("qiOptimizacion", "off");
  r = await Promise.all(Array.from({ length: 20 }, (_, n) => cargar(e, fuente(n))));
  ok(indiv(e) === 20 && lotes(e) === 0, "20 solicitudes individuales (comportamiento anterior reproducible)");

  console.log(fallos ? `\n${fallos} PRUEBA(S) FALLARON` : "\nTODAS LAS PRUEBAS LÓGICAS PASARON");
  process.exit(fallos ? 1 : 0);
})();
