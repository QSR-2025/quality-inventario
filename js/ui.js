/* ==========================================================
   QUALITY INVENTARIO — ui.js
   Detalles de interfaz: nombre/avatar del usuario y opción
   activa del menú lateral.
========================================================== */

document.addEventListener("DOMContentLoaded", () => {
    const nombre = (localStorage.getItem("qualityNombre") || "").trim() ||
                   (localStorage.getItem("qualityUsuario") || "").trim() || "Usuario";
    const etiqueta = document.getElementById("nombreUsuario");
    if (etiqueta) etiqueta.textContent = nombre;

    // Sincroniza foto/inicial del encabezado con la foto de Configuración.
    actualizarAvatarQI();

    // Navegación visual: el elemento activo siempre coincide con la sección abierta.
    const enlaces = document.querySelectorAll(".sidebar nav a");
    enlaces.forEach(enlace => {
        enlace.addEventListener("click", () => {
            enlaces.forEach(item => item.classList.toggle("active", item === enlace));
            const esProductos = enlace.id === "menuProductos";
            document.body.classList.toggle("qi-page-products", esProductos);
            // En Configuración ocultamos las secciones de inventario y mostramos la propia.
            if (enlace.id === "menuConfiguracion") {
                ["seccionResultados", "seccionAlmacen", "seccionMovimientos", "seccionVencimientos", "dashboardCards"].forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.style.display = "none";
                });
                const seccion = document.getElementById("seccionConfiguracion");
                if (seccion) seccion.style.display = "block";
                const titulo = document.getElementById("tituloPagina");
                if (titulo) titulo.textContent = "Configuración";
                const subtitulo = document.getElementById("subtituloPagina");
                if (subtitulo) subtitulo.textContent = "Personaliza tu experiencia en Quality Inventario";
                pintarDatosCuenta();
            }
        });
    });

    // La vista inicial es Productos, por eso es la única pestaña con buscador.
    document.body.classList.add("qi-page-products");
});

/* La foto se guarda POR USUARIO (antes era una sola clave compartida por
   todos los perfiles del mismo navegador). */
function claveFotoPerfilQI(){
 const u=(localStorage.getItem('qualityUsuario')||'').trim().toLowerCase();
 return u?('qualityFotoPerfil:'+u):null;
}
function obtenerFotoPerfilQI(){
 const k=claveFotoPerfilQI();
 return k?(localStorage.getItem(k)||''):'';
}
// La clave antigua compartida no permite saber de quién era la foto:
// se elimina para que no aparezca en el perfil equivocado.
try{localStorage.removeItem('qualityFotoPerfil');}catch(e){}

function pintarDatosCuenta(){
 const nombre=localStorage.getItem('qualityNombre')||'—', usuario=localStorage.getItem('qualityUsuario')||'—', cargo=localStorage.getItem('qualityCargo')||'—', rol=localStorage.getItem('qualityRol')||'—';
 const campos=[['Usuario',usuario],['Nombre',nombre],['Cargo',cargo],['Rol',rol],['Estado','Activo'],['Último acceso',localStorage.getItem('qualityUltimoAccesoTexto')||'—'],['Fecha de creación',localStorage.getItem('qualityFechaCreacion')||'No disponible']];
 const cont=document.getElementById('datosCuenta'); if(cont) cont.innerHTML=campos.map(([k,v])=>`<div class="account-field"><label>${k}</label><div class="account-value"><span></span><i class="fas fa-lock"></i></div></div>`).join('');
 if(cont) [...cont.children].forEach((el,i)=>el.querySelector('span').textContent=campos[i][1]);
}
function actualizarAvatarQI(){
 const foto=obtenerFotoPerfilQI();
 const nombre=(localStorage.getItem('qualityNombre')||localStorage.getItem('qualityUsuario')||'U').trim();
 const avatar=document.getElementById('avatarUsuario');
 if(!avatar) return;
 let img=avatar.querySelector('img.qi-avatar-image');
 if(foto){
   if(!img){img=document.createElement('img');img.className='qi-avatar-image';img.alt='Foto de perfil';avatar.replaceChildren(img);}
   if(img.src!==foto) img.src=foto;
   avatar.classList.add('avatar-con-foto');
 }else{
   if(img) img.remove();
   avatar.classList.remove('avatar-con-foto');
   avatar.textContent=nombre.charAt(0).toUpperCase()||'U';
 }
}
function aplicarPreferenciasQI(){
 const prefs=JSON.parse(localStorage.getItem('qualityPreferencias')||'{}'); document.body.classList.toggle('qi-dark',prefs.theme==='dark'); document.body.classList.remove('qi-font-small','qi-font-medium','qi-font-large');document.body.classList.add('qi-font-'+(prefs.fontSize||'medium'));document.body.style.fontFamily=`"${prefs.font||'Inter'}", sans-serif`;
 document.querySelectorAll('[data-theme]').forEach(b=>{b.classList.toggle('selected',b.dataset.theme===(prefs.theme||'light'));const marca=b.querySelector('b');if(marca)marca.textContent=b.classList.contains('selected')?'◉':'○'});
 document.querySelectorAll('[data-font-size]').forEach(b=>b.classList.toggle('selected',b.dataset.fontSize===(prefs.fontSize||'medium')));
 const fuente=document.getElementById('fuenteSistema');if(fuente)fuente.value=prefs.font||'Inter';
 const foto=obtenerFotoPerfilQI();const av=document.getElementById('fotoPerfilPreview');if(av){if(foto){av.style.backgroundImage=`url("${foto}")`;av.textContent=''}else{av.style.backgroundImage='';av.textContent=(localStorage.getItem('qualityNombre')||'U').trim().charAt(0).toUpperCase()}}
 actualizarAvatarQI();
}
document.addEventListener('DOMContentLoaded',()=>{
 const prefs=()=>JSON.parse(localStorage.getItem('qualityPreferencias')||'{}');
 document.querySelectorAll('[data-theme]').forEach(b=>b.addEventListener('click',()=>{const x=prefs();x.theme=b.dataset.theme;localStorage.setItem('qualityPreferencias',JSON.stringify(x));aplicarPreferenciasQI()}));
 const fuente=document.getElementById('fuenteSistema');if(fuente)fuente.addEventListener('change',()=>{const x=prefs();x.font=fuente.value;localStorage.setItem('qualityPreferencias',JSON.stringify(x));aplicarPreferenciasQI()});
 document.querySelectorAll('[data-font-size]').forEach(b=>b.addEventListener('click',()=>{const x=prefs();x.fontSize=b.dataset.fontSize;localStorage.setItem('qualityPreferencias',JSON.stringify(x));aplicarPreferenciasQI()}));
 const input=document.getElementById('fotoPerfilInput');if(input)input.addEventListener('change',async()=>{const file=input.files&&input.files[0];if(!file)return;if(file.size>5*1024*1024){alert('La foto no debe superar 5 MB.');input.value='';return}
  try{const dataUrl=await reducirFotoQI(file);const r=await postFotoQI('setFotoPerfil',{foto:dataUrl});if(!r||!r.success){alert((r&&r.message)||'No se pudo guardar la foto en el servidor.');return}
   const k=claveFotoPerfilQI();if(k)try{localStorage.setItem(k,dataUrl)}catch(e){}aplicarPreferenciasQI();}
  catch(e){alert('No se pudo guardar la foto: '+(e.message||e))}finally{input.value=''}});
 const del=document.getElementById('eliminarFotoPerfil');if(del)del.addEventListener('click',async()=>{try{const r=await postFotoQI('eliminarFotoPerfil',{});if(!r||!r.success){alert((r&&r.message)||'No se pudo eliminar la foto en el servidor.');return}}catch(e){alert('No se pudo eliminar la foto: '+(e.message||e));return}const k=claveFotoPerfilQI();if(k)localStorage.removeItem(k);aplicarPreferenciasQI()});
 aplicarPreferenciasQI();pintarDatosCuenta();
});


/* ---------- Foto de perfil centralizada (Google Drive vía Apps Script) ----------
   La foto vive en el servidor, ligada al usuario de la sesión (token). El
   localStorage queda solo como copia para mostrarla rápido en este navegador. */
async function postFotoQI(accion,datos){
 const token=String(localStorage.getItem('qualityToken')||'').trim();
 if(!token)return{success:false,message:'La sesión no tiene token. Cierre sesión e ingrese nuevamente.'};
 const r=await fetch(API_URL,{method:'POST',body:JSON.stringify(Object.assign({},datos,{action:accion,token:token}))});
 if(!r.ok)throw new Error('HTTP '+r.status);
 return r.json();
}
function reducirFotoQI(file){
 return new Promise((ok,fallo)=>{const img=new Image(),url=URL.createObjectURL(file);
  img.onload=()=>{URL.revokeObjectURL(url);const L=256,e=Math.min(img.width,img.height),c=document.createElement('canvas');c.width=c.height=L;
   c.getContext('2d').drawImage(img,(img.width-e)/2,(img.height-e)/2,e,e,0,0,L,L);ok(c.toDataURL('image/jpeg',0.85))};
  img.onerror=()=>{URL.revokeObjectURL(url);fallo(new Error('No se pudo leer la imagen.'))};img.src=url})
}
async function sincronizarFotoPerfilQI(){
 try{const r=await postFotoQI('getFotoPerfil',{});if(!r||!r.success)return;const k=claveFotoPerfilQI();if(!k)return;
  if(r.foto)localStorage.setItem(k,r.foto);else localStorage.removeItem(k);aplicarPreferenciasQI()}catch(e){/* sin red: se conserva la copia local */}
}
document.addEventListener('DOMContentLoaded',()=>{if(localStorage.getItem('qualityToken'))sincronizarFotoPerfilQI()});
