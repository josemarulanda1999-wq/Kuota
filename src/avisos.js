/* =========================================================
   KUOTA — notificaciones y avisos
   · Campana de notificaciones: pagos ingresados, créditos por aprobar, no pagos,
     cierres de ruta (oficina) y respuestas/notas (ruta). Con sonido y aviso del sistema.
   · Avisos a clientes por WhatsApp o correo: recordatorio de cuota, mora, paz y salvo.
   · Resumen del día para el dueño por WhatsApp o correo.
   ========================================================= */

ICONS.avisos = '<path d="M20 2H4a2 2 0 00-2 2v18l4-4h14a2 2 0 002-2V4a2 2 0 00-2-2zm-3 11H7v-2h10zm0-3H7V8h10z"/>';
const ICON_CAMPANA = '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M12 22a2.5 2.5 0 002.5-2.5h-5A2.5 2.5 0 0012 22zm7-6V11a7 7 0 00-5.5-6.8V3a1.5 1.5 0 00-3 0v1.2A7 7 0 005 11v5l-2 2v1h18v-1z"/></svg>';

/* ---------- campana de notificaciones ---------- */
const NOTIF = { vistos:{}, listo:{}, items:[] };
const lsNotif = () => 'kuota_notif_'+(ME?ME.uid:'');
function cargarNotif(){ try{ NOTIF.items = JSON.parse(localStorage.getItem(lsNotif())||'[]'); }catch(e){ NOTIF.items=[]; } }
function guardarNotif(){ try{ localStorage.setItem(lsNotif(), JSON.stringify(NOTIF.items.slice(0,60))); }catch(e){} }
function reiniciarNotif(){ NOTIF.vistos={}; NOTIF.listo={}; cargarNotif(); }
const prefNotif = () => Object.assign({pagos:true, creditos:true, nopago:false, cierres:true}, (DB.config&&DB.config.notif)||{});

/* se llama cada vez que llega una colección de la nube */
function novedades(col){
  if(!ME) return;
  const cols = isAdmin() ? ['pagos','aprobaciones','renovaciones','visitas','cierres'] : ['aprobaciones','renovaciones','notas'];
  if(!cols.includes(col)) return;
  const lista = DB[col] || [];
  const vistos = NOTIF.vistos[col] || (NOTIF.vistos[col] = {});
  const primera = !NOTIF.listo[col];
  for(const x of lista){
    const firma = x.id + ':' + (x.estado||'');
    if(vistos[firma]) continue;
    vistos[firma] = 1;
    if(primera) continue;                                  // lo que ya existía al abrir no se avisa
    const n = textoNovedad(col, x);
    if(n) notificar(n);
  }
  NOTIF.listo[col] = true;
}
function textoNovedad(col, x){
  const p = prefNotif(), mio = x.creadoPor===ME.uid || x.registradoPor===ME.uid || x.revisadoPor===ME.uid;
  if(col==='pagos' && isAdmin() && p.pagos && !mio && x.tipo!=='importado' && x.tipo!=='renovacion'){
    const pr = DB.prestamos.find(y=>y.id===x.prestamoId)||{};
    return {t:'Pago ingresado', b:`${nombreUsuario(x.registradoPor)} cobró ${fmt(x.monto)} a ${nombreCliente(pr.clienteId)}${x.medio==='transferencia'?' (transferencia)':''}`, go:'cuadre', ic:'pago'};
  }
  if(col==='aprobaciones' && isAdmin() && p.creditos && x.estado==='pendiente' && !mio)
    return {t:'Crédito por aprobar', b:`${nombreRuta(x.cobradorId)} pide ${fmt(x.monto)} para ${nombreCliente(x.clienteId)}`, go:'renovaciones', ic:'credito'};
  if(col==='renovaciones' && isAdmin() && p.creditos && x.estado==='pendiente' && !mio)
    return {t:'Renovación por aprobar', b:`${nombreRuta(x.cobradorId)} pide renovar a ${nombreCliente(x.clienteId)}`, go:'renovaciones', ic:'credito'};
  if(col==='visitas' && isAdmin() && p.nopago && !mio)
    return {t:'No pagó', b:`${nombreCliente(x.clienteId)} · ${x.motivo} (${nombreRuta(x.cobradorId)})`, go:'cobros', ic:'nopago'};
  if(col==='cierres' && isAdmin() && p.cierres && !mio)
    return {t:'Ruta cerrada', b:`${nombreRuta(x.cobradorId)} cerró el día · debe tener ${fmt((x.resumen||{}).saldoFinal)} en efectivo`, go:'cuadre', ic:'cierre'};
  if(!isAdmin() && (col==='aprobaciones'||col==='renovaciones') && x.cobradorId===ME.uid && (x.estado==='aprobada'||x.estado==='rechazada'))
    return {t: x.estado==='aprobada'?'Te aprobaron':'Te rechazaron', b:`${col==='aprobaciones'?'Crédito':'Renovación'} de ${nombreCliente(x.clienteId)}${x.monto?' por '+fmt(x.monto):''}`, go:'cobros', ic:'credito'};
  if(!isAdmin() && col==='notas' && x.cobradorId===ME.uid && !x.leida)
    return {t:'Nota de la oficina', b:x.texto, go:'cobros', ic:'nota'};
  return null;
}
function notificar(n){
  NOTIF.items.unshift({t:n.t, b:n.b, go:n.go, ic:n.ic, en:Date.now(), leido:false});
  guardarNotif();
  toast(`${n.t}: ${n.b}`);
  sonar();
  avisoSistema(n.t, n.b);
  if(typeof renderNav==='function' && ME) renderNav();
}
let _audio = null;
function sonar(){
  try{
    _audio = _audio || new (window.AudioContext||window.webkitAudioContext)();
    const o=_audio.createOscillator(), g=_audio.createGain(); o.connect(g); g.connect(_audio.destination);
    o.frequency.value=880; g.gain.setValueAtTime(0.0001,_audio.currentTime); g.gain.exponentialRampToValueAtTime(0.25,_audio.currentTime+0.02);
    g.gain.exponentialRampToValueAtTime(0.0001,_audio.currentTime+0.35); o.start(); o.stop(_audio.currentTime+0.36);
  }catch(e){}
}
let _idNotif = 1;
async function avisoSistema(titulo, cuerpo){
  try{
    const LN = window.CapPlugins && window.CapPlugins.LocalNotifications;
    if(isNative() && LN){ await LN.schedule({notifications:[{id:(_idNotif++)%100000, title:titulo, body:cuerpo}]}); return; }
    if(!isNative() && 'Notification' in window && Notification.permission==='granted' && document.visibilityState!=='visible')
      new Notification(titulo, {body:cuerpo, icon:'icon-192.png'});
  }catch(e){}
}
async function activarAvisosSistema(){
  try{
    const LN = window.CapPlugins && window.CapPlugins.LocalNotifications;
    if(isNative() && LN){ const r = await LN.requestPermissions(); toast(r.display==='granted'?'Notificaciones activadas':'El celular no dio permiso'); return; }
    if('Notification' in window){ const r = await Notification.requestPermission(); toast(r==='granted'?'Notificaciones activadas':'El navegador no dio permiso'); }
    else toast('Este navegador no permite notificaciones');
  }catch(e){ toast('No se pudieron activar'); }
}
const sinLeer = () => NOTIF.items.filter(i=>!i.leido).length;
function btnCampana(){
  const n = sinLeer();
  return `<button class="btn sm campana" onclick="abrirNotificaciones()" title="Notificaciones">${ICON_CAMPANA}${n?`<span class="badge">${n>9?'9+':n}</span>`:''}</button>`;
}
function abrirNotificaciones(){
  const items = NOTIF.items;
  openModal(`<div class="row" style="margin-bottom:6px"><h3 style="margin:0">Notificaciones</h3><span class="spacer"></span><button class="btn sm ghost" onclick="closeModal()">✕</button></div>
  <div class="notif-lista">${items.length ? items.map((i,k)=>`<button class="notif ${i.leido?'':'nueva'}" onclick="closeModal();go('${['cuadre','renovaciones','cobros','panel','aprobaciones','avisos','movimientos'].includes(i.go)?i.go:'panel'}')">
    <b>${esc(i.t)}</b><span>${esc(i.b)}</span><small>${horaDe(i.en)}</small></button>`).join('') : '<div class="empty">Aún no hay notificaciones. Aquí te avisamos cada pago que ingresen tus rutas.</div>'}</div>
  <div class="actions"><button class="btn" onclick="activarAvisosSistema()">Avisarme también en el ${isNative()?'celular':'computador'}</button>${items.length?`<button class="btn ghost" onclick="NOTIF.items=[];guardarNotif();closeModal();renderNav()">Borrar todas</button>`:''}</div>`);
  NOTIF.items.forEach(i=>i.leido=true); guardarNotif(); renderNav();
}

/* ---------- mensajes a clientes por WhatsApp o correo ---------- */
const PLANTILLAS = {
  recordatorio: 'Hola {cliente}, te recordamos que hoy {fecha} vence tu cuota de {valor}. Tu saldo es {saldo}. — {negocio}',
  mora: 'Hola {cliente}, tienes {cuotas} cuota(s) atrasada(s) por {atraso} ({dias} días). Ponte al día para evitar recargos. Saldo total {saldo}. — {negocio}',
  pazysalvo: 'Hola {cliente}, ¡terminaste de pagar tu crédito de {monto}! Quedas a paz y salvo con {negocio}. Gracias por tu cumplimiento.'
};
const plantilla = k => ((DB.config.plantillas||{})[k]) || PLANTILLAS[k];
function llenarPlantilla(k, p){
  const c = clienteById(p.clienteId)||{}, e = estadoPrestamo(p);
  const v = {cliente:(c.nombre||'').split(' ')[0]||c.nombre||'', nombre:c.nombre||'', fecha:fdate(todayStr()), valor:fmt(p.valorCuota), saldo:fmt(e.saldo),
    atraso:fmt(e.atrasoMora||e.atraso), cuotas:e.cuotasAtraso||1, dias:e.diasMora||0, monto:fmt(p.monto), negocio:nombreNegocio()};
  return plantilla(k).replace(/\{(\w+)\}/g, (m,x)=> x in v ? v[x] : m);
}
const urlWa = (tel, txt) => `https://wa.me/${telWa(tel)}?text=${encodeURIComponent(txt)}`;
const urlMail = (mail, asunto, txt) => `mailto:${encodeURIComponent(mail)}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(txt)}`;
const emailOk = m => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(m||''));
function marcarAviso(prestamoId, tipo, canal){
  const p = DB.prestamos.find(x=>x.id===prestamoId)||{};
  dbAdd('avisos', {prestamoId, clienteId:p.clienteId||'', cobradorId:p.cobradorId||'', tipo, canal, fecha:todayStr()});
  setTimeout(render, 200);
}
const avisadoHoy = (prestamoId, tipo) => DB.avisos.some(a=>a.prestamoId===prestamoId && a.tipo===tipo && a.fecha===todayStr());
function filaAviso(p, tipo, extra){
  const c = clienteById(p.clienteId)||{}, txt = llenarPlantilla(tipo, p), ok = avisadoHoy(p.id, tipo);
  const asunto = {recordatorio:'Recordatorio de cuota', mora:'Cuotas atrasadas', pazysalvo:'Paz y salvo'}[tipo] + ' — ' + nombreNegocio();
  return `<div class="card cobro">
    <div class="who">${ava(c.nombre)}<div style="min-width:0;flex:1"><b>${esc(c.nombre)}</b><div class="muted" style="font-size:12.5px">${esc(c.tel1||'Sin teléfono')}${c.email?' · '+esc(c.email):''}${isAdmin()?' · '+esc(nombreRuta(p.cobradorId)):''}</div></div>${ok?'<span class="pill p-ok">Avisado hoy</span>':extra||''}</div>
    <div class="aviso-txt">${esc(txt)}</div>
    <div class="row">${c.tel1?`<a class="btn sm pri" href="${urlWa(c.tel1, txt)}" target="_blank" rel="noopener" onclick="marcarAviso('${p.id}','${tipo}','whatsapp')">WhatsApp</a>`:''}
      ${emailOk(c.email)?`<a class="btn sm" href="${urlMail(c.email, asunto, txt)}" onclick="marcarAviso('${p.id}','${tipo}','correo')">Correo</a>`:''}
      ${!c.tel1&&!emailOk(c.email)?'<span class="muted" style="font-size:12.5px">Agrega teléfono o correo al cliente</span>':''}</div></div>`;
}
VIEWS.avisos = () => {
  const t = viewState.t || 'hoy', hoy = todayStr();
  const mios = DB.prestamos.filter(p=>pasaFiltroCob(p.cobradorId)).map(p=>({p, e:estadoPrestamo(p)}));
  const listas = {
    hoy: mios.filter(({e})=>e.estado!=='Pagado' && e.estado!=='Castigado' && e.venceHoy && e.atrasoMora<1 && !(e.pagos.some(x=>x.fecha===hoy))),
    mora: mios.filter(({e})=>e.estado==='En mora').sort((a,b)=>b.e.diasMora-a.e.diasMora),
    pazysalvo: mios.filter(({e})=>e.estado==='Pagado' && e.ultimoPago && (parseD(hoy)-parseD(e.ultimoPago))/864e5 <= 30)
  };
  const tipo = t==='hoy' ? 'recordatorio' : t;
  const tb = (k,txt)=>`<button class="${t===k?'on':''}" onclick="go('avisos',Object.assign({},viewState,{t:'${k}'}))">${txt} (${listas[k].length})</button>`;
  const L = listas[t] || [];
  return `<div class="head"><div><h1>Avisos a clientes</h1><p class="sub">Envía recordatorios, cobros de mora y paz y salvo por WhatsApp o correo con un toque. Los mensajes se editan en Ajustes.</p></div>
  <div class="row">${filtroCobrador('avisos')}</div></div>
  <div class="tabs" style="margin-bottom:16px">${tb('hoy','Pagan hoy')}${tb('mora','En mora')}${tb('pazysalvo','Terminaron de pagar')}</div>
  ${L.length?`<div class="cobros-grid">${L.map(({p,e})=>filaAviso(p, tipo, t==='mora'?`<span class="pill p-mora">${e.diasMora} días</span>`:'')).join('')}</div>`:'<div class="card"><div class="empty">No hay clientes en esta lista.</div></div>'}`;
};

/* recibo por correo (complementa el de WhatsApp) */
function urlReciboCorreo(pagoId){
  const x = DB.pagos.find(y=>y.id===pagoId); if(!x) return '';
  const p = DB.prestamos.find(y=>y.id===x.prestamoId)||{}, c = clienteById(p.clienteId)||{};
  return emailOk(c.email) ? urlMail(c.email, 'Recibo de pago — '+nombreNegocio(), textoRecibo(pagoId).replace(/\*/g,'')) : '';
}

/* ---------- resumen del día para el dueño ---------- */
function textoResumenDia(fecha){
  const rutas = cobradores().map(u=>({u, c:cuadreCobrador(u.id, fecha)}));
  const pagos = DB.pagos.filter(x=>x.fecha===fecha && efectivo(x));
  const tot = pagos.reduce((s,x)=>s+x.monto,0), tr = pagos.filter(x=>x.medio==='transferencia').reduce((s,x)=>s+x.monto,0);
  return `*${nombreNegocio()}* — Resumen del ${fdate(fecha)}\n`+
    `Cobrado: ${fmt(tot)} (${pagos.length} pagos)\nEfectivo: ${fmt(tot-tr)} · Transferencia: ${fmt(tr)}\n`+
    `Préstamos nuevos: ${fmt(DB.prestamos.filter(p=>p.fecha===fecha && !p.importado).reduce((s,p)=>s+p.monto,0))}\n\n`+
    rutas.map(({u,c})=>`• ${rutaDe(u)}: cobró ${fmt(c.cobradoDia+(c.transfDia||0))}, gastos ${fmt(c.gastosDia)}, debe tener ${fmt(c.saldoFinal)}${cierreDe(u.id,fecha)?' (cerrada)':''}`).join('\n');
}
function modalResumenDia(fecha){
  fecha = fecha || todayStr();
  const t = textoResumenDia(fecha), tel = DB.config.telDueno||'', mail = DB.config.mailDueno||'';
  openModal(`<h3>Resumen del día</h3><pre class="recibo">${esc(t.replace(/\*/g,''))}</pre>
  <div class="form"><label class="f">Tu WhatsApp<input class="input" id="rdTel" value="${esc(tel)}" placeholder="3001234567"></label>
  <label class="f">Tu correo<input class="input" id="rdMail" value="${esc(mail)}" placeholder="tucorreo@gmail.com"></label></div>
  <div class="actions"><button class="btn" onclick="closeModal()">Cerrar</button><button class="btn" id="rdMailB">Enviar por correo</button><button class="btn pri" id="rdWa">Enviar por WhatsApp</button></div>`);
  const guardar = ()=>{ const a=document.getElementById('rdTel').value.trim().slice(0,30), b=document.getElementById('rdMail').value.trim().slice(0,120);
    if(isCeo() && (a!==tel || b!==mail)){ DB.config.telDueno=a; DB.config.mailDueno=b; cfgSave(); } return {a,b}; };
  document.getElementById('rdWa').onclick = ()=>{ const {a}=guardar(); window.open(a?urlWa(a,t):`https://wa.me/?text=${encodeURIComponent(t)}`, '_blank'); };
  document.getElementById('rdMailB').onclick = ()=>{ const {b}=guardar(); if(!emailOk(b)) return toast('Escribe un correo válido'); location.href = urlMail(b, 'Resumen del '+fdate(fecha), t.replace(/\*/g,'')); };
}

/* ---------- ajustes de mensajes y notificaciones ---------- */
function bloqueAjustesAvisos(){
  const n = prefNotif(), P = Object.assign({}, PLANTILLAS, DB.config.plantillas||{});
  return `<div class="card pad">
    <h2>Notificaciones y mensajes</h2>
    <div class="form">
      <div class="f full"><span>Avisarme cuando…</span>
        <label class="chk"><input type="checkbox" id="nPag" ${n.pagos?'checked':''}> una ruta registre un pago</label>
        <label class="chk"><input type="checkbox" id="nCre" ${n.creditos?'checked':''}> haya créditos o renovaciones por aprobar</label>
        <label class="chk"><input type="checkbox" id="nNop" ${n.nopago?'checked':''}> un cliente no pague</label>
        <label class="chk"><input type="checkbox" id="nCie" ${n.cierres?'checked':''}> una ruta cierre el día</label></div>
      <label class="f full">Recordatorio de cuota<textarea class="input" id="pRec" rows="2">${esc(P.recordatorio)}</textarea></label>
      <label class="f full">Cliente en mora<textarea class="input" id="pMor" rows="2">${esc(P.mora)}</textarea></label>
      <label class="f full">Paz y salvo<textarea class="input" id="pPaz" rows="2">${esc(P.pazysalvo)}</textarea></label>
      <p class="muted full" style="font-size:12px;margin:0">Puedes usar: {cliente} {nombre} {valor} {saldo} {atraso} {cuotas} {dias} {monto} {fecha} {negocio}</p>
    </div>
    <div class="actions row" style="margin-top:16px"><button class="btn pri" onclick="guardarAjustesAvisos()">Guardar</button></div>
  </div>`;
}
function guardarAjustesAvisos(){
  const v = id => document.getElementById(id).value.trim().slice(0,500);
  const ch = id => document.getElementById(id).checked;
  DB.config.notif = {pagos:ch('nPag'), creditos:ch('nCre'), nopago:ch('nNop'), cierres:ch('nCie')};
  DB.config.plantillas = {recordatorio:v('pRec')||PLANTILLAS.recordatorio, mora:v('pMor')||PLANTILLAS.mora, pazysalvo:v('pPaz')||PLANTILLAS.pazysalvo};
  cfgSave(); render(); toast('Ajustes guardados');
}
