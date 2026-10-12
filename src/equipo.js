/* =========================================================
   KUOTA — equipo autorizado
   Cada ruta (cobrador) queda amarrada al primer celular o navegador donde entra.
   Desde otro equipo no puede abrir Kuota hasta que el CEO lo libere en Usuarios.
   (Android no deja que las apps lean el IMEI desde la versión 10; se usa el
   identificador del equipo que entrega el sistema, o uno propio en el navegador.)
   ========================================================= */

let EQUIPO_ESTADO = '';          // '', 'revisando', 'ok', 'bloqueado'
let EQUIPOS = [], INTENTOS = [], unsubEquipos = [];

async function sha256(txt){
  try{
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
    return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
  }catch(e){ let h=0; for(const c of txt) h=(h*31+c.charCodeAt(0))|0; return 'x'+Math.abs(h).toString(16).padStart(16,'0'); }
}
function nombreNavegador(){
  const u = navigator.userAgent;
  const nav = /Edg\//.test(u)?'Edge':/OPR\//.test(u)?'Opera':/Chrome\//.test(u)?'Chrome':/Firefox\//.test(u)?'Firefox':/Safari\//.test(u)?'Safari':'Navegador';
  const so = /Android/.test(u)?'Android':/iPhone|iPad/.test(u)?'iPhone':/Windows/.test(u)?'Windows':/Mac OS/.test(u)?'Mac':/Linux/.test(u)?'Linux':'';
  return `${nav}${so?' en '+so:''}`;
}
async function idEquipo(){
  let id = '', modelo = '', plataforma = isNative() ? 'android' : 'web';
  try{
    const D = window.CapPlugins && window.CapPlugins.Device;
    if(isNative() && D){
      const r = await D.getId(); id = r.identifier || r.uuid || '';
      const inf = await D.getInfo(); modelo = [inf.manufacturer, inf.model].filter(Boolean).join(' '); plataforma = inf.platform || plataforma;
    }
  }catch(e){}
  if(!id){
    id = lsGet('kuota_dev');
    if(!id){ id = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)+Date.now().toString(36)); lsSet('kuota_dev', id); }
  }
  if(!modelo) modelo = isNative() ? 'Celular Android' : nombreNavegador();
  return { hash: await sha256(ME.uid+':'+id), modelo: modelo.slice(0,80), plataforma: String(plataforma).slice(0,20) };
}
const conTiempo = (p, ms) => Promise.race([p, new Promise((_,rej)=>setTimeout(()=>rej(new Error('tiempo')), ms))]);

/* true si este equipo puede abrir Kuota con este usuario */
async function equipoAutorizado(){
  if(!ME || ME.rol!=='cobrador') return true;
  const d = await idEquipo();
  const okKey = 'kuota_eq_'+ME.uid;
  let reg;
  try{ reg = await conTiempo(S.equipo.get(ME.uid), 9000); }
  catch(e){ return lsGet(okKey)===d.hash; }      // sin internet: solo si este equipo ya estaba aprobado
  if(!reg){
    try{
      await conTiempo(S.equipo.registrar(ME.uid, {dev:d.hash, modelo:d.modelo, plataforma:d.plataforma, registrado:Date.now(), ultimoUso:Date.now()}), 9000);
      lsSet(okKey, d.hash); return true;
    }catch(e){ return lsGet(okKey)===d.hash; }
  }
  if(reg.dev===d.hash){ lsSet(okKey, d.hash); S.equipo.tocar(ME.uid, {ultimoUso:Date.now()}).catch(()=>{}); return true; }
  lsSet(okKey, null);
  S.equipo.intento({uid:ME.uid, nombre:(ME.nombre||'').slice(0,80), modelo:d.modelo, plataforma:d.plataforma, t:Date.now()}).catch(()=>{});
  return false;
}
async function revisarEquipoYArrancar(){
  if(EQUIPO_ESTADO==='revisando') return;
  EQUIPO_ESTADO = 'revisando';
  pantalla(`<img src="logo_dark.png" class="login-brand" alt="Kuota"><p class="sub" style="text-align:center">Verificando este equipo…</p>`);
  let ok = false;
  try{ ok = await equipoAutorizado(); }catch(e){ console.error(e); ok = false; }
  if(!ME) { EQUIPO_ESTADO=''; return; }
  EQUIPO_ESTADO = ok ? 'ok' : 'bloqueado';
  if(ok) arrancarDatos(); else pantallaEquipoBloqueado();
}
function pantallaEquipoBloqueado(){
  pantalla(`<img src="logo_dark.png" class="login-brand" alt="Kuota"><h1 style="font-size:22px">Este equipo no está autorizado</h1>
  <p class="sub">Tu usuario solo puede entrar desde el celular donde se registró la primera vez. Si cambiaste de celular, pídele al dueño del negocio que libere tu equipo en <b>Usuarios</b> y vuelve a intentar.</p>
  <p style="text-align:center;display:flex;gap:8px;justify-content:center"><button class="btn pri" onclick="EQUIPO_ESTADO='';revisarEquipoYArrancar()">Volver a intentar</button><button class="btn" onclick="cerrarSesion()">Cerrar sesión</button></p>`);
}

/* ---- lado del CEO: ver equipos, liberar y ver intentos ---- */
function escucharEquipos(){
  unsubEquipos.forEach(u=>u()); unsubEquipos=[];
  if(!isAdmin()) return;
  unsubEquipos.push(S.equipo.watch(l=>{ EQUIPOS = sanearLista('equipos', l); if(view==='usuarios'||view==='panel') scheduleRender(); }));
  unsubEquipos.push(S.equipo.watchIntentos(l=>{ INTENTOS = sanearLista('intentos', l).sort((a,b)=>(b.t||0)-(a.t||0)); if(view==='usuarios'||view==='panel'||view==='cobros') scheduleRender(); }));
}
function dejarEquipos(){ unsubEquipos.forEach(u=>u()); unsubEquipos=[]; EQUIPOS=[]; INTENTOS=[]; EQUIPO_ESTADO=''; }
function celdaEquipo(u){
  if(u.rol!=='cobrador') return '<span class="muted">—</span>';
  const e = EQUIPOS.find(x=>x.id===u.id);
  if(!e) return '<span class="muted" style="font-size:12.5px">Se registra al primer ingreso</span>';
  return `<div style="font-size:12.5px"><b>${esc(e.modelo||'Equipo')}</b><div class="muted">Desde ${horaDe(e.registrado)}${e.ultimoUso?' · uso '+hace(e.ultimoUso):''}</div></div>`;
}
function btnLiberar(u){
  if(!isCeo() || u.rol!=='cobrador' || !EQUIPOS.some(x=>x.id===u.id)) return '';
  return `<button class="btn sm" onclick="liberarEquipo('${u.id}')">Liberar celular</button>`;
}
async function liberarEquipo(uid){
  const u = userById(uid); if(!u) return;
  if(!await confirmar(`¿Liberar el celular de ${rutaDe(u)}? La próxima vez que ${u.nombre} entre, quedará amarrado al equipo desde el que entre.`, {ok:'Liberar'})) return;
  S.equipo.liberar(uid).then(()=>toast('Equipo liberado')).catch(falloNube);
  for(const i of INTENTOS.filter(x=>x.uid===uid)) S.equipo.borrarIntento(i.id).catch(()=>{});
}
function avisoIntentos(){
  if(!isCeo()) return '';
  const rec = INTENTOS.filter(i=>Date.now()-(i.t||0) < 7*864e5);
  if(!rec.length) return '';
  return rec.slice(0,3).map(i=>{ const u=userById(i.uid); return `<div class="banner bad">Intentaron entrar con el usuario de <b>${esc(u?rutaCompleta(u):i.nombre||'')}</b> desde otro equipo (${esc(i.modelo||'desconocido')}) ${hace(i.t)}.
    <span class="spacer"></span>${u?`<button class="btn sm" onclick="liberarEquipo('${i.uid}')">Es su celular nuevo: liberar</button>`:''}<button class="btn sm ghost" onclick="S.equipo.borrarIntento('${i.id}')">Descartar</button></div>`; }).join('');
}
