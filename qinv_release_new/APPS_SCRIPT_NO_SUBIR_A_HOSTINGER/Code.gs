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
 *
 *  FIX — SESIÓN / OBSERVACIÓN / REINTENTOS (2026-10-07):
 *    1) El token de sesión ahora es un token firmado (HMAC-SHA256, 6 h) que ya
 *       no depende de CacheService (podía descartarse antes de tiempo).
 *       Los tokens anteriores en caché siguen aceptándose hasta que expiren.
 *       doPost informa el motivo real (ausente / vencida / inválida).
 *    2) MOVIMIENTOS guarda y lee la columna "Observación" (se agrega al final
 *       de los encabezados de la hoja Movimientos si no existe).
 *    3) requestId: un reintento de la misma tanda no vuelve a registrar nada
 *       (SOLICITUDES, 24 h).
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
  HOJAS_MATERIALES: ["Materiales", "MATERIALES"],

  // Hojas con estructura de dos niveles (grupo principal + subcategoría).
  HOJAS_DOS_NIVELES: ["Pruebas Especiales SNIBE"],

  // Umbral de stock bajo.
  STOCK_BAJO_UMBRAL: 5,

  // Color de fondo de la fila de un producto que se quedó sin ninguna existencia.
  COLOR_SIN_EXISTENCIA: "#b4a7d6",

  // Valores que jamás deben interpretarse como un SKU o nombre válido.
  SKU_IGNORAR:    ["cellimage", "celimage", "sku", "código", "codigo"],
  NOMBRE_IGNORAR: ["portafolio", "producto", "descripcion", "descripción", "nombre"],

  MESES_ES: ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"],
};


/* ============================================================================
 * CONTEXTO DE REGISTRO POR LOTE
 * Mientras LOTE_CTX_ no sea null (solo dentro de registrarMovimientosLote_),
 * las escrituras auxiliares (historial, snapshot, invalidación de cachés) se
 * acumulan en memoria y se aplican UNA sola vez al terminar. Antes cada
 * producto hacía todo esto por separado, y era lo que tardaba minutos.
 * ========================================================================= */

let LOTE_CTX_ = null;

/** Abre un Spreadsheet una sola vez por ejecución cuando hay un lote en curso. */
function abrirSpreadsheet_(id) {
  if (!LOTE_CTX_) return SpreadsheetApp.openById(id);
  if (!LOTE_CTX_.spreadsheets[id]) LOTE_CTX_.spreadsheets[id] = SpreadsheetApp.openById(id);
  return LOTE_CTX_.spreadsheets[id];
}

/** Valores de una hoja: se leen una vez por lote y se reutilizan. */
function valoresHoja_(hoja) {
  if (!LOTE_CTX_) return hoja.getDataRange().getValues();
  const clave = hoja.getParent().getId() + "|" + hoja.getName();
  if (!LOTE_CTX_.hojas[clave]) LOTE_CTX_.hojas[clave] = hoja.getDataRange().getValues();
  return LOTE_CTX_.hojas[clave];
}

/** Después de modificar una fila, vuelve a leer SOLO esa fila en la copia en memoria. */
function refrescarFilaEnMemoria_(hoja, indiceFila) {
  if (!LOTE_CTX_) return;
  const clave = hoja.getParent().getId() + "|" + hoja.getName();
  const valores = LOTE_CTX_.hojas[clave];
  if (!valores || !valores[indiceFila]) return;
  valores[indiceFila] = hoja.getRange(indiceFila + 1, 1, 1, valores[indiceFila].length).getValues()[0];
}

/* ============================================================================
 * MÓDULO: CACHÉ
 * ========================================================================= */

const CACHE = {

  KEY_INVENTARIO: "inventario_cache_v13",
  KEY_RESUMEN: "inventario_resumen_cache_v3",
  KEY_SPS: "inventario_sps_cache_v2",
  KEY_MOVIMIENTOS_PREFIX: "movimientos_cache_v2",
  // Fase 2.6: respuesta combinada de getInicio (TGU + SPS ya mezclados) y lista de marcas.
  KEY_INICIO: "inventario_inicio_cache_v1",
  KEY_MARCAS: "marcas_cache_v1",

  TTL_INVENTARIO: 300,
  TTL_RESUMEN: 300,
  TTL_SPS: 300,
  TTL_MOVIMIENTOS: 60,
  TTL_INICIO: 60,      // corto a propósito: contiene existencias
  TTL_MARCAS: 600,     // logotipos: cambian muy poco

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

    // En un registro por lote la invalidación se hace UNA sola vez al final.
    if (LOTE_CTX_) { LOTE_CTX_.invalidarInventario = true; return; }

    CACHE.remove(CACHE.KEY_INVENTARIO);

    CACHE.remove(CACHE.KEY_RESUMEN);

    CACHE.remove(CACHE.KEY_INICIO);

    if (
      typeof INVENTARIO_RAPIDO !== "undefined" &&
      INVENTARIO_RAPIDO.invalidar
    ) {
      INVENTARIO_RAPIDO.invalidar();
    }

  },


  invalidarSPS() {

    if (LOTE_CTX_) { LOTE_CTX_.invalidarSPS = true; return; }

    CACHE.remove(CACHE.KEY_SPS);

    CACHE.remove(CACHE.KEY_INICIO);

  },


  invalidarMovimientos() {

    if (LOTE_CTX_) { LOTE_CTX_.invalidarMovimientos = true; return; }

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

  KEY: "INVENTARIO_SNAPSHOT_RAPIDO_V5",
  PREFIJO: "INVENTARIO_SNAPSHOT_RAPIDO_V5_PARTE_",
  TAMANO_PARTE: 8000,

  guardar(datos) {

    try {

      const props = PropertiesService.getScriptProperties();

      const texto = JSON.stringify(datos);

      const partes = [];

      for (let inicio = 0; inicio < texto.length; inicio += this.TAMANO_PARTE) {
        partes.push(texto.substring(inicio, inicio + this.TAMANO_PARTE));
      }

      // Una sola llamada para leer lo existente y una sola para escribir todo.
      const existentes = props.getProperties();

      const nuevas = {};

      partes.forEach((parte, i) => {
        nuevas[this.PREFIJO + i] = parte;
      });

      nuevas[this.KEY] = JSON.stringify({
        partes: partes.length,
        actualizado: new Date().toISOString()
      });

      props.setProperties(nuevas, false);

      // Quitar solo las partes sobrantes de un snapshot anterior más grande.
      Object.keys(existentes).forEach(key => {
        if (key.indexOf(this.PREFIJO) === 0) {
          const n = Number(key.substring(this.PREFIJO.length));
          if (!(n < partes.length)) props.deleteProperty(key);
        }
      });

      Logger.log("SNAPSHOT RÁPIDO guardado: " + partes.length + " partes");

    } catch (e) {

      // Un snapshot que no cabe nunca debe romper la respuesta al usuario.
      Logger.log("No se pudo guardar el snapshot rápido: " + e);

      try { PropertiesService.getScriptProperties().deleteProperty(this.KEY); } catch (e2) {}

    }
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

    // Basta con borrar el manifiesto: sin él, obtener() ignora las partes, y
    // la próxima escritura las reemplaza. Es 1 llamada en vez de decenas.
    PropertiesService.getScriptProperties().deleteProperty(this.KEY);

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
 * Pinta de morado la fila de un producto sin ninguna existencia y le quita el
 * color cuando vuelve a tener. Solo quita el fondo si es exactamente el morado
 * del sistema (no toca otros colores). ultimaColumna es la cantidad de
 * columnas de la tabla (base uno).
 */
function actualizarColorFilaSinExistencia_(hoja, filaReal, ultimaColumna, totalExistencia) {
  try {
    const color = CONFIG.COLOR_SIN_EXISTENCIA;
    const ancho = Math.max(Number(ultimaColumna) || 0, 1);
    const fila = hoja.getRange(filaReal, 1, 1, ancho);
    if (Number(totalExistencia) <= 0) {
      fila.setBackground(color);
    } else {
      const actual = String(hoja.getRange(filaReal, 1).getBackground() || "").toLowerCase();
      if (actual === color.toLowerCase()) fila.setBackground(null);
    }
  } catch (e) {
    Logger.log("No se pudo actualizar el color de la fila: " + e);
  }
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
  const ss = abrirSpreadsheet_(CONFIG.SS_SPS_ID);
  const hoja = ss.getSheetByName(CONFIG.SS_SPS_HOJA_PRODUCTOS);
  if (!hoja) throw new Error('No se encontró la hoja Productos de SPS.');

  const valores = valoresHoja_(hoja);
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
    if (LOTE_CTX_) { while (valores.length <= filaLote) valores.push(filaNueva.slice()); valores[filaLote] = filaNueva.slice(); }
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
  if (LOTE_CTX_ && valores[filaLote]) valores[filaLote][col.cantidad] = stockNuevo;
  if (LOTE_CTX_ && loteCreado && col.vence >= 0 && valores[filaLote]) valores[filaLote][col.vence] = parsearFechaVencimiento_(m.vencimiento) || '';
  const ubicacion = col.ubicacion >= 0 ? String((valores[filaLote] && valores[filaLote][col.ubicacion]) || '').trim() : '';
  try {
    SNAPSHOT.fijarEstado({
      clave: SNAPSHOT.construirClave(codigoFinal, 'SPS', ubicacion, m.sinLote ? 'SIN_LOTE' : String(m.lote)),
      sku: codigoFinal, proveedor: 'SPS', ubicacion: ubicacion, slot: m.sinLote ? 'SIN_LOTE' : String(m.lote),
      lote: m.lote, producto: nombre, stock: stockNuevo
    });
  } catch (errSnap) { Logger.log('No se pudo actualizar snapshot SPS: ' + errSnap); }

  const movimientoSpsOk = MOVIMIENTOS.registrar({
    usuario: m.usuario || USUARIOS.obtenerUsuarioActual(), producto: nombre, sku: codigoFinal,
    lote: m.lote, movimiento: m.tipo === 'entrada' ? 'Entrada' : 'Salida',
    stockAnterior: stockAnterior, stockNuevo: stockNuevo, cliente: m.cliente || '',
    factura: m.factura || m.documento || '', cantidad: m.cantidad,
    observacion: (m.observacion ? m.observacion + ' | ' : '') + 'Bodega: SPS'
  });
  CACHE.invalidarInventario();
  CACHE.invalidarSPS();
  CACHE.invalidarMovimientos();
  return {
    success: true,
    message: m.tipo === 'entrada' ? 'Entrada registrada correctamente en SPS.' : 'Salida registrada correctamente en SPS.',
    producto: nombre, sku: codigoFinal, lote: m.lote, cantidad: m.cantidad,
    stockAnterior: stockAnterior, stockNuevo: stockNuevo, bodega: 'SPS',
    movimientoRegistrado: movimientoSpsOk,
    advertencia: movimientoSpsOk ? '' : 'El inventario se actualizó, pero NO se pudo guardar el movimiento en el historial. Revise la hoja Movimientos.'
  };
}

function respuestaJson_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {

  try {

    if (!e || !e.postData || !e.postData.contents) {
      throw new Error("No se recibieron datos.");
    }

    const datos = JSON.parse(e.postData.contents);

    const accion = String(datos.action || "");

    // Inicio de sesión por POST: la contraseña viaja en el cuerpo, no en la URL
    // (las URL quedan en historial, registros y cachés). Usa la misma función
    // login() que la acción GET, que se conserva por compatibilidad.
    if (accion === "login") {
      return respuestaJson_(login(
        String(datos.usuario == null ? "" : datos.usuario),
        String(datos.password == null ? "" : datos.password)
      ));
    }

    // Acciones de gestión (pedidos, fotos de perfil e imágenes de referencia). Cada una
    // valida token y rol en el servidor (ver autenticarSolicitud_).
    const respuestaGestion = manejarAccionGestion_(accion, datos);
    if (respuestaGestion) return respuestaJson_(respuestaGestion);

    if (accion !== "registrarMovimiento" && accion !== "registrarMovimientos") {
      throw new Error("Acción no válida: «" + accion + "». Si es una acción reciente, la implementación de Apps Script es una versión anterior: cree una Nueva versión en Implementar > Administrar implementaciones.");
    }

    const tokenSesion = String(datos.token || "").trim();
    const validacion = USUARIOS.validarSesionDetalle(tokenSesion);
    const sesion = validacion.sesion;

    // 1) El token debe corresponder a una sesión vigente (firmada, 6 h).
    if (!sesion) {
      const mensajesSesion = {
        ausente: "La solicitud no incluyó el token de sesión. Cierre sesión e ingrese nuevamente.",
        vencida: "Su sesión venció (duran 6 horas). Cierre sesión e ingrese nuevamente.",
        invalida: "El token de sesión no es válido. Cierre sesión e ingrese nuevamente.",
        no_encontrada: "La sesión ya no existe en el servidor. Cierre sesión e ingrese nuevamente."
      };
      const errSesion = new Error(mensajesSesion[validacion.motivo] || "Su sesión no es válida o ya venció. Cierre sesión e ingrese nuevamente.");
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

    // Quién hace el movimiento: el nombre del usuario que inició sesión
    // (hoja Usuarios, columna Nombre); no el correo de quien desplegó el script.
    const usuarioMovimiento =
      String(sesion.nombre || "").trim() ||
      String(sesion.usuario || "").trim() ||
      USUARIOS.obtenerUsuarioActual();

    // Varios productos de una misma factura/traslado en UNA sola solicitud.
    if (accion === "registrarMovimientos") {
      return respuestaJson_(registrarMovimientosLote_(datos, usuarioMovimiento));
    }

    return respuestaJson_(registrarMovimientoUno_(datos, usuarioMovimiento));

  } catch (error) {

    Logger.log("Error en registrarMovimiento: " + error);

    return respuestaJson_({
      success: false,
      message: String(error.message || error),
      codigo: error.codigo || ""
    });
  }

}

/**
 * Registra VARIOS productos (una factura o traslado completo) en una sola
 * ejecución. Abre cada hoja una vez, escribe el historial y el snapshot una
 * vez y limpia las cachés una vez. Se detiene en el primer error y devuelve
 * cuántos productos ya quedaron registrados para que el frontend no los repita.
 */
function registrarMovimientosLote_(datos, usuarioMovimiento) {

  const items = Array.isArray(datos.items) ? datos.items : [];

  if (!items.length) throw new Error("No se recibieron productos para registrar.");

  if (items.length > 60) throw new Error("Demasiados productos en una sola solicitud (máximo 60).");

  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(120000);
  } catch (e) {
    throw new Error("El sistema está procesando otro registro. Espere unos segundos e intente de nuevo.");
  }

  // Identificador de la solicitud (lo genera el frontend y lo conserva al
  // reintentar la MISMA tanda). Si ya se procesó, no se vuelve a ejecutar.
  const requestId = SOLICITUDES.limpiarId(datos.requestId);

  if (requestId) {
    const previa = SOLICITUDES.buscar(requestId);
    if (previa) {
      lock.releaseLock();
      return Object.assign({}, previa, {
        duplicado: true,
        resultados: [],
        message: (previa.success ? "Esta solicitud ya estaba registrada; no se repitió. " : "Esta solicitud ya se había procesado parcialmente; no se repitió. ") + (previa.message || "")
      });
    }
  }

  const ctx = {
    movimientos: [],
    snapshot: {},
    hojas: {},
    spreadsheets: {},
    invalidarInventario: false,
    invalidarSPS: false,
    invalidarMovimientos: false
  };

  const resultados = [];
  let errorMensaje = "";
  let errorCodigo = "";
  let errorIndice = -1;
  let historialOk = true;

  LOTE_CTX_ = ctx;

  try {

    for (let i = 0; i < items.length; i++) {

      const d = Object.assign({}, items[i], {
        tipo: datos.tipo,
        bodega: items[i].bodega || datos.bodega,
        cliente: datos.cliente,
        factura: datos.factura || datos.documento,
        documento: datos.documento || datos.factura,
        observacion: datos.observacion
      });

      try {

        const r = registrarMovimientoUno_(d, usuarioMovimiento);
        resultados.push(Object.assign({ indice: i }, r));

      } catch (err) {

        errorMensaje = String(err.message || err);
        errorCodigo = err.codigo || "";
        errorIndice = i;
        break;

      }
    }

  } finally {

    // Escribir lo acumulado, aunque haya habido un error a mitad del lote:
    // los productos ya procesados SÍ modificaron las hojas de inventario.
    try {
      if (ctx.movimientos.length) MOVIMIENTOS.guardarLote(ctx.movimientos);
    } catch (e) {
      historialOk = false;
      Logger.log("No se pudo guardar el historial del lote: " + e);
    }

    try {
      SNAPSHOT.fijarEstadosLote(ctx.snapshot);
    } catch (e) {
      Logger.log("No se pudo actualizar el snapshot del lote: " + e);
    }

    // Salir del modo lote ANTES de invalidar, para que se limpie de verdad.
    LOTE_CTX_ = null;

    // Dejar constancia de la solicitud (aún con el lock tomado) para que un
    // reintento tras un corte de conexión no duplique lo ya registrado.
    try {
      if (requestId && resultados.length) {
        SOLICITUDES.guardar(requestId, {
          success: errorIndice < 0,
          procesados: resultados.length,
          total: items.length,
          codigo: errorCodigo,
          indiceError: errorIndice,
          movimientoRegistrado: historialOk,
          message: errorIndice >= 0
            ? "SKU " + String(items[errorIndice].producto || items[errorIndice].sku || "") + ": " + errorMensaje
            : (String(datos.tipo).toLowerCase() === "entrada" ? "Entrada" : "Salida") + " registrada correctamente (" + resultados.length + " productos)."
        });
      }
    } catch (e) {
      Logger.log("No se pudo guardar el identificador de la solicitud: " + e);
    }

    try {
      if (ctx.invalidarInventario) CACHE.invalidarInventario();
      if (ctx.invalidarSPS) CACHE.invalidarSPS();
      if (ctx.invalidarMovimientos) CACHE.invalidarMovimientos();
    } catch (e) {
      Logger.log("No se pudo limpiar la caché del lote: " + e);
    }

    lock.releaseLock();
  }

  const procesados = resultados.length;

  const base = {
    procesados: procesados,
    total: items.length,
    resultados: resultados,
    movimientoRegistrado: historialOk,
    advertencia: historialOk ? "" : "El inventario se actualizó, pero NO se pudo guardar el historial de movimientos. Revise la hoja Movimientos."
  };

  if (errorIndice >= 0) {
    return Object.assign(base, {
      success: false,
      message: "SKU " + String(items[errorIndice].producto || items[errorIndice].sku || "") + ": " + errorMensaje,
      codigo: errorCodigo,
      indiceError: errorIndice
    });
  }

  return Object.assign(base, {
    success: true,
    message: (String(datos.tipo).toLowerCase() === "entrada" ? "Entrada" : "Salida") + " registrada correctamente (" + procesados + " productos)."
  });
}

/**
 * Registra UN producto. Devuelve un objeto simple { success, ... } o lanza
 * un Error si algo no es válido (el llamador decide cómo responder).
 */
function registrarMovimientoUno_(datos, usuarioMovimiento) {

  {

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
        usuario: usuarioMovimiento,
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

    const ss = abrirSpreadsheet_(CONFIG.SS_ID);
    // TGU: registrar movimientos únicamente contra Reactivos.
    // La rama SPS se resuelve antes y permanece sin cambios.
    const hojaReactivos = ss.getSheetByName("Reactivos");
    if (!hojaReactivos) throw new Error('No se encontró la hoja "Reactivos" en el inventario de Tegucigalpa.');
    const hojas = [hojaReactivos];

    let filaTocada = null;
    let encontrado = false;
    let productoNombre = "";
    let stockAnterior = 0;
    let stockNuevo = 0;
    let movimientoRegistrado = true;

    for (const hoja of hojas) {

      if (CONFIG.HOJAS_EXCLUIR.includes(hoja.getName())) {
        continue;
      }

      const datosHoja = valoresHoja_(hoja);

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

          let columnasMat = encabezados.length;
          while (columnasMat > 1 && !encabezados[columnasMat - 1]) columnasMat--;
          actualizarColorFilaSinExistencia_(hoja, filaReal, columnasMat, stockNuevo);

          encontrado = true;
          filaTocada = { hoja: hoja, indice: filaProducto };

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
            usuario: usuarioMovimiento,
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
            // DIF. DIAS y ESTADO se borran siempre (aunque tengan fórmula) para que
            // no queden datos de un lote que ya no existe. Los demás lotes no cambian.
            escribirSiNoFormula_(hoja, filaReal, posicion.lote, "");
            escribirSiNoFormula_(hoja, filaReal, posicion.venc, "");
            if (posicion.dif >= 0) hoja.getRange(filaReal, posicion.dif + 1).clearContent();
            if (posicion.estado >= 0) hoja.getRange(filaReal, posicion.estado + 1).clearContent();
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

        // Existencia total del producto tras el movimiento (suma de sus lotes).
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

        // Mantener coherente el TOTAL EXIST. cuando la hoja lo guarda como
        // valor fijo (si es una fórmula, se respeta y se recalcula sola).
        if (idxTotalExis >= 0) {
          escribirSiNoFormula_(hoja, filaReal, idxTotalExis, totalLotes);
        }

        // Fila morada si el producto quedó sin ninguna existencia.
        let columnasTabla = encabezados.length;
        while (columnasTabla > 1 && !encabezados[columnasTabla - 1]) columnasTabla--;
        actualizarColorFilaSinExistencia_(hoja, filaReal, columnasTabla, totalLotes);

        encontrado = true;
        filaTocada = { hoja: hoja, indice: filaProducto };

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
            usuarioMovimiento,

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

    // Mantener la copia en memoria al día para el siguiente producto del lote.
    if (filaTocada) refrescarFilaEnMemoria_(filaTocada.hoja, filaTocada.indice);

    CACHE.invalidarInventario();
    CACHE.invalidarMovimientos();

    return {
      success: true,
      message:
        tipo === "entrada"
          ? "Entrada registrada correctamente."
          : "Salida registrada correctamente.",
      producto: productoNombre,
      sku: sku,
      lote: lote,
      cantidad: cantidad,
      stockAnterior: stockAnterior,
      stockNuevo: stockNuevo,
      movimientoRegistrado: movimientoRegistrado,
      advertencia: movimientoRegistrado ? "" : "El inventario se actualizó, pero NO se pudo guardar el movimiento en el historial. Revise la hoja Movimientos."
    };

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

  /** Identifica una imagen de celda (CellImage), distinta de un enlace URL escrito como texto. */
  esImagenDeCelda(valor) {
    if (!valor || typeof valor !== "object" || valor instanceof Date) return false;
    try {
      return valor.valueType === SpreadsheetApp.ValueType.IMAGE || typeof valor.getContentUrl === "function";
    } catch (e) {
      try { return typeof valor.getContentUrl === "function"; } catch (e2) { return false; }
    }
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

  /** Obtiene una URL vinculada a una referencia, ya sea imagen en celda, fórmula o enlace enriquecido. */
  convertirReferenciaCelda(valor, formula, richText, imagenAnclada) {
    const anclada = String(imagenAnclada || "").trim();
    if (anclada) return UTIL.convertirLinkFoto(anclada) || anclada;
    if (valor !== null && valor !== undefined && valor !== "") {
      // CellImage (imagen insertada dentro de la celda): las URL pueden ser
      // temporales; se conservan para que el frontend las pueda solicitar al proxy.
      try {
        if (valor && (valor.valueType === SpreadsheetApp.ValueType.IMAGE || typeof valor.getContentUrl === "function")) {
          const u = valor.getContentUrl && valor.getContentUrl();
          if (u) return String(u);
        }
      } catch (e) {}
      try {
        if (valor && typeof valor.getSourceUrl === "function") {
          const u = valor.getSourceUrl();
          if (u) return UTIL.convertirLinkFoto(String(u)) || String(u);
        }
      } catch (e) {}
      // getUrl() es obsoleto, pero todavía puede devolver la URL de origen en imágenes antiguas.
      try {
        if (valor && typeof valor.getUrl === "function") {
          const u = valor.getUrl();
          if (u) return UTIL.convertirLinkFoto(String(u)) || String(u);
        }
      } catch (e) {}
    }
    const f = String(formula || "");
    const imagenFormula = f.match(/=IMAGE\(\s*["']([^"']+)["']/i);
    if (imagenFormula) return UTIL.convertirLinkFoto(imagenFormula[1]) || imagenFormula[1];
    let enlace = "";
    try {
      if (richText && typeof richText.getLinkUrl === "function") enlace = richText.getLinkUrl() || "";
      if (!enlace && richText && typeof richText.getRuns === "function") {
        const runs = richText.getRuns() || [];
        for (const run of runs) { const u = run.getLinkUrl && run.getLinkUrl(); if (u) { enlace = u; break; } }
      }
    } catch (e) {}
    if (enlace) return UTIL.convertirLinkFoto(enlace) || enlace;
    if (valor === null || valor === undefined || valor === "") return "";
    if (UTIL.esImagen(valor)) return "";
    const texto = String(valor).trim();
    if (!texto) return "";
    if (/^=IMAGE\(/i.test(texto)) {
      const m = texto.match(/^=IMAGE\(\s*["']([^"']+)["']/i);
      if (m) return UTIL.convertirLinkFoto(m[1]) || m[1];
    }
    return UTIL.convertirLinkFoto(texto) || texto;
  },

  /**
   * MIME de un archivo de Drive, con memoria por ejecución y caché de 6 h.
   * Antes se llamaba a DriveApp.getFileById() por cada fila en cada lectura
   * completa de las hojas; el tipo de un archivo casi nunca cambia.
   */
  mimeArchivoDrive_(id) {
    if (!UTIL._mimeMemo) UTIL._mimeMemo = {};
    if (UTIL._mimeMemo[id] !== undefined) return UTIL._mimeMemo[id];
    let mime = null;
    try {
      const c = CacheService.getScriptCache().get("QI_MIME_" + id);
      if (c !== null && c !== undefined) mime = c === "-" ? "" : c;
    } catch (e) {}
    if (mime === null) {
      mime = "";
      try { mime = String(DriveApp.getFileById(id).getMimeType() || "").toLowerCase(); } catch (e) {}
      try { CacheService.getScriptCache().put("QI_MIME_" + id, mime || "-", 21600); } catch (e) {}
    }
    UTIL._mimeMemo[id] = mime;
    return mime;
  },

  /** Clasifica una referencia para que el frontend distinga imagen, enlace y texto. */
  tipoReferenciaCelda(valor, formula, richText, imagenAnclada) {
    if (imagenAnclada || (valor && (valor.valueType === SpreadsheetApp.ValueType.IMAGE || typeof valor.getContentUrl === "function")) || UTIL.esImagen(valor) || /^=IMAGE\(/i.test(String(formula || ""))) return "imagen";
    const url = UTIL.convertirReferenciaCelda(valor, formula, richText, imagenAnclada);
    if (!/^https?:\/\//i.test(String(url || ""))) return url ? "texto" : "";
    if (/\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(url) || /googleusercontent\.com\//i.test(url)) return "imagen";
    const id = String(url).match(/(?:\/file\/d\/|\/d\/|[?&]id=)([A-Za-z0-9_-]{10,})/);
    if (id) {
      if (UTIL.mimeArchivoDrive_(id[1]).indexOf("image/") === 0) return "imagen";
    }
    if (/drive\.google\.com\/(thumbnail|uc)\b/i.test(url)) return "imagen";
    return "enlace";
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
      ubicacion:  headers.findIndex(h => /^ubicaci[oó]n$/i.test(String(h).trim())),
      minimo:     headers.findIndex(h => /^m[ií]nimo\s*requerido$/i.test(String(h).trim())),
      marca:      headers.findIndex(h => /^marca$/i.test(String(h).trim())),
      imagen:     headers.findIndex(h => /^imagen$/i.test(String(h).trim())),
      categoriaCol: headers.findIndex(h => /^categor[ií]a$/i.test(String(h).trim())),
      ref1:       headers.findIndex(h => /^referencia\s*1$/i.test(String(h).trim())),
      ref2:       headers.findIndex(h => /^referencia\s*2$/i.test(String(h).trim())),
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
      minimo:    h2.findIndex(h => /^m[ií]nimo\s*requerido$/i.test(h)),
      categoria: h2.findIndex(h => /^categor[ií]a$/i.test(h)),
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
  leerHojaReactivos(data, proveedor, formulas, richTexts, imagenesAncladas) {
    const productos = [];
    let categoriaActual = "";
    let headers = null;
    let idx = null;

    data.forEach((fila, filaIndex) => {
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

      const categoriaFila = idx.categoriaCol >= 0 ? String(fila[idx.categoriaCol] || "").trim() : "";
      const marcaFila = idx.marca >= 0 ? String(fila[idx.marca] || "").trim() : "";
      const minimoRaw = idx.minimo >= 0 ? fila[idx.minimo] : "";
      const refCelda = (col) => ({
        valor: col >= 0 ? fila[col] : "",
        formula: col >= 0 && formulas && formulas[filaIndex] ? formulas[filaIndex][col] : "",
        rich: col >= 0 && richTexts && richTexts[filaIndex] ? richTexts[filaIndex][col] : null,
        anclada: col >= 0 && imagenesAncladas ? imagenesAncladas[(filaIndex + 1) + ":" + (col + 1)] || "" : ""
      });
      const imagenRef = refCelda(idx.imagen);
      const ref1 = refCelda(idx.ref1);
      const ref2 = refCelda(idx.ref2);
      productos.push({
        tipo: "reactivo", proveedor: marcaFila, marca: marcaFila,
        categoria: categoriaFila || categoriaActual || "",
        nombre, sku, stockTotal,
        minimoRequerido: minimoRaw === "" || minimoRaw === null || minimoRaw === undefined ? null : (Number(minimoRaw) || 0),
        imagen: idx.imagen >= 0 ? UTIL.convertirReferenciaCelda(imagenRef.valor, imagenRef.formula, imagenRef.rich, imagenRef.anclada) : "",
        imagenTipo: idx.imagen >= 0 ? UTIL.tipoReferenciaCelda(imagenRef.valor, imagenRef.formula, imagenRef.rich, imagenRef.anclada) : "",
        imagenFuente: (UTIL.esImagenDeCelda(imagenRef.valor) || !!imagenRef.anclada) ? { hoja: proveedor, fila: filaIndex + 1, columna: idx.imagen + 1 } : null,
        ubicacion: idx.ubicacion >= 0 ? String(fila[idx.ubicacion] || "").trim() : "",
        foto1: idx.ref1 >= 0 ? UTIL.convertirReferenciaCelda(ref1.valor, ref1.formula, ref1.rich, ref1.anclada) : "",
        foto1Tipo: idx.ref1 >= 0 ? UTIL.tipoReferenciaCelda(ref1.valor, ref1.formula, ref1.rich, ref1.anclada) : "",
        foto1Fuente: (UTIL.esImagenDeCelda(ref1.valor) || !!ref1.anclada) ? { hoja: proveedor, fila: filaIndex + 1, columna: idx.ref1 + 1 } : null,
        foto2: idx.ref2 >= 0 ? UTIL.convertirReferenciaCelda(ref2.valor, ref2.formula, ref2.rich, ref2.anclada) : "",
        foto2Tipo: idx.ref2 >= 0 ? UTIL.tipoReferenciaCelda(ref2.valor, ref2.formula, ref2.rich, ref2.anclada) : "",
        foto2Fuente: (UTIL.esImagenDeCelda(ref2.valor) || !!ref2.anclada) ? { hoja: proveedor, fila: filaIndex + 1, columna: idx.ref2 + 1 } : null,
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
  leerHojaMaterial(data, proveedor, formulas, richTexts, imagenesAncladas) {
    const productos = [];
    const tipo = proveedor === "Repuestos" ? "repuesto" : "material";
    let categoriaActual = "";
    let headers = null;
    let idx = null;

    data.forEach((fila, filaIdx) => {
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

      const categoriaFila = idx.categoria >= 0 ? String(fila[idx.categoria] || "").trim() : "";
      const minimoRaw = idx.minimo >= 0 ? fila[idx.minimo] : null;
      const refCelda = (col) => ({
        valor: col >= 0 ? fila[col] : "",
        formula: col >= 0 && formulas && formulas[filaIdx] ? formulas[filaIdx][col] : "",
        rich: col >= 0 && richTexts && richTexts[filaIdx] ? richTexts[filaIdx][col] : null,
        anclada: col >= 0 && imagenesAncladas ? imagenesAncladas[(filaIdx + 1) + ":" + (col + 1)] || "" : ""
      });
      const ref1 = refCelda(idx.ref1), ref2 = refCelda(idx.ref2);
      const foto1 = idx.ref1 >= 0 ? UTIL.convertirReferenciaCelda(ref1.valor, ref1.formula, ref1.rich, ref1.anclada) : "";
      const foto1Tipo = idx.ref1 >= 0 ? UTIL.tipoReferenciaCelda(ref1.valor, ref1.formula, ref1.rich, ref1.anclada) : "";
      const foto2 = idx.ref2 >= 0 ? UTIL.convertirReferenciaCelda(ref2.valor, ref2.formula, ref2.rich, ref2.anclada) : "";
      const foto2Tipo = idx.ref2 >= 0 ? UTIL.tipoReferenciaCelda(ref2.valor, ref2.formula, ref2.rich, ref2.anclada) : "";
      productos.push({
        tipo, proveedor, categoria: categoriaFila || categoriaActual || "General", nombre, sku,
        stockTotal: (idx.exis1 >= 0 && fila[idx.exis1] !== "" && !UTIL.esImagen(fila[idx.exis1]))
          ? fila[idx.exis1] : 0,
        // Se conserva para cálculos de pedidos; la ficha del producto no lo muestra.
        minimoRequerido: minimoRaw === "" || minimoRaw === null || minimoRaw === undefined ? null : (Number(minimoRaw) || 0),
        ubicacion: idx.ubicacion >= 0 ? String(fila[idx.ubicacion] || "").trim() : "",
        // Materiales no tiene una columna independiente de imagen en el layout
        // actual: Referencia 1 se usa como imagen de tarjeta cuando es imagen.
        imagen: foto1Tipo === "imagen" ? foto1 : (foto2Tipo === "imagen" ? foto2 : ""),
        imagenTipo: (foto1Tipo === "imagen" || foto2Tipo === "imagen") ? "imagen" : "",
        imagenFuente: (foto1Tipo === "imagen" && (UTIL.esImagenDeCelda(ref1.valor) || !!ref1.anclada))
          ? { hoja: proveedor, fila: filaIdx + 1, columna: idx.ref1 + 1 }
          : ((foto2Tipo === "imagen" && (UTIL.esImagenDeCelda(ref2.valor) || !!ref2.anclada)) ? { hoja: proveedor, fila: filaIdx + 1, columna: idx.ref2 + 1 } : null),
        foto1: foto1, foto1Tipo: foto1Tipo,
        foto1Fuente: (UTIL.esImagenDeCelda(ref1.valor) || !!ref1.anclada) ? { hoja: proveedor, fila: filaIdx + 1, columna: idx.ref1 + 1 } : null,
        foto2: foto2, foto2Tipo: foto2Tipo,
        foto2Fuente: (UTIL.esImagenDeCelda(ref2.valor) || !!ref2.anclada) ? { hoja: proveedor, fila: filaIdx + 1, columna: idx.ref2 + 1 } : null,
        lotes: []
      });
    });

    return productos;
  },

  /** Lee TODAS las hojas relevantes del Spreadsheet de inventario. */
  leerSheets() {
    const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
    // TGU: cargar Reactivos y Materiales desde el mismo Spreadsheet.
    // Materiales se incorpora únicamente para Tegucigalpa; SPS permanece
    // sin cambios y Repuestos queda fuera del alcance actual.
    const hojaReactivos = ss.getSheetByName("Reactivos");
    const hojaMateriales = ss.getSheetByName("Materiales") || ss.getSheetByName("MATERIALES");
    const hojas = [hojaReactivos, hojaMateriales].filter(Boolean);
    if (!hojaReactivos) throw new Error('No se encontró la hoja "Reactivos" en el inventario de Tegucigalpa.');
    if (!hojaMateriales) Logger.log('Aviso: no se encontró la hoja "Materiales" en TGU; se cargará únicamente Reactivos.');

    let todos = [];
    hojas.forEach(hoja => {
      const proveedor = hoja.getName();
      const esMaterial = CONFIG.HOJAS_MATERIALES.includes(proveedor);
      const dosNiveles = CONFIG.HOJAS_DOS_NIVELES.includes(proveedor);
      const rangoDatos = hoja.getDataRange();
      const data = rangoDatos.getValues();
      if (data.length < 2) return;
      const formulas = rangoDatos.getFormulas();
      const richTexts = rangoDatos.getRichTextValues();
      const imagenesAncladas = {};
      // También se reconocen imágenes colocadas sobre la cuadrícula de Sheets
      // y ancladas a las columnas Referencia 1/2 o Imagen.
      try {
        hoja.getImages().forEach(img => {
          const celda = img.getAnchorCell();
          const url = img.getUrl && img.getUrl();
          if (celda && url) imagenesAncladas[celda.getRow() + ":" + celda.getColumn()] = url;
        });
      } catch (e) { Logger.log("No se pudieron leer imágenes ancladas de " + proveedor + ": " + e); }

      if (esMaterial) {
        todos = todos.concat(INVENTARIO.leerHojaMaterial(data, proveedor, formulas, richTexts, imagenesAncladas));
      } else if (dosNiveles) {
        todos = todos.concat(INVENTARIO.leerHojaDosNiveles(data, proveedor));
      } else {
        todos = todos.concat(INVENTARIO.leerHojaReactivos(data, proveedor, formulas, richTexts, imagenesAncladas));
      }
    });

    // Evitar productos duplicados en el catálogo de TGU cuando el mismo
    // código aparece más de una vez en Reactivos. Se conservan los datos de
    // la fila más completa y se unen únicamente lotes distintos; no se leen
    // hojas heredadas. La función SPS independiente permanece intacta.
    const unicos = new Map();
    todos.forEach(producto => {
      const codigo = String(producto.sku || '').trim().toUpperCase();
      if (!codigo) { unicos.set('__SIN_CODIGO__' + unicos.size, producto); return; }
      // No mezclar Reactivos con Materiales aunque compartan un código.
      // Son catálogos distintos y sus existencias/unidades no son equivalentes.
      const claveProducto = String(producto.tipo || 'reactivo').toLowerCase() + '|' + codigo;
      if (!unicos.has(claveProducto)) { unicos.set(claveProducto, producto); return; }
      const actual = unicos.get(claveProducto);
      const categoriaActual = String(actual.categoria || '').trim();
      const categoriaNueva = String(producto.categoria || '').trim();
      if ((!categoriaActual || /^general$/i.test(categoriaActual)) && categoriaNueva && !/^general$/i.test(categoriaNueva)) {
        actual.categoria = categoriaNueva;
      }
      if (!actual.marca && producto.marca) { actual.marca = producto.marca; actual.proveedor = producto.marca; }
      if (!actual.imagen && producto.imagen) actual.imagen = producto.imagen;
      if ((actual.minimoRequerido === null || actual.minimoRequerido === undefined || actual.minimoRequerido === 0) && producto.minimoRequerido !== null && producto.minimoRequerido !== undefined) actual.minimoRequerido = producto.minimoRequerido;
      const lotesExistentes = new Set((actual.lotes || []).map(l => String(l.numLote || '').trim() + '|' + String(l.vencimiento || '').trim()));
      (producto.lotes || []).forEach(l => {
        const claveLote = String(l.numLote || '').trim() + '|' + String(l.vencimiento || '').trim();
        if (!lotesExistentes.has(claveLote)) { actual.lotes.push(l); lotesExistentes.add(claveLote); }
      });
      // La existencia del código se calcula a partir de los lotes únicos.
      if (actual.lotes && actual.lotes.length) actual.stockTotal = actual.lotes.reduce((sum, l) => sum + (Number(l.stock) || 0), 0);
    });
    const productosUnicos = Array.from(unicos.values());
    return { productos: productosUnicos, total: productosUnicos.length };
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
      stockNuevo: buscar(['Stock nuevo', 'Stock despues', 'Existencia nueva']),
      observacion: buscar(['Observación', 'Observacion', 'Observaciones', 'Nota', 'Notas', 'Comentario', 'Comentarios'])
    };
  },
  // Si la hoja Movimientos aún no tiene la columna Observación, se agrega al
  // FINAL de la fila de encabezados. No se mueve ni se modifica ninguna columna existente.
  _asegurarObservacion_(hoja, mapa) {
    if (mapa.observacion >= 0) return;
    if (mapa.fecha < 0 && mapa.usuario < 0 && mapa.producto < 0) return; // hoja antigua sin encabezados
    let ultimo = mapa.encabezados.length;
    while (ultimo > 0 && !String(mapa.encabezados[ultimo - 1] || '').trim()) ultimo--;
    if (ultimo === 0) return;
    hoja.getRange(1, ultimo + 1).setValue('Observación');
    while (mapa.encabezados.length <= ultimo) { mapa.encabezados.push(''); mapa.normalizados.push(''); }
    mapa.encabezados[ultimo] = 'Observación';
    mapa.normalizados[ultimo] = 'observacion';
    mapa.observacion = ultimo;
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
    poner(mapa.observacion, datos.observacion || '');
    // Compatibilidad con hojas antiguas sin encabezados reconocibles.
    if (mapa.fecha < 0 && mapa.usuario < 0 && mapa.producto < 0) {
      return [datos.fecha || new Date(), datos.usuario || 'admin', datos.producto || '', datos.sku || '', datos.lote || '', datos.movimiento || '', anterior, nuevo];
    }
    return fila;
  },
  guardar(datos) {
    const ss = abrirSpreadsheet_(CONFIG.SS_MOVIMIENTOS_ID);
    const hoja = ss.getSheetByName(CONFIG.NOMBRE_HOJA_MOVIMIENTOS);
    if (!hoja) throw new Error('No se encontró la hoja "' + CONFIG.NOMBRE_HOJA_MOVIMIENTOS + '" en el Spreadsheet de movimientos.');
    const mapa = this._mapaEncabezados_(hoja);
    this._asegurarObservacion_(hoja, mapa);
    const fila = this._filaDesdeDatos_(datos, mapa, Math.max(hoja.getLastColumn(), mapa.encabezados.length));
    hoja.getRange(hoja.getLastRow() + 1, 1, 1, fila.length).setValues([fila]);
  },
  guardarLote(listaDatos) {
    if (!listaDatos || !listaDatos.length) return;
    const ss = abrirSpreadsheet_(CONFIG.SS_MOVIMIENTOS_ID);
    const hoja = ss.getSheetByName(CONFIG.NOMBRE_HOJA_MOVIMIENTOS);
    if (!hoja) throw new Error('No se encontró la hoja "' + CONFIG.NOMBRE_HOJA_MOVIMIENTOS + '" en el Spreadsheet de movimientos.');
    const mapa = this._mapaEncabezados_(hoja);
    this._asegurarObservacion_(hoja, mapa);
    const ancho = Math.max(hoja.getLastColumn(), mapa.encabezados.length, 8);
    const ahora = new Date();
    const filas = listaDatos.map(datos => this._filaDesdeDatos_(Object.assign({fecha: ahora}, datos), mapa, ancho).slice(0, ancho));
    hoja.getRange(hoja.getLastRow() + 1, 1, filas.length, ancho).setValues(filas);
  },
  registrar(datos) {
    if (LOTE_CTX_) {
      LOTE_CTX_.movimientos.push(Object.assign({ fecha: new Date() }, datos));
      return true;
    }
    try { this.guardar(datos); CACHE.invalidarMovimientos(); CACHE.invalidarInventario(); return true; }
    catch (err) { Logger.log('Error registrando movimiento: ' + err); return false; }
  },
  registrarLote(listaDatos) {
    if (!listaDatos || !listaDatos.length) return 0;
    try { this.guardarLote(listaDatos); CACHE.invalidarMovimientos(); CACHE.invalidarInventario(); return listaDatos.length; }
    catch (err) { Logger.log('Error registrando movimientos en lote: ' + err); return 0; }
  },
  leerDesdeSheet(fecha) {
    const ss = abrirSpreadsheet_(CONFIG.SS_MOVIMIENTOS_ID);
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
        observacion: String(fila[col('observacion', -1)] || ''),
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
    const ss = abrirSpreadsheet_(CONFIG.SS_MOVIMIENTOS_ID);
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

    // En un lote se acumula y se escribe una sola vez (ya se tiene el lock).
    if (LOTE_CTX_) { LOTE_CTX_.snapshot[est.clave] = est; return; }

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
   * Fija varios estados en el snapshot con 1 lectura y 1 escritura.
   * El llamador ya debe tener el lock.
   */
  fijarEstadosLote(estados) {

    const lista = Object.keys(estados || {}).map(k => estados[k]);
    if (!lista.length) return;

    const hoja = SNAPSHOT.obtenerHoja();
    const ancho = CONFIG.ENCABEZADOS_SNAPSHOT.length;
    const ultimaFila = hoja.getLastRow();

    const filas = ultimaFila > 1
      ? hoja.getRange(2, 1, ultimaFila - 1, ancho).getValues()
      : [];

    const posicion = {};
    filas.forEach((f, i) => { if (f[0] !== "") posicion[String(f[0])] = i; });

    const ahora = new Date();
    const nuevas = [];

    lista.forEach(est => {
      const valores = [
        est.clave, est.sku, est.proveedor, est.ubicacion || "", est.slot,
        est.lote || "", est.producto, est.stock, ahora
      ];
      if (posicion[est.clave] !== undefined) {
        filas[posicion[est.clave]] = valores;
      } else {
        nuevas.push(valores);
      }
    });

    if (filas.length) hoja.getRange(2, 1, filas.length, ancho).setValues(filas);
    if (nuevas.length) hoja.getRange(hoja.getLastRow() + 1, 1, nuevas.length, ancho).setValues(nuevas);
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
 * MÓDULO: SOLICITUDES (idempotencia del registro por lote)
 * Guarda, por 24 h, el resultado resumido de cada solicitud ya procesada.
 * ========================================================================= */

const VERSION_SERVIDOR = "2026-11-15-directorio-clientes-fix";

const SOLICITUDES = {
  PREFIJO: "QI_REQ_",
  VIDA_MS: 24 * 3600 * 1000,

  limpiarId(valor) {
    const id = String(valor || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
    return id.length >= 8 ? id : "";
  },

  buscar(id) {
    try {
      const raw = PropertiesService.getScriptProperties().getProperty(this.PREFIJO + id);
      if (!raw) return null;
      const reg = JSON.parse(raw);
      return reg && reg.r && (Date.now() - reg.t) < this.VIDA_MS ? reg.r : null;
    } catch (e) { return null; }
  },

  guardar(id, resumen) {
    const props = PropertiesService.getScriptProperties();
    props.setProperty(this.PREFIJO + id, JSON.stringify({ t: Date.now(), r: resumen }));
    // Limpieza de solicitudes antiguas.
    const todas = props.getProperties();
    Object.keys(todas).forEach(k => {
      if (k.indexOf(this.PREFIJO) !== 0 || k === this.PREFIJO + id) return;
      try {
        const reg = JSON.parse(todas[k]);
        if (!reg || (Date.now() - reg.t) >= this.VIDA_MS) props.deleteProperty(k);
      } catch (e) { props.deleteProperty(k); }
    });
  }
};


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

  SESION_TTL_SEG: 21600, // 6 horas

  /**
   * Secreto de firma de los tokens. Se crea una sola vez y vive en las
   * propiedades del script (no en caché), de modo que no se pierde.
   */
  _secreto_() {
    const props = PropertiesService.getScriptProperties();
    let s = props.getProperty("QI_SESSION_SECRET");
    if (s) return s;
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      s = props.getProperty("QI_SESSION_SECRET");
      if (!s) {
        s = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid();
        props.setProperty("QI_SESSION_SECRET", s);
      }
    } finally {
      lock.releaseLock();
    }
    return s;
  },

  _firmar_(texto) {
    return Utilities.base64EncodeWebSafe(
      Utilities.computeHmacSha256Signature(texto, this._secreto_())
    );
  },

  /**
   * Crea el token de sesión. Es AUTOCONTENIDO y firmado (HMAC-SHA256): no
   * depende de CacheService, que puede descartar entradas antes de tiempo.
   * Si no fuera posible firmar (p. ej. propiedades llenas), se usa el
   * mecanismo anterior en caché como respaldo.
   */
  crearToken(sesion) {
    try {
      const payload = {
        u: sesion.usuario, r: sesion.rol, n: sesion.nombre,
        e: Math.floor(Date.now() / 1000) + this.SESION_TTL_SEG
      };
      const cuerpo = "v2." + Utilities.base64EncodeWebSafe(
        Utilities.newBlob(JSON.stringify(payload)).getBytes()
      );
      return cuerpo + "." + this._firmar_(cuerpo);
    } catch (e) {
      Logger.log("No se pudo firmar el token; se usa caché: " + e);
      const token = Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
      CacheService.getScriptCache().put("QI_SESION_" + token, JSON.stringify(sesion), this.SESION_TTL_SEG);
      return token;
    }
  },

  /** Valida el token y explica el motivo si no es válido. */
  validarSesionDetalle(token) {
    token = String(token || "").trim();
    if (!token) return { sesion: null, motivo: "ausente" };
    try {
      if (token.indexOf("v2.") === 0) {
        const partes = token.split(".");
        if (partes.length !== 3) return { sesion: null, motivo: "invalida" };
        const esperada = this._firmar_(partes[0] + "." + partes[1]);
        const recibida = partes[2];
        let dif = esperada.length ^ recibida.length;
        for (let i = 0; i < Math.min(esperada.length, recibida.length); i++) {
          dif |= esperada.charCodeAt(i) ^ recibida.charCodeAt(i);
        }
        if (dif !== 0) return { sesion: null, motivo: "invalida" };
        const p = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(partes[1])).getDataAsString());
        if (!p || !p.e || p.e < Math.floor(Date.now() / 1000)) return { sesion: null, motivo: "vencida" };
        if (p.u === undefined || p.u === null || p.u === "") return { sesion: null, motivo: "invalida" };
        return { sesion: { usuario: p.u, rol: p.r, nombre: p.n }, motivo: "" };
      }
      // Tokens anteriores (guardados en caché).
      const raw = CacheService.getScriptCache().get("QI_SESION_" + token);
      const sesion = raw ? JSON.parse(raw) : null;
      if (sesion && sesion.usuario !== undefined && sesion.usuario !== "") return { sesion: sesion, motivo: "" };
      return { sesion: null, motivo: "no_encontrada" };
    } catch (e) {
      Logger.log("validarSesion error: " + e);
      return { sesion: null, motivo: "invalida" };
    }
  },

  validarSesion(token) {
    return this.validarSesionDetalle(token).sesion;
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

/** Lee las marcas y sus logotipos desde la pestaña Marcas del Spreadsheet TGU. */
function getMarcasTGU_() {
  const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
  const hoja = ss.getSheetByName("Marcas");
  if (!hoja) return { marcas: [], total: 0, advertencia: 'No existe la pestaña Marcas en el archivo de TGU.' };
  const valores = hoja.getDataRange().getDisplayValues();
  if (!valores.length) return { marcas: [], total: 0 };
  const norm = v => String(v || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  const headers = valores[0].map(norm);
  const iMarca = headers.indexOf('MARCA');
  const iImagen = headers.indexOf('IMAGEN');
  if (iMarca < 0 || iImagen < 0) throw new Error('La hoja Marcas debe tener los encabezados MARCA e IMAGEN.');
  const mapa = new Map();
  valores.slice(1).forEach(row => {
    const marca = String(row[iMarca] || '').trim();
    const imagen = String(row[iImagen] || '').trim();
    if (marca && !mapa.has(marca)) mapa.set(marca, { nombre: marca, imagen });
  });
  return { marcas: Array.from(mapa.values()), total: mapa.size };
}


/* ============================================================================
 * MÓDULO: API PÚBLICA
 * Los nombres, parámetros y formas de respuesta son IDÉNTICOS a los que ya
 * usa la aplicación — no se debe renombrar nada de esta sección.
 * ========================================================================= */

/** action=getInventario — devuelve { productos, total }. */
/** true si la URL es una content URL de Google (caduca; no debe guardarse). */
function esUrlTemporalGoogle_(u) {
  return /^https?:\/\/[^\/]*googleusercontent\.com/i.test(String(u || ""));
}

/**
 * Elimina las content URLs temporales de las imágenes incrustadas en celdas.
 * Esas imágenes se piden siempre por coordenada (hoja/fila/columna), de modo
 * que la URL guardada no sirve, caduca y solo engorda la respuesta, la caché y
 * el snapshot. Es idempotente y también limpia copias antiguas ya guardadas.
 */
function limpiarUrlsTemporales_(datos) {
  const lista = datos && Array.isArray(datos.productos) ? datos.productos : [];
  lista.forEach(p => {
    if (p.imagenFuente && esUrlTemporalGoogle_(p.imagen)) p.imagen = "";
    if (p.foto1Fuente && esUrlTemporalGoogle_(p.foto1)) p.foto1 = "";
    if (p.foto2Fuente && esUrlTemporalGoogle_(p.foto2)) p.foto2 = "";
  });
  return datos;
}

function getInventario(forzar) {

  const inicio = Date.now();

  // 1. SI NO SE FUERZA: intentar primero el snapshot persistente
  if (!forzar) {

    const rapido = INVENTARIO_RAPIDO.obtener();

    if (rapido) {

      Logger.log("INVENTARIO DESDE SNAPSHOT: " + (Date.now() - inicio) + " ms");

      return limpiarUrlsTemporales_(rapido);
    }

    // Si no existe snapshot, probar caché normal
    const cacheado = CACHE.get(CACHE.KEY_INVENTARIO);

    if (cacheado) {

      limpiarUrlsTemporales_(cacheado);

      INVENTARIO_RAPIDO.guardar(cacheado);

      Logger.log("INVENTARIO DESDE CACHE: " + (Date.now() - inicio) + " ms");

      return cacheado;
    }
  }

  // 2. SOLO AQUÍ se leen todas las hojas
  const datos = limpiarUrlsTemporales_(INVENTARIO.leerSheets());

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
    const clave = String(producto.tipo || "reactivo").toLowerCase() + "|" + sku;

    if (!mapa[clave]) {

      mapa[clave] = {
        ...producto,
        stockTotal: Number(producto.stockTotal) || 0,
        lotes: Array.isArray(producto.lotes) ? [...producto.lotes] : []
      };

    } else {

      mapa[clave].stockTotal += Number(producto.stockTotal) || 0;

      if (Array.isArray(producto.lotes)) {
        mapa[clave].lotes.push(...producto.lotes);
      }

    }

  });

  (datosSPS.productos || []).forEach(producto => {

    const sku = String(producto.sku || "").trim();
    if (!sku) return;
    const clave = String(producto.tipo || "reactivo").toLowerCase() + "|" + sku;

    if (!mapa[clave]) {

      mapa[clave] = {
        ...producto,
        stockTotal: Number(producto.stockTotal) || 0,
        lotes: Array.isArray(producto.lotes) ? [...producto.lotes] : []
      };

    } else {

      mapa[clave].stockTotal += Number(producto.stockTotal) || 0;

      if (Array.isArray(producto.lotes)) {
        mapa[clave].lotes.push(...producto.lotes);
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

  // Fase 2.6: respuesta combinada ya calculada (60 s). Se invalida junto con
  // el inventario TGU y SPS; "forzar" (botón Actualizar) la ignora.
  if (!forzar) {
    const combinada = CACHE.get(CACHE.KEY_INICIO);
    if (combinada && Array.isArray(combinada.productos)) {
      Logger.log("getInicio desde caché combinada: " + (Date.now() - inicio) + " ms");
      return combinada;
    }
  }

  // Si se fuerza (botón Actualizar), SPS también se vuelve a leer.
  if (forzar) CACHE.invalidarSPS();

  // OBTENER TEGUS
  const datosTegus = getInventario(forzar);

  // OBTENER SPS
  const datosSPS = getInventarioSPS();

  // COMBINAR TEGUS + SPS POR SKU
  const mapa = {};

  (datosTegus.productos || []).forEach(producto => {

    const sku = String(producto.sku || producto.codigo || "").trim().toUpperCase();
    if (!sku) return;
    const tipo = String(producto.tipo || "reactivo").toLowerCase();
    const clave = tipo + "|" + sku;

    if (!mapa[clave]) {

      mapa[clave] = {
        ...producto,
        sku: sku,
        stockTotal: Number(producto.stockTotal) || 0,
        stockTGU: Number(producto.stockTotal) || 0,
        stockSPS: tipo === "material" ? null : 0,
        lotes: Array.isArray(producto.lotes) ? [...producto.lotes] : []
      };

    } else {

      mapa[clave].stockTotal += Number(producto.stockTotal) || 0;
      mapa[clave].stockTGU = (Number(mapa[clave].stockTGU) || 0) + (Number(producto.stockTotal) || 0);

      if (Array.isArray(producto.lotes) && !["material", "repuesto"].includes(String(mapa[clave].tipo || "").toLowerCase())) {
        mapa[clave].lotes.push(...producto.lotes);
      }

    }

  });

  (datosSPS.productos || []).forEach(producto => {

    const sku = String(producto.sku || producto.codigo || "").trim().toUpperCase();
    if (!sku) return;
    const tipo = String(producto.tipo || "reactivo").toLowerCase();
    const clave = tipo + "|" + sku;

    if (!mapa[clave]) {

      mapa[clave] = {
        ...producto,
        sku: sku,
        stockTotal: Number(producto.stockTotal) || 0,
        stockTGU: 0,
        stockSPS: Number(producto.stockTotal) || 0,
        lotes: Array.isArray(producto.lotes) ? [...producto.lotes] : []
      };

    } else {

      mapa[clave].stockTotal += Number(producto.stockTotal) || 0;
      mapa[clave].stockSPS = (Number(mapa[clave].stockSPS) || 0) + (Number(producto.stockTotal) || 0);

      if (Array.isArray(producto.lotes) && !["material", "repuesto"].includes(String(mapa[clave].tipo || "").toLowerCase())) {
        mapa[clave].lotes.push(...producto.lotes);
      }

    }

  });

  // INVENTARIO FINAL
  const productos = Object.values(mapa);

  // RESUMEN
  const resumen = INVENTARIO.calcularResumen(productos);

  Logger.log("getInicio completado en " + (Date.now() - inicio) + " ms");

  // RESPUESTA ÚNICA
  const respuestaInicio = {
    productos: productos,
    total: productos.length,
    resumen: resumen
  };

  CACHE.put(CACHE.KEY_INICIO, respuestaInicio, CACHE.TTL_INICIO);

  return respuestaInicio;

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

/** Lee los logotipos desde la hoja Marcas del spreadsheet de TGU. */
function getMarcas(forzar) {
  if (!forzar) {
    const cacheadas = CACHE.get(CACHE.KEY_MARCAS);
    if (cacheadas && Array.isArray(cacheadas.marcas)) return cacheadas;
  }
  const resultado = leerMarcas_();
  // No se guarda en caché una respuesta con error de estructura de la hoja.
  if (!resultado.error) CACHE.put(CACHE.KEY_MARCAS, resultado, CACHE.TTL_MARCAS);
  return resultado;
}

function leerMarcas_() {
  const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
  const hoja = ss.getSheetByName("Marcas");
  if (!hoja) return { marcas: [] };
  const rango = hoja.getDataRange();
  const valores = rango.getValues();
  if (valores.length < 2) return { marcas: [] };
  const formulas = rango.getFormulas(), rich = rango.getRichTextValues(), ancladas = {};
  try { hoja.getImages().forEach(img => { const c = img.getAnchorCell(); const u = img.getUrl && img.getUrl(); if (c && u) ancladas[c.getRow() + ":" + c.getColumn()] = u; }); } catch (e) {}
  const norm = v => String(v == null ? "" : v).trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const headers = valores[0].map(norm), iMarca = headers.indexOf("marca"), iImagen = headers.indexOf("imagen") >= 0 ? headers.indexOf("imagen") : headers.indexOf("logo");
  if (iMarca < 0 || iImagen < 0) return { marcas: [], error: 'La hoja Marcas debe tener las columnas MARCA e IMAGEN (o LOGO).' };
  const marcas = [], vistos = new Set();
  for (let r = 1; r < valores.length; r++) {
    const nombre = String(valores[r][iMarca] || "").trim();
    if (!nombre || vistos.has(norm(nombre))) continue;
    vistos.add(norm(nombre));
    const valor = valores[r][iImagen], formula = formulas[r] ? formulas[r][iImagen] : "", richText = rich[r] ? rich[r][iImagen] : null;
    const anclada = ancladas[(r + 1) + ":" + (iImagen + 1)] || "";
    const imagen = UTIL.convertirReferenciaCelda(valor, formula, richText, anclada);
    const esCeldaImagen = UTIL.esImagenDeCelda(valor) || !!anclada;
    // Una imagen de celda se pide por coordenada; su URL temporal no se envía ni se guarda.
    const imagenFinal = (esCeldaImagen && esUrlTemporalGoogle_(imagen)) ? "" : imagen;
    marcas.push({ nombre, imagen: imagenFinal, imagenTipo: UTIL.tipoReferenciaCelda(valor, formula, richText, anclada),
      imagenFuente: esCeldaImagen ? { hoja: "Marcas", fila: r + 1, columna: iImagen + 1 } : null });
  }
  return { marcas };
}

/** Reporte de reposición exclusivamente para TGU, calculado desde Reactivos. */
function getReporteReposicionTGU() {
  // La sugerencia de pedido de TGU SIEMPRE se lee de Reactivos en CONFIG.SS_ID.
  // No consultar el spreadsheet ni las hojas de SPS desde esta función.
  const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
  const hoja = ss.getSheetByName("Reactivos");
  if (!hoja) throw new Error('No se encontró la hoja "Reactivos" de Tegucigalpa.');
  const data = hoja.getDataRange().getValues();
  if (!data.length) return { productos: [], fuente: "Reactivos", bodega: "TGU" };
  const norm = v => String(v == null ? "" : v).replace(/[\u00A0\u200B-\u200D\uFEFF]/g, "").trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  // Buscar encabezados en cualquier fila, sin asumir que siempre están en la primera.
  let hi = -1, headers = [], iCodigo = -1, iProducto = -1, iStock = -1, iMinimo = -1;
  let iMarca = -1, iCategoria = -1;
  for (let r = 0; r < data.length; r++) {
    const h = data[r].map(norm);
    const find = (...names) => h.findIndex(x => names.includes(x));
    const c = find("codigo", "sku", "codigoproducto");
    const p = find("producto", "descripcion", "nombre", "articulo");
    const st = find("totalexist", "totalexistencia", "existenciatotal", "totalstock", "stocktotal");
    const mn = find("minimorequerido", "minimorequerida", "minimo", "stockminimo", "cantidadminima");
    if (c >= 0 && p >= 0 && st >= 0 && mn >= 0) {
      hi = r; headers = h; iCodigo = c; iProducto = p; iStock = st; iMinimo = mn;
      iMarca = find("marca"); iCategoria = find("categoria");
      break;
    }
  }
  if (hi < 0) throw new Error('No se detectaron en Reactivos los encabezados CÓDIGO, PRODUCTO, TOTAL EXIST. y MÍNIMO REQUERIDO. Verifique que estén en la misma fila.');
  const num = v => {
    if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
    const s = String(v == null ? "" : v).trim().replace(/,/g, "");
    return s === "" ? NaN : Number(s);
  };
  const productos = [];
  for (let r = hi + 1; r < data.length; r++) {
    const row = data[r];
    const codigo = String(row[iCodigo] == null ? "" : row[iCodigo]).trim();
    const producto = String(row[iProducto] == null ? "" : row[iProducto]).trim();
    if (!codigo || !producto) continue;
    const existenciaRaw = num(row[iStock]);
    const minimo = num(row[iMinimo]);
    // Stock vacío/ no numérico se considera 0; mínimo vacío se omite para no inventarlo.
    const existencia = Number.isFinite(existenciaRaw) ? existenciaRaw : 0;
    if (!Number.isFinite(minimo) || minimo <= existencia) continue;
    productos.push({
      codigo, producto,
      marca: iMarca >= 0 ? String(row[iMarca] || "").trim() : "",
      categoria: iCategoria >= 0 ? String(row[iCategoria] || "").trim() : "",
      existencia, minimo, cantidadSugerida: Math.max(0, minimo - existencia)
    });
  }
  const unicos = new Map();
  productos.forEach(p => {
    const key = norm(p.codigo || p.producto);
    const anterior = unicos.get(key);
    if (!anterior || p.cantidadSugerida > anterior.cantidadSugerida) unicos.set(key, p);
  });
  const lista = Array.from(unicos.values());
  return { productos: lista, fuente: "Reactivos", bodega: "TGU", totalRevisados: Math.max(0, data.length - hi - 1) };
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

      case "ping":
        // Comprobación mínima de que la implementación responde JSON. No lee
        // ninguna hoja ni devuelve datos de usuarios.
        return responder({ ok: true, version: VERSION_SERVIDOR, hora: new Date().toISOString() });

      case "login":
        return responder(
          login(
            e.parameter.usuario || "",
            e.parameter.password || ""
          )
        );

      case "getInventario":
        return responder(getInventario(forzar));

      case "getMarcas":
        return responder(getMarcas(forzar));

      case "getReporteReposicionTGU":
        // Fuente exclusiva: hoja Reactivos del spreadsheet TGU (CONFIG.SS_ID).
        return responder(getReporteReposicionTGU());

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
  const sesion = { usuario: resultado.usuario.usuario, rol: resultado.usuario.rol, nombre: resultado.usuario.nombre };
  resultado.token = USUARIOS.crearToken(sesion);
  resultado.versionServidor = VERSION_SERVIDOR;
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


/* ============================================================================
   DIAGNÓSTICO DE INICIO DE SESIÓN
   Ejecutar MANUALMENTE desde el editor de Apps Script (no está expuesta en la
   Web App). Revisa el Spreadsheet, la pestaña Usuarios y sus columnas.
   Nunca escribe contraseñas ni tokens en el registro.
============================================================================ */
function diagnosticarUsuarios() {
  const r = { spreadsheet: false, hojaUsuarios: false, hojas: [], columnas: {}, filas: 0,
              activos: 0, inactivos: 0, sinUsuario: 0, sinContrasena: 0, duplicados: [], roles: {} };
  let ss;
  try {
    ss = SpreadsheetApp.openById(CONFIG.SS_ID);
    r.spreadsheet = true;
  } catch (e) {
    Logger.log("NO SE PUDO ABRIR CONFIG.SS_ID (id incorrecto o sin permiso del propietario del script): " + e);
    return r;
  }
  r.hojas = ss.getSheets().map(h => h.getName());
  const hoja = ss.getSheetByName("Usuarios");
  if (!hoja) {
    Logger.log('NO EXISTE una pestaña llamada exactamente "Usuarios". Pestañas encontradas: ' + JSON.stringify(r.hojas));
    return r;
  }
  r.hojaUsuarios = true;
  const datos = hoja.getDataRange().getValues();
  if (datos.length < 2) { Logger.log("La pestaña Usuarios no tiene filas de datos."); return r; }
  const enc = datos[0].map(h => USUARIOS.normalizar(h));
  const c = USUARIOS.mapaColumnas(datos[0]);
  const nombres = { usuario: ["usuario"], password: ["contrasena", "password", "clave"], nombre: ["nombre"],
                    cargo: ["cargo"], rol: ["rol"], estado: ["estado"], ultimoAcceso: ["ultimo acceso"] };
  Object.keys(nombres).forEach(k => {
    r.columnas[k] = { indice: c[k] + 1, reconocidaPorEncabezado: enc.some(h => nombres[k].indexOf(h) !== -1) };
  });
  const vistos = {};
  for (let i = 1; i < datos.length; i++) {
    const fila = datos[i];
    const u = USUARIOS.normalizar(fila[c.usuario]);
    if (!u) { r.sinUsuario++; continue; }
    r.filas++;
    if (vistos[u]) r.duplicados.push(u); vistos[u] = true;
    if (USUARIOS.normalizar(fila[c.estado]) === "activo") r.activos++; else r.inactivos++;
    if (!String(fila[c.password] == null ? "" : fila[c.password]).trim()) r.sinContrasena++;
    const rol = USUARIOS.normalizar(fila[c.rol]) || "(vacío)";
    r.roles[rol] = (r.roles[rol] || 0) + 1;
  }
  Logger.log("DIAGNÓSTICO USUARIOS: " + JSON.stringify(r, null, 2));
  return r;
}


/* ============================================================================
   GESTIÓN: SUGERENCIAS DE PEDIDO, FOTOS DE PERFIL E IMÁGENES DE REFERENCIA
   Todas estas acciones llegan por doPost con token y NO modifican las hojas
   originales de inventario. Los mínimos solo se usan aquí, para pedidos.
============================================================================ */

const GESTION = { ROLES: ["administrador", "bodega"] };

/** Valida token + rol vigente (hoja Usuarios). roles=null: cualquier usuario activo. */
function autenticarSolicitud_(datos, roles) {
  const v = USUARIOS.validarSesionDetalle(String(datos.token || "").trim());
  if (!v.sesion) {
    const e = new Error("Su sesión no es válida o venció. Cierre sesión e ingrese nuevamente.");
    e.codigo = "SESION_INVALIDA";
    throw e;
  }
  const rol = USUARIOS.obtenerRolAutorizado(v.sesion);
  if (!rol || (roles && roles.indexOf(rol) === -1)) {
    const e = new Error("No autorizado para esta acción.");
    e.codigo = "SIN_PERMISO";
    throw e;
  }
  return { sesion: v.sesion, rol: rol };
}


/* ================= DIRECTORIO UNIVERSAL DE CLIENTES ================= */
const QI_DIR_HEADERS_ = ["CODIGO_CLIENTE","NOMBRE_CLIENTE","TELEFONO_GENERAL","ID_DIRECCION","NOMBRE_SUCURSAL","DIRECCION_COMPLETA","PERSONA_QUE_RECIBE","TELEFONO_CONTACTO","USUARIO_REGISTRO","FECHA_REGISTRO","ESTADO"];
function qiDirectorioHoja_(){
  const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
  const sh = ss.getSheetByName("DIRECTORIO_CLIENTES");
  // Ya NO se crea una pestaña en silencio: si el nombre/archivo no coincide, el cliente se
  // guardaría en un lugar distinto al que usted revisa. Se informa el error real.
  if (!sh) {
    throw new Error('No existe la pestaña DIRECTORIO_CLIENTES en el archivo de Google Sheets «' + ss.getName() +
      '» (CONFIG.SS_ID). Pestañas encontradas: ' + ss.getSheets().map(h => h.getName()).join(', ') +
      '. Mueva la pestaña a ese archivo o corrija CONFIG.SS_ID.');
  }
  // Verifica los encabezados sin borrar ni reordenar datos existentes.
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, QI_DIR_HEADERS_.length).setValues([QI_DIR_HEADERS_]);
  } else {
    const actuales = sh.getRange(1, 1, 1, QI_DIR_HEADERS_.length).getDisplayValues()[0];
    const vacia = actuales.every(v => !String(v || "").trim());
    if (vacia) sh.getRange(1, 1, 1, QI_DIR_HEADERS_.length).setValues([QI_DIR_HEADERS_]);
    const codigoHeader = String(actuales[0] || "").trim().toUpperCase();
    if (codigoHeader && codigoHeader !== "CODIGO_CLIENTE") {
      throw new Error('La pestaña DIRECTORIO_CLIENTES existe, pero la columna A debe llamarse CODIGO_CLIENTE. No se modificaron tus datos.');
    }
  }
  return sh;
}
function qiDirectorioListar_(d){
  const sh=qiDirectorioHoja_(), vals=sh.getDataRange().getDisplayValues();
  const q=String(d.q||"").trim().toLowerCase(), map={};
  vals.slice(1).forEach(r=>{if(!r[0])return; const k=String(r[0]).trim(); if(!map[k])map[k]={codigo:k,nombre:r[1]||"",telefono:r[2]||"",direcciones:[]};
    if(r[3] && String(r[10]||"Activo").toLowerCase()!=="eliminado") map[k].direcciones.push({id:r[3],sucursal:r[4]||"",direccion:r[5]||"",recibe:r[6]||"",telefono:r[7]||"",usuario:r[8]||"",fecha:r[9]||"",estado:r[10]||"Activo"});
  });
  return {success:true,clientes:Object.values(map).filter(c=>!q||c.codigo.toLowerCase().includes(q)||c.nombre.toLowerCase().includes(q))};
}
function qiDirectorioGuardar_(d, sesion){
  const codigo = String(d.codigo || "").trim();
  const nombre = String(d.nombre || "").trim();
  const telefono = String(d.telefono || "").trim();
  if (!codigo || !nombre) throw new Error("El código y nombre del cliente son obligatorios.");

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const sh = qiDirectorioHoja_();
    const last = sh.getLastRow();
    const vals = last > 1 ? sh.getRange(2, 1, last - 1, 11).getDisplayValues() : [];
    let fila = -1;
    for (let i = 0; i < vals.length; i++) {
      if (String(vals[i][0] || "").trim() === codigo) { fila = i + 2; break; }
    }

    if (fila > 0) {
      const existente = sh.getRange(fila, 1, 1, 3).getDisplayValues()[0];
      if (String(existente[1] || "").trim() !== nombre ||
          String(existente[2] || "").trim() !== telefono) {
        throw new Error("El código " + codigo + " ya existe. No se sobrescribieron los datos del cliente.");
      }
      return { success: true, existente: true, codigo: codigo, message: "Este cliente ya estaba registrado." };
    }

    const nuevaFila = Math.max(sh.getLastRow() + 1, 2);
    sh.getRange(nuevaFila, 1, 1, 11).setValues([[
      codigo, nombre, telefono, "", "", "", "", "", "", "", "Activo"
    ]]);
    SpreadsheetApp.flush();

    const verificacion = sh.getRange(nuevaFila, 1, 1, 3).getDisplayValues()[0];
    if (String(verificacion[0]).trim() !== codigo ||
        String(verificacion[1]).trim() !== nombre) {
      throw new Error("Google Sheets no confirmó la escritura del cliente. Revisa los permisos de edición de la hoja.");
    }
    return { success: true, existente: false, codigo: codigo, fila: nuevaFila, hoja: sh.getName(), archivo: sh.getParent().getName(), message: "Cliente registrado correctamente." };
  } catch (err) {
    throw new Error("No se pudo registrar el cliente en DIRECTORIO_CLIENTES: " + String(err.message || err));
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}
function qiDirectorioDireccion_(d,sesion,rol){
  const sh=qiDirectorioHoja_(), codigo=String(d.codigo||"").trim(), id=String(d.id||"").trim();
  if(!codigo) throw new Error("Código de cliente obligatorio.");
  const vals=sh.getDataRange().getDisplayValues(), usuario=String(sesion.nombre||sesion.usuario||"Usuario").trim();
  if(d.operacion==="eliminar" || d.operacion==="editar"){
    let fila=-1; for(let i=1;i<vals.length;i++) if(String(vals[i][0]).trim()===codigo&&String(vals[i][3]).trim()===id){fila=i+1;break;}
    if(fila<0) throw new Error("No se encontró la dirección.");
    if(String(vals[fila-1][8]).trim()!==usuario && rol!=="administrador") throw new Error("Solo quien registró esta dirección puede modificarla o eliminarla.");
    if(d.operacion==="eliminar"){sh.getRange(fila,11).setValue("Eliminado");return {success:true};}
    const a=d.direccion||{}; sh.getRange(fila,5,1,4).setValues([[a.sucursal||"",a.direccion||"",a.recibe||"",a.telefono||""]]); return {success:true};
  }
  const a=d.direccion||{}; if(!a.direccion) throw new Error("La dirección completa es obligatoria.");
  const idNuevo="DIR-"+Utilities.getUuid().slice(0,8).toUpperCase();
  sh.appendRow([codigo,"","",idNuevo,a.sucursal||"",a.direccion||"",a.recibe||"",a.telefono||"",usuario,new Date(),"Activo"]);
  return {success:true,id:idNuevo};
}

function manejarAccionGestion_(accion, d) {
  switch (accion) {
    case "directorioListar": { const a=autenticarSolicitud_(d,null); return qiDirectorioListar_(d); }
    case "directorioGuardarCliente": { const a=autenticarSolicitud_(d,null); return qiDirectorioGuardar_(d,a.sesion); }
    case "directorioDireccion": { const a=autenticarSolicitud_(d,null); return qiDirectorioDireccion_(d,a.sesion,a.rol); }
    case "getSugerenciasReposicion": {
      autenticarSolicitud_(d, GESTION.ROLES);
      return Object.assign({ success: true }, getSugerenciasReposicion(!!d.forzar));
    }
    case "getFotoPerfil":
      return FOTOS.obtener(autenticarSolicitud_(d, null).sesion);
    case "setFotoPerfil":
      return FOTOS.guardar(autenticarSolicitud_(d, null).sesion, String(d.foto || ""));
    case "eliminarFotoPerfil":
      return FOTOS.eliminar(autenticarSolicitud_(d, null).sesion);
    case "getImagenDrive": {
      autenticarSolicitud_(d, null);
      return obtenerImagenDriveGestion_(d);
    }
    case "getImagenesLote": {
      // Fase 2.6: varias imágenes por solicitud (una autenticación, una apertura
      // del Spreadsheet, descargas en paralelo y caché de 6 h en el servidor).
      autenticarSolicitud_(d, null);
      return obtenerImagenesLoteGestion_(d);
    }
    default:
      return null;
  }
}

/* ---------- utilidades para cálculos de pedidos ---------- */
function numeroSeguro_(v) { const n = Number(v); return isFinite(n) ? n : 0; }

function codigoComparable_(v) {
  return String(v == null ? "" : v).replace(/[\u00A0\u200B-\u200D\uFEFF]/g, "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/* ---------- REPOSICIÓN ---------- */

/**
 * Cálculo puro. Reactivos: necesidad = mínimo TGU - existencia TGU; la
 * sugerencia a pedir a SPS nunca supera lo disponible en SPS. Materiales:
 * solo necesidad de TGU (sin abastecimiento desde SPS en esta etapa).
 * Productos se relacionan únicamente por código idéntico (sin coincidencias aproximadas).
 */
function calcularReposicion_(tguProductos, spsProductos) {
  const sps = {};
  (spsProductos || []).forEach(p => {
    const k = codigoComparable_(p.sku);
    if (k) sps[k] = (sps[k] || 0) + numeroSeguro_(p.stockTotal);
  });
  const reactivos = [], materiales = [];
  let cumplen = 0, sinMinimo = 0;
  (tguProductos || []).forEach(p => {
    const tipo = String(p.tipo || "reactivo").toLowerCase();
    if (tipo !== "reactivo" && tipo !== "material") return;
    if (p.minimoRequerido === null || p.minimoRequerido === undefined || !isFinite(Number(p.minimoRequerido))) { sinMinimo++; return; }
    const existencia = numeroSeguro_(p.stockTotal), minimo = Number(p.minimoRequerido);
    const necesidad = Math.max(0, minimo - existencia);
    if (necesidad === 0) { cumplen++; return; }
    const base = { codigo: String(p.sku || ""), producto: String(p.nombre || ""), marca: String(p.marca || ""),
                   categoria: String(p.categoria || ""), existenciasTGU: existencia, minimoTGU: minimo, necesidad: necesidad };
    if (tipo === "material") { materiales.push(Object.assign(base, { estado: "pedido" })); return; }
    const k = codigoComparable_(p.sku);
    const registrado = Object.prototype.hasOwnProperty.call(sps, k);
    const disponible = registrado ? Math.max(0, sps[k]) : 0;
    const sugerido = Math.min(necesidad, disponible);
    let estado = "completo";
    if (!registrado) estado = "sin_registro_sps";
    else if (disponible <= 0) estado = "sin_disponibilidad";
    else if (disponible < necesidad) estado = "parcial";
    reactivos.push(Object.assign(base, { existenciasSPS: registrado ? disponible : null, sugerido: sugerido,
                                          pendiente: necesidad - sugerido, estado: estado }));
  });
  const ord = (a, b) => b.necesidad - a.necesidad;
  reactivos.sort(ord); materiales.sort(ord);
  return { reactivos: reactivos, materiales: materiales,
           resumen: { reactivosAReponer: reactivos.length, materialesAReponer: materiales.length, cumplenMinimo: cumplen, sinMinimoDefinido: sinMinimo } };
}

function getSugerenciasReposicion(forzar) {
  const tgu = getInventario(forzar);
  const sps = getInventarioSPS();
  return calcularReposicion_(tgu.productos, sps.productos);
}

/** Hojas permitidas para recuperar imágenes incrustadas.
 * Repuestos utiliza el mismo mecanismo de referencia por celda, pero su hoja
 * puede tener el nombre singular/plural y variaciones de mayúsculas.
 */
function esHojaImagenPermitidaGestion_(nombre) {
  const n = String(nombre || "").trim();
  return n === "Marcas" || CONFIG.HOJAS_MATERIALES.indexOf(n) >= 0 || /^repuestos?$/i.test(n);
}

/** Resuelve de nuevo una imagen alojada en una celda para evitar content URLs vencidas. */
function obtenerUrlImagenCeldaGestion_(fuente) {
  const hojaNombre = String(fuente && fuente.hoja || "").trim();
  const fila = Number(fuente && fuente.fila);
  const columna = Number(fuente && fuente.columna);
  const permitida = esHojaImagenPermitidaGestion_(hojaNombre);
  if (!permitida || !Number.isInteger(fila) || !Number.isInteger(columna) || fila < 1 || columna < 1) {
    throw new Error("La referencia de la celda de imagen no es válida.");
  }
  const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
  const hoja = ss.getSheetByName(hojaNombre);
  if (!hoja || fila > hoja.getMaxRows() || columna > hoja.getMaxColumns()) {
    throw new Error("No se encontró la celda de la imagen en Google Sheets.");
  }
  const celda = hoja.getRange(fila, columna);
  const valor = celda.getValue();
  const formula = celda.getFormula();
  const rich = celda.getRichTextValue();
  let anclada = "";
  try {
    const imagen = hoja.getImages().find(img => {
      const ancla = img.getAnchorCell();
      return ancla && ancla.getRow() === fila && ancla.getColumn() === columna;
    });
    if (imagen && imagen.getUrl) anclada = imagen.getUrl() || "";
  } catch (e) {}
  return UTIL.convertirReferenciaCelda(valor, formula, rich, anclada);
}

/**
 * Recupera una imagen de Drive/Sheets que el navegador no puede abrir directamente.
 * Requiere una sesión activa y valida el MIME antes de devolver la vista previa.
 */
function obtenerImagenDriveGestion_(datos) {
  const entrada = String(datos.fileId || "").trim();
  let url = String(datos.url || "").trim();
  const fuenteCelda = datos.fuente && typeof datos.fuente === "object" ? datos.fuente : null;

  // Para imágenes insertadas dentro de una celda, SIEMPRE generar la URL vigente
  // consultando nuevamente la coordenada original; las content URLs de Google expiran.
  if (fuenteCelda) {
    const actualizada = obtenerUrlImagenCeldaGestion_(fuenteCelda);
    if (actualizada) url = actualizada;
  }

  const fuente = entrada || url;
  const m = fuente.match(/(?:\/file\/d\/|\/d\/|[?&]id=)([A-Za-z0-9_-]{10,})/);
  const id = m ? m[1] : (/^[A-Za-z0-9_-]{20,}$/.test(fuente) ? fuente : "");
  let blob = null;
  let mime = "";

  // Si es un archivo de Drive identificable, usar el blob con permisos de Apps Script.
  if (id) {
    try {
      const archivo = DriveApp.getFileById(id);
      blob = archivo.getBlob();
      mime = String(blob.getContentType() || archivo.getMimeType() || "").toLowerCase();
    } catch (e) {
      Logger.log("No se pudo leer imagen por DriveApp; se intentará su URL temporal: " + e);
    }
  }

  let urlTemporalFallback = "";
  if (!blob || mime.indexOf("image/") !== 0) {
    if (!url || !/^https:\/\//i.test(url)) throw new Error("La referencia no contiene una URL de imagen válida.");
    let host = "", path = "";
    const u = url.match(/^https:\/\/([^/:?#]+)(\/[^?#]*)?/i);
    if (u) { host = u[1].toLowerCase(); path = u[2] || "/"; }

    const googleHost = /(^|\.)googleusercontent\.com$/.test(host) ||
      /(^|\.)drive\.google\.com$/.test(host) || /(^|\.)docs\.google\.com$/.test(host);
    // Solo se permite el dominio oficial del catálogo y su directorio público de imágenes.
    const qualityHost = (host === "qualityhn.com" || host === "www.qualityhn.com") && /^\/wp-content\/uploads\//i.test(path);
    if (!googleHost && !qualityHost) throw new Error("El dominio de la imagen no está autorizado para vista previa.");

    // Una CellImage siempre produce una URL temporal de Google que se puede entregar
    // como alternativa al navegador si UrlFetch no logra descargar el contenido.
    if (googleHost && fuenteCelda) urlTemporalFallback = url;

    const opciones = {
      followRedirects: true,
      muteHttpExceptions: true,
      headers: { Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8", "User-Agent": "Mozilla/5.0 QualityInventario/2.5" }
    };
    if (qualityHost) opciones.headers.Referer = "https://qualityhn.com/";
    let respuesta = UrlFetchApp.fetch(url, opciones);
    let codigo = respuesta.getResponseCode();
    let prueba = codigo >= 200 && codigo < 300 ? respuesta.getBlob() : null;
    let tipo = prueba ? String(prueba.getContentType() || "").toLowerCase() : "";

    // Reintento autenticado para content URLs de Google asociadas a la cuenta del despliegue.
    if ((codigo < 200 || codigo >= 300 || tipo.indexOf("image/") !== 0) && googleHost) {
      opciones.headers.Authorization = "Bearer " + ScriptApp.getOAuthToken();
      respuesta = UrlFetchApp.fetch(url, opciones);
      codigo = respuesta.getResponseCode();
      prueba = codigo >= 200 && codigo < 300 ? respuesta.getBlob() : null;
      tipo = prueba ? String(prueba.getContentType() || "").toLowerCase() : "";
    }

    if (codigo >= 200 && codigo < 300 && prueba && tipo.indexOf("image/") === 0) {
      blob = prueba;
      mime = tipo;
    } else if (urlTemporalFallback) {
      // El navegador puede consumir el content URL firmado recién generado.
      return { success: true, imageUrl: urlTemporalFallback, temporal: true };
    } else {
      throw new Error("No se pudo recuperar la imagen desde el origen (HTTP " + codigo + ", tipo " + (tipo || "desconocido") + ").");
    }
  }

  if (!blob || mime.indexOf("image/") !== 0) {
    if (urlTemporalFallback) return { success: true, imageUrl: urlTemporalFallback, temporal: true };
    throw new Error("El archivo de referencia no es una imagen accesible.");
  }
  const bytes = blob.getBytes();
  if (bytes.length > 3500000) {
    if (urlTemporalFallback) return { success: true, imageUrl: urlTemporalFallback, temporal: true };
    throw new Error("La imagen supera el límite de vista previa de 3.5 MB. Reduzca su tamaño en Drive.");
  }
  return { success: true, dataUrl: "data:" + mime + ";base64," + Utilities.base64Encode(bytes) };
}


/* ============================================================================
 * FASE 2.6 — IMÁGENES POR LOTES
 * Sustituye "una solicitud HTTP + una apertura del Spreadsheet + un getImages()
 * + una descarga" por CADA imagen por una sola solicitud para varias imágenes:
 *   - una autenticación por lote;
 *   - una apertura del Spreadsheet y lectura de rangos agrupados por hoja;
 *   - descargas en paralelo con UrlFetchApp.fetchAll();
 *   - caché del servidor (6 h, el máximo de CacheService) solo para imágenes
 *     pequeñas, con clave hoja|columna|referencia (nunca la URL temporal).
 * La URL temporal de Google se vuelve a generar de la celda en cada descarga.
 * ========================================================================= */

const IMAGENES = {
  MAX_LOTE: 10,
  MAX_BYTES_IMAGEN: 3500000,     // mismo límite que getImagenDrive
  MAX_BYTES_CACHE: 240000,       // solo se cachean imágenes pequeñas
  MAX_CHARS_RESPUESTA: 5500000,  // tope de base64 por respuesta; el resto se pide en otro lote
  TTL_CACHE_SEG: 21600,          // 6 h: máximo permitido por CacheService
  PARTE: 90000,                  // < 100 KB por entrada de caché
  SEPARACION_FILAS: 40,          // filas de distancia para leer rangos separados

  norm_(v) {
    return String(v == null ? "" : v).trim().normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  },

  clave_(hoja, columna, ref) {
    const crudo = hoja + "|" + columna + "|" + IMAGENES.norm_(ref);
    const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, crudo, Utilities.Charset.UTF_8);
    return "QI_IMG_V1_" + bytes.map(b => ("0" + (b & 0xff).toString(16)).slice(-2)).join("");
  },

  /** La fila debe seguir conteniendo la referencia (SKU o marca) que pidió el cliente. */
  filaContiene_(fila, ref) {
    const buscado = IMAGENES.norm_(ref);
    if (!buscado) return false;
    for (let i = 0; i < fila.length; i++) {
      const c = fila[i];
      if (c === null || c === undefined || c === "" || typeof c === "object") continue;
      if (IMAGENES.norm_(c) === buscado) return true;
    }
    return false;
  },

  indiceAncladas_(hoja) {
    const mapa = {};
    try {
      hoja.getImages().forEach(img => {
        const celda = img.getAnchorCell();
        const url = img.getUrl && img.getUrl();
        if (celda && url) mapa[celda.getRow() + ":" + celda.getColumn()] = url;
      });
    } catch (e) { Logger.log("No se pudieron leer imágenes ancladas: " + e); }
    return mapa;
  },

  urlPermitida_(url) {
    const u = String(url || "").match(/^https:\/\/([^\/:?#]+)(\/[^?#]*)?/i);
    if (!u) return false;
    const host = u[1].toLowerCase(), path = u[2] || "/";
    const google = /(^|\.)googleusercontent\.com$/.test(host) || /(^|\.)drive\.google\.com$/.test(host) || /(^|\.)docs\.google\.com$/.test(host);
    const quality = (host === "qualityhn.com" || host === "www.qualityhn.com") && /^\/wp-content\/uploads\//i.test(path);
    return google || quality;
  },

  opcionesFetch_(url, conAuth) {
    const h = { Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8", "User-Agent": "Mozilla/5.0 QualityInventario/2.6" };
    if (/qualityhn\.com/i.test(url)) h.Referer = "https://qualityhn.com/";
    if (conAuth) h.Authorization = "Bearer " + ScriptApp.getOAuthToken();
    return { url: url, method: "get", followRedirects: true, muteHttpExceptions: true, headers: h };
  },

  /** Lee de la caché del servidor; devuelve { mime, base64 } o null. */
  leerCache_(cache, manifiestos, clave) {
    try {
      const raw = manifiestos[clave];
      if (!raw) return null;
      const m = JSON.parse(raw);
      if (!m || !m.n || !m.m) return null;
      const claves = [];
      for (let i = 0; i < m.n; i++) claves.push(clave + "#" + i);
      const partes = cache.getAll(claves);
      let base64 = "";
      for (let i = 0; i < m.n; i++) {
        const p = partes[clave + "#" + i];
        if (!p) return null;
        base64 += p;
      }
      return { mime: m.m, base64: base64 };
    } catch (e) { return null; }
  },

  guardarCache_(cache, clave, mime, base64) {
    try {
      const partes = {};
      let n = 0;
      for (let ini = 0; ini < base64.length; ini += IMAGENES.PARTE) {
        partes[clave + "#" + n] = base64.substring(ini, ini + IMAGENES.PARTE);
        n++;
      }
      partes[clave] = JSON.stringify({ m: mime, n: n });
      cache.putAll(partes, IMAGENES.TTL_CACHE_SEG);
    } catch (e) { Logger.log("No se pudo guardar la imagen en caché: " + e); }
  }
};

/** Vacía la caché de imágenes del servidor (ejecutar manualmente si se reemplazó una imagen y no se quiere esperar). */
function limpiarCacheImagenes() {
  // CacheService no permite listar claves: se invalida cambiando el prefijo de IMAGENES.clave_
  // (QI_IMG_V1_ → QI_IMG_V2_) y desplegando de nuevo, o esperando las 6 h de caducidad.
  // El cliente también puede pasar forzar:true para saltarse la caché por lote.
  Logger.log("Las imágenes en caché caducan solas a las 6 h. Use forzar:true desde el cliente para omitirlas.");
}

function obtenerImagenesLoteGestion_(datos) {
  const t0 = Date.now();
  const forzar = !!datos.forzar;
  const entrada = Array.isArray(datos.items) ? datos.items.slice(0, IMAGENES.MAX_LOTE) : [];
  const resultados = new Array(entrada.length);
  const cache = CacheService.getScriptCache();
  let pendientes = [];

  // 1. Validar cada elemento y calcular su clave de caché.
  entrada.forEach((it, i) => {
    const hoja = String(it && it.hoja || "").trim();
    const fila = Number(it && it.fila), columna = Number(it && it.columna);
    const ref = String(it && it.ref || "").trim();
    const permitida = esHojaImagenPermitidaGestion_(hoja);
    if (!permitida || !Number.isInteger(fila) || !Number.isInteger(columna) || fila < 1 || columna < 1 || !ref) {
      resultados[i] = { ok: false, motivo: "REFERENCIA_NO_VALIDA" };
      return;
    }
    pendientes.push({ i: i, hoja: hoja, fila: fila, columna: columna, ref: ref, clave: IMAGENES.clave_(hoja, columna, ref) });
  });

  let desdeCache = 0, descargadas = 0, totalChars = 0;

  // 2. Caché del servidor (una sola lectura de manifiestos).
  if (!forzar && pendientes.length) {
    const manifiestos = cache.getAll(pendientes.map(p => p.clave));
    pendientes = pendientes.filter(p => {
      const hit = IMAGENES.leerCache_(cache, manifiestos, p.clave);
      if (!hit) return true;
      resultados[p.i] = { ok: true, dataUrl: "data:" + hit.mime + ";base64," + hit.base64, mime: hit.mime, origen: "cache" };
      totalChars += hit.base64.length;
      desdeCache++;
      return false;
    });
  }

  // 3. Leer las celdas necesarias: un Spreadsheet, un rango por grupo de filas cercanas.
  if (pendientes.length) {
    const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
    const porHoja = {};
    pendientes.forEach(p => { (porHoja[p.hoja] = porHoja[p.hoja] || []).push(p); });

    Object.keys(porHoja).forEach(nombre => {
      const lista = porHoja[nombre].sort((a, b) => a.fila - b.fila);
      const hoja = ss.getSheetByName(nombre);
      if (!hoja) { lista.forEach(p => { p.error = "HOJA_NO_ENCONTRADA"; }); return; }
      const ultimaFila = hoja.getLastRow(), ultimaCol = hoja.getLastColumn();
      let ancladas = null;
      const grupos = [];
      let actual = [];
      lista.forEach(p => {
        if (actual.length && p.fila - actual[actual.length - 1].fila > IMAGENES.SEPARACION_FILAS) { grupos.push(actual); actual = []; }
        actual.push(p);
      });
      if (actual.length) grupos.push(actual);

      grupos.forEach(g => {
        const f0 = g[0].fila, f1 = Math.min(g[g.length - 1].fila, ultimaFila);
        if (f1 < f0) { g.forEach(p => { p.error = "CELDA_NO_ENCONTRADA"; }); return; }
        const valores = hoja.getRange(f0, 1, f1 - f0 + 1, ultimaCol).getValues();
        g.forEach(p => {
          const fila = valores[p.fila - f0];
          if (!fila) { p.error = "CELDA_NO_ENCONTRADA"; return; }
          if (!IMAGENES.filaContiene_(fila, p.ref)) { p.error = "FILA_DESACTUALIZADA"; return; }
          const valor = fila[p.columna - 1];
          let url = "";
          if (UTIL.esImagenDeCelda(valor)) { try { url = valor.getContentUrl() || ""; } catch (e) {} }
          if (!url) {
            if (!ancladas) ancladas = IMAGENES.indiceAncladas_(hoja);
            url = ancladas[p.fila + ":" + p.columna] || "";
          }
          if (!url) { p.error = "SIN_IMAGEN"; return; }
          if (!IMAGENES.urlPermitida_(url)) { p.error = "DOMINIO_NO_AUTORIZADO"; return; }
          p.url = url;
        });
      });
    });

    pendientes.forEach(p => { if (p.error) resultados[p.i] = { ok: false, motivo: p.error }; });

    // 4. Descargas en paralelo (primero sin credenciales; reintento con token solo para las que fallen).
    let conUrl = pendientes.filter(p => p.url);
    const evaluar = (p, r) => {
      const codigo = r.getResponseCode();
      if (codigo < 200 || codigo >= 300) return null;
      const blob = r.getBlob();
      const mime = String(blob.getContentType() || "").toLowerCase();
      return mime.indexOf("image/") === 0 ? { blob: blob, mime: mime } : null;
    };
    const descargar = (lista, conAuth) => {
      if (!lista.length) return;
      let respuestas = null;
      try {
        respuestas = UrlFetchApp.fetchAll(lista.map(p => IMAGENES.opcionesFetch_(p.url, conAuth)));
      } catch (e) {
        Logger.log("fetchAll falló; se descarga una por una: " + e);
        respuestas = lista.map(p => { try { return UrlFetchApp.fetch(p.url, IMAGENES.opcionesFetch_(p.url, conAuth)); } catch (e2) { return null; } });
      }
      lista.forEach((p, k) => {
        const r = respuestas[k];
        if (!r) return;
        try { const ok = evaluar(p, r); if (ok) p.descarga = ok; } catch (e) {}
      });
    };
    descargar(conUrl, false);
    descargar(conUrl.filter(p => !p.descarga && /googleusercontent|drive\.google|docs\.google/i.test(p.url)), true);

    conUrl.forEach(p => {
      if (!p.descarga) {
        // Último recurso (igual que getImagenDrive): URL recién generada para que el navegador la intente.
        resultados[p.i] = { ok: true, imageUrl: p.url, temporal: true, origen: "url-temporal" };
        return;
      }
      const bytes = p.descarga.blob.getBytes();
      if (bytes.length > IMAGENES.MAX_BYTES_IMAGEN) {
        resultados[p.i] = { ok: true, imageUrl: p.url, temporal: true, origen: "url-temporal" };
        return;
      }
      const base64 = Utilities.base64Encode(bytes);
      if (totalChars + base64.length > IMAGENES.MAX_CHARS_RESPUESTA && totalChars > 0) {
        // Respuesta demasiado grande: el cliente vuelve a pedir esta imagen en otro lote.
        resultados[p.i] = { ok: false, pendiente: true, motivo: "LOTE_LLENO" };
        return;
      }
      totalChars += base64.length;
      descargadas++;
      if (bytes.length <= IMAGENES.MAX_BYTES_CACHE) IMAGENES.guardarCache_(cache, p.clave, p.descarga.mime, base64);
      resultados[p.i] = { ok: true, dataUrl: "data:" + p.descarga.mime + ";base64," + base64, mime: p.descarga.mime, origen: "origen" };
    });
  }

  return {
    success: true,
    resultados: resultados,
    desdeCache: desdeCache,
    descargadas: descargadas,
    ms: Date.now() - t0
  };
}

/* ---------- FOTO DE PERFIL (Google Drive, una por usuario) ---------- */

const FOTOS = {
  CARPETA: "QualityInventario_FotosPerfil",
  MAX_CHARS: 300000,
  // La clave sale SIEMPRE del usuario de la sesión: el cliente no puede indicar de quién es la foto.
  clave(sesion) {
    return "QI_FOTO_" + USUARIOS._firmar_("foto:" + USUARIOS.normalizar(sesion.usuario)).replace(/[^A-Za-z0-9]/g, "").slice(0, 32);
  },
  carpeta() {
    const it = DriveApp.getFoldersByName(this.CARPETA);
    return it.hasNext() ? it.next() : DriveApp.createFolder(this.CARPETA);
  },
  obtener(sesion) {
    const id = PropertiesService.getScriptProperties().getProperty(this.clave(sesion));
    if (!id) return { success: true, foto: "" };
    try {
      const f = DriveApp.getFileById(id);
      if (f.isTrashed()) return { success: true, foto: "" };
      const b = f.getBlob();
      return { success: true, foto: "data:" + b.getContentType() + ";base64," + Utilities.base64Encode(b.getBytes()) };
    } catch (e) {
      Logger.log("No se pudo leer la foto de perfil: " + e);
      return { success: true, foto: "" };
    }
  },
  guardar(sesion, dataUrl) {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+\/=]+)$/.exec(dataUrl);
    if (!m) throw new Error("Formato de imagen no válido (use JPG, PNG o WEBP).");
    if (dataUrl.length > this.MAX_CHARS) throw new Error("La imagen es demasiado grande.");
    const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], "perfil_" + Date.now());
    const props = PropertiesService.getScriptProperties(), k = this.clave(sesion);
    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      const previo = props.getProperty(k);
      const archivo = this.carpeta().createFile(blob);
      props.setProperty(k, archivo.getId());
      if (previo) { try { DriveApp.getFileById(previo).setTrashed(true); } catch (e) {} }
    } finally { lock.releaseLock(); }
    return { success: true };
  },
  eliminar(sesion) {
    const props = PropertiesService.getScriptProperties(), k = this.clave(sesion);
    const previo = props.getProperty(k);
    if (previo) { try { DriveApp.getFileById(previo).setTrashed(true); } catch (e) {} props.deleteProperty(k); }
    return { success: true };
  }
};

/** Ejecutar UNA vez desde el editor: pide la autorización de Google Drive para las fotos. */
function autorizarPermisos() {
  DriveApp.getRootFolder();
  Logger.log("Permisos de Drive autorizados. Ahora cree una nueva versión de la implementación.");
}


/* ============================================================================
   DIAGNÓSTICO DEL DIRECTORIO DE CLIENTES
   Ejecutar MANUALMENTE desde el editor de Apps Script (no está expuesta en la
   Web App). Confirma archivo, pestaña, encabezados y permiso de escritura.
   No agrega, borra ni modifica ninguna fila.
============================================================================ */
function diagnosticarDirectorio() {
  const r = { archivo: "", pestanas: [], existePestana: false, encabezadosOk: false, filas: 0, puedeEscribir: null, propietario: "", usuarioEfectivo: "", error: "" };
  try {
    const ss = SpreadsheetApp.openById(CONFIG.SS_ID);
    r.archivo = ss.getName();
    r.pestanas = ss.getSheets().map(h => h.getName());
    const sh = ss.getSheetByName("DIRECTORIO_CLIENTES");
    r.existePestana = !!sh;
    if (sh) {
      const enc = sh.getRange(1, 1, 1, QI_DIR_HEADERS_.length).getDisplayValues()[0].map(v => String(v || "").trim().toUpperCase());
      r.encabezadosOk = QI_DIR_HEADERS_.every((h, i) => enc[i] === h);
      r.filas = Math.max(sh.getLastRow() - 1, 0);
      try { r.propietario = ss.getOwner() ? ss.getOwner().getEmail() : "(archivo en unidad compartida)"; r.usuarioEfectivo = Session.getEffectiveUser().getEmail(); r.puedeEscribir = "Si propietario y usuarioEfectivo coinciden, o el usuario es editor del archivo, la escritura está permitida."; } catch (e) { r.puedeEscribir = "no verificable: " + e; }
    }
  } catch (e) {
    r.error = String(e);
  }
  Logger.log("DIAGNÓSTICO DIRECTORIO: " + JSON.stringify(r, null, 2));
  return r;
}
