# Quality Inventario — Corrección Directorio de Clientes (v3.1.0)

## Causa real encontrada
**1. Los clientes no se guardaban:** en `home.html` el formulario `qiFormDirectorio` contiene el campo
`<textarea name="direccion" required>` dentro del bloque oculto «Nueva dirección». Al registrar un
**cliente**, ese campo queda vacío, oculto y obligatorio; el navegador cancela el envío con su
validación nativa («invalid form control is not focusable»). El evento `submit` nunca llega a ejecutarse,
no sale ninguna petición a Apps Script y no aparece ningún error. Por eso la lista seguía vacía.
Reproducido con el HTML original: `checkValidity()` devuelve `false` con código y nombre llenos.

**2. Las tarjetas reaparecían:** `mostrarDashboardCards()` (home.js), llamada desde `mostrarMarcas()`,
la búsqueda y la auto-actualización, escribe `dashboard.style.display = "grid"` y solo conocía
Almacén/Movimientos/Vencimientos, no el Directorio. Ese estilo inline pisaba el `display:none`
puesto por el listener del Directorio.

## Qué se cambió
- `js/directorio.js`: solo el bloque visible del modal queda habilitado/obligatorio; validación propia;
  evita doble envío; tras guardar **relee** `DIRECTORIO_CLIENTES` y exige que el registro aparezca; errores
  reales por `alert` y en la lista; navegación por clase `qi-vista-directorio` en `<body>`.
- `css/directorio.css`: con esa clase (`!important`) se ocultan tarjetas, resultados de productos,
  Almacén, Movimientos, Vencimientos, Configuración y el buscador de productos. Sin la clase, el Directorio
  siempre está oculto. Ningún `style.display` de otro script puede volver a mostrar las tarjetas.
- `js/home.js`: `mostrarDashboardCards()` no muestra nada si el Directorio está activo (1 bloque añadido).
- `js/api.js` (`postAutenticado`): si Apps Script no devuelve JSON (p. ej. login de Google por
  implementación no pública) o no hay conexión, se informa el motivo real.
- `home.html` / `service-worker.js`: versión `?v=3.1.0` en todos los scripts/CSS y caché `v3-1`
  para forzar la descarga de los archivos nuevos (el SW es «red primero»).
- `Code.gs`: ya **no crea en silencio** una pestaña `DIRECTORIO_CLIENTES` si no la encuentra (eso guardaría
  en un archivo distinto al que usted revisa): devuelve error con el nombre del archivo y sus pestañas.
  Mensaje de «Acción no válida» indica la acción y que probablemente falta redesplegar. `VERSION_SERVIDOR`
  = `2026-11-15-directorio-clientes-fix`. Nueva función manual `diagnosticarDirectorio()`.
- Auditado sin cambios necesarios: `directorioGuardarCliente` (campos `codigo,nombre,telefono`),
  enrutamiento de `directorioListar` / `directorioGuardarCliente` / `directorioDireccion` en
  `manejarAccionGestion_`, `autenticarSolicitud_`, `qiDirectorioGuardar_` (lock, escritura, `flush`,
  verificación), token enviado por `postAutenticado`, respuesta JSON de `doPost`, un solo listener `submit`
  (protegido con `dataset.qiSubmitBound`).

## Instalación (en este orden)
1. **Frontend:** suba el contenido de `FRONTEND_HOSTINGER/` a Hostinger reemplazando los archivos existentes
   (incluya `home.html`, `service-worker.js`, `js/` y `css/`).
2. **Apps Script:** abra el proyecto, reemplace todo `Code.gs` por `APPS_SCRIPT_NO_SUBIR_A_HOSTINGER/Code.gs`
   (también entregado suelto), **Guardar**.
3. **Implementar > Administrar implementaciones > ✏️ Editar > Versión: «Nueva versión» > Implementar.**
   Guardar no basta. Mantenga «Ejecutar como: yo» y acceso «Cualquier persona» y **la misma URL** que `API_URL` en `js/api.js`.
4. Compruebe el despliegue abriendo `API_URL?action=ping`: debe mostrar `"version":"2026-11-15-directorio-clientes-fix"`.
5. En el editor de Apps Script ejecute `diagnosticarDirectorio()` y revise el registro: debe indicar el archivo
   correcto, `existePestana: true` y `encabezadosOk: true`. Si no, mueva la pestaña al archivo de `CONFIG.SS_ID`.
6. En el navegador: Ctrl+F5 (o Aplicación > Service Workers > Unregister una vez) y cierre/abra sesión
   para obtener un token vigente (duran 6 h).
7. Pruebe: Directorio de Clientes > + Nuevo cliente > Guardar. Debe aparecer una fila nueva en `DIRECTORIO_CLIENTES`.

## Archivos modificados
`FRONTEND_HOSTINGER/`: `home.html`, `service-worker.js`, `js/directorio.js`, `js/api.js`, `js/home.js`,
`css/directorio.css` · `APPS_SCRIPT_NO_SUBIR_A_HOSTINGER/Code.gs` · este README.

## Pruebas realizadas
- `node --check` en los 17 JS del frontend + `service-worker.js` y en `Code.gs`: sin errores de sintaxis.
- Prueba en jsdom con el `home.html`, `directorio.css`, `directorio.js` y las funciones reales de `home.js`
  (17/17): tarjetas ocultas al entrar al Directorio; un listener ajeno que intenta re-mostrarlas no lo logra;
  resultados de productos y buscador ocultos; formulario válido y enviado con `codigo/nombre/telefono`;
  relectura de la lista tras guardar; error del servidor mostrado y modal abierto; al volver a Productos se
  restauran tarjetas y resultados.
- Revisión del enrutamiento: las tres acciones existen en `manejarAccionGestion_`.
## Pruebas pendientes (no ejecutables sin su entorno real)
- Escritura real en su Google Sheets, permisos de la cuenta que ejecuta el Web App y que `CONFIG.SS_ID`
  contenga la pestaña (use `diagnosticarDirectorio()`).
- Despliegue real de la nueva versión y comportamiento en su navegador con caché/Service Worker previos.
- Navegación visual en Chrome/Safari móvil (solo se probó en jsdom).
