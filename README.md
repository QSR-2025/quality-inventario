# quality-inventario
PWA para el inventario de Quality Sistemas y Reactivos


Ajuste de sugerencia de pedido: se incluyen productos de Reactivos de TGU con mínimo configurado y existencia inferior al mínimo, incluso si la existencia es cero. Se deduplican por código. El mínimo no se muestra en las tarjetas resumidas del catálogo.


IMPORTANTE PARA ACTIVAR SUGERENCIA DE PEDIDO:
1. En Apps Script, reemplaza el contenido de Code.gs con el incluido en este paquete.
2. Guarda el proyecto y ve a Implementar > Administrar implementaciones.
3. Edita la implementación de Aplicación web, selecciona Nueva versión y pulsa Implementar.
4. Si cambia la URL de la implementación, actualiza API_URL en js/api.js.
5. Abre la app y prueba action=getReporteReposicionTGU. Debe devolver productos leídos solo de Reactivos en el spreadsheet TGU configurado en CONFIG.SS_ID.

El reporte busca las columnas CÓDIGO, PRODUCTO, TOTAL EXIST. y MÍNIMO REQUERIDO, normalizando tildes y espacios; incluye existencia cero cuando hay mínimo configurado mayor que cero.
