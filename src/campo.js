/* =========================================================
   KUOTA — trabajo en campo: GPS, mapa del equipo y fotos del cliente
   · Admin y cobradores comparten su ubicación durante la jornada (celular).
   · Cada cobro guarda dónde se registró; el CEO ve alertas si fue lejos del cliente.
   · Los clientes guardan la ubicación de su casa o negocio ("Cómo llegar").
   · Al crear un crédito se suben la foto del cliente y la cédula (frente y reverso).
   ========================================================= */

ICONS.mapa = '<path d="M15 5.1L9 3 3 5v16l6-2.1 6 2.1 6-2V3l-6 2.1zM15 19l-6-2.1V5l6 2.1V19z"/>';

/* ---------- utilidades de ubicación ---------- */
const LEJOS_M = 300;   // un cobro registrado a más de esto del cliente se marca como alerta
function distM(a, b){
  const R=6371000, r=x=>x*Math.PI/180;
  const dLa=r(b.lat-a.lat), dLo=r(b.lng-a.lng);
  const h=Math.sin(dLa/2)**2 + Math.cos(r(a.lat))*Math.cos(r(b.lat))*Math.sin(dLo/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}
const fmtDist = m => m < 1000 ? Math.round(m)+' m' : (m/1000).toLocaleString('es-CO',{maximumFractionDigits:1})+' km';
const tieneUbic = o => !!o && typeof o.lat==='number' && typeof o.lng==='number' && (o.lat!==0 || o.lng!==0);
function urlComoLlegar(o){
  const ll = `${o.lat},${o.lng}`;
  return isNative() ? `geo:${ll}?q=${ll}` : `https://www.google.com/maps/dir/?api=1&destination=${ll}`;
}
const btnComoLlegar = (o, cls='btn sm') => tieneUbic(o) ? `<a class="${cls}" href="${urlComoLlegar(o)}" ${isNative()?'':'target="_blank" rel="noopener"'}>Cómo llegar</a>` : '';
function hace(t){
  const m = Math.round((Date.now()-t)/60000);
  if(m < 1) return 'ahora'; if(m < 60) return `hace ${m} min`;
  const h = Math.round(m/60); return h < 24 ? `hace ${h} h` : horaDe(t);
}

/* posición actual: usa la última del rastreo si es reciente, si no le pide una al GPS */
function posicionActual(maxMs=7000){
  if(GPS.ultimo && Date.now()-GPS.ultimo.t < 90000 && GPS.ultimo.prec < 150) return Promise.resolve(GPS.ultimo);
  if(!navigator.geolocation) return Promise.resolve(null);
  return new Promise(res=>{
    let listo=false; const fin=v=>{ if(!listo){ listo=true; res(v); } };
    setTimeout(()=>fin(GPS.ultimo||null), maxMs+500);
    navigator.geolocation.getCurrentPosition(
      p=>{ const v={lat:p.coords.latitude, lng:p.coords.longitude, prec:p.coords.accuracy, t:Date.now()}; GPS.ultimo=v; fin(v); },
      ()=>fin(GPS.ultimo||null), {enableHighAccuracy:true, timeout:maxMs, maximumAge:60000});
  });
}

/* ---------- rastreo de la jornada (Admin y cobradores, en el celular) ---------- */
const GPS = { ultimo:null, watcherId:null, webId:null, activo:false, ultEnvio:null, ultPunto:null, enviando:false };
const gpsRastreable = () => !!ME && !isCeo() && (isNative() || !!navigator.geolocation);
const lsGet = k => { try{ return localStorage.getItem(k); }catch(e){ return null; } };
const lsSet = (k,v) => { try{ v==null ? localStorage.removeItem(k) : localStorage.setItem(k,v); }catch(e){} };

async function iniciarJornada(){
  if(!gpsRastreable() || GPS.activo) return;
  if(lsGet('kuota_gps_ok_'+ME.uid)!=='1'){
    const ok = await confirmar(`Ubicación durante la jornada\n\nMientras tengas la jornada activa, Kuota comparte tu ubicación con ${(EMPRESA&&EMPRESA.nombre)||'la empresa'} para ver la ruta y validar los cobros. ${isNative()?'Verás un aviso fijo en el celular mientras esté activa':'En el navegador la ubicación se envía mientras tengas Kuota abierto'} y la puedes terminar cuando acabes de trabajar.\n\n¿Autorizas el uso de tu ubicación?`, {ok:'Acepto', no:'Ahora no'});
    if(!ok){ lsSet('kuota_gps_off_'+ME.uid, todayStr()); render(); return; }
    lsSet('kuota_gps_ok_'+ME.uid, '1');
  }
  const BG = window.CapPlugins && window.CapPlugins.BackgroundGeolocation;
  GPS.activo = true; lsSet('kuota_gps_off_'+ME.uid, null);
  if(!isNative() || !BG){ gpsNavegador(); enviarUbic({activo:true, t:Date.now()}); render(); return; }
  try{
    GPS.watcherId = await BG.addWatcher({
      backgroundTitle:'Kuota · jornada activa',
      backgroundMessage:'Compartiendo tu ubicación con la empresa. Termina la jornada para apagarlo.',
      requestPermissions:true, stale:false, distanceFilter:20
    }, (loc, err)=>{
      if(err){
        if(err.code==='NOT_AUTHORIZED'){
          detenerJornada(false);
          confirmar('Kuota necesita el permiso de ubicación para la jornada. Actívalo en los ajustes del celular (Ubicación → Permitir).', {ok:'Abrir ajustes', no:'Ahora no'})
            .then(ok=>{ if(ok && BG.openSettings) BG.openSettings(); });
        }
        return;
      }
      if(loc) gpsFix(loc.latitude, loc.longitude, loc.accuracy);
    });
  }catch(e){
    console.warn('GPS en segundo plano no disponible, uso el del navegador', e);
    gpsNavegador();
  }
  enviarUbic({activo:true, t:Date.now()});
  render();
}
/* navegador (PC o celular sin la app): rastrea mientras la página esté abierta */
function gpsNavegador(){
  if(!navigator.geolocation) return;
  GPS.webId = navigator.geolocation.watchPosition(
    p=>gpsFix(p.coords.latitude, p.coords.longitude, p.coords.accuracy),
    err=>{
      if(err && err.code===1){   // permiso negado
        detenerJornada(false);
        avisar('El navegador bloqueó la ubicación. Toca el candado junto a la dirección de la página, permite "Ubicación" y vuelve a iniciar la jornada.');
      }
    }, {enableHighAccuracy:true, maximumAge:30000, timeout:30000});
  pedirPantallaActiva();
}
/* en el celular por navegador, mantener la pantalla encendida ayuda a que no se corte el GPS */
let _wake = null;
async function pedirPantallaActiva(){
  try{ if(!isNative() && GPS.activo && navigator.wakeLock && document.visibilityState==='visible' && /Android|iPhone|iPad/i.test(navigator.userAgent)) _wake = await navigator.wakeLock.request('screen'); }catch(e){}
}
document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState==='visible' && GPS.activo && !isNative()){
    pedirPantallaActiva();
    GPS.ultEnvio = null;   // al volver a la página, enviar de inmediato la posición
    posicionActual(8000).then(p=>{ if(p) gpsFix(p.lat, p.lng, p.prec); });
  }
});
function pararRastreo(){
  if(_wake){ _wake.release().catch(()=>{}); _wake=null; }
  const BG = window.CapPlugins && window.CapPlugins.BackgroundGeolocation;
  if(GPS.watcherId && BG){ BG.removeWatcher({id:GPS.watcherId}).catch(()=>{}); }
  if(GPS.webId!=null && navigator.geolocation) navigator.geolocation.clearWatch(GPS.webId);
  GPS.watcherId=null; GPS.webId=null;
  const estaba = GPS.activo; GPS.activo=false; GPS.ultEnvio=null; GPS.ultPunto=null;
  return estaba;
}
function detenerJornada(marcarDia=true){
  const estaba = pararRastreo();
  if(ME && marcarDia) lsSet('kuota_gps_off_'+ME.uid, todayStr());
  if(estaba && ME) enviarUbic({activo:false, t:Date.now()});
  if(ME) render();
}
async function toggleJornada(){
  if(GPS.activo){
    if(await confirmar('¿Terminar la jornada? Se apaga el GPS hasta que la vuelvas a iniciar.', {ok:'Terminar jornada'})) detenerJornada(true);
  } else iniciarJornada();
}
function autoJornada(){
  if(gpsRastreable() && !GPS.activo && lsGet('kuota_gps_off_'+ME.uid)!==todayStr()) iniciarJornada();
}
function enviarUbic(extra, punto){
  if(!ME) return;
  const u = Object.assign({nombre:(ME.nombre||'').slice(0,80), rol:ME.rol==='admin'?'admin':'cobrador'}, extra);
  S.gpsEnviar(ME.uid, todayStr(), u, punto).catch(e=>console.warn('gps', e));
}
function gpsFix(lat, lng, prec){
  const ahora = Date.now();
  GPS.ultimo = {lat, lng, prec:prec||0, t:ahora};
  if(!GPS.activo || !(prec < 150)) return;          // lecturas muy imprecisas no se envían
  const p = {lat, lng};
  const mov = GPS.ultEnvio ? distM(GPS.ultEnvio, p) : 1e9;
  const seg = GPS.ultEnvio ? (ahora-GPS.ultEnvio.t)/1000 : 1e9;
  if(!(seg >= 120 || (mov >= 80 && seg >= 30))) return;
  let punto = null;
  if(!GPS.ultPunto || distM(GPS.ultPunto, p) >= 40 || ahora-GPS.ultPunto.t >= 300000){
    punto = {la:Math.round(lat*1e6)/1e6, lo:Math.round(lng*1e6)/1e6, t:ahora};
    GPS.ultPunto = {lat, lng, t:ahora};
  }
  GPS.ultEnvio = {lat, lng, t:ahora};
  enviarUbic({lat:Math.round(lat*1e6)/1e6, lng:Math.round(lng*1e6)/1e6, prec:Math.round(prec), t:ahora, activo:true}, punto);
}
function chipGPS(){
  if(!gpsRastreable()) return '';
  return `<button class="btn sm gps-chip ${GPS.activo?'on':''}" onclick="toggleJornada()" title="${GPS.activo?'Terminar jornada':'Iniciar jornada'}"><i></i>${GPS.activo?'En jornada':'Iniciar jornada'}</button>`;
}

/* ---------- ubicaciones del equipo (las ven el CEO y el Admin) ---------- */
let UBIC = [], unsubUbic = null;
function escucharEquipo(){
  if(unsubUbic){ unsubUbic(); unsubUbic=null; }
  if(!isAdmin()) return;
  unsubUbic = S.watchUbicaciones(l=>{ UBIC = sanearLista('ubicaciones', l); if(view==='mapa') refrescarEquipo(); });
}
function dejarDeEscuchar(){ if(unsubUbic){ unsubUbic(); unsubUbic=null; } UBIC=[]; }
function equipo(){
  return DB.users.filter(u=>u.rol!=='ceo' && u.activo!==false)
    .map(u=>({u, g:UBIC.find(x=>x.id===u.id)||null}))
    .sort((a,b)=>(a.u.nombre||'').localeCompare(b.u.nombre||''));
}
function estadoGPS(g){
  if(!g || !g.t) return {txt:'Sin datos de GPS', c:'muted', vivo:false};
  if(g.activo && Date.now()-g.t < 15*60000) return {txt:`En jornada · ${hace(g.t)}`, c:'ok', vivo:true};
  if(g.activo) return {txt:`Sin señal desde ${horaDe(g.t)}`, c:'warn', vivo:false};
  return {txt:`Jornada terminada · ${horaDe(g.t)}`, c:'muted', vivo:false};
}

/* ---------- ubicación del cliente ---------- */
let CLI_UBIC = null;   // ubicación elegida en el formulario del cliente
function bloqueUbicacionCliente(c){
  CLI_UBIC = tieneUbic(c) ? {lat:c.lat, lng:c.lng, igual:true} : null;
  return `<div class="f full"><span>Ubicación de la casa o negocio</span><div id="cliUbic">${htmlUbicCliente(c)}</div></div>`;
}
function htmlUbicCliente(c){
  const u = CLI_UBIC;
  const puedeCambiar = isAdmin() || !tieneUbic(c);   // el cobrador no puede mover una ubicación ya guardada
  if(u && (u.lat||u.lng)) return `<div class="row"><span class="pill p-ok">Guardada</span>${btnComoLlegar(u)}${isAdmin()?`<button type="button" class="btn sm" onclick="tomarUbicCliente()">Actualizar con mi ubicación</button><button type="button" class="btn sm ghost" onclick="CLI_UBIC={lat:0,lng:0};document.getElementById('cliUbic').innerHTML=htmlUbicCliente({})">Quitar</button>`:''}</div>`;
  return `<div class="row"><span class="muted" style="font-size:13px">Sin ubicación.</span>${puedeCambiar?`<button type="button" class="btn sm" onclick="tomarUbicCliente()">Usar mi ubicación actual</button>`:''}</div><div class="muted" style="font-size:12px;margin-top:4px">Guárdala estando en la casa o el negocio del cliente.</div>`;
}
async function tomarUbicCliente(){
  const box = document.getElementById('cliUbic'); if(box) box.innerHTML = '<span class="muted">Buscando señal GPS…</span>';
  const p = await posicionActual(10000);
  if(!p){ if(box) box.innerHTML = htmlUbicCliente({}); return avisar('No se pudo obtener la ubicación. Activa el GPS del celular y dale permiso a Kuota.'); }
  CLI_UBIC = {lat:Math.round(p.lat*1e6)/1e6, lng:Math.round(p.lng*1e6)/1e6};
  const b = document.getElementById('cliUbic'); if(b) b.innerHTML = htmlUbicCliente({}) + (p.prec>60?`<div class="muted" style="font-size:12px">Precisión aproximada: ${fmtDist(p.prec)}</div>`:'');
}
function cambiosUbicCliente(){
  if(!CLI_UBIC || CLI_UBIC.igual) return {};
  return {lat:CLI_UBIC.lat, lng:CLI_UBIC.lng, ubicadoEn:Date.now()};
}
/* atajo desde la ruta: guardar la ubicación del cliente estando en su casa */
async function guardarUbicCliente(id){
  const c = clienteById(id); if(!c) return;
  if(tieneUbic(c) && !isAdmin()) return toast('Este cliente ya tiene ubicación');
  if(!await confirmar(`¿Estás en la casa o el negocio de ${c.nombre}? Se guardará tu ubicación actual como la del cliente.`, {ok:'Guardar ubicación'})) return;
  toast('Buscando señal GPS…');
  const p = await posicionActual(10000);
  if(!p) return avisar('No se pudo obtener la ubicación. Activa el GPS del celular y dale permiso a Kuota.');
  dbUpd('clientes', id, {lat:Math.round(p.lat*1e6)/1e6, lng:Math.round(p.lng*1e6)/1e6, ubicadoEn:Date.now()});
  toast('Ubicación del cliente guardada'); render();
}
function btnUbicRuta(cl){
  if(tieneUbic(cl)) return btnComoLlegar(cl);
  return cl && cl.id ? `<button class="btn sm" onclick="guardarUbicCliente('${cl.id}')">Guardar ubicación</button>` : '';
}

/* ---------- GPS de cada cobro ---------- */
async function gpsParaPago(){
  if(isCeo()) return {};
  const p = await posicionActual(6000);
  return p ? {lat:Math.round(p.lat*1e6)/1e6, lng:Math.round(p.lng*1e6)/1e6, prec:Math.round(p.prec||0)} : {sinGps:true};
}
function alertaPago(x){
  if(x.tipo==='renovacion') return null;
  const quien = userById(x.registradoPor);
  if(!quien || quien.rol==='ceo') return null;
  if(!tieneUbic(x)) return x.sinGps ? {txt:'Sin GPS', nivel:'warn'} : null;
  const p = DB.prestamos.find(y=>y.id===x.prestamoId), c = p && clienteById(p.clienteId);
  if(!tieneUbic(c)) return null;
  const d = distM(x, c);
  return d > LEJOS_M ? {txt:`A ${fmtDist(d)} del cliente`, nivel:'bad', d} : {txt:`En el sitio (${fmtDist(d)})`, nivel:'ok', d};
}
function celdaGPSPago(x){
  const a = alertaPago(x);
  const ver = tieneUbic(x) ? ` <a class="muted" href="${isNative()?`geo:${x.lat},${x.lng}?q=${x.lat},${x.lng}`:`https://www.google.com/maps/search/?api=1&query=${x.lat},${x.lng}`}" ${isNative()?'':'target="_blank" rel="noopener"'}>ver</a>` : '';
  if(!a) return tieneUbic(x) ? `<span class="muted" style="font-size:12px">Registrado${ver}</span>` : '<span class="muted">—</span>';
  return `<span class="gps-tag ${a.nivel}">${a.txt}</span>${ver}`;
}
function alertasGPS(fecha, cob){
  return DB.pagos.filter(x=>x.fecha===fecha && (!cob || x.cobradorId===cob || x.registradoPor===cob))
    .map(x=>({x, a:alertaPago(x)})).filter(r=>r.a && r.a.nivel!=='ok');
}

/* ---------- vista Mapa ---------- */
const MAPA = { map:null, vista:null, capas:{} };
VIEWS.mapa = () => {
  const fecha = viewState.fecha || todayStr();
  const cob = viewState.cob || '';
  const eq = equipo();
  const clientes = DB.clientes.filter(c=>!cob || c.cobradorId===cob);
  const sinUbic = clientes.filter(c=>!tieneUbic(c) && DB.prestamos.some(p=>p.clienteId===c.id && estadoPrestamo(p).estado!=='Pagado')).length;
  const al = alertasGPS(fecha, cob);
  const opts = eq.map(({u})=>`<option value="${u.id}" ${u.id===cob?'selected':''}>${esc(u.nombre)}</option>`).join('');
  return `
  <div class="head"><div><h1>Mapa</h1><p class="sub">Dónde está tu equipo, dónde viven tus clientes y dónde se registró cada cobro.</p></div>
  <div class="row"><select class="input" style="width:auto" onchange="go('mapa',Object.assign({},viewState,{cob:this.value,ruta:this.value||''}))"><option value="">Todo el equipo</option>${opts}</select>
  <input type="date" class="input" style="width:auto" value="${fecha}" onchange="go('mapa',Object.assign({},viewState,{fecha:this.value}))"></div></div>
  <div class="mapa-wrap">
    <div class="card mapa-card"><div id="mapa" class="mapa"><div class="empty">Cargando mapa…</div></div>
      <div class="mapa-ley"><span><i class="ley eq"></i>Equipo</span><span><i class="ley cl"></i>Cliente al día</span><span><i class="ley mo"></i>Cliente atrasado</span><span><i class="ley pg"></i>Cobro</span><span><i class="ley al"></i>Cobro con alerta</span></div>
    </div>
    <div class="mapa-side">
      <div class="card"><h3 style="margin-top:0">Equipo</h3><div id="equipoLista">${htmlEquipo()}</div>
        <p class="muted" style="font-size:12px;margin:10px 0 0">Cada persona comparte su ubicación mientras tiene la jornada activa: en la app del celular también con la pantalla apagada; en el navegador, mientras tenga Kuota abierto.</p></div>
      <div class="card"><h3 style="margin-top:0">Alertas de cobro · ${fdate(fecha)}</h3>
        ${al.length ? al.map(({x,a})=>{const p=DB.prestamos.find(y=>y.id===x.prestamoId)||{};return `<div class="alerta-row" onclick="modalDetalle('${p.id||''}','pagos')"><div style="min-width:0"><b>${esc(nombreCliente(p.clienteId))}</b><div class="muted" style="font-size:12px">${fmt(x.monto)} · ${esc(nombreUsuario(x.registradoPor))}${x.creado?' · '+horaDe(x.creado):''}</div></div><span class="gps-tag ${a.nivel}">${a.txt}</span></div>`;}).join('') : '<p class="muted" style="margin:0">Sin alertas. Los cobros se registraron cerca de cada cliente.</p>'}
      </div>
      ${sinUbic?`<div class="banner" style="margin:0">${sinUbic} cliente(s) con crédito activo no tienen ubicación. Se guarda desde la ruta con “Guardar ubicación” o en la ficha del cliente.</div>`:''}
    </div>
  </div>`;
};
function htmlEquipo(){
  const eq = equipo();
  if(!eq.length) return '<p class="muted" style="margin:0">Aún no tienes administradores ni cobradores.</p>';
  const ruta = viewState.ruta || '';
  return eq.map(({u,g})=>{ const e=estadoGPS(g); return `<div class="eq-row">
    ${ava(u.nombre)}<div style="min-width:0;flex:1"><b>${esc(u.nombre)}</b><div class="gps-est ${e.c}">${e.txt}</div></div>
    ${tieneUbic(g)?`<button class="btn sm" onclick="centrarEn(${g.lat},${g.lng})">Ver</button>`:''}
    <button class="btn sm ${ruta===u.id?'pri':''}" onclick="go('mapa',Object.assign({},viewState,{ruta:'${ruta===u.id?'':u.id}'}))">Recorrido</button></div>`; }).join('');
}
function refrescarEquipo(){
  const l = document.getElementById('equipoLista'); if(l) l.innerHTML = htmlEquipo();
  if(MAPA.map && MAPA.capas.eq) dibujarEquipo();
}
function centrarEn(lat, lng){ if(MAPA.map) MAPA.map.setView([lat,lng], 17); }

let _leaflet = null;
function cargarLeaflet(){
  if(window.L) return Promise.resolve(true);
  if(_leaflet) return _leaflet;
  const css = (href)=>{ const l=document.createElement('link'); l.rel='stylesheet'; l.href=href; document.head.appendChild(l); };
  const js = (src)=>new Promise(res=>{ const s=document.createElement('script'); s.src=src; s.onload=()=>res(!!window.L); s.onerror=()=>res(false); document.head.appendChild(s); });
  _leaflet = (async ()=>{
    css('leaflet/leaflet.css');
    if(await js('leaflet/leaflet.js')) return true;
    css('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css');
    return js('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js');
  })();
  _leaflet.then(ok=>{ if(!ok) _leaflet=null; });
  return _leaflet;
}
const iconoPersona = (nombre, vivo) => L.divIcon({className:'', iconSize:[34,34], iconAnchor:[17,17],
  html:`<div class="mk-eq ${vivo?'vivo':''}">${esc(((nombre||'?').trim().split(/\s+/).map(w=>w[0]).join('').slice(0,2)).toUpperCase())}</div>`});
function dibujarEquipo(){
  const g = MAPA.capas.eq; g.clearLayers();
  const cob = viewState.cob || '';
  for(const {u, g:ub} of equipo()){
    if(cob && u.id!==cob) continue;
    if(!tieneUbic(ub)) continue;
    const e = estadoGPS(ub);
    L.marker([ub.lat, ub.lng], {icon:iconoPersona(u.nombre, e.vivo), zIndexOffset:1000})
      .bindPopup(`<b>${esc(u.nombre)}</b><br>${esc(e.txt)}${ub.prec?`<br><span class="muted">Precisión ±${fmtDist(ub.prec)}</span>`:''}`).addTo(g);
  }
}
AFTER.mapa = async () => {
  const el = document.getElementById('mapa'); if(!el) return;
  const ok = await cargarLeaflet();
  if(!document.body.contains(el)) return;
  if(!ok){ el.innerHTML = '<div class="empty">No se pudo cargar el mapa. Revisa tu conexión a internet.</div>'; return; }
  if(MAPA.map){ try{ MAPA.vista = {c:MAPA.map.getCenter(), z:MAPA.map.getZoom(), key:MAPA.key}; MAPA.map.remove(); }catch(e){} MAPA.map=null; }
  el.innerHTML = '';
  const fecha = viewState.fecha || todayStr(), cob = viewState.cob || '';
  const map = L.map(el, {zoomControl:true});
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:19, attribution:'© OpenStreetMap'}).addTo(map);
  MAPA.map = map; MAPA.key = fecha+'|'+cob+'|'+(viewState.ruta||'');
  MAPA.capas = { cl:L.layerGroup().addTo(map), pg:L.layerGroup().addTo(map), ruta:L.layerGroup().addTo(map), eq:L.layerGroup().addTo(map) };
  const pts = [];
  for(const c of DB.clientes){
    if(cob && c.cobradorId!==cob) continue;
    if(!tieneUbic(c)) continue;
    const ps = DB.prestamos.filter(p=>p.clienteId===c.id).map(p=>estadoPrestamo(p)).filter(e=>e.estado!=='Pagado');
    const atr = ps.some(e=>e.atrasoMora>0.5), saldo = ps.reduce((s,e)=>s+e.saldo,0);
    L.circleMarker([c.lat,c.lng], {radius:7, weight:2, color:'#0e0e10', fillColor: atr?'#ff5d5d':(ps.length?'#c6f432':'#8a8a93'), fillOpacity:.95})
      .bindPopup(`<b>${esc(c.nombre)}</b>${c.direccion?`<br>${esc(c.direccion)}`:''}<br>Saldo: ${fmt(saldo)}${atr?' · <span style="color:#d33">atrasado</span>':''}<br><a href="${urlComoLlegar(c)}" ${isNative()?'':'target="_blank" rel="noopener"'}>Cómo llegar</a>`)
      .addTo(MAPA.capas.cl);
    pts.push([c.lat,c.lng]);
  }
  for(const x of DB.pagos){
    if(x.fecha!==fecha || !tieneUbic(x)) continue;
    if(cob && x.cobradorId!==cob && x.registradoPor!==cob) continue;
    const a = alertaPago(x), p = DB.prestamos.find(y=>y.id===x.prestamoId)||{};
    const mal = a && a.nivel==='bad';
    L.circleMarker([x.lat,x.lng], {radius:5, weight:2, color: mal?'#ffb020':'#ffffff', fillColor: mal?'#ffb020':'#4aa8ff', fillOpacity:1})
      .bindPopup(`<b>Cobro ${fmt(x.monto)}</b><br>${esc(nombreCliente(p.clienteId))}<br>${esc(nombreUsuario(x.registradoPor))}${x.creado?' · '+horaDe(x.creado):''}${a?`<br>${esc(a.txt)}`:''}`)
      .addTo(MAPA.capas.pg);
    pts.push([x.lat,x.lng]);
    const c = clienteById(p.clienteId);
    if(mal && tieneUbic(c)) L.polyline([[x.lat,x.lng],[c.lat,c.lng]], {color:'#ffb020', weight:2, dashArray:'4 6'}).addTo(MAPA.capas.pg);
  }
  dibujarEquipo();
  for(const {u, g} of equipo()) if((!cob || u.id===cob) && tieneUbic(g)) pts.push([g.lat,g.lng]);
  const ruta = viewState.ruta;
  if(ruta){
    S.getRecorrido(ruta, fecha).then(r=>{
      if(!r || !Array.isArray(r.puntos) || MAPA.map!==map) return;
      const ll = r.puntos.filter(q=>q && typeof q.la==='number' && typeof q.lo==='number').sort((a,b)=>(a.t||0)-(b.t||0)).map(q=>[q.la,q.lo]);
      if(!ll.length) return toast('Sin recorrido para esa fecha');
      L.polyline(ll, {color:'#c6f432', weight:4, opacity:.85}).addTo(MAPA.capas.ruta);
      L.circleMarker(ll[0], {radius:5, color:'#c6f432', fillColor:'#0e0e10', fillOpacity:1}).bindPopup('Inicio del recorrido').addTo(MAPA.capas.ruta);
      map.fitBounds(L.latLngBounds(ll).pad(0.15));
    }).catch(()=>toast('No se pudo cargar el recorrido'));
  }
  if(MAPA.vista && MAPA.vista.key===MAPA.key) map.setView(MAPA.vista.c, MAPA.vista.z);
  else if(pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.15), {maxZoom:16});
  else if(GPS.ultimo) map.setView([GPS.ultimo.lat, GPS.ultimo.lng], 14);
  else map.setView([4.65,-74.08], 6);
  setTimeout(()=>map.invalidateSize(), 60);
};

/* ---------- fotos del cliente y de la cédula ---------- */
const TIPOS_FOTO = [['foto','Foto del cliente'],['cedula','Cédula (frente)'],['cedulaReverso','Cédula (reverso)']];
const FOTO_OK = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;
const fotoSegura = v => (typeof v==='string' && v.length < 340000 && FOTO_OK.test(v)) ? v : '';
let FOTOS_TMP = {};
function comprimirFoto(file){
  return new Promise((res, rej)=>{
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = ()=>{
      URL.revokeObjectURL(url);
      let lado = 1100, q = 0.7, out = '';
      for(let i=0;i<14;i++){
        const k = Math.min(1, lado/Math.max(img.width, img.height));
        const cv = document.createElement('canvas'); cv.width = Math.round(img.width*k); cv.height = Math.round(img.height*k);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        out = cv.toDataURL('image/jpeg', q);
        if(out.length < 290000) break;
        if(q > 0.45) q -= 0.1; else lado = Math.round(lado*0.8);
      }
      out.length < 300000 ? res(out) : rej(new Error('muy grande'));
    };
    img.onerror = ()=>{ URL.revokeObjectURL(url); rej(new Error('imagen')); };
    img.src = url;
  });
}
function slotFoto(k, t){
  const v = fotoSegura(FOTOS_TMP[k]);
  return `<div class="foto-slot" id="fs_${k}">
    <div class="foto-prev">${v?`<img src="${v}" alt="${t}" onclick="verFoto('${k}',true)">`:`<span>${t}</span>`}</div>
    <div class="foto-btns"><label class="btn sm">Cámara<input type="file" accept="image/*" capture="environment" hidden onchange="cargarFoto('${k}',this)"></label>
    <label class="btn sm">Galería<input type="file" accept="image/*" hidden onchange="cargarFoto('${k}',this)"></label>
    ${v?`<button type="button" class="btn sm ghost" onclick="FOTOS_TMP['${k}']='';document.getElementById('fs_${k}').outerHTML=slotFoto('${k}','${t}')">Quitar</button>`:''}</div></div>`;
}
function bloqueFotos(){
  return `<div class="f full"><span>Fotos del cliente y de la cédula</span><div class="fotos-grid">${TIPOS_FOTO.map(([k,t])=>slotFoto(k,t)).join('')}</div></div>`;
}
async function cargarFoto(k, input){
  const f = input.files && input.files[0]; if(!f) return;
  const t = (TIPOS_FOTO.find(x=>x[0]===k)||[])[1]||'';
  const slot = document.getElementById('fs_'+k);
  if(slot) slot.querySelector('.foto-prev').innerHTML = '<span>Procesando…</span>';
  try{ FOTOS_TMP[k] = await comprimirFoto(f); }
  catch(e){ toast('No se pudo leer la imagen'); }
  const s2 = document.getElementById('fs_'+k); if(s2) s2.outerHTML = slotFoto(k, t);
}
function hayFotos(o){ return TIPOS_FOTO.some(([k])=>fotoSegura(o[k])); }
function guardarFotos(pid, clienteId, fotos){
  const d = {clienteId, creado:Date.now(), creadoPor:ME.uid};
  for(const [k] of TIPOS_FOTO){ const v = fotoSegura(fotos[k]); if(v) d[k] = v; }
  return S.setFotos(pid, d);
}
/* busca las fotos del préstamo; si no tiene, las del crédito más reciente del mismo cliente */
async function fotosDe(p){
  const lista = [p, ...DB.prestamos.filter(x=>x.clienteId===p.clienteId && x.id!==p.id).sort((a,b)=>(b.fecha||'').localeCompare(a.fecha||''))];
  for(const x of lista.slice(0, 6)){
    const f = await S.getFotos(x.id);
    if(f && hayFotos(f)) return {f, de:x};
  }
  return null;
}
let FOTOS_VISTA = {};
async function cargarFotosDetalle(pid){
  const box = document.getElementById('fotosBox'); if(!box) return;
  const p = DB.prestamos.find(x=>x.id===pid); if(!p) return;
  const r = await fotosDe(p);
  const b = document.getElementById('fotosBox'); if(!b) return;
  FOTOS_VISTA = r ? r.f : {};
  const btn = isAdmin() ? `<button class="btn sm" onclick="modalFotos('${pid}')">${r?'Cambiar fotos':'Agregar fotos'}</button>` : '';
  if(!r){ b.innerHTML = `<div class="empty">Este cliente no tiene fotos todavía.</div><div class="row" style="justify-content:center">${btn}</div>`; return; }
  b.innerHTML = `${r.de.id!==pid?`<p class="muted" style="margin-top:0;font-size:12.5px">Fotos tomadas en el crédito del ${fdate(r.de.fecha)}.</p>`:''}
    <div class="fotos-grid">${TIPOS_FOTO.map(([k,t])=>{ const v=fotoSegura(r.f[k]); return `<div class="foto-slot"><div class="foto-prev">${v?`<img src="${v}" alt="${t}" onclick="verFoto('${k}')">`:`<span>Sin ${t.toLowerCase()}</span>`}</div><div class="muted" style="font-size:12px;text-align:center">${t}</div></div>`; }).join('')}</div>
    <div class="row" style="margin-top:10px">${r.f.creado?`<span class="muted" style="font-size:12px">Subidas ${horaDe(r.f.creado)} por ${esc(nombreUsuario(r.f.creadoPor))}</span>`:''}<span class="spacer"></span>${btn}</div>`;
}
function verFoto(k, tmp){
  const v = fotoSegura((tmp?FOTOS_TMP:FOTOS_VISTA)[k]); if(!v) return;
  const w = document.createElement('div'); w.className = 'foto-full';
  w.innerHTML = `<img src="${v}" alt="">`; w.onclick = ()=>w.remove();
  document.body.appendChild(w);
}
function modalFotos(pid){
  const p = DB.prestamos.find(x=>x.id===pid); if(!p) return;
  FOTOS_TMP = Object.assign({}, FOTOS_VISTA);
  openModal(`<h3>Fotos de ${esc(nombreCliente(p.clienteId))}</h3>${bloqueFotos()}
  <div class="actions"><button class="btn" onclick="modalDetalle('${pid}','fotos')">Cancelar</button><button class="btn pri" id="fSave">Guardar fotos</button></div>`);
  document.getElementById('fSave').onclick = ()=>{
    guardarFotos(pid, p.clienteId, FOTOS_TMP).then(()=>toast('Fotos guardadas')).catch(falloNube);
    toast('Subiendo fotos…'); modalDetalle(pid, 'fotos');
  };
}
