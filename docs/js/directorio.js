/* Directorio universal y orden imprimible: no almacena órdenes ni usos. */
(() => {
 const $=id=>document.getElementById(id); let clientes=[], modo='cliente';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 async function post(action,data={}){return postAutenticado(action,data)}
 async function cargar(q=''){
  const r=await post('directorioListar',{q}); if(!r.success) throw Error(r.message||'No se pudo cargar el directorio'); clientes=r.clientes||[]; pintar();
 }
 function pintar(){
  const cont=$('qiDirectorioLista'); if(!cont)return;
  cont.innerHTML=clientes.length?clientes.map(c=>`<article class="qi-client-card"><header><div><b>${esc(c.nombre)}</b><small>Código: ${esc(c.codigo)} · Tel.: ${esc(c.telefono||'—')}</small></div><button data-add="${esc(c.codigo)}">+ Dirección</button></header>${c.direcciones.map(a=>`<div class="qi-address"><div><b>${esc(a.sucursal||'Dirección')}</b><p>${esc(a.direccion)}</p><small>Recibe: ${esc(a.recibe||'—')} · ${esc(a.telefono||'—')} · Registró: ${esc(a.usuario||'—')}</small></div><div class="qi-address-actions"><button data-use="${esc(c.codigo)}|${esc(a.id)}">Usar dirección</button>${(a.usuario||'')===(localStorage.getItem('qualityNombre')||localStorage.getItem('qualityUsuario'))?`<button data-del="${esc(c.codigo)}|${esc(a.id)}">Eliminar</button>`:''}</div></div>`).join('')||'<p class="qi-empty">Este cliente aún no tiene direcciones.</p>'}</article>`).join(''):'<p class="qi-empty">No hay clientes registrados.</p>';
 }
 function configurarCampos(tipo){
  // Un campo "required" dentro de un bloque oculto impide el submit nativo sin avisar.
  // Solo el bloque visible queda habilitado y con sus campos obligatorios.
  const bloques={cliente:$('qiCamposCliente'),direccion:$('qiCamposDireccion')};
  Object.keys(bloques).forEach(k=>{const b=bloques[k]; if(!b)return; const activo=k===tipo; b.hidden=!activo;
   b.querySelectorAll('input,select,textarea').forEach(el=>{
    if(el.dataset.qiReq===undefined) el.dataset.qiReq=el.required?'1':'0';
    el.disabled=!activo; el.required=activo&&el.dataset.qiReq==='1';
   });
  });
 }
 function abrir(tipo,codigo=''){
  if(tipo==='direccion'&&!clientes.length){alert('Primero registre un cliente; todavía no hay clientes en el directorio.');return}
  modo=tipo;$('qiFormDirectorio').reset();
  $('qiSelectCliente').innerHTML=clientes.map(c=>`<option value="${esc(c.codigo)}" ${c.codigo===codigo?'selected':''}>${esc(c.codigo)} — ${esc(c.nombre)}</option>`).join('');
  configurarCampos(tipo);
  $('qiModalTitulo').textContent=tipo==='cliente'?'Registrar cliente':'Registrar dirección';
  $('qiModalDirectorio').hidden=false;
 }
 function orden(c,a){
  const fecha=new Date().toLocaleDateString('es-HN'); $('qiOrdenImpresion').innerHTML=`<div class="qi-order-sheet"><div class="qi-order-head"><img src="assets/logo.png"><div><h1>QUALITY SISTEMAS Y REACTIVOS S. DE R.L.</h1><b>RTN: 05019015711487</b><p>San Pedro Sula: 27 calle, Complejo Costa del Este.</p><p>Tegucigalpa: Col. Kennedy, Zona 1, grupo 15, casa 40.</p><p>Tel. (504) 2566-0382 · (504) 2228-4273 · (504) 2230-2078 · 3154-8831</p><p>Fax: (504) 2566-0417 · qualityspS@yahoo.com</p></div></div><h2>ORDEN DE ENTREGA</h2><div class="qi-order-grid"><label>Fecha <strong>${fecha}</strong></label><label>Código de cliente <strong>${esc(c.codigo)}</strong></label><label>Cliente <strong>${esc(c.nombre)}</strong></label><label>Teléfono <strong>${esc(c.telefono||'')}</strong></label><label class="wide">Dirección de entrega <strong>${esc(a.direccion)}</strong></label><label class="qi-thanks">Gracias por preferirnos</label><label class="qi-quantity">Cantidad de productos <strong>&nbsp;</strong></label><label>Persona que recibe <strong>${esc(a.recibe||'')}</strong></label><label>Teléfono de contacto <strong>${esc(a.telefono||'')}</strong></label></div><div class="qi-order-checks"><label><input type="checkbox"> <span>Refrigerado</span></label><label><input type="checkbox"> <span>No refrigerado</span></label><label><input type="checkbox"> <span>Frágil – manejar con cuidado</span></label><label><input type="checkbox"> <span>Revisado</span></label></div><div class="qi-order-bottom"><label>Preparado por <strong class="qi-blank-name">&nbsp;</strong></label><label>Observaciones<div class="qi-observations"></div></label></div></div>`;
  $('qiOrdenImpresion').hidden=false; window.print(); setTimeout(()=>$('qiOrdenImpresion').hidden=true,800);
 }
 const VISTA='qi-vista-directorio';
 function entrarVistaDirectorio(){
  // 1) clase en <body>: el CSS (con !important) oculta dashboard e inventario sin importar qué listener los reactive.
  document.body.classList.add(VISTA); document.body.classList.remove('qi-page-products');
  // 2) estado coherente de las secciones (home.js las lee con style.display).
  if(typeof ocultarSeccionesPrincipales==='function') ocultarSeccionesPrincipales();
  const dash=$('dashboardCards'); if(dash) dash.style.display='none';
  const sec=$('seccionDirectorioClientes'); if(sec){sec.hidden=false;sec.style.display='block'}
  if($('tituloPagina'))$('tituloPagina').textContent='Directorio de Clientes';
  if($('subtituloPagina'))$('subtituloPagina').textContent='Directorio universal de clientes y direcciones';
 }
 function salirVistaDirectorio(){
  if(!document.body.classList.contains(VISTA)) return;
  document.body.classList.remove(VISTA);
  const sec=$('seccionDirectorioClientes'); if(sec) sec.style.display='none';
 }
 function mostrarErrorLista(msg){const c=$('qiDirectorioLista'); if(c) c.innerHTML='<p class="qi-empty" style="color:#a8323e">'+esc(msg)+'</p>'}
 function iniciarDirectorioQI(){
  const menu=$('menuDirectorioClientes'); if(menu)menu.addEventListener('click',async()=>{
   entrarVistaDirectorio();
   try{await cargar()}catch(e){mostrarErrorLista('No se pudo cargar el directorio: '+e.message)}
  });
  // Cualquier otra opción del menú (en fase de captura, antes que sus propios listeners)
  // saca al usuario del Directorio; así Productos/Almacén/Reportes/Configuración
  // restauran su pantalla con el dashboard otra vez permitido.
  document.addEventListener('click',e=>{
   const t=e.target&&e.target.closest?e.target.closest('#menuProductos,#menuAlmacen,#menuMovimientos,#menuVencimientos,#menuConfiguracion'):null;
   if(t) salirVistaDirectorio();
  },true);
  $('qiBuscarCliente')?.addEventListener('input',e=>cargar(e.target.value).catch(x=>console.error(x)));
  $('qiNuevoCliente')?.addEventListener('click',()=>abrir('cliente'));
  $('qiNuevaDireccion')?.addEventListener('click',()=>abrir('direccion'));
  document.querySelectorAll('#qiDireccionRapida').forEach((el,i)=>{if(i>0)el.remove()}); const barra=$('qiDirectorioLista')?.parentElement; if(barra && !$('qiDireccionRapida')){const b=document.createElement('button');b.id='qiDireccionRapida';b.type='button';b.textContent='Dirección relámpago';b.className='qi-quick-address';$('qiDirectorioLista').before(b);b.addEventListener('click',()=>{const codigo=prompt('Código de cliente:');if(!codigo)return;const nombre=prompt('Nombre del cliente:')||'';const telefono=prompt('Teléfono general:')||'';const direccion=prompt('Dirección de entrega:');if(!direccion)return;const recibe=prompt('Persona que recibe:')||'';const tel=prompt('Teléfono de contacto:')||'';orden({codigo,nombre,telefono},{direccion,recibe,telefono:tel});});}
  $('qiCerrarModal')?.addEventListener('click',()=>$('qiModalDirectorio').hidden=true);
  configurarCampos('cliente');
  const formulario=$('qiFormDirectorio');
  if(formulario && !formulario.dataset.qiSubmitBound){
   formulario.dataset.qiSubmitBound='1';
   formulario.addEventListener('submit',async e=>{
    e.preventDefault();e.stopPropagation();
    if(formulario.dataset.qiGuardando==='1') return; // evita doble envío
    const f=new FormData(formulario), boton=formulario.querySelector('button[type="submit"]');
    const textoOriginal=boton?boton.textContent:'Guardar';
    const val=k=>String(f.get(k)==null?'':f.get(k)).trim();
    try{
     if(modo==='cliente'){ if(!val('codigo')||!val('nombre')) throw Error('El código y el nombre del cliente son obligatorios.'); }
     else { if(!val('clienteCodigo')) throw Error('Seleccione un cliente.'); if(!val('direccion')) throw Error('La dirección completa es obligatoria.'); }
     formulario.dataset.qiGuardando='1';
     if(boton){boton.disabled=true;boton.textContent='Guardando...'}
     let r;
     if(modo==='cliente') r=await post('directorioGuardarCliente',{codigo:val('codigo'),nombre:val('nombre'),telefono:val('telefono')});
     else r=await post('directorioDireccion',{codigo:val('clienteCodigo'),direccion:{sucursal:val('sucursal'),direccion:val('direccion'),recibe:val('recibe'),telefono:val('telefonoDireccion')}});
     if(!r || !r.success) throw Error((r&&r.message)||'Apps Script no confirmó el registro.');
     // Verificación: se vuelve a leer el directorio y el registro debe aparecer.
     if($('qiBuscarCliente'))$('qiBuscarCliente').value='';
     await cargar('');
     if(modo==='cliente'){
      if(!clientes.some(c=>c.codigo===val('codigo'))) throw Error('El servidor respondió que guardó el cliente, pero no aparece al releer DIRECTORIO_CLIENTES. Revise que la pestaña esté en el Spreadsheet configurado en CONFIG.SS_ID.');
     } else if(r.id){
      const c=clientes.find(x=>x.codigo===val('clienteCodigo'));
      if(!c||!c.direcciones.some(d=>d.id===r.id)) throw Error('El servidor respondió que guardó la dirección, pero no aparece al releer DIRECTORIO_CLIENTES.');
     }
     $('qiModalDirectorio').hidden=true;
     alert(r.existente?(r.message||'Este cliente ya estaba registrado.'):(modo==='cliente'?'Cliente registrado correctamente.':'Dirección registrada correctamente.'));
    }catch(x){alert('No se pudo guardar: '+(x&&x.message?x.message:String(x)))}
    finally{formulario.dataset.qiGuardando='0';if(boton){boton.disabled=false;boton.textContent=textoOriginal}}
   });
  }
  $('qiDirectorioLista')?.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;try{if(b.dataset.add)abrir('direccion',b.dataset.add);if(b.dataset.use){const [codigo,id]=b.dataset.use.split('|');const c=clientes.find(x=>x.codigo===codigo),a=c.direcciones.find(x=>x.id===id);orden(c,a)}if(b.dataset.del){const [codigo,id]=b.dataset.del.split('|');if(confirm('¿Eliminar esta dirección del directorio?')){const r=await post('directorioDireccion',{operacion:'eliminar',codigo,id});if(!r.success)throw Error(r.message);await cargar()}}}catch(x){alert(x.message)}});
 }
 if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',iniciarDirectorioQI,{once:true}); else iniciarDirectorioQI();
})();
