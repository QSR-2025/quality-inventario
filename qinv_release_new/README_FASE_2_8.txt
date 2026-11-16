QUALITY INVENTARIO — FASE 2.8

CAMBIO DE ESTA ENTREGA
- Se actualizó la paleta visual del frontend tomando como referencia la captura compartida: menú azul marino, acentos turquesa, violeta y azul, fondos gris claro y tarjetas blancas.
- Se ajustaron superficies del modo oscuro para conservar los mismos acentos sobre fondos azul marino profundos.
- Se incrementó el versionado de CSS y Service Worker para solicitar los recursos actualizados.
- Se conserva el código funcional de la Fase 2.7, incluyendo el backend, menú de reportes, optimización y manejo de imágenes.

IMPORTANTE SOBRE MATERIALLES
- Referencia 1 y Referencia 2 del módulo Materiales pueden contener imagen, texto o estar vacías.
- Deben mostrarse únicamente en la sección Referencias del detalle; no se debe reutilizar Referencia 1 como fotografía principal.
- Esta condición se confirmó durante la conversación, pero la recuperación real de cada tipo de contenido debe probarse con las hojas de Google Sheets de producción. El backend requiere desplegarse en Apps Script.

DESPLIEGUE
1. Hacer copia de seguridad de la versión actual.
2. Subir el contenido de FRONTEND_HOSTINGER al hosting.
3. El Code.gs de APPS_SCRIPT_NO_SUBIR_A_HOSTINGER corresponde al backend: actualizarlo únicamente dentro del proyecto Google Apps Script si se van a aplicar también los cambios de backend de la Fase 2.7.
4. Crear una nueva versión de la Web App si se actualiza Apps Script.
5. Recargar la aplicación con Ctrl+F5 y probar los módulos.

NO VERIFICADO EN ESTE ENTORNO
- No se pudo conectar al hosting de producción ni a las hojas privadas de Google Sheets/Drive.
- No se puede afirmar que la paleta se haya comprobado visualmente en producción.
- La interpretación de imágenes insertadas en celdas, textos y celdas vacías debe validarse con los datos reales después del despliegue.

ACTUALIZACIÓN DE TRABAJO — DIRECTORIO Y ORDEN DE ENTREGA
- Se añadió la vista de Directorio de Clientes y las acciones servidoras autenticadas.
- Usa la pestaña DIRECTORIO_CLIENTES del mismo libro configurado en CONFIG.SS_ID.
- Las direcciones se registran con usuario y fecha; quien no sea creador no puede editar/eliminar, salvo Administrador.
- La orden se genera para impresión desde el navegador y no se almacena. No hay historial de órdenes ni registro de uso de direcciones.
- Para publicar: subir el contenido de FRONTEND_HOSTINGER a Hostinger y reemplazar el contenido de Code.gs en Apps Script; después desplegar una nueva versión de la Web App.
- Esta integración requiere prueba real con la cuenta y hoja de producción antes de considerarla validada. Las operaciones de Google Sheets no pueden probarse desde este paquete local.
