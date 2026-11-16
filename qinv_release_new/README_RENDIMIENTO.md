# Quality Inventario — Fase 2.6: optimización de velocidad y rendimiento

## 1. Diagnóstico (cuellos de botella encontrados leyendo el código)
| # | Hallazgo | Dónde |
|---|---|---|
| 1 | Cada imagen incrustada en una celda (Materiales, logos de Marcas) hacía **su propio POST** a Apps Script, y se lanzaba al crear la tarjeta aunque no estuviera visible (`loading="lazy"` solo frena el `src`, no esa llamada). | `home.js` → `cargarImagenConRespaldoQI` |
| 2 | Cada POST: valida sesión, **lee la hoja Usuarios completa**, abre el Spreadsheet, recorre `getImages()` de toda la hoja, descarga la imagen y la convierte a base64. Sin paralelismo. | `Code.gs` → `getImagenDrive` |
| 3 | Caché de imágenes solo en memoria, 30 s (URL temporal) / 5 min. Se perdía al recargar. El mismo logotipo se pedía en cada tarjeta de categoría. | `home.js` |
| 4 | `getMarcas` sin caché en servidor ni cliente (lee hoja + `getImages()` + `DriveApp.getFileById()` por fila). | `Code.gs` |
| 5 | Las URLs temporales `googleusercontent` se guardaban en CacheService y en el snapshot persistente (PropertiesService) y viajaban en cada respuesta. | `Code.gs` → `leerHojaMaterial` |
| 6 | `tipoReferenciaCelda` llamaba a `DriveApp.getFileById()` por fila en cada lectura completa. | `Code.gs` |
| 7 | Chart.js, jsPDF y autotable eran `<script>` **síncronos** antes de la app: hasta que bajaban de CDN, la app no arrancaba. | `home.html` |
| 8 | La primera pantalla esperaba también a `getMarcas` (`Promise.all`). | `home.js` |
| 9 | Búsqueda y filtro por estado creaban **todas** las tarjetas de golpe; el auto-refresco redibujaba todo aunque los datos no cambiaran. | `home.js` |
| 10 | `will-change` y animación en cada tarjeta; el service worker borraba cualquier caché ajena y no tenía tiempo máximo de red. | CSS / SW |

Ya estaba bien (no se tocó): cambio de tema por clase CSS (sin recarga), `getResumen`/`getInicio` en una sola llamada, snapshot, búsqueda local.

## 2. Qué se cambió
**Imágenes (`js/imagenes.js`, nuevo)**: carga solo de lo visible (IntersectionObserver, 400 px de margen, 80 ms de permanencia), primeras tarjetas con prioridad, **lotes de hasta 8 imágenes por solicitud** (máx. 2 lotes simultáneos), deduplicación, caché en memoria + **Cache API** persistente que guarda la *imagen* (nunca la URL temporal), caché negativa de 60 s para fallos, respaldo automático al endpoint individual si el servidor es el anterior. Una imagen lenta no bloquea nada.

**Cachés por tipo**
| Dato | Dónde | Duración |
|---|---|---|
| Existencias, lotes, movimientos | memoria (30 s) + CacheService servidor (300 s / 60 s `getInicio`) | **nunca persistente en el navegador** |
| Lista de marcas/logos (nombres, URL pública, coordenada) | localStorage | 10 min fresco; hasta 24 h con renovación en segundo plano |
| Logotipos (imagen) | Cache API `qi-img-marcas-v1` | 24 h |
| Fotos de Reactivos (URL pública WordPress) | caché HTTP del navegador (carga directa) | la que defina el servidor |
| Imágenes incrustadas de Materiales | Cache API `qi-img-materiales-v1` + CacheService servidor | 6 h + 6 h |
| Repuestos | `qi-img-repuestos-v1` | 6 h |
| Preferencias visuales | localStorage `qualityPreferencias` (sin cambio) | permanente |
| URLs temporales de Google | solo memoria, 25 s, sin persistir | — |

**Backend (`Code.gs`)**: acción `getImagenesLote` (1 autenticación, 1 apertura del Spreadsheet, rangos agrupados, `fetchAll` en paralelo, verifica que la fila siga teniendo el SKU/marca pedido); `getMarcas` con caché 10 min; se dejan de guardar/enviar URLs temporales; MIME de Drive memorizado; `getInicio` con caché combinada de 60 s invalidada junto con el inventario.
**Interfaz**: esqueleto de carga estático, lista de productos por tandas (16 + 24 al acercarse al final), logos ya no bloquean la primera pantalla, no se redibuja si los datos no cambiaron (conserva el scroll si cambian), `content-visibility`, sin `will-change`, modo ligero automático (≤4 GB / ≤4 núcleos / ahorro de datos; forzar con `localStorage.qiModoLigero = "1"|"0"`), tema aplicado antes del primer pintado, Chart.js/jsPDF bajo demanda, `preconnect` a Apps Script, versionado `?v=2.6.0` en scripts/CSS.
**Service worker v2-7**: red primero con tope de 4 s y respaldo en caché; ya no borra las cachés de imágenes.
**No modificados (hash idéntico)**: `movimientos.js`, `pdf-vencimientos.js`, `vencimientos.js`, `gestion.js`, `login.js`, `session.js`, `ui.js`. Autenticación, roles, credenciales y movimientos: sin cambios.

## 3. Pruebas
### 3.1 Ejecutadas aquí (simulación, sin acceso a su Google ni a su hosting)
`node pruebas/prueba-imagenes.js` y `node pruebas/prueba-backend.js` → **todas pasan**.
| Escenario simulado | Antes | Después |
|---|---|---|
| 20 imágenes de Materiales visibles | 20 solicitudes a Apps Script | **3** (8+8+4) |
| Mismo logo en 12 tarjetas | hasta 12 | **1** |
| Segunda visita (caché persistente) | 20 | **0** |
| Servidor por 10 imágenes | 10 aperturas del Spreadsheet, 10 `getImages()`, 10 descargas en serie | **1** apertura, **0** `getImages()`, 1 `fetchAll` de 10 |
| Fila movida en Sheets | podía mostrar otra foto | rechazada (`FILA_DESACTUALIZADA`) |
Son **conteos de operaciones**, no tiempos. **No hay tiempos medidos de producción y no afirmo que la app sea X % más rápida.** Sintaxis de todos los JS y de `Code.gs`: correcta.

### 3.2 Protocolo para medir antes/después (usted, en producción)
1. Cada medición en **PC** y en **teléfono**, con sesión iniciada, 5 repeticiones en frío (borrar datos del sitio) y 5 en caliente.
2. **Mismo equipo, mismos datos, solo frontend**: abra `home.html?perf=1`; el botón *Cambiar modo* alterna `qiOptimizacion` (off = ruta anterior de imágenes/lista). Haga: abrir app, entrar a un Reactivo→categoría, a Materiales, abrir 3 fichas, cambiar entre módulos. *Exportar* → un JSON por corrida.
3. **Antes/después completo** (incluye Code.gs y SW): despliegue el ZIP anterior y este en dos copias, y repita 2.
4. Cargue los JSON en `comparar-rendimiento.html` (mediana por métrica). Cubre: apertura inicial, categorías, logos, imágenes de Materiales/Repuestos, ficha, módulos, solicitudes a Apps Script, LCP, tareas largas. Pruebe con Chrome DevTools "Fast 3G / CPU 4× slowdown" para simular teléfonos modestos.

### 3.3 No verificado (requiere su entorno)
- Todo tiempo real; el efecto de `fetchAll`, `getInicio` en caché y la lectura por rangos en sus hojas.
- Que `getContentUrl()` siga descargable con/sin token en su despliegue (misma lógica que antes; ahora en paralelo).
- Cuota de CacheService (entradas ≤ 240 KB; si se desaloja, simplemente se vuelve a pedir).
- Cache API en iOS/Safari (puede purgar tras días sin uso).
- Repuestos y Materiales de SPS: fuera de alcance, no probados.
- Fotos de WordPress: se descargan a tamaño completo. Si WordPress genera miniaturas, defina `window.QI_IMG_CONFIG = { miniatura: url => ... }` (gancho ya previsto) **solo después de comprobar** que esas URLs existen.

## 4. Despliegue
1. Reemplace el contenido de `version actual/` en GitHub Pages (incluye archivos nuevos `imagenes.js`, `rendimiento.js`, `libs.js`, `comparar-rendimiento.html`).
2. Pegue `Code.gs` en Apps Script, guarde y cree **nueva versión** de la implementación existente (sin cambiar acceso). Si pide permisos, acéptelos.
3. Ctrl+F5. El SW pasa a v2-7. Puede desplegar frontend y backend en cualquier orden: sin backend nuevo se usa el endpoint individual.
4. Si reemplaza una foto en Sheets y no quiere esperar: **Mayús + clic en Actualizar** (vuelve a bajar imágenes), o `QI_IMG.invalidar()` en consola.
5. Recomendado en Sheets (no hecho por mí): reducir fotos de Materiales a ≤ 100–200 KB; es la mejora individual más grande para teléfonos.

## 5. Observación (no modificada)
`autenticarSolicitud_` lee la hoja Usuarios completa en cada solicitud autenticada. Con lotes pasa a ser una vez por lote. No se tocó por su regla de no alterar autenticación/permisos.
