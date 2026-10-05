/**
 * =============================================================================
 *  QUALITY INVENTARIO — Code.gs
 * =============================================================================
 *  Backend de Google Apps Script para el sistema de inventario web.
 *
 *  IMPORTANTE — COMPATIBILIDAD CON EL FRONTEND:
 *  Este archivo conserva EXACTAMENTE los mismos nombres de función, parámetros
 *  y estructuras de respuesta JSON que ya consume el frontend (HTML/CSS/JS).
 *
 *    - action=getInventario        -> getInventario(forzar)
 *    - action=getResumen           -> getResumen(forzar)
 *    - action=buscar               -> buscarProductos(q, forzar)
 *    - action=getMovimientos       -> getMovimientos(forzar, fecha)
 *    - action=getResumenMovimientos-> getResumenMovimientos(fecha)
 *
 *  onEdit(e): detecta SOLO la celda/fila realmente editada, compara contra
 *  Snapshot_Stock y registra un movimiento solo si el stock cambió.
 *
 *  FIX — MÓDULO VENCIMIENTOS (getVencimientos): el ciclo empieza en el índice 2
 *  (fila 1 = título, fila 2 = encabezados, fila 3+ = datos) y el guard usa <= 2.
 *
 *  FIX — REGISTRO DESDE ALMACÉN (doPost):
 *    - USUARIOS.obtenerUsuarioActual() agregado.
 *    - La búsqueda del producto recorre toda la sección.
 *
 *  FIX — ENTRADAS / SALIDAS POR LOTE (esta versión):
 *    1) El "else" de la SALIDA estaba pegado al "if (!loteActual)" de la
 *       entrada: una entrada a lote existente restaba y una salida dejaba la
 *       existencia en 0. Ahora if/else pertenecen a tipo entrada/salida.
 *    2) Entrada a lote existente: suma en su mismo slot, conserva el
 *       vencimiento y recalcula DIF. DIAS y ESTADO a partir de él.
 *    3) Entrada a lote nuevo: primer slot libre; guarda lote, vencimiento
 *       (como fecha), DIF. DIAS n y ESTADO n. "__NUEVO_LOTE__" nunca se guarda.
 *    4) DIF. DIAS n: encabezado reconocido ("DIF. DIAS n" / "DIF. DE DIAS n") y
 *       cálculo solo con fechas (sin desfase por zona horaria).
 *    5) Salida que deja EXIS en 0: se libera el slot (LOTE, VENCI., DIF. DIAS,
 *       ESTADO, EXIS.). Las celdas con fórmula nunca se sobrescriben ni se
 *       borran. Los demás lotes no se tocan.
 *    6) DIF. DIAS: se reconoce por nombre flexible o por posición (entre
 *       VENCI. n y ESTADO n) y se guarda con formato numérico.
 *
 *  FIX — AUTORIZACIÓN (rol Bodega rechazado): USUARIOS.obtenerRolAutorizado()
 *  usaba /[\\u0300-\\u036f]/ (barra doble) y borraba todas las mayúsculas, de
 *  modo que "Bodega" -> "odega". Ahora usuario/rol/estado se normalizan con
 *  USUARIOS.normalizar() y las columnas se ubican por encabezado (A..G de respaldo).
 *    6) Doble modificación: doPost actualiza Snapshot_Stock (SNAPSHOT.fijarEstado)
 *       para que la sincronización automática no registre el mismo cambio.
 * =============================================================================
 */


/* ============================================================================
 * MÓDULO: CONFIGURACIÓN
 * ========================================================================= */

const CONFIG = {

  SS_ID: "1w8Kl6AO-ozKf6XsJIMr_Tzi-g7VocXCpViMOenM7eHk",
    // Bodega SPS
  SS_SPS_ID: "16LYBR2UHUKEqGYqcVhR8qPqgsSu4pu6u7hWY-DtJhtY",
  SS_SPS_HOJA_PRODUCTOS: "Productos",

  SS_MOVIMIENTOS_ID: "1pWHry-sFsAEuWf_-riKOUjB3vGlCV0yHvhLXyo9pzuE",

  SS_VENCIMIENTOS_ID: "1dEfvx0bWm4y-J0Lc4tgCBAJPTQtrCvfwg8f79P8nBsI",

  NOMBRE_HOJA_MOVIMIENTOS: "Movimientos",

  // Hoja de control que guarda el último stock conocido por cada
  // combinación producto+lote. Es la fuente de verdad para decidir si un
  // cambio de stock es real y si ya fue registrado.
  NOMBRE_HOJA_SNAPSHOT: "Snapshot_Stock",
  ENCABEZADOS_SNAPSHOT: ["Clave", "SKU", "Proveedor", "Ubicación", "Slot", "Lote", "Producto", "Stock", "Actualizado"],

  // Hojas del Sheet de inventario que NO contienen productos.
  HOJAS_EXCLUIR: [
    "Resumen", "Config", "Sheet1", "Productos", "Pedidos",
    "Detalle_Pedidos", "Equipos_Categorias", "Carrusel", "Noticias"
  ],

  // Hojas que se interpretan con el layout de materiales/repuestos.
  HOJAS_MATERIALES: ["Materiales", "Repuestos", "MATERIALES", "REPUESTOS"],

  // Hojas con estructura de dos niveles (grupo principal + subcategoría).
  HOJAS_DOS_NIVELES: ["Pruebas Especiales SNIBE"],

  // Umbral de stock bajo.
  STOCK_BAJO_UMBRAL: 5,

  // Valores que jamás deben interpretarse como un SKU o nombre válido.
  SKU_IGNORAR:    ["cellimage", "celimage", "sku", "código", "codigo"],
  NOMBRE_IGNORAR: ["portafolio", "producto", "descripcion", "descripción", "nombre"],

  MESES_ES: ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"],
};


/* ============================================================================
 * MÓDULO: CACHÉ
 * ========================================================================= */

const CACHE = {

  KEY_INVENTARIO: "inventario_cache_v9",
  KEY_RESUMEN: "inventario_resumen_cache_v2",
  KEY_SPS: "inventario_sps_cache_v2",
  KEY_MOVIMIENTOS_PREFIX: "movimientos_cache_v1",

  TTL_INVENTARIO: 300,
  TTL_RESUMEN: 300,
  TTL_SPS: 300,
  TTL_MOVIMIENTOS: 60,

  // Cada bloque queda por debajo del límite de CacheService
  TAMANO_BLOQUE: 70000,

  get(clave) {

    try {

      const cache = CacheService.getScriptCache();

      // Intentar primero una entrada normal
      const valorDirecto = cache.get(clave);

      if (valorDirecto) {
        try {
          return JSON.parse(valorDirecto);
        } catch (e) {
          // Puede ser un manifiesto de bloques.
        }
      }

      // Buscar manifiesto de bloques
      const manifiestoTexto = cache.get(clave + "_manifest");

      if (!manifiestoTexto) {
        return null;
      }

      const manifiesto = JSON.parse(manifiestoTexto);

      if (!manifiesto || !manifiesto.partes) {
        return null;
      }

      // Recuperar todos los bloques
      const claves = [];

      for (let i = 0; i < manifiesto.partes; i++) {
        claves.push(clave + "_part_" + i);
      }

      const partes = cache.getAll(claves);

      let jsonCompleto = "";

      for (let i = 0; i < manifiesto.partes; i++) {

        const parte = partes[clave + "_part_" + i];

        if (!parte) {
          Logger.log("CACHE incompleta: falta bloque " + i + " de " + clave);
          return null;
        }

        jsonCompleto += parte;
      }

      return JSON.parse(jsonCompleto);

    } catch (e) {

      Logger.log("CACHE.get error (" + clave + "): " + e);
      return null;
    }
  },


  put(clave, datos, ttlSegundos) {

    try {

      const cache = CacheService.getScriptCache();

      const valor = JSON.stringify(datos);

      // Si cabe en una sola entrada
      if (valor.length <= CACHE.TAMANO_BLOQUE) {

        cache.put(clave, valor, ttlSegundos);

        // Eliminar manifiesto anterior
        cache.remove(clave + "_manifest");

        return;
      }

      // Dividir en bloques
      const partes = [];

      for (let inicio = 0; inicio < valor.length; inicio += CACHE.TAMANO_BLOQUE) {
        partes.push(valor.substring(inicio, inicio + CACHE.TAMANO_BLOQUE));
      }

      const datosCache = {};

      partes.forEach((parte, i) => {
        datosCache[clave + "_part_" + i] = parte;
      });

      // Guardar bloques
      cache.putAll(datosCache, ttlSegundos);

      // Guardar manifiesto
      cache.put(
        clave + "_manifest",
        JSON.stringify({ partes: partes.length }),
        ttlSegundos
      );

      // Eliminar versión directa anterior
      cache.remove(clave);

      Logger.log("CACHE guardada en " + partes.length + " bloques: " + clave);

    } catch (e) {

      Logger.log("CACHE.put error (" + clave + "): " + e);

    }
  },


  remove(clave) {

    try {

      const cache = CacheService.getScriptCache();

      // Eliminar entrada normal
      cache.remove(clave);

      // Eliminar manifiesto y bloques
      const manifiestoTexto = cache.get(clave + "_manifest");

      if (manifiestoTexto) {

        try {

          const manifiesto = JSON.parse(manifiestoTexto);

          const claves = [];

          for (let i = 0; i < manifiesto.partes; i++) {
            claves.push(clave + "_part_" + i);
          }

          if (claves.length) {
            cache.removeAll(claves);
          }

        } catch (e) {
          Logger.log("Error eliminando bloques de cache: " + e);
        }

      }

      cache.remove(clave + "_manifest");

    } catch (e) {

      Logger.log("CACHE.remove error (" + clave + "): " + e);

    }
  },


  claveMovimientos(fecha) {

    return CACHE.KEY_MOVIMIENTOS_PREFIX + "_" + (fecha || "todas");

  },


  invalidarInventario() {

    CACHE.remove(CACHE.KEY_INVENTARIO);

    CACHE.remove(CACHE.KEY_RESUMEN);

    if (
      typeof INVENTARIO_RAPIDO !== "undefined" &&
      INVENTARIO_RAPIDO.invalidar
    ) {
      INVENTARIO_RAPIDO.invalidar();
    }

  },


  invalidarSPS() {

    CACHE.remove(CACHE.KEY_SPS);

  },


  invalidarMovimientos() {

    CACHE.remove(CACHE.claveMovimientos(""));

    const hoy = Utilities.formatDate(
      new Date(),
      Session.getScriptTimeZone(),
      "yyyy-MM-dd"
    );

    CACHE.remove(CACHE.claveMovimientos(hoy));

  },


  invalidarTodo() {

    CACHE.invalidarInventario();

    CACHE.invalidarSPS();

    CACHE.invalidarMovimientos();

  }

};


/* ============================================================================
 * MÓDULO: SNAPSHOT RÁPIDO DE INVENTARIO
 * Guarda una copia persistente del inventario para evitar leer todas las
 * hojas de Google Sheets en cada apertura de la aplicación.
 * ============================================================================ */

const INVENTARIO_RAPIDO = {

  KEY: "INVENTARIO_SNAPSHOT_RAPIDO_V1",
  PREFIJO: "INVENTARIO_SNAPSHOT_RAPIDO_PARTE_",
  TAMANO_PARTE: 8000,

  guardar(datos) {

    const props = PropertiesService.getScriptProperties();

    // Eliminar partes anteriores
    const actuales = props.getProperties();

    Object.keys(actuales).forEach(key => {
      if (key.indexOf(this.PREFIJO) === 0) {
        props.deleteProperty(key);
      }
    });

    const texto = JSON.stringify(datos);

    const partes = [];

    for (let inicio = 0; inicio < texto.length; inicio += this.TAMANO_PARTE) {
      partes.push(texto.substring(inicio, inicio + this.TAMANO_PARTE));
    }

    partes.forEach((parte, i) => {
      props.setProperty(this.PREFIJO + i, parte);
    });

    props.setProperty(
      this.KEY,
      JSON.stringify({
        partes: partes.length,
        actualizado: new Date().toISOString()
      })
    );

    Logger.log("SNAPSHOT RÁPIDO guardado: " + partes.length + " partes");
  },


  obtener() {

    try {

      const props = PropertiesService.getScriptProperties();

      // Leer TODAS las propiedades en una sola operación
      const todas = props.getProperties();

      const manifiestoTexto = todas[this.KEY];

      if (!manifiestoTexto) {
        return null;
      }

      const manifiesto = JSON.parse(manifiestoTexto);

      if (!manifiesto || !manifiesto.partes) {
        return null;
      }

      let texto = "";

      // Recuperar las partes desde la memoria ya cargada
      for (let i = 0; i < manifiesto.partes; i++) {

        const parte = todas[this.PREFIJO + i];

        if (!parte) {
          Logger.log("Falta parte del snapshot: " + i);
          return null;
        }

        texto += parte;
      }

      return JSON.parse(texto);

    } catch (e) {

      Logger.log("Error obteniendo snapshot rápido: " + e);
      return null;
    }
  },

  invalidar() {

    const props = PropertiesService.getScriptProperties();

    props.deleteProperty(this.KEY);

    const actuales = props.getProperties();

    Object.keys(actuales).forEach(key => {
      if (key.indexOf(this.PREFIJO) === 0) {
        props.deleteProperty(key);
      }
    });

    Logger.log("SNAPSHOT RÁPIDO DE INVENTARIO INVALIDADO");
  },

  actualizar() {

    const inicio = Date.now();

    const datos = INVENTARIO.leerSheets();

    this.guardar(datos);

    Logger.log("SNAPSHOT INVENTARIO actualizado en " + (Date.now() - inicio) + " ms");

    return datos;
  }

};

/* ============================================================================
 * MÓDULO: REGISTRO DESDE ALMACÉN
 * Entradas y salidas realizadas desde la aplicación web (doPost).
 * ============================================================================ */

/** Convierte el texto de vencimiento a Date local a medianoche (sin horas). */
function parsearFechaVencimiento_(valor) {

  if (valor instanceof Date) {
    if (isNaN(valor.getTime())) return null;
    return new Date(valor.getFullYear(), valor.getMonth(), valor.getDate());
  }

  const t = String(valor || "").trim();

  if (!t) return null;

  // yyyy-mm-dd  o  yyyy/mm/dd  (formato del input type="date")
  let m = t.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  // dd/mm/yyyy  o  dd-mm-yyyy
  m = t.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
  if (m) {
    return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  }

  // dd mmm yyyy (formato de visualización de las hojas: "12 ago 2026")
  m = t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .match(/^(\d{1,2})\s+([a-z]{3})\.?\s+(\d{4})$/);
  if (m) {
    const mes = CONFIG.MESES_ES.indexOf(m[2]);
    if (mes >= 0) return new Date(Number(m[3]), mes, Number(m[1]));
  }

  const d = new Date(t);

  if (isNaN(d.getTime())) return null;

  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Escribe (o limpia, si valor es "") una celda de la hoja SIN destruir
 * fórmulas: si la celda tiene una fórmula, no se toca. col es base cero.
 */
function escribirSiNoFormula_(hoja, fila, col, valor) {
  if (col < 0) return;
  const celda = hoja.getRange(fila, col + 1);
  if (celda.getFormula()) return;
  if (valor === "" || valor === null || valor === undefined) {
    celda.clearContent();
  } else {
    // Un número (p. ej. DIF. DIAS) se guarda con formato numérico simple para
    // que no quede oculto por un formato de fecha/texto heredado de la celda.
    if (typeof valor === "number") celda.setNumberFormat("0");
    celda.setValue(valor);
  }
}

/** Días entre hoy y la fecha (solo fechas, sin horas). */
function diasHastaFecha_(fecha) {

  const ahora = new Date();

  const hoy = new Date(
    ahora.getFullYear(),
    ahora.getMonth(),
    ahora.getDate()
  );

  return Math.round((fecha.getTime() - hoy.getTime()) / 86400000);
}

/** Misma lógica de ESTADO que ya existía. */
function estadoPorDias_(dias) {

  if (dias >= 121) return "VIGENTE";
  if (dias >= 50) return "POR VENCER";
  if (dias >= 1) return "URGENTE";
  return "VENCIDO";
}


/**
 * Registra movimientos exclusivamente en SPS (una fila por lote).
 * Los encabezados se detectan sin depender de mayúsculas o tildes.
 */
function registrarMovimientoSPS_(m) {
  const ss = SpreadsheetApp.openById(CONFIG.SS_SPS_ID);
  const hoja = ss.getSheetByName(CONFIG.SS_SPS_HOJA_PRODUCTOS);
  if (!hoja) throw new Error('No se encontró la hoja Productos de SPS.');

  const rango = hoja.getDataRange();
  const valores = rango.getValues();
  if (!valores.length) throw new Error('La hoja Productos de SPS está vacía.');
  const normalizar = v => String(v == null ? '' : v).trim().toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const headers = valores[0].map(normalizar);
  const col = {
    sku: headers.indexOf('CODIGO'), nombre: headers.indexOf('DESCRIPCION'),
    lote: headers.indexOf('LOTE'), cantidad: headers.indexOf('CANTIDAD'),
    vence: headers.indexOf('VENCE'), codigoUnico: headers.indexOf('CODIGO_UNICO'),
    ubicacion: headers.indexOf('UBICACION')
  };
  if ([col.sku,col.nombre,col.lote,col.cantidad].some(i => i < 0)) {
    throw new Error('SPS requiere las columnas CODIGO, DESCRIPCION, LOTE y CANTIDAD.');
  }

  const skuEntrada = String(m.sku || '').trim();
  const skuCorto = skuEntrada.split(/\s+-\s+/)[0].trim();
  const skuNorm = normalizar(skuEntrada);
  const skuCortoNorm = normalizar(skuCorto);
  const filasProducto = [];
  for (let r = 1; r < valores.length; r++) {
    const codigo = normalizar(valores[r][col.sku]);
    if (codigo && (codigo === skuNorm || codigo === skuCortoNorm)) filasProducto.push(r);
  }
  if (!filasProducto.length) throw new Error('No se encontró el producto en SPS: ' + skuEntrada);

  const loteNorm = normalizar(m.lote);
  let filaLote = filasProducto.find(r => normalizar(valores[r][col.lote]) === loteNorm);
  let loteCreado = false;
  const nombre = String(valores[filasProducto[0]][col.nombre] || '').trim();
  let stockAnterior = 0;
  let stockNuevo = 0;

  if (filaLote === undefined && m.sinLote) {
    throw new Error('No se encontró en SPS el producto ' + skuEntrada + ' sin lote. Debe existir en la hoja Productos de SPS con la columna LOTE vacía.');
  }

  if (filaLote === undefined) {
    if (m.tipo !== 'entrada') throw new Error('El lote indicado no existe para este producto en SPS.');
    // Un lote nuevo se agrega como fila independiente copiando los datos del producto.
    filaLote = hoja.getLastRow();
    const filaNueva = valores[filasProducto[0]].slice();
    filaNueva[col.lote] = m.lote;
    filaNueva[col.cantidad] = 0;
    if (col.vence >= 0) filaNueva[col.vence] = parsearFechaVencimiento_(m.vencimiento) || '';
    if (col.codigoUnico >= 0) filaNueva[col.codigoUnico] = skuCorto + '-' + String(m.lote).replace(/\s+/g,'') + '-' + Date.now();
    hoja.appendRow(filaNueva);
    filaLote = hoja.getLastRow() - 1; // índice base cero para valores/identificación
    loteCreado = true;
    stockAnterior = 0;
  } else {
    stockAnterior = Number(valores[filaLote][col.cantidad]) || 0;
  }

  if (m.tipo === 'salida' && m.cantidad > stockAnterior) {
    throw new Error('No hay suficiente existencia en el lote de SPS. Stock disponible: ' + stockAnterior);
  }
  stockNuevo = m.tipo === 'entrada' ? stockAnterior + m.cantidad : stockAnterior - m.cantidad;
  // filaLote está en índice base cero, Sheets usa base uno.
  hoja.getRange(filaLote + 1, col.cantidad + 1).setValue(stockNuevo);
  if (m.tipo === 'entrada' && col.vence >= 0 && m.vencimiento && loteCreado) {
    const fecha = parsearFechaVencimiento_(m.vencimiento);
    if (fecha) hoja.getRange(filaLote + 1, col.vence + 1).setValue(fecha);
  }

  const codigoFinal = String(valores[filasProducto[0]][col.sku] || skuCorto).trim();
  const ubicacion = col.ubicacion >= 0 ? String(hoja.getRange(filaLote + 1, col.ubicacion + 1).getValue() || '').trim() : '';
  try {
    SNAPSHOT.fijarEstado({
      clave: SNAPSHOT.construirClave(codigoFinal, 'SPS', ubicacion, m.sinLote ? 'SIN_LOTE' : String(m.lote)),
      sku: codigoFinal, proveedor: 'SPS', ubicacion: ubicacion, slot: m.sinLote ? 'SIN_LOTE' : String(m.lote),
      lote: m.lote, producto: nombre, stock: stockNuevo
    });
  } catch (errSnap) { Logger.log('No se pudo actualizar snapshot SPS: ' + errSnap); }

  const movimientoSpsOk = MOVIMIENTOS.registrar({
    usuario: USUARIOS.obtenerUsuarioActual(), producto: nombre, sku: codigoFinal,
    lote: m.lote, movimiento: m.tipo === 'entrada' ? 'Entrada' : 'Salida',
    stockAnterior: stockAnterior, stockNuevo: stockNuevo, cliente: m.cliente || '',
    factura: m.factura || m.documento || '', cantidad: m.cantidad,
    observacion: (m.observacion ? m.observacion + ' | ' : '') + 'Bodega: SPS'
  });
  CACHE.invalidarInventario();
  CACHE.invalidarMovimientos();
  return ContentService.createTextOutput(JSON.stringify({
    success: true,
    message: m.tipo === 'entrada' ? 'Entrada registrada correctamente en SPS.' : 'Salida registrada correctamente en SPS.',
    producto: nombre, lote: m.lote, cantidad: m.cantidad,
    stockAnterior: stockAnterior, stockNuevo: stockNuevo, bodega: 'SPS',
    movimientoRegistrado: movimientoSpsOk,
    advertencia: movimientoSpsOk ? '' : 'El inventario se actualizó, pero NO se pudo guardar el movimiento en el historial. Revise la hoja Movimientos.'
  })).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {

  try {

    if (!e || !e.postData || !e.postData.contents) {
      throw new Error("No se recibieron datos.");
    }

    const datos = JSON.parse(e.postData.contents);

    if (datos.action !== "registrarMovimiento") {
      throw new Error("Acción no válida.");
    }
    const tokenSesion = String(datos.token || "").trim();
    const sesion = USUARIOS.validarSesion(tokenSesion);

    // 1) El token debe corresponder a una sesión vigente (6 h en caché).
    if (!sesion) {
      const errSesion = new Error("Su sesión no es válida o ya venció. Cierre sesión e ingrese nuevamente.");
      errSesion.codigo = "SESION_INVALIDA";
      throw errSesion;
    }

    // 2) El rol y el estado se consultan SIEMPRE en la hoja Usuarios; no se
    //    confía en el rol enviado por el navegador ni en el guardado en sesión.
    const rolActual = USUARIOS.obtenerRolAutorizado(sesion);
    if (["administrador", "bodega"].indexOf(rolActual) === -1) {
      const errRol = new Error("No autorizado: solo un usuario activo con rol Administrador o Bodega puede registrar movimientos.");
      errRol.codigo = "SIN_PERMISO";
      throw errRol;
    }

    const tipo = String(datos.tipo || "").toLowerCase().trim();
    Logger.log("TIPO RECIBIDO: [" + tipo + "]");
    // Nunca registrar el token en los logs.
    const datosLog = Object.assign({}, datos);
    delete datosLog.token;
    Logger.log("DATOS RECIBIDOS: " + JSON.stringify(datosLog));
    // Acepta tanto el SKU puro como el formato antiguo "SKU - Nombre".
    // Algunos navegadores pueden conservar temporalmente el valor combinado del datalist.
    const productoRecibido = String(datos.producto || datos.sku || "").trim();
    const sku = productoRecibido.split(/\s+-\s+/)[0].trim();
    const lote = String(datos.lote || "").trim();
    const cantidad = Number(datos.cantidad || 0);
    const vencimiento = String(datos.vencimiento || "").trim();
    const cliente = String(datos.cliente || "").trim();
    const factura = String(datos.factura || datos.documento || datos.numeroFactura || "").trim();
    const observacion = String(datos.observacion || "").trim();

    if (!sku) {
      throw new Error("Debe indicar el producto.");
    }

    // Los Materiales/Repuestos no manejan lotes: el frontend envía "SIN_LOTE"
    // (o vacío). El servidor decide por el tipo de hoja; para un reactivo, el
    // lote sigue siendo obligatorio (se valida más abajo).
    const sinLote = lote.toUpperCase().replace(/[_\s]/g, "") === "" ||
                    lote.toUpperCase().replace(/[_\s]/g, "") === "SINLOTE";

    // "__NUEVO_LOTE__" es solo un valor interno del SELECT del frontend:
    // jamás debe llegar a Sheets.
    if (lote.toUpperCase().replace(/_/g, "").replace(/\s+/g, "") === "NUEVOLOTE") {
      throw new Error("Debe escribir el número del nuevo lote.");
    }

    if (!cantidad || cantidad <= 0) {
      throw new Error("La cantidad debe ser mayor que cero.");
    }

    if (tipo !== "entrada" && tipo !== "salida") {
      throw new Error("Tipo de movimiento no válido.");
    }

    if (tipo === "salida" && !cliente) {
      throw new Error("Debe indicar el nombre del cliente.");
    }

    const bodega = String(datos.bodega || "Tegus").trim().toUpperCase();

    // SPS tiene una estructura distinta: una fila por lote en la hoja Productos.
    // Se procesa en su propia hoja y nunca se busca/modifica en el inventario Tegus.
    if (bodega === "SPS" || bodega === "SAN PEDRO SULA") {
      return registrarMovimientoSPS_( {
        tipo: tipo,
        sku: sku,
        sinLote: sinLote,
        lote: sinLote ? "" : lote,
        cantidad: cantidad,
        vencimiento: vencimiento,
        cliente: cliente,
        factura: factura,
        documento: factura,
        observacion: observacion
      });
    }

    if (bodega !== "TEGUS" && bodega !== "TEGUCIGALPA") {
      throw new Error("Bodega no válida. Seleccione Tegus o SPS.");
    }

    const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
    const hojas = ss.getSheets();

    let encontrado = false;
    let productoNombre = "";
    let stockAnterior = 0;
    let stockNuevo = 0;
    let movimientoRegistrado = true;

    for (const hoja of hojas) {

      if (CONFIG.HOJAS_EXCLUIR.includes(hoja.getName())) {
        continue;
      }

      const datosHoja = hoja.getDataRange().getValues();

      for (let fila = 0; fila < datosHoja.length; fila++) {

        const encabezados = datosHoja[fila].map(x =>
          String(x || "").replace(/[\u00A0\u200B-\u200D\uFEFF]/g, "").trim()
        );

        const idxCodigo = encabezados.findIndex(h =>
          /^(c[oó]digo|sku|c[oó]digo del producto)$/i.test(h)
        );

        const idxProducto = encabezados.findIndex(h =>
          /^(producto|descripci[oó]n|nombre|art[ií]culo)(\s*\([^)]*\))?$/i.test(h)
        );

        const idxUbicacion = encabezados.findIndex(h =>
          /^ubicaci[oó]n$/i.test(h)
        );

        const idxTotalExis = encabezados.findIndex(h =>
          /total\s*exist/i.test(h)
        );

        const idxLote1 = encabezados.findIndex(h =>
          /^lote\s*1$/i.test(h)
        );

        const idxLote2 = encabezados.findIndex(h =>
          /^lote\s*2$/i.test(h)
        );

        const idxLote3 = encabezados.findIndex(h =>
          /^lote\s*3$/i.test(h)
        );

        const idxLote4 = encabezados.findIndex(h =>
          /^lote\s*4$/i.test(h)
        );

        const idxVenc1 = encabezados.findIndex(h =>
          /^venci\.?\s*1$/i.test(h)
        );

        const idxVenc2 = encabezados.findIndex(h =>
          /^venci\.?\s*2$/i.test(h)
        );

        const idxVenc3 = encabezados.findIndex(h =>
          /^venci\.?\s*3$/i.test(h)
        );

        const idxVenc4 = encabezados.findIndex(h =>
          /^venci\.?\s*4$/i.test(h)
        );

        const idxExis1 = encabezados.findIndex(h =>
          /^exis\.?\s*1$/i.test(h)
        );

        const idxExis2 = encabezados.findIndex(h =>
          /^exis\.?\s*2$/i.test(h)
        );

        const idxExis3 = encabezados.findIndex(h =>
          /^exis\.?\s*3$/i.test(h)
        );

        const idxExis4 = encabezados.findIndex(h =>
          /^exis\.?\s*4$/i.test(h)
        );

        // Reconoce "DIF. DIAS n", "DIF. DE DIAS n", "DIFERENCIA DE DIAS n",
        // con tildes, puntos, espacios raros o saltos de línea. Si el nombre
        // no se reconoce, se usa la columna que está entre VENCI. n y ESTADO n.
        const limpiarEnc = h => String(h || "")
          .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
          .toLowerCase().replace(/[^a-z0-9]/g, "");

        const buscarDif = (n, idxVenc, idxEstado) => {
          const porNombre = encabezados.findIndex(h =>
            new RegExp("^dif(erencia)?(de)?dias?" + n + "$").test(limpiarEnc(h))
          );
          if (porNombre >= 0) return porNombre;
          if (idxVenc >= 0 && idxEstado >= 0 && idxEstado - idxVenc === 2) {
            return idxVenc + 1;
          }
          return -1;
        };

        const buscarEstado = n =>
          encabezados.findIndex(h =>
            new RegExp("^estado\\s*" + n + "$", "i").test(h)
          );

        if (idxCodigo < 0 || idxProducto < 0) {
          continue;
        }

        /* ==========================================
           BUSCAR EL PRODUCTO EN TODAS LAS FILAS DE
           ESTA SECCIÓN (desde la fila siguiente al
           encabezado hasta el próximo encabezado o
           el final de la hoja).
        ========================================== */

        let filaProducto = -1;

        for (let f = fila + 1; f < datosHoja.length; f++) {

          const posibleEncabezado = datosHoja[f].map(x =>
            String(x || "").trim()
          );

          const esOtroEncabezado =
            posibleEncabezado.findIndex(h => /^(c[oó]digo|sku|c[oó]digo del producto)$/i.test(h)) >= 0 &&
            posibleEncabezado.findIndex(h =>
              /^(producto|descripci[oó]n|nombre|art[ií]culo)(\s*\([^)]*\))?$/i.test(h)
            ) >= 0;

          if (esOtroEncabezado) {
            break; // Llegamos a la siguiente sección sin encontrarlo.
          }

          // Normalizar códigos de Sheets: pueden venir como número, texto,
          // con espacios invisibles o en el formato antiguo "SKU - Nombre".
          const normalizarCodigo = valor => String(valor == null ? "" : valor)
            .replace(/[\u00A0\u200B-\u200D\uFEFF]/g, "")
            .trim()
            .split(/\s+-\s+/)[0]
            .trim()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, "");
          const valorCodigo = normalizarCodigo(datosHoja[f][idxCodigo]);
          const skuBuscado = normalizarCodigo(sku);
          // Algunas hojas tienen celdas combinadas o columnas desplazadas;
          // primero validamos la columna CODIGO y, como respaldo, buscamos el
          // código en la fila del producto sin confundirlo con el nombre.
          const codigoEnFila = datosHoja[f].some(valor =>
            normalizarCodigo(valor) === skuBuscado
          );

          if (skuBuscado && (valorCodigo === skuBuscado || codigoEnFila)) {
            filaProducto = f;
            break;
          }

        }

        if (filaProducto < 0) {
          continue; // No está en esta sección; seguir con la siguiente.
        }

        const filaReal = filaProducto + 1;

        productoNombre =
          String(datosHoja[filaProducto][idxProducto] || "").trim();

        const ubicacionProducto =
          idxUbicacion >= 0
            ? String(datosHoja[filaProducto][idxUbicacion] || "").trim()
            : "";

        /* ==========================================
           MATERIALES / REPUESTOS (sin lotes): se suma o
           descuenta directamente en la columna de existencia.
        ========================================== */

        if (CONFIG.HOJAS_MATERIALES.includes(hoja.getName())) {

          const idxMat = INVENTARIO.buildIdxMaterial(encabezados);

          if (idxMat.exis1 < 0) {
            throw new Error("No se encontró la columna de existencia en la hoja " + hoja.getName() + ".");
          }

          const celdaExistencia = hoja.getRange(filaReal, idxMat.exis1 + 1);

          if (celdaExistencia.getFormula()) {
            throw new Error("La existencia de este producto es una fórmula en la hoja " + hoja.getName() + "; no se puede modificar desde el sistema.");
          }

          const stockMaterial = Number(datosHoja[filaProducto][idxMat.exis1]) || 0;

          stockAnterior = stockMaterial;

          if (tipo === "salida" && cantidad > stockMaterial) {
            throw new Error("No hay suficiente existencia. Stock disponible: " + stockMaterial);
          }

          stockNuevo = tipo === "entrada"
            ? stockMaterial + cantidad
            : stockMaterial - cantidad;

          celdaExistencia.setValue(stockNuevo);

          encontrado = true;

          const skuHoja = String(datosHoja[filaProducto][idxCodigo] || "").trim() || sku;

          try {
            SNAPSHOT.fijarEstado({
              clave: SNAPSHOT.construirClave(skuHoja, hoja.getName(), ubicacionProducto, "TOTAL"),
              sku: skuHoja,
              proveedor: hoja.getName(),
              ubicacion: ubicacionProducto,
              slot: "TOTAL",
              lote: "",
              producto: productoNombre,
              stock: stockNuevo
            });
          } catch (errSnapMat) {
            Logger.log("No se pudo actualizar el snapshot (material): " + errSnapMat);
          }

          movimientoRegistrado = MOVIMIENTOS.registrar({
            usuario: USUARIOS.obtenerUsuarioActual(),
            producto: productoNombre,
            sku: skuHoja,
            lote: "",
            movimiento: tipo === "entrada" ? "Entrada" : "Salida",
            stockAnterior: stockAnterior,
            stockNuevo: stockNuevo,
            cliente: cliente,
            factura: factura,
            cantidad: cantidad,
            observacion: observacion
          });

          break;

        }

        // Un reactivo sí necesita lote.
        if (sinLote) {
          throw new Error("Debe indicar el lote.");
        }

        const lotes = [
          {
            n: 1,
            lote: idxLote1,
            venc: idxVenc1,
            exis: idxExis1,
            dif: buscarDif(1, idxVenc1, buscarEstado(1)),
            estado: buscarEstado(1)
          },
          {
            n: 2,
            lote: idxLote2,
            venc: idxVenc2,
            exis: idxExis2,
            dif: buscarDif(2, idxVenc2, buscarEstado(2)),
            estado: buscarEstado(2)
          },
          {
            n: 3,
            lote: idxLote3,
            venc: idxVenc3,
            exis: idxExis3,
            dif: buscarDif(3, idxVenc3, buscarEstado(3)),
            estado: buscarEstado(3)
          },
          {
            n: 4,
            lote: idxLote4,
            venc: idxVenc4,
            exis: idxExis4,
            dif: buscarDif(4, idxVenc4, buscarEstado(4)),
            estado: buscarEstado(4)
          }
        ];

        let posicion = null;

        /* ==========================================
           BUSCAR LOTE EXISTENTE
        ========================================== */

        for (const l of lotes) {

          if (l.lote < 0) continue;

          const valorLote =
            String(datosHoja[filaProducto][l.lote] || "").trim();

          if (
            valorLote &&
            valorLote.toUpperCase() === lote.toUpperCase()
          ) {
            posicion = l;
            break;
          }

        }

        /* ==========================================
           SI ES ENTRADA Y EL LOTE NO EXISTE,
           BUSCAR ESPACIO LIBRE
        ========================================== */

        if (!posicion && tipo === "entrada") {

          for (const l of lotes) {

            if (l.lote < 0) continue;

            const valorLote =
              String(datosHoja[filaProducto][l.lote] || "").trim();

            if (!valorLote) {
              posicion = l;
              break;
            }

          }

        }

        if (!posicion) {
          throw new Error(
            tipo === "entrada"
              ? "No hay espacio disponible para un nuevo lote."
              : "El lote indicado no existe para este producto."
          );
        }

        if (posicion.exis < 0) {
          throw new Error("No se encontró la columna de existencia.");
        }

        const loteActual =
          String(
            datosHoja[filaProducto][posicion.lote] || ""
          ).trim();

        // Si el slot estaba libre, su existencia previa cuenta como 0.
        const stockActual =
          loteActual
            ? (Number(datosHoja[filaProducto][posicion.exis]) || 0)
            : 0;

        stockAnterior = stockActual;

        /* ==========================================
           ENTRADA
        ========================================== */

        if (tipo === "entrada") {

          stockNuevo = stockActual + cantidad;

          if (!loteActual) {

            // ==============================
            // LOTE NUEVO: GUARDAR NÚMERO DE LOTE
            // ==============================

            hoja
              .getRange(filaReal, posicion.lote + 1)
              .setValue(lote);

            // ==============================
            // LOTE NUEVO: VENCIMIENTO, DIF. DIAS Y ESTADO
            // ==============================

            const fechaVenc = parsearFechaVencimiento_(vencimiento);

            if (fechaVenc && posicion.venc >= 0) {

              const celdaVencimiento =
                hoja.getRange(filaReal, posicion.venc + 1);

              celdaVencimiento.setValue(fechaVenc);

              // Mismo formato que los demás vencimientos
              celdaVencimiento.setNumberFormat("dd mmm yyyy");

            }

            if (fechaVenc) {

              const dias = diasHastaFecha_(fechaVenc);

              if (posicion.dif < 0) {
                Logger.log("AVISO: no se encontró la columna DIF. DIAS " + posicion.n + " en la hoja " + hoja.getName());
              }

              escribirSiNoFormula_(hoja, filaReal, posicion.dif, dias);
              escribirSiNoFormula_(hoja, filaReal, posicion.estado, estadoPorDias_(dias));

            } else {

              // Lote nuevo sin vencimiento: no dejar restos del lote anterior.
              if (posicion.venc >= 0) {
                hoja.getRange(filaReal, posicion.venc + 1).clearContent();
              }
              if (posicion.dif >= 0) {
                hoja.getRange(filaReal, posicion.dif + 1).clearContent();
              }
              if (posicion.estado >= 0) {
                hoja.getRange(filaReal, posicion.estado + 1).clearContent();
              }

            }

          }

          else {

            // LOTE EXISTENTE: se suma la existencia en su mismo slot, se
            // conserva el vencimiento y se recalculan DIF. DIAS y ESTADO a
            // partir de ese vencimiento (si el lote estaba en 0 y tenía esas
            // celdas vacías, vuelven a completarse). No se toca otro lote.
            const fechaExistente = posicion.venc >= 0
              ? parsearFechaVencimiento_(datosHoja[filaProducto][posicion.venc])
              : null;

            if (fechaExistente) {
              const diasExistente = diasHastaFecha_(fechaExistente);
              escribirSiNoFormula_(hoja, filaReal, posicion.dif, diasExistente);
              escribirSiNoFormula_(hoja, filaReal, posicion.estado, estadoPorDias_(diasExistente));
            }

          }

          hoja
            .getRange(filaReal, posicion.exis + 1)
            .setValue(stockNuevo);

        }

        /* ==========================================
           SALIDA
        ========================================== */

        else {

          if (cantidad > stockActual) {
            throw new Error(
              "No hay suficiente existencia en el lote. " +
              "Stock disponible: " + stockActual
            );
          }

          stockNuevo = stockActual - cantidad;

          // Solo se modifica el slot del lote seleccionado.
          hoja.getRange(filaReal, posicion.exis + 1).setValue(stockNuevo);

          if (stockNuevo === 0) {

            // Lote agotado: se libera SOLO este slot (LOTE, VENCI., DIF. DIAS,
            // ESTADO y EXIS.) para que quede disponible para un lote nuevo.
            // Las celdas con fórmula no se tocan. Los demás lotes no cambian.
            escribirSiNoFormula_(hoja, filaReal, posicion.lote, "");
            escribirSiNoFormula_(hoja, filaReal, posicion.venc, "");
            escribirSiNoFormula_(hoja, filaReal, posicion.dif, "");
            escribirSiNoFormula_(hoja, filaReal, posicion.estado, "");
            hoja.getRange(filaReal, posicion.exis + 1).clearContent();

          } else if (posicion.venc >= 0) {

            // Salida parcial: el vencimiento no se borra; se recalculan los
            // días y el estado a partir de la fecha ya guardada.
            const fechaConservada = parsearFechaVencimiento_(datosHoja[filaProducto][posicion.venc]);

            if (fechaConservada) {
              const diasRestantes = diasHastaFecha_(fechaConservada);
              escribirSiNoFormula_(hoja, filaReal, posicion.dif, diasRestantes);
              escribirSiNoFormula_(hoja, filaReal, posicion.estado, estadoPorDias_(diasRestantes));
            }

          }

        }

        // Mantener coherente el TOTAL EXIST. cuando la hoja lo guarda como
        // valor fijo (si es una fórmula, se respeta y se recalcula sola).
        if (idxTotalExis >= 0) {

          let totalLotes = 0;

          for (const l of lotes) {

            if (l.lote < 0 || l.exis < 0) continue;

            const hayLote = (l === posicion)
              ? true
              : String(datosHoja[filaProducto][l.lote] || "").trim() !== "";

            if (!hayLote) continue;

            totalLotes += (l === posicion)
              ? stockNuevo
              : (Number(datosHoja[filaProducto][l.exis]) || 0);

          }

          escribirSiNoFormula_(hoja, filaReal, idxTotalExis, totalLotes);

        }

        encontrado = true;

        /* ==========================================
           ACTUALIZAR SNAPSHOT (evita que la sincronización
           automática registre este mismo cambio otra vez)
        ========================================== */

        try {

          SNAPSHOT.fijarEstado({
            clave: SNAPSHOT.construirClave(
              sku,
              hoja.getName(),
              ubicacionProducto,
              "L" + posicion.n
            ),
            sku: sku,
            proveedor: hoja.getName(),
            ubicacion: ubicacionProducto,
            slot: "L" + posicion.n,
            lote: stockNuevo === 0 ? "" : lote,
            producto: productoNombre,
            stock: stockNuevo
          });

        } catch (errSnap) {
          Logger.log("No se pudo actualizar el snapshot: " + errSnap);
        }

        /* ==========================================
           REGISTRAR MOVIMIENTO
        ========================================== */

        movimientoRegistrado = MOVIMIENTOS.registrar({

          usuario:
            USUARIOS.obtenerUsuarioActual(),

          producto:
            productoNombre,

          sku:
            sku,

          lote:
            lote,

          movimiento:
            tipo === "entrada"
              ? "Entrada"
              : "Salida",

          stockAnterior:
            stockAnterior,

          stockNuevo:
            stockNuevo,

          cliente:
            cliente,

          factura:
            factura,

          cantidad:
            cantidad,

          observacion:
            observacion

        });

        break;

      }

      if (encontrado) break;

    }

    if (!encontrado) {
      throw new Error(
        "No se encontró el producto con código: " + sku
      );
    }

    CACHE.invalidarInventario();
    CACHE.invalidarMovimientos();

    return ContentService
      .createTextOutput(
        JSON.stringify({
          success: true,
          message:
            tipo === "entrada"
              ? "Entrada registrada correctamente."
              : "Salida registrada correctamente.",
          producto: productoNombre,
          lote: lote,
          cantidad: cantidad,
          stockAnterior: stockAnterior,
          stockNuevo: stockNuevo,
          movimientoRegistrado: movimientoRegistrado,
          advertencia: movimientoRegistrado ? "" : "El inventario se actualizó, pero NO se pudo guardar el movimiento en el historial. Revise la hoja Movimientos."
        })
      )
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {

    Logger.log(
      "Error en registrarMovimiento: " +
      error
    );

    return ContentService
      .createTextOutput(
        JSON.stringify({
          success: false,
          message: String(error.message || error),
          codigo: error.codigo || ""
        })
      )
      .setMimeType(ContentService.MimeType.JSON);
  }

}

/* ============================================================================
 * MÓDULO: UTILIDADES
 * Funciones puras de apoyo, sin dependencias de Sheets salvo cuando se indica.
 * ========================================================================= */

const UTIL = {

  /** true si el valor de una celda es una imagen incrustada (no texto/número). */
  esImagen(val) {
    if (val === null || val === undefined || val === "") return false;
    const t = typeof val;
    if (t === "string" || t === "number" || t === "boolean") return false;
    if (val instanceof Date) return false;
    return true;
  },

  /** Filtra una fila dejando solo celdas con contenido real (no vacías/imagen). */
  celdasReales(fila) {
    return fila.filter(c => c !== "" && c !== null && c !== undefined && !UTIL.esImagen(c));
  },

  /** true si la fila es un encabezado de tabla (contiene la columna "Código"). */
  esEncabezado(fila) {
    return fila.some(c => /^c[oó]digos?$/i.test(String(c).trim()));
  },

  /** true si la fila es una fila divisoria de categoría (una sola celda con texto). */
  esCategoria(fila) {
    if (UTIL.esEncabezado(fila)) return false;
    return UTIL.celdasReales(fila).length === 1;
  },

  esVacia(fila) {
    return UTIL.celdasReales(fila).length === 0;
  },

  /** Valida que un SKU/nombre correspondan a un producto real y no a ruido. */
  skuValido(sku, nombre) {
    if (!sku) return false;
    if (CONFIG.SKU_IGNORAR.includes(String(sku).toLowerCase())) return false;
    if (CONFIG.NOMBRE_IGNORAR.includes(String(nombre).trim().toLowerCase())) return false;
    if (/^c[oó]digo$/i.test(sku)) return false;
    return true;
  },

  /** Obtiene una referencia de Materiales: imagen incrustada, URL o texto. */
  convertirReferenciaCelda(valor, formula) {
    if (valor === null || valor === undefined || valor === "") {
      const f = String(formula || "");
      const imagenFormula = f.match(/=IMAGE\(\s*["']([^"']+)["']/i);
      return imagenFormula ? (UTIL.convertirLinkFoto(imagenFormula[1]) || imagenFormula[1]) : "";
    }
    try {
      if (valor && typeof valor.getContentUrl === "function") return valor.getContentUrl() || "";
    } catch (e) {}
    if (UTIL.esImagen(valor)) return "";
    const texto = String(valor).trim();
    if (/^=IMAGE\(/i.test(texto)) {
      const m = texto.match(/=IMAGE\(\s*["']([^"']+)["']/i);
      if (m) return UTIL.convertirLinkFoto(m[1]) || m[1];
    }
    return UTIL.convertirLinkFoto(texto) || texto;
  },

  /** Convierte un link de Google Drive en una URL de miniatura utilizable. */
  convertirLinkFoto(url) {
    if (!url || typeof url !== "string") return "";
    url = url.trim();
    if (url.indexOf("http") !== 0) return "";

    const m = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (m) return "https://drive.google.com/thumbnail?id=" + m[1] + "&sz=w800";

    const m2 = url.match(/lh3\.googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/);
    if (m2) return "https://drive.google.com/thumbnail?id=" + m2[1] + "&sz=w800";

    const m3 = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (m3) return "https://drive.google.com/thumbnail?id=" + m3[1] + "&sz=w800";

    return url;
  },

  /** Convierte Date o número de serie de Sheets a "12 ago 2026". */
  formatFecha(val) {
    if (!val) return "—";
    let d;
    if (val instanceof Date) {
      d = val;
    } else if (typeof val === "number") {
      d = new Date(Math.round((val - 25569) * 86400000));
    } else {
      return String(val);
    }
    if (isNaN(d.getTime())) return String(val);

    const dia  = d.getUTCDate();
    const mes  = CONFIG.MESES_ES[d.getUTCMonth()];
    const anio = d.getUTCFullYear();
    return dia + " " + mes + " " + anio;
  },

  /** Convierte Date a "12 ago 2026, 14:35" (hora local del script). */
  formatFechaMovimiento(d) {
    const dia     = d.getDate();
    const mes     = CONFIG.MESES_ES[d.getMonth()];
    const anio    = d.getFullYear();
    const horas   = String(d.getHours()).padStart(2, "0");
    const minutos = String(d.getMinutes()).padStart(2, "0");
    return dia + " " + mes + " " + anio + ", " + horas + ":" + minutos;
  },

  /** Clasifica el estado de vencimiento de un lote según días restantes. */
  alertaVencimiento(val) {
    if (!val) return "ok";
    let d;
    if (val instanceof Date) {
      d = val;
    } else if (typeof val === "number") {
      d = new Date(Math.round((val - 25569) * 86400000));
    } else {
      d = new Date(val);
    }
    if (isNaN(d.getTime())) return "ok";

    const hoy     = new Date();
    const hoyUTC  = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate());
    const vencUTC = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const dias    = Math.floor((vencUTC - hoyUTC) / 86400000);

    if (dias >= 121) return "ok";
    if (dias >= 50)  return "proximo";
    if (dias >= 1)   return "urgente";
    return "vencido";
  },

  /** Normaliza cualquier valor de celda de stock a número (vacío/— => 0). */
  normalizarNumero(val) {
    if (val === "" || val === null || val === undefined || val === "—") return 0;
    const n = Number(val);
    return isNaN(n) ? 0 : n;
  }
};


/* ============================================================================
 * MÓDULO: INVENTARIO
 * Lectura y parseo de las hojas del Sheet de inventario, y las funciones
 * públicas usadas por el frontend (getInventario, getResumen, buscar).
 * ========================================================================= */

const INVENTARIO = {

  /**
   * Construye el mapa de índices de columnas para hojas de reactivos
   * (incluye también las hojas de dos niveles, que comparten layout).
   */
  buildIdxReactivo(headers) {
    return {
      nombre:     headers.findIndex(h => /^(producto|descripci[oó]n|nombre|art[ií]culo)$/i.test(h)),
      sku:        headers.findIndex(h => /^c[oó]digo$/i.test(h)),
      stockTotal: headers.findIndex(h => /total\s*exist/i.test(h)),
      ubicacion:  headers.findIndex(h => /^ubicaci[oó]n$/i.test(h)),
      ref1:       headers.findIndex(h => /^referencia\s*1$/i.test(h)),
      ref2:       headers.findIndex(h => /^referencia\s*2$/i.test(h)),
      lote1:      headers.findIndex(h => /^lote\s*1$/i.test(h)),
      lote2:      headers.findIndex(h => /^lote\s*2$/i.test(h)),
      lote3:      headers.findIndex(h => /^lote\s*3$/i.test(h)),
      lote4:      headers.findIndex(h => /^lote\s*4$/i.test(h)),
      venc1:      headers.findIndex(h => /^venci\.?\s*1$/i.test(h)),
      venc2:      headers.findIndex(h => /^venci\.?\s*2$/i.test(h)),
      venc3:      headers.findIndex(h => /^venci\.?\s*3$/i.test(h)),
      venc4:      headers.findIndex(h => /^venci\.?\s*4$/i.test(h)),
      exis1:      headers.findIndex(h => /^exis\.?\s*1$/i.test(h)),
      exis2:      headers.findIndex(h => /^exis\.?\s*2$/i.test(h)),
      exis3:      headers.findIndex(h => /^exis\.?\s*3$/i.test(h)),
      exis4:      headers.findIndex(h => /^exis\.?\s*4$/i.test(h)),
    };
  },

  /** Construye el mapa de índices de columnas para hojas de materiales/repuestos. */
  buildIdxMaterial(headers) {
    const h2 = headers.map(h => String(h).trim());
    return {
      sku:       h2.findIndex(h => /^c[oó]digos?$/i.test(h)),
      nombre:    h2.findIndex(h => /^(producto|descripci[oó]n|nombre|art[ií]culo)$/i.test(h)),
      ubicacion: h2.findIndex(h => /^ubicaci[oó]n$/i.test(h)),
      exis1:     h2.findIndex(h =>
                   /^exis\.?\s*1$/i.test(h) || /^total[\s._]*exist/i.test(h) ||
                   /^existencia/i.test(h)   || /^stock/i.test(h) || /^cantidad/i.test(h)),
      ref1:      h2.findIndex(h => /^referencia[\s._]*1$/i.test(h) || /^imagen[\s._]*1$/i.test(h) || /^foto[\s._]*1$/i.test(h)),
      ref2:      h2.findIndex(h => /^referencia[\s._]*2$/i.test(h) || /^imagen[\s._]*2$/i.test(h) || /^foto[\s._]*2$/i.test(h)),
    };
  },

  /** Extrae hasta 4 lotes (numLote/stock/vencimiento/alerta) de una fila. */
  extraerLotes(fila, idx) {
    const lotes = [];

    [
      [idx.lote1, idx.venc1, idx.exis1],
      [idx.lote2, idx.venc2, idx.exis2],
      [idx.lote3, idx.venc3, idx.exis3],
      [idx.lote4, idx.venc4, idx.exis4]
    ].forEach(([li, vi, ei], i) => {

      const numLote = li >= 0 ? fila[li] : "";
      const venc    = vi >= 0 ? fila[vi] : "";
      const stock   = ei >= 0 ? fila[ei] : "";

      if (
        numLote !== "" &&
        numLote !== null &&
        !UTIL.esImagen(numLote)
      ) {

        lotes.push({
          numero: i + 1,
          numLote: String(numLote),
          stock:
            (stock !== "" &&
             stock !== null &&
             !UTIL.esImagen(stock))
              ? stock
              : "—",
          vencimiento:
            venc
              ? UTIL.formatFecha(venc)
              : "—",
          bodega: "Tegus",
          // Ubicación interna asociada a este lote (la de la fila del producto).
          ubicacion: idx.ubicacion >= 0 ? String(fila[idx.ubicacion] || "").trim() : "",
          alerta:
            venc
              ? UTIL.alertaVencimiento(venc)
              : "ok"
        });

      }
    });

    return lotes;
  },

  /** Parsea una hoja simple de reactivos (una sola categoría por sección). */
  leerHojaReactivos(data, proveedor) {
    const productos = [];
    let categoriaActual = "";
    let headers = null;
    let idx = null;

    data.forEach(fila => {
      if (UTIL.esVacia(fila)) return;

      if (UTIL.esCategoria(fila)) {
        categoriaActual = String(UTIL.celdasReales(fila)[0]).trim();
        return;
      }
      if (UTIL.esEncabezado(fila)) {
        headers = fila.map(h => String(h).trim());
        idx = INVENTARIO.buildIdxReactivo(headers);
        return;
      }
      if (!headers || !idx) return;

      const sku    = idx.sku    >= 0 ? String(fila[idx.sku]).trim()    : "";
      const nombre = idx.nombre >= 0 ? String(fila[idx.nombre]).trim() : "";
      if (!UTIL.skuValido(sku, nombre)) return;

      const lotes = INVENTARIO.extraerLotes(fila, idx);
      const stockRaw = idx.stockTotal >= 0 ? fila[idx.stockTotal] : null;
      const stockTotal = (stockRaw !== "" && stockRaw !== null && !UTIL.esImagen(stockRaw))
        ? stockRaw
        : lotes.reduce((s, l) => s + (Number(l.stock) || 0), 0);

      if (typeof stockTotal === "string" && stockTotal !== "—" && isNaN(Number(stockTotal))) return;

      productos.push({
        tipo: "reactivo", proveedor, categoria: categoriaActual || "General",
        nombre, sku, stockTotal,
        ubicacion: idx.ubicacion >= 0 ? String(fila[idx.ubicacion] || "").trim() : "",
        foto1: idx.ref1 >= 0 ? UTIL.convertirLinkFoto(String(fila[idx.ref1])) : "",
        foto2: idx.ref2 >= 0 ? UTIL.convertirLinkFoto(String(fila[idx.ref2])) : "",
        lotes
      });
    });

    return productos;
  },

  /** Parsea una hoja con estructura de dos niveles (grupo + subcategoría). */
  leerHojaDosNiveles(data, proveedor) {
    const productos = [];
    let grupoPrincipal = "";
    let subcategoriaActual = "";
    let headers = null;
    let idx = null;

    data.forEach(fila => {
      if (UTIL.esVacia(fila)) return;

      if (UTIL.esCategoria(fila)) {
        const valor = String(UTIL.celdasReales(fila)[0]).trim();
        if (!grupoPrincipal || /\d+\s*test/i.test(valor) || /^\d+\s/i.test(valor)) {
          grupoPrincipal = valor;
          subcategoriaActual = "";
        } else {
          subcategoriaActual = valor;
        }
        headers = null; idx = null;
        return;
      }
      if (UTIL.esEncabezado(fila)) {
        headers = fila.map(h => String(h).trim());
        idx = INVENTARIO.buildIdxReactivo(headers);
        return;
      }
      if (!headers || !idx) return;

      const sku    = idx.sku    >= 0 ? String(fila[idx.sku]).trim()    : "";
      const nombre = idx.nombre >= 0 ? String(fila[idx.nombre]).trim() : "";
      if (!UTIL.skuValido(sku, nombre)) return;

      const categoria = subcategoriaActual
        ? grupoPrincipal + "||" + subcategoriaActual
        : (grupoPrincipal || "");

      const lotes = INVENTARIO.extraerLotes(fila, idx);
      const stockRaw = idx.stockTotal >= 0 ? fila[idx.stockTotal] : null;
      const stockTotal = (stockRaw !== "" && stockRaw !== null && !UTIL.esImagen(stockRaw))
        ? stockRaw
        : lotes.reduce((s, l) => s + (Number(l.stock) || 0), 0);

      if (typeof stockTotal === "string" && stockTotal !== "—" && isNaN(Number(stockTotal))) return;

      productos.push({
        tipo: "reactivo", proveedor, categoria,
        nombre, sku, stockTotal,
        ubicacion: idx.ubicacion >= 0 ? String(fila[idx.ubicacion] || "").trim() : "",
        foto1: idx.ref1 >= 0 ? UTIL.convertirLinkFoto(String(fila[idx.ref1])) : "",
        foto2: idx.ref2 >= 0 ? UTIL.convertirLinkFoto(String(fila[idx.ref2])) : "",
        lotes
      });
    });

    return productos;
  },

  /** Parsea hojas de Materiales/Repuestos (sin lotes, sin vencimiento). */
  leerHojaMaterial(data, proveedor, formulas) {
    const productos = [];
    const tipo = proveedor === "Repuestos" ? "repuesto" : "material";
    let categoriaActual = "";
    let headers = null;
    let idx = null;

    data.forEach(fila => {
      if (UTIL.esVacia(fila)) return;

      if (UTIL.esCategoria(fila)) {
        categoriaActual = String(UTIL.celdasReales(fila)[0]).trim();
        return;
      }
      if (UTIL.esEncabezado(fila)) {
        headers = fila.map(h => String(h).trim());
        idx = INVENTARIO.buildIdxMaterial(headers);
        return;
      }
      if (!headers || !idx) return;

      const sku    = idx.sku    >= 0 ? String(fila[idx.sku]).trim()    : "";
      const nombre = idx.nombre >= 0 ? String(fila[idx.nombre]).trim() : "";
      if (!UTIL.skuValido(sku, nombre)) return;

      productos.push({
        tipo, proveedor, categoria: categoriaActual || "General", nombre, sku,
        stockTotal: (idx.exis1 >= 0 && fila[idx.exis1] !== "" && !UTIL.esImagen(fila[idx.exis1]))
          ? fila[idx.exis1] : 0,
        ubicacion: idx.ubicacion >= 0 ? String(fila[idx.ubicacion] || "").trim() : "",
        foto1: idx.ref1 >= 0 ? UTIL.convertirReferenciaCelda(fila[idx.ref1], formulas && formulas[data.indexOf(fila)] ? formulas[data.indexOf(fila)][idx.ref1] : "") : "",
        foto2: idx.ref2 >= 0 ? UTIL.convertirReferenciaCelda(fila[idx.ref2], formulas && formulas[data.indexOf(fila)] ? formulas[data.indexOf(fila)][idx.ref2] : "") : "",
        lotes: []
      });
    });

    return productos;
  },

  /** Lee TODAS las hojas relevantes del Spreadsheet de inventario. */
  leerSheets() {
    const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
    const hojas = ss.getSheets().filter(h => !CONFIG.HOJAS_EXCLUIR.includes(h.getName()));

    let todos = [];
    hojas.forEach(hoja => {
      const proveedor = hoja.getName();
      const esMaterial = CONFIG.HOJAS_MATERIALES.includes(proveedor);
      const dosNiveles = CONFIG.HOJAS_DOS_NIVELES.includes(proveedor);
      const rangoDatos = hoja.getDataRange();
      const data = rangoDatos.getValues();
      if (data.length < 2) return;

      if (esMaterial) {
        todos = todos.concat(INVENTARIO.leerHojaMaterial(data, proveedor, rangoDatos.getFormulas()));
      } else if (dosNiveles) {
        todos = todos.concat(INVENTARIO.leerHojaDosNiveles(data, proveedor));
      } else {
        todos = todos.concat(INVENTARIO.leerHojaReactivos(data, proveedor));
      }
    });

    return { productos: todos, total: todos.length };
  },

  /** Calcula las métricas del dashboard a partir de la lista de productos. */
  calcularResumen(productos) {

    const total = productos.length;

    let stockBajo = 0;
    let porVencer = 0;

    let lotesVigentes = 0;
    let lotesPorVencer = 0;
    let lotesUrgentes = 0;
    let lotesVencidos = 0;

    const marcasSet = new Set();

    productos.forEach(p => {

      // STOCK BAJO
      const stockNum = Number(p.stockTotal);

      if (!isNaN(stockNum) && stockNum <= CONFIG.STOCK_BAJO_UMBRAL) {
        stockBajo++;
      }

      // LOTES
      if (p.lotes && p.lotes.length) {

        p.lotes.forEach(lote => {

          switch (lote.alerta) {

            case "ok":
              lotesVigentes++;
              break;

            case "proximo":
              lotesPorVencer++;
              break;

            case "urgente":
              lotesUrgentes++;
              break;

            case "vencido":
              lotesVencidos++;
              break;

            default:
              lotesVigentes++;
              break;
          }

        });

        // Contador de "Por vencer": productos con algún lote
        // próximo, urgente o vencido.
        if (
          p.lotes.some(l =>
            l.alerta === "proximo" ||
            l.alerta === "urgente" ||
            l.alerta === "vencido"
          )
        ) {
          porVencer++;
        }
      }

      // MARCAS
      if (p.tipo === "reactivo" && p.proveedor) {
        marcasSet.add(p.proveedor);
      }

    });

    return {
      total,
      stockBajo,
      porVencer,
      marcas: marcasSet.size,

      lotesVigentes,
      lotesPorVencer,
      lotesUrgentes,
      lotesVencidos
    };

  }
};

/* =========================================================================
 * BODEGA SPS
 * Lee únicamente la hoja "Productos" del Google Sheets de Bodega SPS.
 * Solo lectura. Código identifica el producto; la bodega queda como "SPS".
 * ========================================================================= */

function getInventarioSPS() {

  // Usar caché para no volver a leer SPS en cada llamada
  const cacheado = CACHE.get(CACHE.KEY_SPS);

  if (cacheado) {
    return cacheado;
  }

  const ss = SpreadsheetApp.openById(CONFIG.SS_SPS_ID);
  const hoja = ss.getSheetByName(CONFIG.SS_SPS_HOJA_PRODUCTOS);

  if (!hoja) {
    throw new Error(
      'No se encontró la hoja "' +
      CONFIG.SS_SPS_HOJA_PRODUCTOS +
      '" en el archivo de Bodega SPS.'
    );
  }

  const datos = hoja.getDataRange().getValues();

  if (!datos || datos.length < 2) {
    return {
      productos: [],
      total: 0,
      bodega: "SPS"
    };
  }

  // ENCABEZADOS
  const encabezados = datos[0].map(h =>
    String(h || "")
      .trim()
      .toUpperCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
  );

  const idx = {
    marca: encabezados.indexOf("MARCA"),
    sku: encabezados.indexOf("CODIGO"),
    nombre: encabezados.indexOf("DESCRIPCION"),
    lote: encabezados.indexOf("LOTE"),
    cantidad: encabezados.indexOf("CANTIDAD"),
    vence: encabezados.indexOf("VENCE"),
    proximo: encabezados.indexOf("PROXIMO A VENCER"),
    ubicacion: encabezados.indexOf("UBICACION"),
    codigoUnico: encabezados.indexOf("CODIGO_UNICO")
  };

  // VALIDACIÓN MÍNIMA
  if (idx.sku < 0) {
    throw new Error(
      'La hoja "Productos" de SPS no contiene la columna "CODIGO".'
    );
  }

  if (idx.nombre < 0) {
    throw new Error(
      'La hoja "Productos" de SPS no contiene la columna "DESCRIPCION".'
    );
  }

  // AGRUPAR POR CÓDIGO
  const mapa = {};

  for (let i = 1; i < datos.length; i++) {

    const fila = datos[i];

    const sku = idx.sku >= 0
      ? String(fila[idx.sku] || "").trim()
      : "";

    const nombre = idx.nombre >= 0
      ? String(fila[idx.nombre] || "").trim()
      : "";

    if (!sku || !nombre) continue;

    const clave = sku;

    if (!mapa[clave]) {

      mapa[clave] = {
        tipo: "reactivo",
        proveedor: idx.marca >= 0
          ? String(fila[idx.marca] || "").trim()
          : "",
        categoria: "General",

        nombre: nombre,
        sku: sku,

        stockTotal: 0,

        ubicacion: idx.ubicacion >= 0
          ? String(fila[idx.ubicacion] || "").trim()
          : "",

        bodega: "SPS",

        lotes: []
      };

    }

    // CANTIDAD
    let cantidad = 0;

    if (idx.cantidad >= 0) {

      const valor = fila[idx.cantidad];

      if (
        valor !== "" &&
        valor !== null &&
        valor !== undefined &&
        !isNaN(Number(valor))
      ) {
        cantidad = Number(valor);
      }

    }

    // LOTE
    const lote = idx.lote >= 0
      ? String(fila[idx.lote] || "").trim()
      : "";

    // VENCIMIENTO
    const vence = idx.vence >= 0
      ? fila[idx.vence]
      : "";

    let vencimiento = "—";

    if (vence !== "" && vence !== null && vence !== undefined) {

      if (typeof UTIL !== "undefined" && UTIL.formatFecha) {
        vencimiento = UTIL.formatFecha(vence);
      } else {
        vencimiento = String(vence);
      }

    }

    // CÓDIGO ÚNICO
    const codigoUnico = idx.codigoUnico >= 0
      ? String(fila[idx.codigoUnico] || "").trim()
      : "";

    // AGREGAR LOTE
    if (lote) {

      mapa[clave].lotes.push({

        numero: mapa[clave].lotes.length + 1,

        numLote: lote,

        stock: cantidad,

        vencimiento: vencimiento,

        bodega: "SPS",

        codigoUnico: codigoUnico,

        ubicacion: idx.ubicacion >= 0
          ? String(fila[idx.ubicacion] || "").trim()
          : "",

        alerta: UTIL.alertaVencimiento(vence)

      });

    }

    // STOCK TOTAL DEL PRODUCTO EN SPS
    mapa[clave].stockTotal += cantidad;

  }

  const productos = Object.values(mapa);

  Logger.log("SPS - Productos encontrados: " + productos.length);
  Logger.log(JSON.stringify(productos.slice(0, 5)));

  const resultado = {
    productos: productos,
    total: productos.length,
    bodega: "SPS"
  };

  CACHE.put(
    CACHE.KEY_SPS,
    resultado,
    CACHE.TTL_SPS
  );

  return resultado;

}

/* ============================================================================
 * MÓDULO: MOVIMIENTOS
 * Registro y consulta del historial de entradas/salidas de stock.
 * ========================================================================= */

const MOVIMIENTOS = {
  // Escribe usando los encabezados de la hoja para que agregar columnas
  // no desplace silenciosamente los datos históricos.
  _normalizarEncabezado_(valor) {
    return String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  },
  _mapaEncabezados_(hoja) {
    const ultimaColumna = Math.max(hoja.getLastColumn(), 8);
    const encabezados = hoja.getRange(1, 1, 1, ultimaColumna).getDisplayValues()[0];
    const normalizados = encabezados.map(h => this._normalizarEncabezado_(h));
    const buscar = aliases => normalizados.findIndex(h => aliases.some(a => h === this._normalizarEncabezado_(a)));
    return {
      encabezados, normalizados,
      fecha: buscar(['Fecha']), usuario: buscar(['Usuario']), producto: buscar(['Producto']),
      sku: buscar(['SKU', 'Código', 'Codigo']), lote: buscar(['Lote']), movimiento: buscar(['Movimiento', 'Tipo de movimiento']),
      cliente: buscar(['Cliente']), factura: buscar(['N.º de factura', 'No. de factura', 'Numero de factura', 'Factura', 'Documento']),
      cantidad: buscar(['Cantidad']), stockAnterior: buscar(['Stock anterior', 'Stock antes', 'Existencia anterior']),
      stockNuevo: buscar(['Stock nuevo', 'Stock despues', 'Existencia nueva'])
    };
  },
  _filaDesdeDatos_(datos, mapa, ancho) {
    const fila = Array(Math.max(ancho, mapa.encabezados.length)).fill('');
    const poner = (col, valor) => { if (col >= 0) fila[col] = valor; };
    poner(mapa.fecha, datos.fecha || new Date());
    poner(mapa.usuario, datos.usuario || 'admin');
    poner(mapa.producto, datos.producto || '');
    poner(mapa.sku, datos.sku || '');
    poner(mapa.lote, datos.lote || '');
    poner(mapa.movimiento, datos.movimiento || '');
    poner(mapa.cliente, datos.cliente || '');
    poner(mapa.factura, datos.factura || datos.documento || '');
    const anterior = Number(datos.stockAnterior || 0), nuevo = Number(datos.stockNuevo || 0);
    poner(mapa.cantidad, datos.cantidad != null ? datos.cantidad : Math.abs(nuevo - anterior));
    poner(mapa.stockAnterior, anterior);
    poner(mapa.stockNuevo, nuevo);
    // Compatibilidad con hojas antiguas sin encabezados reconocibles.
    if (mapa.fecha < 0 && mapa.usuario < 0 && mapa.producto < 0) {
      return [datos.fecha || new Date(), datos.usuario || 'admin', datos.producto || '', datos.sku || '', datos.lote || '', datos.movimiento || '', anterior, nuevo];
    }
    return fila;
  },
  guardar(datos) {
    const ss = SpreadsheetApp.openById(CONFIG.SS_MOVIMIENTOS_ID);
    const hoja = ss.getSheetByName(CONFIG.NOMBRE_HOJA_MOVIMIENTOS);
    if (!hoja) throw new Error('No se encontró la hoja "' + CONFIG.NOMBRE_HOJA_MOVIMIENTOS + '" en el Spreadsheet de movimientos.');
    const mapa = this._mapaEncabezados_(hoja);
    const fila = this._filaDesdeDatos_(datos, mapa, hoja.getLastColumn());
    hoja.getRange(hoja.getLastRow() + 1, 1, 1, fila.length).setValues([fila]);
  },
  guardarLote(listaDatos) {
    if (!listaDatos || !listaDatos.length) return;
    const ss = SpreadsheetApp.openById(CONFIG.SS_MOVIMIENTOS_ID);
    const hoja = ss.getSheetByName(CONFIG.NOMBRE_HOJA_MOVIMIENTOS);
    if (!hoja) throw new Error('No se encontró la hoja "' + CONFIG.NOMBRE_HOJA_MOVIMIENTOS + '" en el Spreadsheet de movimientos.');
    const mapa = this._mapaEncabezados_(hoja);
    const ancho = Math.max(hoja.getLastColumn(), mapa.encabezados.length, 8);
    const ahora = new Date();
    const filas = listaDatos.map(datos => this._filaDesdeDatos_(Object.assign({fecha: ahora}, datos), mapa, ancho).slice(0, ancho));
    hoja.getRange(hoja.getLastRow() + 1, 1, filas.length, ancho).setValues(filas);
  },
  registrar(datos) {
    try { this.guardar(datos); CACHE.invalidarMovimientos(); CACHE.invalidarInventario(); return true; }
    catch (err) { Logger.log('Error registrando movimiento: ' + err); return false; }
  },
  registrarLote(listaDatos) {
    if (!listaDatos || !listaDatos.length) return 0;
    try { this.guardarLote(listaDatos); CACHE.invalidarMovimientos(); CACHE.invalidarInventario(); return listaDatos.length; }
    catch (err) { Logger.log('Error registrando movimientos en lote: ' + err); return 0; }
  },
  leerDesdeSheet(fecha) {
    const ss = SpreadsheetApp.openById(CONFIG.SS_MOVIMIENTOS_ID);
    const hoja = ss.getSheetByName(CONFIG.NOMBRE_HOJA_MOVIMIENTOS);
    if (!hoja || hoja.getLastRow() <= 1) return {movimientos: [], total: 0};
    const mapa = this._mapaEncabezados_(hoja);
    const ancho = Math.max(hoja.getLastColumn(), mapa.encabezados.length, 8);
    const data = hoja.getRange(2, 1, hoja.getLastRow() - 1, ancho).getValues();
    const col = (nombre, fallback) => mapa[nombre] >= 0 ? mapa[nombre] : fallback;
    const movimientos = data.filter(fila => {
      if (!fila.some(c => c !== '' && c !== null && c !== undefined)) return false;
      if (!fecha) return true;
      const f = fila[col('fecha', 0)];
      if (!(f instanceof Date)) return false;
      return Utilities.formatDate(f, Session.getScriptTimeZone(), 'yyyy-MM-dd') === fecha;
    }).map(fila => {
      const f = fila[col('fecha', 0)];
      const anterior = fila[col('stockAnterior', 6)] !== '' && fila[col('stockAnterior', 6)] != null ? fila[col('stockAnterior', 6)] : 0;
      const nuevo = fila[col('stockNuevo', 7)] !== '' && fila[col('stockNuevo', 7)] != null ? fila[col('stockNuevo', 7)] : 0;
      const cantidadCol = col('cantidad', -1);
      return {
        fecha: f instanceof Date ? UTIL.formatFechaMovimiento(f) : String(f || '—'),
        fechaISO: f instanceof Date ? f.toISOString() : '',
        usuario: String(fila[col('usuario', 1)] || '—'),
        producto: String(fila[col('producto', 2)] || '—'),
        sku: String(fila[col('sku', 3)] || '—'),
        lote: String(fila[col('lote', 4)] || '—'),
        movimiento: String(fila[col('movimiento', 5)] || '—'),
        cliente: String(fila[col('cliente', -1)] || ''),
        factura: String(fila[col('factura', -1)] || ''),
        cantidad: cantidadCol >= 0 && fila[cantidadCol] !== '' ? Number(fila[cantidadCol]) : Math.abs(Number(nuevo) - Number(anterior)),
        stockAnterior: anterior, stockNuevo: nuevo
      };
    }).reverse();
    return {movimientos, total: movimientos.length};
  }
};


/* ============================================================================
 * MÓDULO: SNAPSHOT (fuente de verdad persistente del stock)
 * La clave de cada registro es "SKU|Proveedor|Ubicación|Slot", donde Slot es
 * "L1".."L4" (posición del lote) o "TOTAL" (productos sin lotes).
 * ========================================================================= */

const SNAPSHOT = {

  /** Obtiene (o crea, si es la primera vez) la hoja de control de snapshot. */
  obtenerHoja() {
    const ss = SpreadsheetApp.openById(CONFIG.SS_MOVIMIENTOS_ID);
    let hoja = ss.getSheetByName(CONFIG.NOMBRE_HOJA_SNAPSHOT);
    if (!hoja) {
      hoja = ss.insertSheet(CONFIG.NOMBRE_HOJA_SNAPSHOT);
      hoja.getRange(1, 1, 1, CONFIG.ENCABEZADOS_SNAPSHOT.length).setValues([CONFIG.ENCABEZADOS_SNAPSHOT]);
      hoja.setFrozenRows(1);
    }
    return hoja;
  },

  /**
   * Construye la clave estable "SKU|Proveedor|Ubicación|Slot". Se incluye la
   * ubicación porque el mismo SKU puede existir en más de una bodega.
   */
  construirClave(sku, proveedor, ubicacion, slot) {
    return [
      String(sku).trim(),
      String(proveedor).trim(),
      String(ubicacion || "").trim(),
      String(slot).trim()
    ].join("|");
  },

  /**
   * Carga todo el snapshot en memoria una sola vez.
   * Devuelve { hoja, mapa, ultimaFila } donde mapa[clave] = { fila, stock }.
   */
  cargar() {
    const hoja = SNAPSHOT.obtenerHoja();
    const ultimaFila = hoja.getLastRow();
    const mapa = {};

    if (ultimaFila > 1) {
      const datos = hoja.getRange(2, 1, ultimaFila - 1, CONFIG.ENCABEZADOS_SNAPSHOT.length).getValues();
      datos.forEach((fila, i) => {
        const clave = String(fila[0]);
        if (!clave) return;
        // 0 Clave, 1 SKU, 2 Proveedor, 3 Ubicación, 4 Slot, 5 Lote, 6 Producto, 7 Stock, 8 Actualizado
        mapa[clave] = { fila: i + 2, stock: UTIL.normalizarNumero(fila[7]) };
      });
    }

    return { hoja, mapa, ultimaFila };
  },

  /**
   * Aplica una lista de estados actuales contra el snapshot cargado:
   *   - Clave nueva: se guarda como línea base (SIN movimiento).
   *   - Stock igual: no pasa nada.
   *   - Stock distinto: se arma el movimiento a registrar.
   */
  calcularDiferencias(estados, snapshotCargado) {
    const { mapa } = snapshotCargado;
    const movimientos = [];
    const filasActualizar = []; // [{ fila, valores }]
    const filasNuevas = [];     // [valores]
    const ahoraTexto = new Date();

    estados.forEach(est => {
      const previo = mapa[est.clave];
      const valoresFila = [
        est.clave, est.sku, est.proveedor, est.ubicacion || "", est.slot,
        est.lote, est.producto, est.stock, ahoraTexto
      ];

      if (!previo) {
        filasNuevas.push(valoresFila);
        return;
      }

      if (previo.stock === est.stock) {
        return; // Sin cambio real.
      }

      movimientos.push({
        usuario:       est.usuario || "admin",
        producto:      est.producto,
        sku:           est.sku,
        lote:          est.lote,
        movimiento:    est.stock > previo.stock ? "Entrada" : "Salida",
        stockAnterior: previo.stock,
        stockNuevo:    est.stock
      });

      filasActualizar.push({ fila: previo.fila, valores: valoresFila });
    });

    return { movimientos, filasActualizar, filasNuevas };
  },

  /** Escribe en la hoja de snapshot las filas actualizadas y las nuevas. */
  guardarCambios(hoja, filasActualizar, filasNuevas) {
    filasActualizar.forEach(({ fila, valores }) => {
      hoja.getRange(fila, 1, 1, valores.length).setValues([valores]);
    });

    if (filasNuevas.length > 0) {
      const inicio = hoja.getLastRow() + 1;
      hoja.getRange(inicio, 1, filasNuevas.length, filasNuevas[0].length).setValues(filasNuevas);
    }
  },

  /**
   * Fija el stock de una clave en el snapshot SIN generar movimiento.
   * Se usa cuando el cambio ya lo registró el sistema (doPost), para que la
   * sincronización automática no lo vuelva a contar.
   */
  fijarEstado(est) {

    const lock = LockService.getScriptLock();

    try {
      lock.waitLock(15000);
    } catch (e) {
      Logger.log("fijarEstado: no se obtuvo el lock: " + e);
      return;
    }

    try {

      const snap = SNAPSHOT.cargar();

      const valores = [
        est.clave,
        est.sku,
        est.proveedor,
        est.ubicacion || "",
        est.slot,
        est.lote || "",
        est.producto,
        est.stock,
        new Date()
      ];

      const previo = snap.mapa[est.clave];

      if (previo) {
        snap.hoja
          .getRange(previo.fila, 1, 1, valores.length)
          .setValues([valores]);
      } else {
        snap.hoja
          .getRange(snap.hoja.getLastRow() + 1, 1, 1, valores.length)
          .setValues([valores]);
      }

    } finally {
      lock.releaseLock();
    }

  },

  /**
   * Punto de entrada único: recibe una lista de estados actuales, calcula qué
   * cambió realmente contra el snapshot, registra esos movimientos y actualiza
   * el snapshot — protegido con un lock contra condiciones de carrera.
   * Devuelve la cantidad de movimientos efectivamente registrados.
   */
  procesarEstados(estados) {
    if (!estados || estados.length === 0) return 0;

    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(15000); // hasta 15s esperando el lock antes de rendirse.
    } catch (e) {
      Logger.log("No se pudo obtener el lock de sincronización a tiempo: " + e);
      return 0;
    }

    try {
      const snapshotCargado = SNAPSHOT.cargar();
      const { movimientos, filasActualizar, filasNuevas } =
        SNAPSHOT.calcularDiferencias(estados, snapshotCargado);

      // Orden: primero movimientos, luego snapshot. Si algo falla entre medio,
      // en el peor caso se re-detecta el mismo cambio una vez más la próxima
      // corrida, pero nunca se pierde un cambio silenciosamente.
      const registrados = MOVIMIENTOS.registrarLote(movimientos);
      SNAPSHOT.guardarCambios(snapshotCargado.hoja, filasActualizar, filasNuevas);

      return registrados;
    } catch (err) {
      Logger.log("Error procesando estados de snapshot: " + err);
      return 0;
    } finally {
      lock.releaseLock();
    }
  }
};


/* ============================================================================
 * MÓDULO: DETECCIÓN DE CAMBIOS DE STOCK
 *   1) DETECTOR.procesarRangoEditado(...) — usado por onEdit.
 *   2) DETECTOR.sincronizarTodo() — barrido completo del inventario.
 * ========================================================================= */

const DETECTOR = {

  /**
   * Busca hacia arriba, desde una fila dada, la fila de encabezado más
   * cercana.
   */
  encontrarEncabezadoSuperior(hoja, filaInicio) {
    const lastCol = hoja.getLastColumn();
    for (let r = filaInicio; r >= 1; r--) {
      const valores = hoja.getRange(r, 1, 1, lastCol).getValues()[0];
      if (UTIL.esEncabezado(valores)) {
        return { fila: r, headers: valores.map(h => String(h).trim()) };
      }
    }
    return null;
  },

  /**
   * A partir de una fila ya leída y su idx de columnas, genera los "estados"
   * (producto/lote + stock actual) que deben compararse contra el snapshot.
   */
  extraerEstadosDeFila(valoresFila, idx, esMaterial, proveedor, usuario) {
    const sku    = idx.sku    >= 0 ? String(valoresFila[idx.sku]).trim()    : "";
    const nombre = idx.nombre >= 0 ? String(valoresFila[idx.nombre]).trim() : "";
    if (!UTIL.skuValido(sku, nombre)) return [];

    // La ubicación forma parte de la clave del snapshot.
    const ubicacion = idx.ubicacion >= 0 ? String(valoresFila[idx.ubicacion] || "").trim() : "";

    const estados = [];

    if (esMaterial) {
      if (idx.exis1 >= 0) {
        estados.push({
          clave:     SNAPSHOT.construirClave(sku, proveedor, ubicacion, "TOTAL"),
          sku, proveedor, ubicacion, slot: "TOTAL", lote: "", producto: nombre, usuario,
          stock: UTIL.normalizarNumero(valoresFila[idx.exis1])
        });
      }
      return estados;
    }

    // Reactivos: si la hoja tiene columnas de lote, se rastrea por lote.
    const tieneLotes = [1, 2, 3, 4].some(i => idx["exis" + i] >= 0);

    if (tieneLotes) {
      [1, 2, 3, 4].forEach(i => {
        const colExis = idx["exis" + i];
        if (colExis < 0) return;
        const colLote = idx["lote" + i];
        const numLote = colLote >= 0 ? valoresFila[colLote] : "";
        // Si la casilla del lote está vacía, no hay nada que rastrear ahí.
        if (numLote === "" || numLote === null || UTIL.esImagen(numLote)) return;

        estados.push({
          clave:     SNAPSHOT.construirClave(sku, proveedor, ubicacion, "L" + i),
          sku, proveedor, ubicacion, slot: "L" + i, lote: String(numLote), producto: nombre, usuario,
          stock: UTIL.normalizarNumero(valoresFila[colExis])
        });
      });
    } else if (idx.stockTotal >= 0) {
      // Sin columnas de lote: se rastrea el total directamente.
      estados.push({
        clave:     SNAPSHOT.construirClave(sku, proveedor, ubicacion, "TOTAL"),
        sku, proveedor, ubicacion, slot: "TOTAL", lote: "", producto: nombre, usuario,
        stock: UTIL.normalizarNumero(valoresFila[idx.stockTotal])
      });
    }

    return estados;
  },

  /**
   * Procesa el rango realmente editado (una celda o un bloque). Lee solo esas
   * filas y delega la comparación real a SNAPSHOT.
   */
  procesarRangoEditado(hoja, nombreHoja, rango) {
    const esMaterial = CONFIG.HOJAS_MATERIALES.indexOf(nombreHoja) !== -1;

    const filaInicio = rango.getRow();
    const filaFin     = rango.getLastRow();
    const lastCol      = hoja.getLastColumn();

    let usuario = "admin";
    try {
      usuario = Session.getActiveUser().getEmail() || "admin";
    } catch (e) { /* puede fallar según permisos; se deja "admin". */ }

    // Se cachea el último encabezado encontrado para no repetir la búsqueda.
    let headerInfoCache = null;
    const estados = [];

    for (let fila = filaInicio; fila <= filaFin; fila++) {
      let headerInfo = headerInfoCache;
      if (!headerInfo || fila < headerInfo.fila) {
        headerInfo = DETECTOR.encontrarEncabezadoSuperior(hoja, fila);
        headerInfoCache = headerInfo;
      }
      if (!headerInfo) continue; // Fila por encima de cualquier encabezado (p. ej. título).

      const idx = esMaterial
        ? INVENTARIO.buildIdxMaterial(headerInfo.headers)
        : INVENTARIO.buildIdxReactivo(headerInfo.headers);

      const valoresFila = hoja.getRange(fila, 1, 1, lastCol).getValues()[0];
      const nuevos = DETECTOR.extraerEstadosDeFila(valoresFila, idx, esMaterial, nombreHoja, usuario);
      estados.push(...nuevos);
    }

    return SNAPSHOT.procesarEstados(estados);
  },

  /**
   * Barrido completo del inventario. Reutiliza el parseo de INVENTARIO y
   * compara TODO contra el snapshot de una sola vez.
   */
  sincronizarTodo() {
    const datos = INVENTARIO.leerSheets(); // Lectura fresca y completa.
    const estados = [];

    datos.productos.forEach(p => {
      if (!UTIL.skuValido(p.sku, p.nombre)) return;
      const ubicacion = String(p.ubicacion || "").trim();

      if (p.lotes && p.lotes.length > 0) {
        p.lotes.forEach(l => {
          estados.push({
            clave:     SNAPSHOT.construirClave(p.sku, p.proveedor, ubicacion, "L" + l.numero),
            sku: p.sku, proveedor: p.proveedor, ubicacion, slot: "L" + l.numero,
            lote: l.numLote, producto: p.nombre, usuario: "sincronizacion",
            stock: UTIL.normalizarNumero(l.stock)
          });
        });
      } else {
        estados.push({
          clave:     SNAPSHOT.construirClave(p.sku, p.proveedor, ubicacion, "TOTAL"),
          sku: p.sku, proveedor: p.proveedor, ubicacion, slot: "TOTAL",
          lote: "", producto: p.nombre, usuario: "sincronizacion",
          stock: UTIL.normalizarNumero(p.stockTotal)
        });
      }
    });

    const registrados = SNAPSHOT.procesarEstados(estados);
    Logger.log("Sincronización completa: " + registrados + " movimiento(s) registrado(s) sobre " + estados.length + " producto/lote revisados.");
    return registrados;
  }
};

/**
 * Trigger simple de Google Sheets. Se dispara en cada edición manual del
 * Spreadsheet de inventario — sea de una celda o de un bloque (pegado).
 */
function onEdit(e) {
  try {
    if (!e || !e.range) return;

    const hoja = e.range.getSheet();
    const nombreHoja = hoja.getName();
    if (CONFIG.HOJAS_EXCLUIR.indexOf(nombreHoja) !== -1) return;
    if (nombreHoja === CONFIG.NOMBRE_HOJA_SNAPSHOT) return; // Nunca reaccionar a su propia hoja de control.

    DETECTOR.procesarRangoEditado(hoja, nombreHoja, e.range);
  } catch (err) {
    Logger.log("Error en onEdit: " + err);
  }
}

/**
 * Fuerza una sincronización completa del inventario contra el snapshot.
 */
function sincronizarStockCompleto() {
  return DETECTOR.sincronizarTodo();
}

/**
 * Instala (una sola vez) un trigger de tiempo que ejecuta
 * sincronizarStockCompleto() cada 15 minutos. Ejecutar UNA VEZ manualmente.
 */
function configurarSincronizacionAutomatica() {
  const yaExiste = ScriptApp.getProjectTriggers().some(
    t => t.getHandlerFunction() === "sincronizarStockCompleto"
  );
  if (yaExiste) {
    Logger.log("El trigger de sincronización automática ya estaba instalado.");
    return;
  }
  ScriptApp.newTrigger("sincronizarStockCompleto")
    .timeBased()
    .everyMinutes(15)
    .create();
  Logger.log("Trigger de sincronización automática instalado (cada 15 minutos).");
}


/* ============================================================================
 * MÓDULO: USUARIOS (placeholder para roles futuros)
 * ========================================================================= */

const USUARIOS = {

  // Posiciones de respaldo (hoja Usuarios): A Usuario, B Contraseña, C Nombre,
  // D Cargo, E Rol, F Estado, G Último acceso, H Fecha de creación.
  COL_RESPALDO: { usuario: 0, password: 1, nombre: 2, cargo: 3, rol: 4, estado: 5, ultimoAcceso: 6 },

  obtenerHoja() {
    const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
    return ss.getSheetByName("Usuarios");
  },

  /**
   * Normaliza texto para comparar: sin tildes, sin espacios invisibles ni
   * repetidos, sin mayúsculas. Se usa para usuario, rol y estado.
   */
  normalizar(valor) {
    return String(valor == null ? "" : valor)
      .replace(/[\u00A0\u200B-\u200D\uFEFF]/g, " ")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  },

  /** Ubica las columnas por encabezado; si no se reconoce, usa A..G. */
  mapaColumnas(encabezados) {
    const enc = (encabezados || []).map(h => USUARIOS.normalizar(h));
    const buscar = (nombres, respaldo) => {
      const i = enc.findIndex(h => nombres.indexOf(h) !== -1);
      return i >= 0 ? i : respaldo;
    };
    const r = USUARIOS.COL_RESPALDO;
    return {
      usuario: buscar(["usuario"], r.usuario),
      password: buscar(["contrasena", "password", "clave"], r.password),
      nombre: buscar(["nombre"], r.nombre),
      cargo: buscar(["cargo"], r.cargo),
      rol: buscar(["rol"], r.rol),
      estado: buscar(["estado"], r.estado),
      ultimoAcceso: buscar(["ultimo acceso"], r.ultimoAcceso)
    };
  },

  /** Devuelve el correo del usuario activo, o "admin" si no se puede obtener. */
  obtenerUsuarioActual() {
    try {
      const email = Session.getActiveUser().getEmail();
      return email || "admin";
    } catch (e) {
      return "admin";
    }
  },

  validarSesion(token) {
    if (!token) return null;
    try {
      const cache = CacheService.getScriptCache();
      const raw = cache.get("QI_SESION_" + token);
      const sesion = raw ? JSON.parse(raw) : null;
      return sesion && sesion.usuario !== undefined && sesion.usuario !== "" ? sesion : null;
    } catch (e) { return null; }
  },

  /**
   * Devuelve el rol vigente (normalizado: "administrador", "bodega"...) del
   * usuario asociado a una sesión válida. Nunca acepta el rol enviado por el
   * navegador ni el guardado en la sesión: lo lee de la hoja Usuarios, y solo
   * si el usuario sigue con estado Activo.
   */
  obtenerRolAutorizado(sesion) {
    try {
      if (!sesion || sesion.usuario === undefined || sesion.usuario === null) return "";
      const hoja = this.obtenerHoja();
      if (!hoja) return "";
      const filas = hoja.getDataRange().getValues();
      if (filas.length < 2) return "";
      const c = this.mapaColumnas(filas[0]);
      const usuarioBuscado = this.normalizar(sesion.usuario);
      if (!usuarioBuscado) return "";
      for (let i = 1; i < filas.length; i++) {
        const fila = filas[i];
        if (this.normalizar(fila[c.usuario]) !== usuarioBuscado) continue;
        if (this.normalizar(fila[c.estado]) !== "activo") continue;
        return this.normalizar(fila[c.rol]);
      }
      return "";
    } catch (e) {
      Logger.log("No se pudo validar el rol actual: " + e);
      return "";
    }
  },

  login(usuario, password) {

    const hoja = this.obtenerHoja();

    if (!hoja) {
      return { success: false, mensaje: "No se encontró la hoja Usuarios." };
    }

    const datos = hoja.getDataRange().getValues();

    if (datos.length < 2) {
      return { success: false, mensaje: "Usuario o contraseña incorrectos" };
    }

    const c = this.mapaColumnas(datos[0]);
    const usuarioBuscado = this.normalizar(usuario);
    const claveRecibida = String(password == null ? "" : password).trim();

    if (usuarioBuscado) {

      for (let i = 1; i < datos.length; i++) {

        const fila = datos[i];

        if (
          this.normalizar(fila[c.usuario]) === usuarioBuscado &&
          String(fila[c.password] == null ? "" : fila[c.password]).trim() === claveRecibida &&
          this.normalizar(fila[c.estado]) === "activo"
        ) {

          hoja.getRange(i + 1, c.ultimoAcceso + 1).setValue(new Date());

          return {
            success: true,
            usuario: {
              usuario: String(fila[c.usuario]).trim(),
              nombre: fila[c.nombre],
              cargo: fila[c.cargo],
              rol: String(fila[c.rol] == null ? "" : fila[c.rol]).trim()
            }
          };

        }

      }

    }

    return {
      success: false,
      mensaje: "Usuario o contraseña incorrectos"
    };

  }

};

/* ============================================================================
 * MÓDULO: API PÚBLICA
 * Los nombres, parámetros y formas de respuesta son IDÉNTICOS a los que ya
 * usa la aplicación — no se debe renombrar nada de esta sección.
 * ========================================================================= */

/** action=getInventario — devuelve { productos, total }. */
function getInventario(forzar) {

  const inicio = Date.now();

  // 1. SI NO SE FUERZA: intentar primero el snapshot persistente
  if (!forzar) {

    const rapido = INVENTARIO_RAPIDO.obtener();

    if (rapido) {

      Logger.log("INVENTARIO DESDE SNAPSHOT: " + (Date.now() - inicio) + " ms");

      return rapido;
    }

    // Si no existe snapshot, probar caché normal
    const cacheado = CACHE.get(CACHE.KEY_INVENTARIO);

    if (cacheado) {

      INVENTARIO_RAPIDO.guardar(cacheado);

      Logger.log("INVENTARIO DESDE CACHE: " + (Date.now() - inicio) + " ms");

      return cacheado;
    }
  }

  // 2. SOLO AQUÍ se leen todas las hojas
  const datos = INVENTARIO.leerSheets();

  // 3. Guardar en las dos cachés
  CACHE.put(
    CACHE.KEY_INVENTARIO,
    datos,
    CACHE.TTL_INVENTARIO
  );

  INVENTARIO_RAPIDO.guardar(datos);

  Logger.log("INVENTARIO GENERADO DESDE SHEETS: " + (Date.now() - inicio) + " ms");

  return datos;
}

/**
 * action=getResumen — devuelve el resumen combinado TEGUS + SPS.
 *  1) Si hay resumen cacheado, se devuelve directo.
 *  2) Si no, se reutiliza el inventario cacheado o se lee Sheets.
 */
function getResumen(forzar) {

  if (!forzar) {

    const resumenCacheado = CACHE.get(CACHE.KEY_RESUMEN);

    if (resumenCacheado) {
      return resumenCacheado;
    }

  }

  // INVENTARIO TEGUCIGALPA
  let datosTegus = !forzar ? CACHE.get(CACHE.KEY_INVENTARIO) : null;

  if (!datosTegus) {

    datosTegus = INVENTARIO.leerSheets();

    CACHE.put(
      CACHE.KEY_INVENTARIO,
      datosTegus,
      CACHE.TTL_INVENTARIO
    );

  }

  // INVENTARIO SPS
  const datosSPS = getInventarioSPS();

  // COMBINAR TEGUS + SPS POR SKU
  const mapa = {};

  (datosTegus.productos || []).forEach(producto => {

    const sku = String(producto.sku || "").trim();

    if (!sku) return;

    if (!mapa[sku]) {

      mapa[sku] = {
        ...producto,
        stockTotal: Number(producto.stockTotal) || 0,
        lotes: Array.isArray(producto.lotes) ? [...producto.lotes] : []
      };

    } else {

      mapa[sku].stockTotal += Number(producto.stockTotal) || 0;

      if (Array.isArray(producto.lotes)) {
        mapa[sku].lotes.push(...producto.lotes);
      }

    }

  });

  (datosSPS.productos || []).forEach(producto => {

    const sku = String(producto.sku || "").trim();

    if (!sku) return;

    if (!mapa[sku]) {

      mapa[sku] = {
        ...producto,
        stockTotal: Number(producto.stockTotal) || 0,
        lotes: Array.isArray(producto.lotes) ? [...producto.lotes] : []
      };

    } else {

      mapa[sku].stockTotal += Number(producto.stockTotal) || 0;

      if (Array.isArray(producto.lotes)) {
        mapa[sku].lotes.push(...producto.lotes);
      }

    }

  });

  const productosCombinados = Object.values(mapa);

  // CALCULAR RESUMEN CON TEGUS + SPS
  const resumen = INVENTARIO.calcularResumen(productosCombinados);

  // GUARDAR EN CACHÉ
  CACHE.put(
    CACHE.KEY_RESUMEN,
    resumen,
    CACHE.TTL_RESUMEN
  );

  return resumen;

}

/**
 * action=getInicio
 * Carga inicial completa: TEGUS + SPS + resumen.
 * NO reemplaza los endpoints existentes; solo evita múltiples llamadas HTTP.
 */
function getInicio(forzar) {

  const inicio = Date.now();

  // OBTENER TEGUS
  const datosTegus = getInventario(forzar);

  // OBTENER SPS
  const datosSPS = getInventarioSPS();

  // COMBINAR TEGUS + SPS POR SKU
  const mapa = {};

  (datosTegus.productos || []).forEach(producto => {

    const sku = String(producto.sku || producto.codigo || "").trim().toUpperCase();

    if (!sku) return;

    if (!mapa[sku]) {

      mapa[sku] = {
        ...producto,
        sku: sku,
        stockTotal: Number(producto.stockTotal) || 0,
        stockTGU: Number(producto.stockTotal) || 0,
        stockSPS: 0,
        lotes: Array.isArray(producto.lotes) ? [...producto.lotes] : []
      };

    } else {

      mapa[sku].stockTotal += Number(producto.stockTotal) || 0;
      mapa[sku].stockTGU = (Number(mapa[sku].stockTGU) || 0) + (Number(producto.stockTotal) || 0);

      if (Array.isArray(producto.lotes) && !["material", "repuesto"].includes(String(mapa[sku].tipo || "").toLowerCase())) {
        mapa[sku].lotes.push(...producto.lotes);
      }

    }

  });

  (datosSPS.productos || []).forEach(producto => {

    const sku = String(producto.sku || producto.codigo || "").trim().toUpperCase();

    if (!sku) return;

    if (!mapa[sku]) {

      mapa[sku] = {
        ...producto,
        sku: sku,
        stockTotal: Number(producto.stockTotal) || 0,
        stockTGU: 0,
        stockSPS: Number(producto.stockTotal) || 0,
        lotes: Array.isArray(producto.lotes) ? [...producto.lotes] : []
      };

    } else {

      mapa[sku].stockTotal += Number(producto.stockTotal) || 0;
      mapa[sku].stockSPS = (Number(mapa[sku].stockSPS) || 0) + (Number(producto.stockTotal) || 0);

      if (Array.isArray(producto.lotes) && !["material", "repuesto"].includes(String(mapa[sku].tipo || "").toLowerCase())) {
        mapa[sku].lotes.push(...producto.lotes);
      }

    }

  });

  // INVENTARIO FINAL
  const productos = Object.values(mapa);

  // RESUMEN
  const resumen = INVENTARIO.calcularResumen(productos);

  Logger.log("getInicio completado en " + (Date.now() - inicio) + " ms");

  // RESPUESTA ÚNICA
  return {
    productos: productos,
    total: productos.length,
    resumen: resumen
  };

}

/** action=buscar&q=... — devuelve { productos, total }. */
function buscarProductos(q, forzar) {
  const termino = String(q || "").trim().toLowerCase();
  const datos = getInventario(forzar);

  if (!termino) return { productos: [], total: 0 };

  const resultado = datos.productos.filter(p => {
    const nombre    = String(p.nombre || "").toLowerCase();
    const sku       = String(p.sku || "").toLowerCase();
    const proveedor = String(p.proveedor || "").toLowerCase();
    const categoria = String(p.categoria || "").toLowerCase();
    const enLotes = (p.lotes || []).some(l =>
      String(l.numLote || "").toLowerCase().indexOf(termino) !== -1
    );

    return nombre.indexOf(termino) !== -1
      || sku.indexOf(termino) !== -1
      || proveedor.indexOf(termino) !== -1
      || categoria.indexOf(termino) !== -1
      || enLotes;
  });

  return { productos: resultado, total: resultado.length };
}

/** action=getMovimientos — devuelve { movimientos, total }. */
function getMovimientos(forzar, fecha) {
  const clave = CACHE.claveMovimientos(fecha);

  if (!forzar) {
    const cacheado = CACHE.get(clave);
    if (cacheado) return cacheado;
  }

  const resultado = MOVIMIENTOS.leerDesdeSheet(fecha || "");
  CACHE.put(clave, resultado, CACHE.TTL_MOVIMIENTOS);
  return resultado;
}

/** action=getResumenMovimientos — devuelve { entradas, salidas, total, productos, topProductos }. */
function getResumenMovimientos(fecha) {
  const datos = getMovimientos(false, fecha).movimientos;

  let entradas = 0;
  let salidas = 0;
  const productos = {};

  datos.forEach(m => {
    if (m.movimiento === "Entrada") entradas++;
    else if (m.movimiento === "Salida") salidas++;

    productos[m.producto] = (productos[m.producto] || 0) + 1;
  });

  const topProductos = Object.entries(productos)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  return {
    entradas,
    salidas,
    total: datos.length,
    productos: Object.keys(productos).length,
    topProductos
  };
}

/**
 * Punto de entrada de la Web App. Enruta según ?action=... exactamente
 * igual que antes, para no romper ninguna llamada del frontend.
 */
function doGet(e) {
  const accion = (e && e.parameter && e.parameter.action) || "";
  const forzar = !!(e && e.parameter && e.parameter.forzar === "1");

  const responder = (datos) =>
    ContentService.createTextOutput(JSON.stringify(datos))
      .setMimeType(ContentService.MimeType.JSON);

  try {
    switch (accion) {

      case "login":
        return responder(
          login(
            e.parameter.usuario || "",
            e.parameter.password || ""
          )
        );

      case "getInventario":
        return responder(getInventario(forzar));

      case "getInventarioSPS":
        return responder(getInventarioSPS());

      case "getResumen":
        return responder(getResumen(forzar));

      case "getInicio":
        return responder(getInicio(forzar));

      case "buscar":
        return responder(buscarProductos(e.parameter.q || "", forzar));

      case "getMovimientos":
        return responder(getMovimientos(forzar, e.parameter.fecha || ""));

      case "getResumenMovimientos":
        return responder(getResumenMovimientos(e.parameter.fecha || ""));

      case "getMesesVencimientos":
        return responder(getMesesVencimientos());

      case "getVencimientos":
        return responder(
          getVencimientos(
            e.parameter.mes || ""
          )
        );

      default:
        return HtmlService.createHtmlOutputFromFile("Index")
          .setTitle("Inventario — Vendedores");
    }

  } catch (err) {
    Logger.log("Error en doGet (" + accion + "): " + err);
    return responder({
      error: true,
      mensaje: String(err)
    });
  }
}

function limpiarCache() {
  CACHE.invalidarTodo();
  Logger.log("Caché limpiada.");
}

function login(usuario, password) {
  const resultado = USUARIOS.login(usuario, password);
  if (!resultado || !resultado.success || !resultado.usuario) return resultado;
  const token = Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
  const sesion = { usuario: resultado.usuario.usuario, rol: resultado.usuario.rol, nombre: resultado.usuario.nombre };
  CacheService.getScriptCache().put("QI_SESION_" + token, JSON.stringify(sesion), 21600);
  resultado.token = token;
  return resultado;
}

/* ============================================================================
   VENCIMIENTOS
============================================================================ */

function getMesesVencimientos() {

  const ss = SpreadsheetApp.openById(CONFIG.SS_VENCIMIENTOS_ID);

  return ss.getSheets().map(h => h.getName());

}

function getVencimientos(mes) {

  const ss = SpreadsheetApp.openById(CONFIG.SS_VENCIMIENTOS_ID);

  const hoja = ss.getSheetByName(mes);

  if (!hoja) {

    return {
      productos: [],
      resumen: {}
    };

  }

  const datos = hoja.getDataRange().getValues();

  // fila 1 = título (índice 0), fila 2 = encabezados (índice 1),
  // fila 3 en adelante = datos reales (índice 2+).
  if (datos.length <= 2) {

    return {
      productos: [],
      resumen: {}
    };

  }

  const productos = [];

  let totalUnidades = 0;

  const marcas = new Set();

  for (let i = 2; i < datos.length; i++) {

    const fila = datos[i];

    productos.push({

      item: fila[0],

      marca: fila[1],

      codigo: fila[2],

      producto: fila[3],

      cantidad: Number(fila[4]) || 0,

      lote: fila[5],

      fecha: fila[6]

    });

    totalUnidades += Number(fila[4]) || 0;

    marcas.add(fila[1]);

  }

  return {

    productos,

    resumen: {

      productos: productos.length,

      lotes: productos.length,

      unidades: totalUnidades,

      marcas: marcas.size

    }

  };

}