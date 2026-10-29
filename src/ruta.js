/* =========================================================
   KUOTA — operación diaria de las rutas
   · La ruta presta en la calle (con tope; si se pasa pide aprobación)
   · Visitas: No pagó / Aplazado con motivo y fecha para volver
   · Gastos e ingresos de la ruta con conceptos configurables
   · Cierre del día de la ruta (la oficina la puede reabrir)
   · Enrutar: orden de visita de los clientes
   · Recibo de pago por WhatsApp
   ========================================================= */

ICONS.enrutar = '<path d="M4 6h10v2H4zm0 5h10v2H4zm0 5h7v2H4zm13-9l4 4h-3v7h-2v-7h-3z"/>';

const rutaCfg = uid => DB.rutas.find(r=>r.id===uid) || {};
const idCierre = (uid, fecha) => `${uid}_${fecha}`;
const cierreDe = (uid, fecha) => DB.cierres.find(c=>c.id===idCierre(uid, fecha));
const miRutaCerrada = (fecha=todayStr()) => !isAdmin() && ME && !!cierreDe(ME.uid, fecha);
const visitaDe = (prestamoId, fecha) => DB.visitas.filter(v=>v.prestamoId===prestamoId && v.fecha===fecha && v.resultado!=='dominical').sort((a,b)=>(b.creado||0)-(a.creado||0))[0];
const telWa = t => { let d = String(t||'').replace(/\D/g,''); if(!d) return ''; const cc = MON().tel; if(!d.startsWith(cc) || d.length <= 10) d = cc + d.replace(/^0+/,''); return d; };
function rutaBloqueada(){
  if(miRutaCerrada()){ avisar('Tu ruta de hoy ya está cerrada. Pídele a la oficina que la reabra si necesitas registrar algo más.'); return true; }
  if(!isAdmin() && ME && !aperturaDe(ME.uid, todayStr())){
    // si hoy ya registró pagos, visitas o gastos, la ruta sí se abrió: la apertura solo no ha llegado al celular
    if(trabajoHoy()){ recuperarApertura(); return false; }
    pedirAbrirRuta(); return true;
  }
  return false;
}
function trabajoHoy(){
  const h = todayStr(), yo = ME.uid;
  return DB.pagos.some(x=>x.fecha===h && x.registradoPor===yo) || DB.visitas.some(x=>x.fecha===h && x.creadoPor===yo) || DB.movruta.some(x=>x.fecha===h && x.creadoPor===yo);
}
/* trae la apertura de hoy directo de la nube (por si el celular la perdió al reconectarse) */
let _recuperando = null;
function recuperarApertura(){
  if(_recuperando) return _recuperando;
  const id = idCierre(ME.uid, todayStr());
  _recuperando = S.getUno('aperturas', id).then(a=>{ _recuperando = null;
    if(a && !aperturaDe(ME.uid, todayStr())){ DB.aperturas = (DB.aperturas||[]).concat([sanearDoc(a)]); scheduleRender(); }
    return a; });
  return _recuperando;
}
/* ---------- apertura del día: cada ruta abre su día antes de cobrar y lo cierra al final ---------- */
const aperturaDe = (uid, fecha) => (DB.aperturas||[]).find(a=>a.id===idCierre(uid, fecha));
const miRutaAbierta = () => !isAdmin() && ME && !!aperturaDe(ME.uid, todayStr());
async function pedirAbrirRuta(){
  // antes de pedirla, se revisa en la nube: puede que ya esté abierta
  const a = await recuperarApertura();
  if(a){ toast('Tu ruta de hoy sí está abierta. Vuelve a intentarlo.'); return; }
  openModal(`<h3>Primero abre tu ruta de hoy</h3><p class="muted" style="margin-top:-6px">Para registrar cobros, visitas o gastos tienes que abrir la ruta del día. Al terminar, la cierras.</p>
    <div class="actions"><button class="btn" onclick="closeModal()">Ahora no</button><button class="btn pri" onclick="closeModal();abrirMiRuta()">Abrir ruta</button></div>`);
}
async function abrirMiRuta(uid, fecha){
  uid = uid || ME.uid; fecha = fecha || todayStr();
  if(aperturaDe(uid, fecha)) return toast('La ruta ya está abierta');
  if(cierreDe(uid, fecha)) return avisar('Esa ruta ya se cerró ese día.');
  // si ya existe en la nube no se vuelve a crear (la nube no deja reescribirla)
  const ya = await S.getUno('aperturas', idCierre(uid, fecha));
  if(ya){ if(!aperturaDe(uid, fecha)) DB.aperturas = (DB.aperturas||[]).concat([sanearDoc(ya)]); render(); return toast('La ruta ya estaba abierta'); }
  const d = {cobradorId:uid, fecha, abiertaEn:Date.now(), por:ME.uid};
  if(!isAdmin()){ try{ const g = await gpsParaPago(); if(g && g.lat) Object.assign(d, {lat:g.lat, lng:g.lng, prec:g.prec||0}); }catch(e){} }
  S.set('aperturas', idCierre(uid, fecha), d).catch(falloNube);
  DB.aperturas = (DB.aperturas||[]).concat([{id:idCierre(uid, fecha), ...d}]);
  if(!isAdmin() && typeof iniciarJornada==='function' && typeof GPS!=='undefined' && !GPS.activo && typeof gpsRastreable==='function' && gpsRastreable()) iniciarJornada();
  render(); toast(isAdmin() ? 'Ruta abierta' : 'Ruta abierta: ¡buen día de cobro!');
}
let _sinAbrirC = {}, _sinAbrirRef = null, _sinAbrirLen = -1, _sinAbrirHoy = '';
function diasSinAbrirCache(uid){
  const A = DB.aperturas||[], hoy = todayStr();
  if(_sinAbrirRef!==A || _sinAbrirLen!==A.length || _sinAbrirHoy!==hoy){ _sinAbrirC={}; _sinAbrirRef=A; _sinAbrirLen=A.length; _sinAbrirHoy=hoy; }
  return _sinAbrirC[uid] || (_sinAbrirC[uid] = diasSinAbrir(uid, hoy));
}
// días que la ruta no abrió (desde su primera apertura y sin contar domingos)
function diasSinAbrir(uid, hasta){
  const ap = (DB.aperturas||[]).filter(a=>a.cobradorId===uid).map(a=>a.fecha).sort();
  if(!ap.length) return new Set();
  const hechos = new Set(ap), out = new Set();
  const d = parseD(ap[0]);
  for(let i=0;i<120 && ymd(d) < hasta;i++){ const f=ymd(d); if(d.getDay()!==0 && !hechos.has(f)) out.add(f); d.setDate(d.getDate()+1); }
  return out;
}
// cuotas que debe hoy y cuáles vienen de días en que no se abrió la ruta
function detallePendiente(p, e, fecha){
  const debe = e.cron.filter(c=>c.n > e.cuotasPagadas && c.fecha <= fecha);
  const sin = p.cobradorId ? diasSinAbrir(p.cobradorId, fecha) : new Set();
  return { n: debe.length, sinAbrir: debe.filter(c=>sin.has(c.fecha)).map(c=>c.fecha) };
}
function bloqueAperturaRuta(fecha){
  if(isAdmin() || fecha!==todayStr()) return '';
  if(cierreDe(ME.uid, fecha)) return '';
  const a = aperturaDe(ME.uid, fecha);
  const sin = [...diasSinAbrir(ME.uid, fecha)].filter(f=>f >= ymd(new Date(parseD(fecha).getTime()-14*864e5)));
  const correr = DB.config.sinAbrir==='correr';
  const avisoSin = sin.length ? `<div class="banner" style="display:block">No abriste la ruta ${sin.length===1?'el '+fdate(sin[0]):'estos días: '+sin.map(fdate).join(', ')}. ${correr?`Las cuotas de ${sin.length===1?'ese día':'esos días'} se corrieron un día: no generan mora.`:`Las cuotas de ${sin.length===1?'ese día':'esos días'} se suman a las de hoy: cobra todo lo pendiente.`}</div>` : '';
  if(!a) return `<div class="card pad abrir-ruta" style="margin-bottom:16px;text-align:center">
    <h2 style="margin:0 0 6px">Tu ruta de hoy está sin abrir</h2><p class="muted" style="margin:0 0 14px">Ábrela para empezar a cobrar. Al final del día la cierras.</p>
    <button class="btn pri" style="font-size:17px;padding:14px 28px" onclick="abrirMiRuta()">Abrir ruta de hoy</button></div>${avisoSin}`;
  const faltan = faltanPorVisitar(ME.uid, fecha).length;
  return `<div class="banner" style="background:var(--green-soft);color:inherit"><span class="pill p-ok">Ruta abierta</span> desde las ${new Date(a.abiertaEn).toLocaleTimeString('es-CO',{hour:'numeric',minute:'2-digit'})}<span class="spacer"></span>${faltan?`<span class="muted" style="font-size:12.5px">Faltan ${faltan} por visitar</span>`:''}<button class="btn sm ${faltan?'':'pri'}" onclick="cerrarMiRuta()">Cerrar ruta del día</button></div>${avisoSin}`;
}

/* ---------- visitas: no pagó / aplazado ---------- */
const MOTIVOS_NOPAGO = ['No estaba en casa','No tenía plata','Pagará más tarde','Se negó a pagar','Cliente enfermo o viaje','Dirección no encontrada','Otro'];
function modalNoPago(prestamoId, fecha){
  if(rutaBloqueada()) return;
  const p = DB.prestamos.find(x=>x.id===prestamoId); if(!p) return;
  const man = ymd(new Date(Date.now()+864e5));
  openModal(`<h3>No pagó · ${esc(nombreCliente(p.clienteId))}</h3>
  <p class="muted" style="margin-top:-8px">Queda en el historial del cliente y la oficina lo ve en el cuadre.</p>
  <div class="form">
    <label class="f full">Motivo<select class="input" id="vMot">${MOTIVOS_NOPAGO.map(m=>`<option>${m}</option>`).join('')}</select></label>
    <label class="f">¿Cuándo volver?<input type="date" class="input" id="vVol" value="${man}"></label>
    <label class="f">Nota<input class="input" id="vNot" placeholder="Opcional"></label>
  </div>
  <div class="actions"><button class="btn" onclick="closeModal()">Cancelar</button><button class="btn pri" id="vSave">Guardar visita</button></div>`);
  document.getElementById('vSave').onclick = async ()=>{
    const b=document.getElementById('vSave'); b.disabled=true; b.textContent='Guardando…';
    const volver = document.getElementById('vVol').value;
    const gps = await gpsParaPago();
    dbAdd('visitas', Object.assign({prestamoId, clienteId:p.clienteId, cobradorId:p.cobradorId||'', fecha:fecha||todayStr(),
      resultado: volver ? 'aplazado' : 'nopago', motivo:document.getElementById('vMot').value, volver:volver||'',
      nota:document.getElementById('vNot').value.trim().slice(0,200)}, gps));
    closeModal(); render(); toast('Visita registrada');
  };
}
function chipVisita(p, fecha){
  const dd = diaDado(p.id, fecha);
  if(dd) return `<span class="pill p-ok" title="${esc(dd.nota||'')}">Día dado · ${esc(dd.motivo)}</span>`;
  const v = visitaDe(p.id, fecha);
  if(v) return `<span class="pill p-mora" title="${esc(v.nota||'')}">No pagó · ${esc(v.motivo)}${v.volver?` · vuelve ${fdateShort(v.volver)}`:''}</span>`;
  const ap = DB.visitas.find(x=>x.prestamoId===p.id && x.volver===fecha);
  return ap ? `<span class="pill p-hoy">Aplazado para hoy</span>` : '';
}

/* ---------- dar día (dominical): fuerza mayor, la cuota pasa al día siguiente sin quedar en mora ---------- */
const MOTIVOS_DIA = ['Fuerza mayor','Calamidad familiar','Enfermedad','Día festivo del cliente','Otro'];
const diaDado = (prestamoId, fecha) => DB.visitas.find(v=>v.prestamoId===prestamoId && v.fecha===fecha && v.resultado==='dominical');
function puedeDarDia(){ return isAdmin() || !!rutaCfg(ME.uid).puedeDominical; }

/* ---------- visitados: ya pagó, quedó como "no pagó", se le dio el día o ya no debe nada ese día ---------- */
function rutaVisitado(c, fecha){
  return c.pagadoHoy > 0.5 || c.cobrar <= 0.5 || !!visitaDe(c.p.id, fecha) || !!diaDado(c.p.id, fecha);
}
function faltanPorVisitar(uid, fecha){
  return cobrosDelDia(fecha).filter(c=>c.p.cobradorId===uid && !rutaVisitado(c, fecha));
}
/* la ruta puede corregir los pagos que ella misma registró hoy, mientras no haya cerrado el día */
function puedeEditarPago(x){
  if(!x || !ME) return false;
  if(isCeo()) return true;
  if(isAdmin()) return false;
  return !x.tipo && x.registradoPor===ME.uid && x.fecha===todayStr() && !miRutaCerrada(x.fecha);
}
function modalDarDia(prestamoId, fecha){
  if(!puedeDarDia()) return toast('La oficina no le ha dado permiso a tu ruta para dar días');
  if(!isAdmin() && rutaBloqueada()) return;
  const p = DB.prestamos.find(x=>x.id===prestamoId); if(!p) return;
  const e = estadoPrestamo(p), hoy = todayStr();
  const sugerida = fecha || (e.cron.find(c=>c.fecha>=hoy && !(diasLibres(p.id)||new Set()).has(c.fecha))||{}).fecha || hoy;
  openModal(`<h3>Dar día · ${esc(nombreCliente(p.clienteId))}</h3>
  <p class="muted" style="margin-top:-8px">El cliente tuvo un caso de fuerza mayor. Ese día no se le cobra, <b>no queda en mora</b> y la cuota pasa al día siguiente.</p>
  <div class="form">
    <label class="f">Día que se le da<input type="date" class="input" id="dFec" value="${sugerida}" ${isAdmin()?'':`min="${hoy}"`}></label>
    <label class="f">Motivo<select class="input" id="dMot">${MOTIVOS_DIA.map(m=>`<option>${m}</option>`).join('')}</select></label>
    <label class="f full">Nota<input class="input" id="dNot" placeholder="Opcional: qué pasó"></label>
  </div>
  <div class="calcbox" id="dInfo" style="margin-top:12px"></div>
  <div class="actions"><button class="btn" onclick="closeModal()">Cancelar</button><button class="btn pri" id="dOk">Dar el día</button></div>`);
  const info = ()=>{
    const f = document.getElementById('dFec').value; if(!f) return;
    const libres = new Set(diasLibres(p.id)||[]); const antes = cronograma(p);
    libres.add(f); _libIdx[p.id]=libres; const desp = cronograma(p); _libLen=-1;
    const i = antes.findIndex(c=>c.fecha===f);
    document.getElementById('dInfo').innerHTML = i<0
      ? `<div><div class="l">Ese día no tiene cuota</div><div class="v" style="font-size:14px">Queda registrado igual, pero no cambia el calendario.</div></div>`
      : `<div><div class="l">Cuota ${antes[i].n}</div><div class="v" style="font-size:15px">${fdate(antes[i].fecha)} → <b>${fdate(desp[i].fecha)}</b></div></div>
         <div><div class="l">Última cuota</div><div class="v" style="font-size:15px">${fdate(desp[desp.length-1].fecha)}</div></div>`;
  };
  document.getElementById('dFec').addEventListener('change', info); info();
  document.getElementById('dOk').onclick = async ()=>{
    const f = document.getElementById('dFec').value;
    if(!f) return toast('Escoge el día');
    if(diaDado(p.id, f)) return toast('Ese día ya se le había dado');
    const b=document.getElementById('dOk'); b.disabled=true;
    const gps = isAdmin() ? {} : await gpsParaPago();
    dbAdd('visitas', Object.assign({prestamoId:p.id, clienteId:p.clienteId, cobradorId:p.cobradorId||'', fecha:f, resultado:'dominical',
      motivo:document.getElementById('dMot').value, volver:'', nota:document.getElementById('dNot').value.trim().slice(0,200)}, gps));
    closeModal(); render(); toast('Día dado: la cuota pasa al día siguiente');
  };
}
function listaDiasDados(p){
  const l = DB.visitas.filter(v=>v.prestamoId===p.id && v.resultado==='dominical').sort((a,b)=>a.fecha.localeCompare(b.fecha));
  if(!l.length) return '';
  return `<div class="banner" style="background:var(--green-soft,rgba(200,241,105,.12));color:inherit">Días dados (dominical): ${l.map(v=>`<b>${fdate(v.fecha)}</b> · ${esc(v.motivo)}${v.nota?' ('+esc(v.nota)+')':''} <span class="muted" style="font-size:12px">por ${esc(nombreUsuario(v.creadoPor))}</span>${isCeo()?` <button class="btn sm ghost" onclick="quitarDiaDado('${v.id}','${p.id}')">Quitar</button>`:''}`).join(' &nbsp;·&nbsp; ')}</div>`;
}
async function quitarDiaDado(id, prestamoId){
  if(!await confirmar('¿Quitar este día dado? La cuota vuelve a su fecha original y puede quedar en mora.')) return;
  dbDel('visitas', id); closeModal(); render(); modalDetalle(prestamoId);
}

/* ---------- gastos e ingresos de la ruta ---------- */
function modalGastoRuta(tipo='gasto', cobradorId, fecha){
  const uid = cobradorId || ME.uid;
  if(!isAdmin() && rutaBloqueada()) return;
  const lista = tipo==='gasto' ? DB.config.conceptosGasto : DB.config.conceptosIngreso;
  const max = Number(rutaCfg(uid).maxGasto)||0;
  openModal(`<h3>${tipo==='gasto'?'Gasto':'Ingreso'} de ${esc(nombreRuta(uid))}</h3>
  ${tipo==='gasto'&&max&&!isAdmin()?`<p class="muted" style="margin-top:-8px">Máximo por gasto: ${fmt(max)}. Si es más, pídelo a la oficina.</p>`:''}
  <div class="form">
    <label class="f full">Concepto<select class="input" id="gCon">${lista.map(c=>`<option>${esc(c)}</option>`).join('')}</select></label>
    <label class="f">Fecha<input type="date" class="input" id="gFec" value="${fecha||todayStr()}" ${isAdmin()?'':'disabled'}></label>
    <label class="f">Valor<input class="input" id="gVal2" inputmode="decimal"></label>
    <label class="f full">Nota<input class="input" id="gNot2" placeholder="Opcional"></label>
  </div>
  <div class="actions"><button class="btn" onclick="closeModal()">Cancelar</button><button class="btn pri" id="gSave2">Guardar</button></div>`);
  const val=document.getElementById('gVal2'); val.addEventListener('blur',()=>{ const n=num(val.value); if(n) val.value=fmtIn(n); });
  document.getElementById('gSave2').onclick = async ()=>{
    const v = num(val.value); if(v<=0) return toast('Escribe el valor');
    if(tipo==='gasto' && max && v>max && !isAdmin()) return avisar(`Ese gasto pasa el máximo de tu ruta (${fmt(max)}). Pídele a la oficina que lo registre.`);
    const gps = isAdmin() ? {} : await gpsParaPago();
    dbAdd('movruta', Object.assign({cobradorId:uid, fecha:document.getElementById('gFec').value||todayStr(), tipo, concepto:document.getElementById('gCon').value,
      valor:v, nota:document.getElementById('gNot2').value.trim().slice(0,200)}, gps));
    closeModal(); render(); toast(tipo==='gasto'?'Gasto registrado':'Ingreso registrado');
  };
}
async function borrarMovRuta(id){ if(!await confirmar('¿Borrar este movimiento de la ruta?')) return; dbDel('movruta', id); render(); }
function tablaMovRuta(uid, fecha){
  const ms = DB.movruta.filter(x=>x.cobradorId===uid && x.fecha===fecha);
  if(!ms.length) return '';
  return `<div class="card pad" style="margin-bottom:16px"><h2>Gastos e ingresos de la ruta</h2><div class="tablewrap"><table><tbody>${ms.map(x=>`<tr>
    <td>${x.tipo==='gasto'?'<span class="pill p-mora">Gasto</span>':'<span class="pill p-ok">Ingreso</span>'}</td><td>${esc(x.concepto)}${x.nota?`<div class="muted" style="font-size:12px">${esc(x.nota)}</div>`:''}</td>
    <td class="num">${fmt(x.valor)}</td><td class="right">${isCeo()?`<button class="btn sm danger" onclick="borrarMovRuta('${x.id}')">Borrar</button>`:''}</td></tr>`).join('')}</tbody></table></div></div>`;
}

/* ---------- cierre del día de la ruta ---------- */
function resumenCierre(uid, fecha){
  const c = cuadreCobrador(uid, fecha);
  const lista = cobrosDelDia(fecha).filter(x=>x.p.cobradorId===uid);
  const visitas = DB.visitas.filter(v=>v.cobradorId===uid && v.fecha===fecha && v.resultado!=='dominical');
  return { cobrado:c.cobradoDia, transferencias:c.transfDia||0, pagos:c.nPagosDia, base:c.baseDia, gastos:c.gastosDia, ingresos:c.ingresosDia, prestado:c.prestadoDia + c.desembolsadoDia,
           entregado:c.entregadoDia, saldoFinal:c.saldoFinal, clientes:lista.length, noPagos:visitas.length };
}
/* ---------- detalle del cierre: quién pagó, quién quedó pendiente y el recorrido del día ---------- */
function listasDia(uid, fecha){
  const mios = new Set(DB.prestamos.filter(p=>p.cobradorId===uid).map(p=>p.id));
  const pagaron = DB.pagos.filter(x=>x.fecha===fecha && efectivo(x) && (mios.has(x.prestamoId) || x.cobradorId===uid))
    .map(x=>{ const p=DB.prestamos.find(y=>y.id===x.prestamoId)||{}; return {c:nombreCliente(p.clienteId).slice(0,60), m:Math.round(x.monto*100)/100, t:x.medio==='transferencia'?'T':'E', h:x.creado?new Date(x.creado).toLocaleTimeString('es-CO',{hour:'numeric',minute:'2-digit'}):''}; })
    .slice(0,300);
  const pendientes = cobrosDelDia(fecha).filter(c=>c.p.cobradorId===uid && c.pagadoHoy<0.5 && c.cobrar>0.5)
    .map(c=>{ const v=visitaDe(c.p.id, fecha), dd=diaDado(c.p.id, fecha); return {c:nombreCliente(c.p.clienteId).slice(0,60), d:Math.round(c.cobrar*100)/100, r:(dd?'Día dado: '+dd.motivo:v?'No pagó: '+v.motivo:'Sin visita').slice(0,60)}; })
    .slice(0,300);
  return {pagaron, pendientes};
}
function distanciaKm(ll){ let d=0; for(let i=1;i<ll.length;i++){ const [a,b]=ll[i-1],[c,e]=ll[i]; const R=6371, dl=(c-a)*Math.PI/180, dn=(e-b)*Math.PI/180;
  const h=Math.sin(dl/2)**2+Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(dn/2)**2; const k=2*R*Math.asin(Math.sqrt(h)); if(k<5) d+=k; } return Math.round(d*10)/10; }
async function resumenRecorrido(uid, fecha){
  try{
    const r = await Promise.race([S.getRecorrido(uid, fecha), new Promise(res=>setTimeout(()=>res(null), 6000))]);
    const pts = (r && Array.isArray(r.puntos) ? r.puntos : []).filter(q=>q && typeof q.la==='number' && typeof q.lo==='number').sort((a,b)=>(a.t||0)-(b.t||0));
    if(!pts.length) return {rPuntos:0};
    const hora = t => t ? new Date(t).toLocaleTimeString('es-CO',{hour:'numeric',minute:'2-digit'}) : '';
    return {rPuntos:pts.length, rKm:distanciaKm(pts.map(q=>[q.la,q.lo])), rDesde:hora(pts[0].t), rHasta:hora(pts[pts.length-1].t)};
  }catch(e){ return {rPuntos:0}; }
}
async function resumenCierreCompleto(uid, fecha){
  return Object.assign(resumenCierre(uid, fecha), listasDia(uid, fecha), await resumenRecorrido(uid, fecha));
}
async function modalCierre(uid, fecha){
  const ci = cierreDe(uid, fecha);
  let r = ci && ci.resumen && Array.isArray(ci.resumen.pagaron) ? ci.resumen : null;
  if(!r){ r = Object.assign(resumenCierre(uid, fecha), listasDia(uid, fecha)); Object.assign(r, await resumenRecorrido(uid, fecha)); }
  const tot = (l,k) => (l||[]).reduce((s,x)=>s+(Number(x[k])||0),0);
  const pag = r.pagaron||[], pen = r.pendientes||[];
  openModal(`<div class="row" style="margin-bottom:6px"><h3 style="margin:0">${ci?'Cierre':'Día'} de ${esc(nombreRuta(uid))} · ${fdate(fecha)}</h3><span class="spacer"></span><button class="btn sm ghost" onclick="closeModal()">✕</button></div>
    <p class="muted" style="margin:0 0 12px">${ci?`Cerrada a las ${new Date(ci.cerradoEn).toLocaleTimeString('es-CO',{hour:'numeric',minute:'2-digit'})}`:'La ruta todavía no ha cerrado este día: estos datos son en vivo.'}</p>
    <div class="calcbox" style="margin-bottom:12px">
      <div><div class="l">Cobrado en efectivo</div><div class="v">${fmt(r.cobrado||0)}</div></div>
      <div><div class="l">Prestado y renovado</div><div class="v">${fmt(r.prestado||0)}</div></div>
      <div><div class="l">Transferencias</div><div class="v">${fmt(r.transferencias||0)}</div></div>
      <div><div class="l">Gastos</div><div class="v">${fmt(r.gastos||0)}</div></div>
      <div><div class="l">Debe tener en efectivo</div><div class="v">${fmt(r.saldoFinal||0)}</div></div>
    </div>
    <div class="card pad" style="margin-bottom:12px;background:var(--panel-2)"><div class="row"><b>Recorrido del día</b><span class="spacer"></span>${r.rPuntos?`<span class="muted">${r.rKm||0} km · ${esc(r.rDesde||'')} a ${esc(r.rHasta||'')} · ${r.rPuntos} puntos</span>`:'<span class="muted">Sin recorrido GPS ese día</span>'}
      ${r.rPuntos&&isAdmin()?`<button class="btn sm" onclick="closeModal();go('mapa',{ruta:'${uid}',fecha:'${fecha}'})">Ver en el mapa</button>`:''}</div></div>
    <div class="grid2" style="gap:12px">
      <div class="card pad" style="background:var(--panel-2)"><div class="row" style="margin-bottom:8px"><b>Pagaron</b><span class="pill p-ok">${pag.length}</span><span class="spacer"></span><b>${fmt(tot(pag,'m'))}</b></div>
        ${pag.length?`<div class="tablewrap" style="max-height:300px"><table><tbody>${pag.map(x=>`<tr><td>${esc(x.c)}</td><td class="muted" style="font-size:12px">${esc(x.h||'')}${x.t==='T'?' · transf.':''}</td><td class="num">${fmt(x.m)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted" style="margin:0">Nadie pagó este día.</p>'}</div>
      ${seccionPrestadoDia(uid, fecha)}
      <div class="card pad" style="background:var(--panel-2)"><div class="row" style="margin-bottom:8px"><b>Quedaron pendientes</b><span class="pill p-mora">${pen.length}</span><span class="spacer"></span><b style="color:var(--red)">${fmt(tot(pen,'d'))}</b></div>
        ${pen.length?`<div class="tablewrap" style="max-height:300px"><table><tbody>${pen.map(x=>`<tr><td>${esc(x.c)}<div class="muted" style="font-size:12px">${esc(x.r||'')}</div></td><td class="num">${fmt(x.d)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted" style="margin:0">Todos pagaron. 🎉</p>'}</div>
    </div>
    <div class="actions"><button class="btn" onclick="closeModal()">Cerrar</button></div>`, true);
}
async function cerrarMiRuta(){
  const fecha = todayStr();
  if(cierreDe(ME.uid, fecha)) return avisar('Tu ruta de hoy ya está cerrada.');
  if(!aperturaDe(ME.uid, fecha)) return avisar('Tu ruta de hoy no está abierta todavía.');
  // no se puede cerrar mientras queden clientes sin pago ni visita registrada
  const faltan = faltanPorVisitar(ME.uid, fecha);
  if(faltan.length){
    const nombres = faltan.slice(0,15).map(c=>'• '+nombreCliente(c.p.clienteId)).join('\n') + (faltan.length>15?`\n… y ${faltan.length-15} más`:'');
    if(view!=='cobros' || viewState.tab==='hechos') go('cobros', {tab:'pend'});
    return avisar(`Todavía no puedes cerrar la ruta: ${faltan.length===1?'te falta 1 cliente':`te faltan ${faltan.length} clientes`} por visitar.\n\n${nombres}\n\nA cada uno regístrale el pago o márcalo como "No pagó".`);
  }
  const r = resumenCierre(ME.uid, fecha);
  if(!await confirmar(`Cerrar la ruta de hoy\n\nCobrado en efectivo: ${fmt(r.cobrado)} (${r.pagos} pagos)\nPor transferencia: ${fmt(r.transferencias)}\nGastos: ${fmt(r.gastos)}\nPrestado: ${fmt(r.prestado)}\nDebes tener en efectivo: ${fmt(r.saldoFinal)}\n\nDespués de cerrar no podrás registrar más cobros hoy.`, {ok:'Cerrar ruta'})) return;
  const rc = await resumenCierreCompleto(ME.uid, fecha);       // guarda quién pagó, quién quedó pendiente y el recorrido del día
  S.set('cierres', idCierre(ME.uid, fecha), {cobradorId:ME.uid, fecha, cerradoEn:Date.now(), resumen:rc}).catch(falloNube);
  DB.cierres.push({id:idCierre(ME.uid, fecha), cobradorId:ME.uid, fecha, cerradoEn:Date.now(), resumen:rc});
  if(typeof GPS!=='undefined' && GPS.activo) detenerJornada(true);
  render(); toast('Ruta cerrada');
}
async function cerrarRutaOficina(uid, fecha){
  if(cierreDe(uid, fecha)) return;
  if(!await confirmar(`¿Cerrar ${nombreRuta(uid)} del ${fdate(fecha)}? La ruta ya no podrá registrar movimientos ese día.`, {ok:'Cerrar ruta'})) return;
  const r = await resumenCierreCompleto(uid, fecha);
  S.set('cierres', idCierre(uid, fecha), {cobradorId:uid, fecha, cerradoEn:Date.now(), resumen:r}).catch(falloNube);
  DB.cierres.push({id:idCierre(uid, fecha), cobradorId:uid, fecha, cerradoEn:Date.now(), resumen:r});
  render(); toast('Ruta cerrada');
}
async function reabrirRuta(uid, fecha){
  if(!isAdmin()) return avisar('Solo la oficina puede reabrir una ruta cerrada.');
  const hoy = fecha===todayStr();
  if(!await confirmar(`¿Reabrir ${nombreRuta(uid)} del ${fdate(fecha)}?\n\n${hoy ? 'El cobrador podrá volver a registrar cobros, gastos y créditos de hoy. Al terminar debe cerrarla otra vez.' : 'Como es un día anterior, lo que falte (un pago, un gasto…) lo registras tú desde la oficina con esa fecha. Luego la vuelves a cerrar desde el historial de cuadres.'}`, {ok:'Reabrir'})) return;
  const ci = cierreDe(uid, fecha);
  if(typeof auditar==='function') auditar('reabrir', 'cierres', idCierre(uid, fecha), `${nombreRuta(uid)} del ${fecha}`+(ci&&ci.resumen?` (cerrada con ${fmt(ci.resumen.saldoFinal||0)} en efectivo)`:''));
  dbDel('cierres', idCierre(uid, fecha)); render(); toast('Ruta reabierta');
}

/* ---------- historial: el cuadre de cada día queda guardado ----------
   Un día cerrado muestra lo que quedó guardado al cerrar; uno sin cerrar se calcula en vivo. */
function diasDeRuta(uid, desde){
  const f = new Set([...(DB.aperturas||[]).filter(a=>a.cobradorId===uid).map(a=>a.fecha), ...DB.cierres.filter(c=>c.cobradorId===uid).map(c=>c.fecha)]);
  return [...f].filter(x=>x && x>=desde).sort().reverse();
}
function filaHistorial(uid, fecha){
  const ci = cierreDe(uid, fecha), r = ci && ci.resumen ? ci.resumen : resumenCierre(uid, fecha);
  const hora = t => t ? new Date(t).toLocaleTimeString('es-CO',{hour:'numeric',minute:'2-digit'}) : '';
  const estado = ci ? `<span class="pill p-ok">Cerrada ${hora(ci.cerradoEn)}</span>`
    : fecha===todayStr() ? '<span class="pill p-hoy">Abierta</span>' : '<span class="pill p-mora">Sin cerrar</span>';
  const acciones = `<button class="btn sm" onclick="modalCierre('${uid}','${fecha}')">Ver</button>`
    + (isAdmin() ? (ci ? ` <button class="btn sm ghost" onclick="reabrirRuta('${uid}','${fecha}')">Reabrir</button>` : ` <button class="btn sm ghost" onclick="cerrarRutaOficina('${uid}','${fecha}')">Cerrar</button>`) : '');
  return {r, ci, html:`<tr><td style="white-space:nowrap"><b>${fdate(fecha)}</b><div class="muted" style="font-size:12px">${diaSem(fecha)}</div></td>${isAdmin()&&cobradores().length>1?`<td>${esc(nombreRuta(uid))}</td>`:''}<td>${estado}</td>
    <td class="num">${fmt(r.cobrado||0)}</td><td class="num">${fmt(r.transferencias||0)}</td><td class="num">${fmt(r.prestado||0)}</td><td class="num">${fmt(r.gastos||0)}</td><td class="num">${fmt(r.entregado||0)}</td>
    <td class="num"><b>${fmt(r.saldoFinal||0)}</b></td><td class="right" style="white-space:nowrap">${acciones}</td></tr>`};
}
function historialCuadres(){
  const meses = Number(viewState.hm)||1;
  const desde = ymd(new Date(Date.now() - meses*31*864e5));
  const rutaSel = isAdmin() ? (viewState.hr||'') : ME.uid;
  const rutas = isAdmin() ? cobradores().filter(u=>!rutaSel || u.id===rutaSel).map(u=>u.id) : [ME.uid];
  const filas = rutas.flatMap(uid=>diasDeRuta(uid, desde).map(f=>({uid, f}))).sort((a,b)=>b.f.localeCompare(a.f) || nombreRuta(a.uid).localeCompare(nombreRuta(b.uid)));
  const hs = filas.map(x=>filaHistorial(x.uid, x.f));
  const sinCerrar = hs.filter((h,i)=>!h.ci && filas[i].f<todayStr()).length;
  const sel = isAdmin() && cobradores().length>1 ? `<select class="input" style="width:auto" onchange="go('cuadre',Object.assign({},viewState,{hr:this.value}))"><option value="">Todas las rutas</option>${cobradores().map(u=>`<option value="${u.id}" ${rutaSel===u.id?'selected':''}>${esc(rutaCompleta(u))}</option>`).join('')}</select>` : '';
  return `<div class="card pad" style="margin-top:16px"><div class="row" style="margin-bottom:8px"><h2 style="margin:0">Cuadres guardados por día</h2><span class="spacer"></span>${sel}
    <select class="input" style="width:auto" onchange="go('cuadre',Object.assign({},viewState,{hm:this.value}))">${[[1,'Último mes'],[3,'3 meses'],[12,'Este año']].map(([v,t])=>`<option value="${v}" ${meses===v?'selected':''}>${t}</option>`).join('')}</select></div>
    ${sinCerrar?`<div class="banner" style="margin:0 0 10px">${sinCerrar} día(s) quedaron sin cerrar.${isAdmin()?' Revísalos y ciérralos con “Cerrar”.':''}</div>`:''}
    ${filas.length ? `<div class="tablewrap"><table><thead><tr><th>Día</th>${isAdmin()&&cobradores().length>1?'<th>Ruta</th>':''}<th>Estado</th><th class="num">Cobrado efectivo</th><th class="num">Transferencias</th><th class="num">Prestado</th><th class="num">Gastos</th><th class="num">Entregó</th><th class="num">Debía tener</th><th></th></tr></thead>
      <tbody>${hs.map(h=>h.html).join('')}</tbody></table></div>
      <p class="muted" style="font-size:12px;margin:8px 0 0">El día cerrado muestra lo que quedó guardado al cerrar. ${isAdmin()?'Si hay que corregir algo, reábrelo, registra lo que falta con esa fecha y vuelve a cerrarlo.':'Si te faltó algo, pídele a la oficina que reabra ese día.'}</p>`
      : '<div class="empty">Todavía no hay días registrados en este periodo.</div>'}</div>`;
}

/* ---------- enrutar: orden de visita ---------- */
let ORDEN_TMP = [];
function clientesDeRuta(uid){
  return DB.clientes.filter(c=>c.cobradorId===uid && DB.prestamos.some(p=>p.clienteId===c.id && estadoPrestamo(p).estado!=='Pagado'));
}
const porOrden = (a,b) => (Number(a.orden)||1e9) - (Number(b.orden)||1e9) || (a.nombre||'').localeCompare(b.nombre||'');
function modalEnrutar(uid){
  uid = uid || (isAdmin() ? (viewState.cob && viewState.cob!=='_yo' ? viewState.cob : (cobradores()[0]||{}).id) : ME.uid);
  if(!uid) return avisar('Primero crea una ruta.');
  ORDEN_TMP = clientesDeRuta(uid).sort(porOrden).map(c=>c.id);
  const sel = isAdmin() ? `<select class="input" style="width:auto" onchange="modalEnrutar(this.value)">${cobradores().map(u=>`<option value="${u.id}" ${u.id===uid?'selected':''}>${esc(rutaCompleta(u))}</option>`).join('')}</select>` : '';
  openModal(`<h3>Orden de visita · ${esc(nombreRuta(uid))}</h3>
  <p class="muted" style="margin-top:-8px">Así aparecen los clientes en la ruta del día. Muévelos con las flechas o ordénalos por cercanía.</p>
  <div class="row" style="margin-bottom:10px">${sel}<button class="btn sm" onclick="ordenarCercania()">Ordenar por cercanía (GPS)</button></div>
  <div id="ordenLista" class="orden-lista"></div>
  <div class="actions"><button class="btn" onclick="closeModal()">Cancelar</button><button class="btn pri" onclick="guardarOrden()">Guardar orden</button></div>`, true);
  pintarOrden();
}
function pintarOrden(){
  const box = document.getElementById('ordenLista'); if(!box) return;
  if(!ORDEN_TMP.length){ box.innerHTML = '<div class="empty">Esta ruta no tiene clientes con créditos activos.</div>'; return; }
  box.innerHTML = ORDEN_TMP.map((id,i)=>{ const c=clienteById(id)||{}; return `<div class="orden-item"><b class="orden-n">${i+1}</b><div style="min-width:0;flex:1"><b>${esc(c.nombre)}</b><div class="muted" style="font-size:12px">${esc(c.direccion||'')}${tieneUbic(c)?'':' · sin ubicación'}</div></div>
    <button class="btn sm ghost" ${i?'':'disabled'} onclick="moverOrden(${i},-1)">↑</button><button class="btn sm ghost" ${i<ORDEN_TMP.length-1?'':'disabled'} onclick="moverOrden(${i},1)">↓</button></div>`; }).join('');
}
function moverOrden(i, d){ const j=i+d; if(j<0||j>=ORDEN_TMP.length) return; [ORDEN_TMP[i],ORDEN_TMP[j]]=[ORDEN_TMP[j],ORDEN_TMP[i]]; pintarOrden(); }
async function ordenarCercania(){
  toast('Buscando tu ubicación…');
  let pos = await posicionActual(8000);
  const con = ORDEN_TMP.map(id=>clienteById(id)).filter(tieneUbic), sin = ORDEN_TMP.filter(id=>!tieneUbic(clienteById(id)));
  if(!con.length) return avisar('Ningún cliente de esta ruta tiene ubicación guardada todavía.');
  if(!pos) pos = con[0];
  const out=[]; let cur=pos; const rest=[...con];
  while(rest.length){ let bi=0, bd=Infinity; rest.forEach((c,i)=>{ const d=distM(cur,c); if(d<bd){bd=d;bi=i;} }); cur=rest.splice(bi,1)[0]; out.push(cur.id); }
  ORDEN_TMP = out.concat(sin); pintarOrden();
}
function guardarOrden(){
  ORDEN_TMP.forEach((id,i)=>{ const c=clienteById(id); if(c && Number(c.orden)!==i+1) dbUpd('clientes', id, {orden:i+1}); });
  closeModal(); render(); toast('Orden de la ruta guardado');
}

/* ---------- crédito nuevo desde la ruta (con tope y aprobación) ---------- */
function puedePrestarRuta(){ return !isAdmin() && !!rutaCfg(ME.uid).puedePrestar; }
function tarjetaAprobacion(a){
  const est = {pendiente:'<span class="pill p-hoy">Pendiente</span>', aprobada:'<span class="pill p-ok">Aprobada</span>', rechazada:'<span class="pill p-mora">Rechazada</span>'}[a.estado]||'';
  const k = (a.cuotas ? calcularCuotas(a.monto, a.tasa, a.cuotas, a.periodo, a.modoInteres||'mensual') : calcular(a.monto, a.tasa, a.meses, a.periodo));
  return `<div class="card cobro">
    <div class="who">${ava(nombreCliente(a.clienteId))}<div style="min-width:0;flex:1"><b>${esc(nombreCliente(a.clienteId))}</b><div class="muted" style="font-size:12.5px">Crédito nuevo · ${esc(nombreRuta(a.cobradorId))} · ${fdate(a.fecha)}</div></div>${est}</div>
    <div class="cobro-nums"><div><span>Monto</span><b>${fmt(a.monto)}</b></div><div><span>Interés</span><b>${fmtN(a.tasa)}% · ${k.cuotas} ${(UNIDAD_CUOTA[a.periodo]||['',''])[1]}</b></div><div><span>Cuota</span><b>${fmt(k.valorCuota)}</b></div></div>
    <div class="muted" style="font-size:12.5px">Tope de la ruta: ${fmt(rutaCfg(a.cobradorId).maxPrestamo||0)}${a.periodo==='SEMANAL'&&a.primeraCuota?` · paga ${losDias(parseD(a.primeraCuota).getDay())}`:''}${a.nota?' · '+esc(a.nota):''}</div>
    ${a.estado==='pendiente'&&isAdmin()?`<div class="row"><button class="btn sm danger" onclick="responderAprobacion('${a.id}',false)">Rechazar</button><span class="spacer"></span><button class="btn sm pri" onclick="responderAprobacion('${a.id}',true)">Aprobar crédito</button></div>`:''}
  </div>`;
}
async function responderAprobacion(id, ok){
  const a = DB.aprobaciones.find(x=>x.id===id); if(!a || a.estado!=='pendiente') return;
  if(!ok){ if(!await confirmar('¿Rechazar esta solicitud de crédito?', {peligro:true, ok:'Rechazar'})) return;
    dbUpd('aprobaciones', id, {estado:'rechazada', revisadoPor:ME.uid, revisadoEn:Date.now()}); render(); return; }
  if(a.periodo==='SEMANAL') return modalAprobarSemanal(a);
  if(!await confirmar(`¿Aprobar el crédito de ${fmt(a.monto)} para ${nombreCliente(a.clienteId)}? La ruta entrega la plata y se descuenta de su caja.`, {ok:'Aprobar'})) return;
  aprobarCredito(a);
}
/* semanal: al aprobar, la oficina confirma o cambia el día de pago que escogió la ruta */
function modalAprobarSemanal(a){
  const hoy = todayStr();
  openModal(`<h3>Aprobar crédito · ${esc(nombreCliente(a.clienteId))}</h3>
  <p class="muted" style="margin-top:-8px">${fmt(a.monto)} semanal · ${esc(nombreRuta(a.cobradorId))}. La ruta entrega la plata y se descuenta de su caja.${a.primeraCuota?` La ruta pidió que pague <b>${losDias(parseD(a.primeraCuota).getDay())}</b>.`:''}</p>
  <div class="form"><div class="f full" style="display:block">${htmlDiaSemanal('aS')}<div class="muted" style="font-size:12px;margin-top:4px">Todas las cuotas quedan ese día de la semana.</div></div></div>
  <div class="actions"><button class="btn" onclick="closeModal()">Cancelar</button><button class="btn pri" id="aSOk">Aprobar crédito</button></div>`);
  const pri = activarDiaSemanal('aS', hoy, a.primeraCuota && a.primeraCuota>hoy ? a.primeraCuota : (a.primeraCuota ? primeraSemanalDefecto(hoy, parseD(a.primeraCuota).getDay()) : ''));
  document.getElementById('aSOk').onclick = ()=>{ const f = pri(); closeModal(); aprobarCredito(a, f); };
}
function aprobarCredito(a, priElegida){
  if(!a || a.estado!=='pendiente') return;
  const k = (a.cuotas ? calcularCuotas(a.monto, a.tasa, a.cuotas, a.periodo, a.modoInteres||'mensual') : calcular(a.monto, a.tasa, a.meses, a.periodo));
  const pid = a.prestamoId || S.newId('prestamos');
  // si la ruta escogió día de pago (semanal), se respeta; si esa fecha ya pasó, se toma el mismo día de la semana siguiente
  const priAp = priElegida ? priElegida : a.periodo==='SEMANAL' && a.primeraCuota ? (a.primeraCuota>todayStr() ? a.primeraCuota : primeraSemanalDefecto(todayStr(), parseD(a.primeraCuota).getDay())) : '';
  const obj = {...(priAp && priAp!==ymd(addPeriodo(parseD(todayStr()),'SEMANAL')) ? {primeraCuota:priAp} : {}), clienteId:a.clienteId, fecha:todayStr(), monto:a.monto, tasa:a.tasa, meses:k.meses||a.meses, periodo:a.periodo, modoInteres:a.modoInteres||'mensual', excluirDomingos:!!a.excluirDomingos,
    nota:a.nota||'', cuotas:k.cuotas, valorCuota:k.valorCuota, interesMes:k.interesMes, total:k.total, cobradorId:a.cobradorId, fuente:'ruta', creado:Date.now(), creadoPor:ME.uid};
  DB.prestamos.push(Object.assign({id:pid}, obj)); S.set('prestamos', pid, obj).catch(falloNube);
  dbUpd('aprobaciones', a.id, {estado:'aprobada', prestamoId:pid, revisadoPor:ME.uid, revisadoEn:Date.now()});
  render(); toast('Crédito aprobado');
}

/* ---------- recibo de pago ---------- */
/* datos del recibo tal como quedaron en el momento de ese pago */
function datosRecibo(pagoId){
  const x = DB.pagos.find(y=>y.id===pagoId); if(!x) return null;
  const p = DB.prestamos.find(y=>y.id===x.prestamoId)||{}, c = clienteById(p.clienteId)||{};
  const orden = pagosDe(p.id).slice().sort((a,b)=>a.fecha.localeCompare(b.fecha) || (a.creado||0)-(b.creado||0));
  let antes = 0; for(const y of orden){ if(y.id===x.id) break; antes += y.monto; }
  const vc = Number(p.valorCuota)||0, n = Number(p.cuotas)||0, base = vc*n, desp = antes + x.monto;
  let cuotaTxt = '';
  if(vc>0 && n>0){
    const desde = Math.min(n, Math.floor(antes/vc + 1e-6) + 1), hasta = Math.min(n, Math.max(desde, Math.ceil(desp/vc - 1e-6)));
    const parcial = desp < base - 0.5 && (desp % vc) > 0.5;
    cuotaTxt = desde===hasta ? `Cuota ${desde} de ${n}${parcial?' (abono parcial)':''}` : `Cuotas ${desde} a ${hasta} de ${n}${parcial?' (la última con abono parcial)':''}`;
    if(antes >= base - 0.5) cuotaTxt = 'Abono a multas';
  }
  const e = estadoPrestamo(p);
  return { x, p, c, negocio: nombreNegocio(), numero: String(x.id).slice(-6).toUpperCase(),
    fecha: fdate(x.fecha), hora: x.creado ? new Date(x.creado).toLocaleTimeString('es-CO',{hour:'numeric',minute:'2-digit'}) : '',
    monto: x.monto, medio: x.medio==='transferencia'?'Transferencia':'Efectivo', cuotaTxt, valorCuota: vc,
    cuotasPagadas: Math.min(n, Math.floor(desp/vc + 1e-6) || 0), cuotas: n,
    saldo: Math.max(0, base - desp), multa: e.multaPend||0, recibio: nombreUsuario(x.registradoPor), mensaje: DB.config.mensajeRecibo||'' };
}
function textoRecibo(pagoId){
  const d = datosRecibo(pagoId); if(!d) return '';
  return `*${d.negocio}* — Recibo de pago Nº ${d.numero}\n`+
    `Cliente: ${d.c.nombre||''}${d.c.cedula?' · CC '+d.c.cedula:''}\nFecha: ${d.fecha}${d.hora?' '+d.hora:''}\n\n`+
    `*Valor pagado: ${fmt(d.monto)}* (${d.medio.toLowerCase()})\n${d.cuotaTxt?d.cuotaTxt+'\n':''}Valor de la cuota: ${fmt(d.valorCuota)}\n`+
    `Cuotas pagadas: ${d.cuotasPagadas} de ${d.cuotas}\n*Saldo del crédito: ${fmt(d.saldo)}*\n${d.multa>0.5?`Multas pendientes: ${fmt(d.multa)}\n`:''}`+
    `Recibió: ${d.recibio}\n${d.mensaje?'\n'+d.mensaje:''}`;
}
function modalRecibo(pagoId){
  const d = datosRecibo(pagoId); if(!d) return;
  const t = textoRecibo(pagoId);
  openModal(`<h3>Pago registrado · recibo Nº ${esc(d.numero)}</h3>
  <div class="row" style="align-items:center;gap:10px;margin:-4px 0 10px">${LOGO?`<img src="${LOGO}" alt="" style="width:44px;height:44px;object-fit:contain;border-radius:8px;background:#fff;padding:3px">`:''}<b>${esc(d.negocio)}</b></div><div style="text-align:center;background:var(--panel-2);border-radius:12px;padding:10px;max-height:52vh;overflow:auto"><img id="rcImg" alt="Recibo" style="max-width:100%;width:420px;border-radius:6px"></div>
  <div class="form" style="margin-top:12px">
    <label class="f full">WhatsApp del cliente<div class="row" style="flex-wrap:nowrap"><input class="input" id="rcTel" inputmode="tel" value="${esc(d.c.tel1||'')}" placeholder="Número de WhatsApp"><button class="btn pri" id="rcWa" style="white-space:nowrap">Enviar por WhatsApp</button></div></label>
    <label class="f full">Correo<div class="row" style="flex-wrap:nowrap"><input class="input" id="rcMail" type="email" value="${esc(d.c.email||'')}" placeholder="correo@ejemplo.com"><button class="btn" id="rcCo" style="white-space:nowrap">Enviar por correo</button></div></label>
    <label class="chk full" id="rcGuardW" style="display:none"><input type="checkbox" id="rcGuard" checked> Guardar estos datos en la ficha del cliente</label>
  </div>
  <div class="actions"><button class="btn" onclick="closeModal()">Listo</button>
  ${d.x.comprobante?`<button class="btn" onclick="verComprobante('${pagoId}')">Ver comprobante</button>`:''}
  <button class="btn" onclick="descargarRecibo('${pagoId}')">${isNative()||movil()?'Enviar recibo en foto':'Descargar recibo'}</button>
  <button class="btn" onclick="compartirRecibo('${pagoId}')">Compartir</button></div>`);
  const $=k=>document.getElementById(k);
  const pinta=()=>{ const im=$('rcImg'); if(im) im.src=imagenRecibo(pagoId); }; pinta(); if(LOGO && !LOGO_IMG) setTimeout(pinta, 400);
  const cambio=()=>{ const ch = $('rcTel').value.trim()!==(d.c.tel1||'') || $('rcMail').value.trim().toLowerCase()!==(d.c.email||''); $('rcGuardW').style.display = ch && d.c.id ? '' : 'none'; };
  ['rcTel','rcMail'].forEach(k=>$(k).addEventListener('input',cambio));
  const guardar=()=>{ if(!d.c.id || $('rcGuardW').style.display==='none' || !$('rcGuard').checked) return;
    const upd={}; const tel=$('rcTel').value.trim(), mail=$('rcMail').value.trim().toLowerCase();
    if(tel && tel!==(d.c.tel1||'')) upd.tel1=tel.slice(0,40); if(mail && emailOk(mail) && mail!==(d.c.email||'')) upd.email=mail.slice(0,120);
    if(Object.keys(upd).length) dbUpd('clientes', d.c.id, upd); };
  $('rcWa').onclick=()=>{ const wa=telWa($('rcTel').value); if(!wa) return toast('Escribe el número de WhatsApp');
    guardar(); window.open(`https://wa.me/${wa}?text=${encodeURIComponent(t)}`,'_blank'); };
  $('rcCo').onclick=()=>{ const m=$('rcMail').value.trim(); if(!emailOk(m)) return toast('Escribe un correo válido');
    guardar(); location.href = urlMail(m, 'Recibo de pago Nº '+d.numero+' — '+d.negocio, t.replace(/\*/g,'')); };
}
/* recibo como imagen (estilo recibo de caja: papel, marco, sello) para descargar o mandar como foto */
function imagenRecibo(pagoId){
  const d = datosRecibo(pagoId); if(!d) return '';
  const E = (typeof EMPRESA!=='undefined' && EMPRESA) || {};
  const sub = [E.nit?'NIT/CC '+E.nit:'', E.ciudad||'', E.telefono?'Tel. '+E.telefono:''].filter(Boolean).join('  ·  ');
  const filas = [['Cliente', d.c.nombre||''], ...(d.c.cedula?[['Cédula', d.c.cedula]]:[]), ['Fecha', d.fecha], ...(d.hora?[['Hora', d.hora]]:[]),
    ['Medio de pago', d.medio], ...(d.cuotaTxt?[['Concepto', d.cuotaTxt]]:[]), ['Valor de la cuota', fmt(d.valorCuota)], ['Cuotas pagadas', `${d.cuotasPagadas} de ${d.cuotas}`]];
  const W=760, PX=40, PW=W-PX*2, top=34;
  const logoH = LOGO_IMG ? 110 : 0;
  const cv=document.createElement('canvas'); let g;
  // se dibuja dos veces: la primera solo para medir el alto exacto del papel
  const dibujar = H => { cv.width=W; cv.height=H; g=cv.getContext('2d');
  const F='-apple-system,Segoe UI,Roboto,Arial,sans-serif', M='Menlo,Consolas,"Courier New",monospace';
  const centro=(t,y,font,col)=>{ g.font=font; g.fillStyle=col; g.fillText(t,(W-g.measureText(t).width)/2,y); };
  const ajusta=(t,max,peso,tam,fam)=>{ let f=tam; do{ g.font=`${peso} ${f}px ${fam}`; f--; }while(g.measureText(t).width>max && f>11); return g.font; };
  const linea=(y,dash)=>{ g.save(); g.strokeStyle='#9a9a9a'; g.lineWidth=2; if(dash) g.setLineDash([8,7]); g.beginPath(); g.moveTo(PX+30,y); g.lineTo(W-PX-30,y); g.stroke(); g.restore(); };
  // fondo y papel con bordes dentados arriba y abajo
  g.fillStyle='#e9e7e1'; g.fillRect(0,0,W,H);
  const paper=()=>{ g.beginPath(); const z=12, y0=top, y1=H-top; g.moveTo(PX,y0);
    for(let x=PX;x<W-PX;x+=z*2){ g.lineTo(x+z,y0-z*0.9); g.lineTo(Math.min(x+z*2,W-PX),y0); }
    g.lineTo(W-PX,y1); for(let x=W-PX;x>PX;x-=z*2){ g.lineTo(x-z,y1+z*0.9); g.lineTo(Math.max(x-z*2,PX),y1); } g.closePath(); };
  g.save(); g.shadowColor='rgba(0,0,0,.18)'; g.shadowBlur=18; g.shadowOffsetY=6; g.fillStyle='#fffdf8'; paper(); g.fill(); g.restore();
  // marco doble
  g.strokeStyle='#1d1f22'; g.lineWidth=3; g.strokeRect(PX+14, top+14, PW-28, H-top*2-28);
  g.strokeStyle='#1d1f22'; g.lineWidth=1; g.strokeRect(PX+21, top+21, PW-42, H-top*2-42);
  let y = top + 44;
  if(LOGO_IMG){ const L=96, k=Math.min(L/LOGO_IMG.width, (L)/LOGO_IMG.height), w=LOGO_IMG.width*k, h=LOGO_IMG.height*k; g.drawImage(LOGO_IMG,(W-w)/2,y+(L-h)/2,w,h); y += logoH; }
  centro(d.negocio.toUpperCase(), y+30, ajusta(d.negocio.toUpperCase(), PW-90, '800', 34, F), '#111');
  y += 30; if(sub){ centro(sub, y+28, ajusta(sub, PW-90, '500', 18, F), '#555'); y += 30; }
  y += 30; linea(y);
  centro('RECIBO DE CAJA', y+44, `800 28px ${F}`, '#111');
  g.font=`600 19px ${M}`; g.fillStyle='#b3261e'; const nro='Nº '+d.numero; g.fillText(nro, W-PX-44-g.measureText(nro).width, y+44);
  y += 70; linea(y, true); y += 40;
  for(const [k,v] of filas){
    g.font=`500 20px ${F}`; g.fillStyle='#555'; g.fillText(k, PX+44, y);
    const vv=String(v); g.font=ajusta(vv, PW-300, '600', 21, F); g.fillStyle='#111'; g.fillText(vv, W-PX-44-g.measureText(vv).width, y);
    g.save(); g.strokeStyle='#e2ded4'; g.lineWidth=1; g.beginPath(); g.moveTo(PX+44,y+16); g.lineTo(W-PX-44,y+16); g.stroke(); g.restore();
    y += 46;
  }
  y += 14;
  // caja del total
  g.fillStyle='#111214'; const bx=PX+40, bw=PW-80, bh=96;
  if(g.roundRect){ g.beginPath(); g.roundRect(bx,y,bw,bh,10); g.fill(); } else g.fillRect(bx,y,bw,bh);
  g.font=`600 20px ${F}`; g.fillStyle='#c8f169'; g.fillText('VALOR PAGADO', bx+26, y+40);
  g.font=`500 16px ${F}`; g.fillStyle='#bbb'; g.fillText(d.medio, bx+26, y+68);
  const tot=fmt(d.monto); g.font=ajusta(tot, bw-260, '800', 46, F); g.fillStyle='#fff'; g.fillText(tot, bx+bw-26-g.measureText(tot).width, y+64);
  y += bh + 40;
  g.font=`600 22px ${F}`; g.fillStyle='#333'; g.fillText('Saldo del crédito', PX+44, y);
  const sal=fmt(d.saldo); g.font=`800 26px ${F}`; g.fillStyle='#111'; g.fillText(sal, W-PX-44-g.measureText(sal).width, y);
  y += 18;
  if(d.multa>0.5){ y+=30; g.font=`500 18px ${F}`; g.fillStyle='#8a6d00'; g.fillText('Multas pendientes (aparte)', PX+44, y); const m=fmt(d.multa); g.fillText(m, W-PX-44-g.measureText(m).width, y); y+=10; }
  y += 22; linea(y, true);
  // sello PAGADO
  g.save(); g.translate(W-PX-150, y+70); g.rotate(-0.22); g.globalAlpha=0.82; g.strokeStyle='#2e7d32'; g.lineWidth=4;
  if(g.roundRect){ g.beginPath(); g.roundRect(-95,-34,190,68,8); g.stroke(); } else g.strokeRect(-95,-34,190,68);
  g.lineWidth=1.5; g.strokeRect(-88,-27,176,54); g.font=`900 34px ${F}`; g.fillStyle='#2e7d32'; const st='PAGADO'; g.fillText(st,-g.measureText(st).width/2,12); g.restore();
  // firma
  g.save(); g.strokeStyle='#333'; g.lineWidth=1.5; g.beginPath(); g.moveTo(PX+50,y+92); g.lineTo(PX+330,y+92); g.stroke(); g.restore();
  g.font=`600 18px ${F}`; g.fillStyle='#111'; g.fillText(d.recibio||'', PX+50, y+84);
  g.font=`500 15px ${F}`; g.fillStyle='#666'; g.fillText('Recibió', PX+50, y+114);
  y += 170;
  if(d.mensaje){ centro(d.mensaje.slice(0,70), y, ajusta(d.mensaje.slice(0,70), PW-100, 'italic 500', 19, F), '#444'); y += 36; }
  centro('Conserve este recibo como soporte de su pago', y, `500 15px ${F}`, '#777');
  return y; };
  const alto = dibujar(2400);
  dibujar(alto + 30 + top + 22);
  return cv.toDataURL('image/png');
}
async function descargarRecibo(pagoId){
  const url = imagenRecibo(pagoId); if(!url) return;
  const d = datosRecibo(pagoId), nombre = `recibo_${(d.c.nombre||'cliente').replace(/[^\wáéíóúñ]+/gi,'_')}_${d.x.fecha}.png`;
  if(isNative() && window.CapPlugins){
    try{ const {Filesystem, Share, Directory} = window.CapPlugins;
      const r = await Filesystem.writeFile({path:nombre, data:url.split(',')[1], directory:Directory.Cache});
      await Share.share({title:'Recibo de pago', url:r.uri}); return;
    }catch(e){ if(String(e).includes('cancel')) return; }
  }
  try{ const blob = await (await fetch(url)).blob(); const f = new File([blob], nombre, {type:'image/png'});
    if(navigator.canShare && navigator.canShare({files:[f]}) && movil()){ await navigator.share({files:[f], title:'Recibo de pago'}); return; } }catch(e){ if(String(e).includes('Abort')) return; }
  const a=document.createElement('a'); a.href=url; a.download=nombre; document.body.appendChild(a); a.click(); a.remove();
}
async function compartirRecibo(pagoId){
  const t = textoRecibo(pagoId);
  try{
    if(isNative() && window.CapPlugins && window.CapPlugins.Share){ await window.CapPlugins.Share.share({title:'Recibo de pago', text:t}); return; }
    if(navigator.share){ await navigator.share({title:'Recibo de pago', text:t}); return; }
  }catch(e){ return; }
  try{ await navigator.clipboard.writeText(t); toast('Recibo copiado'); }catch(e){ toast('No se pudo compartir'); }
}

/* ---------- configuración de la ruta (oficina) ---------- */
function bloqueCfgRuta(uid){
  const r = rutaCfg(uid);
  return `<div class="f full"><span>Permisos de la ruta</span>
    <label class="chk"><input type="checkbox" id="rPrest" ${r.puedePrestar?'checked':''}> Puede crear créditos en la calle</label>
    <label class="chk"><input type="checkbox" id="rDom" ${r.puedeDominical?'checked':''}> Puede dar día (dominical) a un cliente por fuerza mayor</label></div>
    <label class="f">Monto máximo por crédito<input class="input" id="rMax" inputmode="decimal" value="${r.maxPrestamo?fmtIn(r.maxPrestamo):''}" placeholder="Sin tope = pide aprobación siempre"></label>
    <label class="f">Gasto máximo por registro<input class="input" id="rGas" inputmode="decimal" value="${r.maxGasto?fmtIn(r.maxGasto):''}" placeholder="Sin límite"></label>`;
}
function guardarCfgRuta(uid){
  const el = document.getElementById('rPrest'); if(!el) return;
  const g = id => document.getElementById(id) ? document.getElementById(id).value : '';
  const dm = document.getElementById('rDom');
  const d = {cobradorId:uid, puedePrestar:el.checked, puedeDominical:!!(dm&&dm.checked), maxPrestamo:num(g('rMax')), maxGasto:num(g('rGas')),
    salario:num(g('rSal')), periodoPago:['SEMANAL','QUINCENAL','MENSUAL'].includes(g('rPer'))?g('rPer'):'QUINCENAL',
    pctRecaudo:Math.min(100,Math.max(0,num(g('rPR')))), pctVentas:Math.min(100,Math.max(0,num(g('rPV')))),
    maxCuotas:Math.max(0,Math.round(num(g('rMC')))), maxRenov:Math.max(0,Math.round(num(g('rMR')))), actualizado:Date.now()};
  S.set('rutas', uid, d).catch(falloNube);
  const i = DB.rutas.findIndex(x=>x.id===uid); if(i>=0) DB.rutas[i]=Object.assign({id:uid}, d); else DB.rutas.push(Object.assign({id:uid}, d));
}

/* ---------- ajustes del negocio relacionados ---------- */
function bloqueAjustesRuta(){
  const c = DB.config;
  return `<div class="card pad">
    <h2>País, moneda y rutas</h2>
    <div class="form">
      <label class="f full">País y moneda<select class="input" id="sPais">${Object.entries(MONEDAS).map(([k,m])=>`<option value="${k}" ${c.pais===k?'selected':''}>${m.pais} (${m.simbolo})</option>`).join('')}</select></label>
      <label class="f full">Si una ruta no abre un día<select class="input" id="sSinA"><option value="sumar" ${c.sinAbrir!=='correr'?'selected':''}>Las cuotas de ese día se suman al día siguiente (cuenta como mora)</option><option value="correr" ${c.sinAbrir==='correr'?'selected':''}>Ese día no cuenta: las cuotas se corren un día y no generan mora</option></select></label>
      <label class="chk full"><input type="checkbox" id="sSim" ${verSimbolo()?'checked':''}> Mostrar el símbolo de la moneda junto a cada valor (ej. ${esc(MON().simbolo)} 1.500)</label>
      <label class="f full">Conceptos de gasto de las rutas (uno por línea)<textarea class="input" id="sConG" rows="5">${esc((c.conceptosGasto||[]).join('\n'))}</textarea></label>
      <label class="f full">Conceptos de ingreso de las rutas (uno por línea)<textarea class="input" id="sConI" rows="3">${esc((c.conceptosIngreso||[]).join('\n'))}</textarea></label>
      <label class="f full">Mensaje al final del recibo de pago<input class="input" id="sMsg" value="${esc(c.mensajeRecibo||'')}" maxlength="300"></label>
    </div>
    <div class="actions row" style="margin-top:16px"><button class="btn pri" onclick="guardarAjustesRuta()">Guardar</button></div>
  </div>`;
}
function guardarAjustesRuta(){
  const lineas = id => document.getElementById(id).value.split('\n').map(x=>x.trim()).filter(Boolean).slice(0,40).map(x=>x.slice(0,40));
  DB.config.pais = document.getElementById('sPais').value;
  DB.config.verSimbolo = document.getElementById('sSim').checked;
  DB.config.sinAbrir = document.getElementById('sSinA').value==='correr' ? 'correr' : 'sumar';
  DB.config.conceptosGasto = lineas('sConG').length ? lineas('sConG') : defaultConfig().conceptosGasto;
  DB.config.conceptosIngreso = lineas('sConI').length ? lineas('sConI') : defaultConfig().conceptosIngreso;
  DB.config.mensajeRecibo = document.getElementById('sMsg').value.trim().slice(0,300);
  cfgSave(); render(); toast('Ajustes guardados');
}

/* ---------- pagos por transferencia y comprobantes ---------- */
const enEfectivo = x => efectivo(x) && x.medio !== 'transferencia';    // plata que queda en la mano de la ruta
const porTransferencia = x => efectivo(x) && x.medio === 'transferencia';
let COMP_TMP = '';
async function cargarComprobante(input){
  const f = input.files && input.files[0]; if(!f) return;
  const ok = document.getElementById('gCompOk'); if(ok) ok.textContent = 'Procesando…';
  try{ COMP_TMP = await comprimirFoto(f); if(ok){ ok.innerHTML = '<span style="color:var(--green)">Comprobante listo ✓</span>'; } }
  catch(e){ COMP_TMP=''; if(ok) ok.textContent = 'No se pudo leer la imagen'; }
}
function guardarComprobante(pagoId, prestamoId, cobradorId){
  const img = fotoSegura(COMP_TMP); COMP_TMP = '';
  if(!img) return;
  S.setComprobante(pagoId, {img, prestamoId, cobradorId, creado:Date.now(), creadoPor:ME.uid}).catch(falloNube);
}
async function verComprobante(pagoId){
  toast('Cargando comprobante…');
  const c = await S.getComprobante(pagoId);
  const v = c && fotoSegura(c.img);
  if(!v) return avisar('Este pago no tiene comprobante guardado.');
  const w = document.createElement('div'); w.className = 'foto-full';
  w.innerHTML = `<img src="${v}" alt="Comprobante">`; w.onclick = ()=>w.remove();
  document.body.appendChild(w);
}
const etiquetaMedio = x => x.medio==='transferencia'
  ? `<span class="pill p-pag">Transferencia</span>${x.comprobante?` <button class="btn sm ghost" onclick="event.stopPropagation();verComprobante('${x.id}')">Ver comprobante</button>`:' <span class="muted" style="font-size:12px">sin comprobante</span>'}`
  : '<span class="pill p-ok">Efectivo</span>';

/* ---------- análisis de rutas (solo CEO): plata, utilidad y crecimiento ---------- */
ICONS.analisis = '<path d="M4 20h16v2H4zM6 10h3v8H6zm5-6h3v14h-3zm5 9h3v5h-3z"/>';
const fraccionInteres = p => { const t = (Number(p.valorCuota)||0)*(Number(p.cuotas)||0); return t>0 ? Math.max(0,(t-p.monto)/t) : 0; };
function metricasRuta(uid, desde, hasta){
  const enR = f => f && f>=desde && f<=hasta;
  const prest = DB.prestamos.filter(p=>p.cobradorId===uid);
  const ids = new Set(prest.map(p=>p.id));
  const pagos = DB.pagos.filter(x=>ids.has(x.prestamoId) && efectivo(x) && enR(x.fecha));
  let cobrado=0, intereses=0, transf=0;
  for(const x of pagos){ const p=prest.find(y=>y.id===x.prestamoId); cobrado+=x.monto; intereses+=x.monto*fraccionInteres(p); if(x.medio==='transferencia') transf+=x.monto; }
  const gastos = DB.movruta.filter(m=>m.cobradorId===uid && m.tipo==='gasto' && enR(m.fecha)).reduce((s,m)=>s+m.valor,0)
    + DB.salidas.filter(m=>m.cobradorId===uid && enR(m.fecha)).reduce((s,m)=>s+m.valor,0);       // gastos que la oficina le cargó a la ruta
  const ingresos = DB.movruta.filter(m=>m.cobradorId===uid && m.tipo==='ingreso' && enR(m.fecha)).reduce((s,m)=>s+m.valor,0)
    + DB.ingresos.filter(m=>m.cobradorId===uid && enR(m.fecha)).reduce((s,m)=>s+m.valor,0);
  const nuevos = prest.filter(p=>enR(p.fecha) && !p.importado && !p.renovacionDe);
  return { cobrado, transf, intereses, gastos, ingresos, utilidad: intereses + ingresos - gastos, prestado: nuevos.reduce((s,p)=>s+p.monto,0), nNuevos: nuevos.length };
}
function estadoCarteraRuta(uid){
  let cartera=0, activos=0, mora=0, enMora=0, multas=0;
  for(const p of DB.prestamos.filter(p=>p.cobradorId===uid)){
    const e = estadoPrestamo(p); if(e.estado==='Pagado' || e.estado==='Castigado') continue;
    cartera+=e.saldoCuotas; multas+=e.multaPend; activos++; if(e.estado==='En mora'){ mora+=e.atrasoMora; enMora++; }
  }
  return { cartera, multas, activos, mora, enMora, enMano: cuadreCobrador(uid).enMano };
}
function rangoPeriodo(k){
  const h = new Date(), y=h.getFullYear(), m=h.getMonth();
  const r = (a,b)=>[ymd(a), ymd(b)];
  if(k==='mes') return { act:r(new Date(y,m,1), h), ant:r(new Date(y,m-1,1), new Date(y,m-1,Math.min(h.getDate(), new Date(y,m,0).getDate()))), txt:'este mes', antTxt:'el mismo corte del mes pasado' };
  if(k==='mespasado') return { act:r(new Date(y,m-1,1), new Date(y,m,0)), ant:r(new Date(y,m-2,1), new Date(y,m-1,0)), txt:'el mes pasado', antTxt:'el mes anterior' };
  if(k==='trimestre') return { act:r(new Date(y,m-2,1), h), ant:r(new Date(y,m-5,1), new Date(y,m-2,0)), txt:'los últimos 3 meses', antTxt:'los 3 meses anteriores' };
  if(k==='semana'){ const a=new Date(h); a.setDate(h.getDate()-6); const b=new Date(a); b.setDate(a.getDate()-1); const c=new Date(b); c.setDate(b.getDate()-6); return { act:r(a,h), ant:r(c,b), txt:'los últimos 7 días', antTxt:'los 7 días anteriores' }; }
  return { act:r(new Date(y,0,1), h), ant:r(new Date(y-1,0,1), new Date(y-1,m,h.getDate())), txt:'este año', antTxt:'el mismo corte del año pasado' };
}
function crecimiento(a, b){
  if(!b) return a ? '<span class="crece up">nuevo</span>' : '<span class="crece">—</span>';
  const pc = (a-b)/Math.abs(b)*100;
  return `<span class="crece ${pc>=0?'up':'down'}">${pc>=0?'▲':'▼'} ${Math.abs(pc).toLocaleString('es-CO',{maximumFractionDigits:0})}%</span>`;
}
VIEWS.analisis = () => {
  const k = viewState.p || 'mes', R = rangoPeriodo(k);
  const rutas = cobradores();
  const filas = rutas.map(u=>({u, a:metricasRuta(u.id, ...R.act), b:metricasRuta(u.id, ...R.ant), c:estadoCarteraRuta(u.id)}));
  const T = (sel, key) => filas.reduce((s,f)=>s+(f[sel][key]||0),0);
  const pb=(kk,t)=>`<button class="btn sm ${k===kk?'pri':''}" onclick="go('analisis',{p:'${kk}'})">${t}</button>`;
  // utilidad de los últimos 6 meses por ruta
  const h=new Date(), meses=[];
  for(let i=5;i>=0;i--){ const d=new Date(h.getFullYear(), h.getMonth()-i, 1); const fin=new Date(d.getFullYear(), d.getMonth()+1, 0);
    meses.push({txt:d.toLocaleDateString('es-CO',{month:'short'}), vals:rutas.map(u=>metricasRuta(u.id, ymd(d), ymd(fin)).utilidad)}); }
  const maxU = Math.max(1, ...meses.flatMap(m=>m.vals.map(v=>Math.abs(v))));
  const colores = ['#c8f169','#7db8ff','#efeac2','#ff9f7a','#b99bff','#5fd4c4','#f2d66b','#ff7b9c'];
  return `
  <div class="head"><div><h1>Análisis de rutas</h1><p class="sub">Cuánta plata tiene cada ruta, cuánto deja y cómo va creciendo. Comparado contra ${R.antTxt}.</p></div>
  <div class="row">${pb('semana','7 días')}${pb('mes','Este mes')}${pb('mespasado','Mes pasado')}${pb('trimestre','3 meses')}${pb('anio','Este año')}</div></div>
  <div class="kpis">
    <div class="kpi cream"><div class="l">Plata en las rutas (efectivo)</div><div class="v">${fmt(T('c','enMano'))}</div><div class="n">Cartera por cobrar ${fmt(T('c','cartera'))}${T('c','multas')?` · multas aparte ${fmt(T('c','multas'))}`:''}</div></div>
    <div class="kpi hl"><div class="l">Utilidad ${R.txt}</div><div class="v">${fmt(T('a','utilidad'))}</div><div class="n">${crecimiento(T('a','utilidad'), T('b','utilidad'))} vs ${fmt(T('b','utilidad'))}</div></div>
    <div class="kpi sky"><div class="l">Cobrado ${R.txt}</div><div class="v">${fmt(T('a','cobrado'))}</div><div class="n">${crecimiento(T('a','cobrado'), T('b','cobrado'))} · transferencias ${fmt(T('a','transf'))}</div></div>
  </div>
  ${rutas.length ? `
  <div class="card" style="margin-bottom:16px"><div class="tablewrap"><table><thead><tr><th>Ruta</th><th class="num">Capital asignado</th><th class="num">Disponible</th><th class="num">Plata en la ruta</th><th class="num">Caja disponible</th><th class="num">Cartera</th><th class="num">Clientes</th><th class="num">En mora</th><th class="num">Cobrado</th><th class="num">Prestado</th><th class="num">Gastos</th><th class="num">Utilidad</th><th>vs antes</th></tr></thead><tbody>
  ${filas.sort((x,y)=>y.a.utilidad-x.a.utilidad).map(({u,a,b,c})=>`<tr>
    <td><div class="who">${ava(u.nombre)}<div><b>${esc(rutaDe(u))}</b><div class="muted" style="font-size:12px">${esc(u.nombre)}</div>
      <div class="row" style="gap:6px;margin-top:6px"><button class="btn sm" onclick="go('cobros',{cob:'${u.id}'})">Ver ruta</button><button class="btn sm" onclick="go('clientes',{cob:'${u.id}'})">Clientes</button></div></div></div></td>
    ${(()=>{ const k=capitalRuta(u.id); return `<td class="num">${k.tiene?fmt(k.asignado)+capImpNota(k):'—'}</td><td class="num" style="color:${k.disponible<0?'var(--red)':'inherit'}">${k.tiene?fmt(k.disponible):'—'}</td>`; })()}
    <td class="num"><b>${fmt(c.enMano)}</b></td>${(()=>{ const kj=cajaRuta(u.id).caja; return `<td class="num" style="color:${kj<0?'var(--red)':'inherit'}">${fmt(kj)}</td>`; })()}<td class="num">${fmt(c.cartera)}${c.multas>0.5?`<div class="muted" style="font-size:11.5px;color:var(--amber)">+ multas ${fmt(c.multas)}</div>`:''}</td><td class="num">${c.activos}</td>
    <td class="num" style="color:${c.enMora?'var(--red)':'inherit'}">${c.enMora} · ${fmt(c.mora)}</td>
    <td class="num">${fmt(a.cobrado)}</td><td class="num">${fmt(a.prestado)} <span class="muted">(${a.nNuevos})</span></td><td class="num">${fmt(a.gastos)}</td>
    <td class="num"><b style="color:var(--green)">${fmt(a.utilidad)}</b></td><td>${crecimiento(a.utilidad, b.utilidad)}</td></tr>`).join('')}
  </tbody></table></div></div>
  <div class="card pad"><h2>Utilidad por mes de cada ruta</h2>
    <div class="leyenda">${rutas.map((u,i)=>`<span><i style="background:${colores[i%colores.length]}"></i>${esc(rutaDe(u))}</span>`).join('')}</div>
    <div class="barras">${meses.map(m=>`<div class="mes"><div class="cols">${m.vals.map((v,i)=>`<div class="col" title="${esc(rutaDe(rutas[i]))}: ${fmt(v)}" style="height:${Math.max(2,Math.abs(v)/maxU*100)}%;background:${v<0?'var(--red)':colores[i%colores.length]}"></div>`).join('')}</div><span>${m.txt}</span></div>`).join('')}</div>
    <p class="muted" style="font-size:12px;margin:10px 0 0">Utilidad = intereses cobrados + ingresos de la ruta − gastos de la ruta.</p>
  </div>` : '<div class="card"><div class="empty">Aún no tienes rutas. Cuando las tengas, aquí verás cuánto deja cada una.</div></div>'}`;
};
function resumenRutasPanel(){
  const rutas = cobradores(); if(!rutas.length) return '';
  const R = rangoPeriodo('mes');
  return `<div class="card pad" style="margin-top:16px"><div class="row" style="margin-bottom:6px"><h2 style="margin:0">Rutas este mes</h2><span class="spacer"></span><button class="btn sm" data-go="analisis">Ver análisis</button></div>
  <div class="cuadre-grid">${rutas.map(u=>{ const a=metricasRuta(u.id,...R.act), b=metricasRuta(u.id,...R.ant), c=estadoCarteraRuta(u.id); return `<div class="ruta-mini">
    <div class="row">${ava(u.nombre)}<div style="min-width:0;flex:1"><b>${esc(rutaDe(u))}</b><div class="muted" style="font-size:12px">${esc(u.nombre)}</div></div></div>
    ${(()=>{ const k=capitalRuta(u.id); return k.tiene?`<div class="capruta"><div><span>Capital</span><b>${fmt(k.asignado)}</b>${capImpNota(k)}</div><div><span>En la calle</span><b>${fmt(k.enCalle)}</b></div><div><span>Disponible</span><b style="color:${k.disponible<0?'var(--red)':'var(--green)'}">${fmt(k.disponible)}</b></div></div>`:''; })()}
    <div class="cobro-nums"><div><span>En la ruta</span><b>${fmt(c.enMano)}</b></div><div><span>Utilidad</span><b style="color:var(--green)">${fmt(a.utilidad)}</b></div><div><span>vs mes ant.</span><b>${crecimiento(a.utilidad,b.utilidad)}</b></div></div>
    <div class="row"><button class="btn sm" onclick="go('cobros',{cob:'${u.id}'})">Ver ruta</button><button class="btn sm" onclick="go('clientes',{cob:'${u.id}'})">Clientes (${DB.clientes.filter(x=>x.cobradorId===u.id).length})</button></div></div>`; }).join('')}</div></div>`;
}

/* ---------- oficina: primero se escoge la ruta y adentro se ven sus clientes y cobros ---------- */
function verPorRutas(){ return isAdmin() && cobradores().length > 0; }
function datosRutaHoy(id, fecha){
  const deRuta = cob => id==='_yo' ? !cob : cob===id;
  const mios = cobrosDelDia(fecha).filter(c=>deRuta(c.p.cobradorId));
  return { porVisitar: mios.filter(c=>!rutaVisitado(c, fecha)).length, visitados: mios.filter(c=>rutaVisitado(c, fecha)).length,
    pendiente: mios.reduce((s,c)=>s+(rutaVisitado(c, fecha)?0:c.cobrar),0), cobrado: mios.reduce((s,c)=>s+c.pagadoHoy,0),
    clientes: DB.clientes.filter(c=>deRuta(c.cobradorId)).length,
    estado: id==='_yo' ? '' : cierreDe(id, fecha) ? '<span class="pill p-pag">Cerrada</span>' : aperturaDe(id, fecha) ? '<span class="pill p-ok">Abierta</span>' : '<span class="pill p-hoy">Sin abrir</span>' };
}
function rutasParaElegir(){
  const l = cobradores().map(u=>({id:u.id, titulo:rutaCompleta(u), sub:u.nombre}));
  if(DB.clientes.some(c=>!c.cobradorId || !cobradores().some(u=>u.id===c.cobradorId))) l.push({id:'_yo', titulo:'Sin ruta (oficina)', sub:'Clientes sin ruta asignada'});
  return l;
}
function selectorRutas(vista, fecha){
  fecha = fecha || viewState.fecha || todayStr();
  return `<p class="muted" style="margin:0 0 12px">Escoge una ruta para ver sus clientes y cobros. Si buscas a alguien en especial, escribe su nombre o cédula arriba.</p>
  <div class="cuadre-grid">${rutasParaElegir().map(r=>{ const d=datosRutaHoy(r.id, fecha); return `<div class="ruta-mini" style="cursor:pointer" onclick="go('${vista}',Object.assign({},viewState,{cob:'${r.id}',q:''}))">
    <div class="row">${ava(r.sub||r.titulo)}<div style="min-width:0;flex:1"><b>${esc(r.titulo)}</b><div class="muted" style="font-size:12px">${esc(r.sub||'')} · ${d.clientes} cliente(s)</div></div>${d.estado}</div>
    <div class="cobro-nums"><div><span>Por visitar</span><b>${d.porVisitar}</b></div><div><span>Pendiente</span><b style="color:${d.pendiente>0.5?'var(--red)':'inherit'}">${fmt(d.pendiente)}</b></div><div><span>Cobrado ${fecha===todayStr()?'hoy':'ese día'}</span><b style="color:var(--green)">${fmt(d.cobrado)}</b></div></div>
    <div class="row"><span class="spacer"></span><button class="btn sm pri">Entrar a la ruta</button></div></div>`; }).join('')}</div>`;
}
/* panel: resumen por ruta, sin nombres de clientes */
function tablaRutasHoy(){
  const hoy = todayStr();
  return `<div class="tablewrap"><table><thead><tr><th>Ruta</th><th class="num">Por visitar</th><th class="num">Pendiente</th><th class="num">Cobrado</th><th></th></tr></thead><tbody>
  ${rutasParaElegir().map(r=>{ const d=datosRutaHoy(r.id, hoy); return `<tr class="click" onclick="go('cobros',{cob:'${r.id}'})">
    <td><b>${esc(r.titulo)}</b><div style="margin-top:3px">${d.estado}</div></td><td class="num">${d.porVisitar} <span class="muted" style="font-size:12px">de ${d.porVisitar+d.visitados}</span></td>
    <td class="num" style="color:${d.pendiente>0.5?'var(--red)':'inherit'}">${fmt(d.pendiente)}</td><td class="num" style="color:var(--green)">${fmt(d.cobrado)}</td>
    <td class="right"><button class="btn sm">Entrar</button></td></tr>`; }).join('')}</tbody></table></div>`;
}

/* ---------- cambiar el día de pago de un semanal (oficina o la ruta) ---------- */
function modalDiaPago(id){
  const p = DB.prestamos.find(x=>x.id===id); if(!p || p.periodo!=='SEMANAL') return;
  if(!isAdmin() && p.cobradorId!==ME.uid) return;
  const actual = primeraDe(p), dowAct = parseD(actual).getDay();
  openModal(`<h3>Día de pago · ${esc(nombreCliente(p.clienteId))}</h3>
  <p class="muted" style="margin-top:-8px">Ahora paga <b>${losDias(dowAct)}</b>. Escoge el nuevo día y todas las cuotas quedan ese día de la semana.</p>
  <div class="form"><label class="f full">Nuevo día de pago<select class="input" id="dpDia">${opcionesDiaSemana(dowAct)}</select></label></div>
  <div class="calcbox" id="dpInfo" style="margin-top:12px"></div>
  <div class="actions"><button class="btn" onclick="closeModal()">Cancelar</button><button class="btn pri" id="dpOk">Guardar día</button></div>`);
  // se toma la fecha con ese día más cercana a la primera cuota actual, para mover el calendario lo menos posible
  const nuevaPrimera = dow => { let d = parseD(actual); let delta = (dow - dowAct + 7) % 7; if(delta > 3) delta -= 7; d.setDate(d.getDate()+delta); if(ymd(d) <= p.fecha) d.setDate(d.getDate()+7); return ymd(d); };
  const info = ()=>{
    const dow = Number(document.getElementById('dpDia').value), np = nuevaPrimera(dow);
    const e = estadoPrestamo(p), antes = e.cron, desp = cronograma(Object.assign({}, p, {primeraCuota:np}));
    const i = Math.max(0, antes.findIndex(c=>c.n > e.cuotasPagadas));
    document.getElementById('dpInfo').innerHTML = dow===dowAct ? `<div><div class="l">Sin cambios</div><div class="v" style="font-size:14px">Ya paga ese día.</div></div>` :
      `<div><div class="l">Próxima cuota (Nº ${antes[i].n})</div><div class="v" style="font-size:15px">${fdate(antes[i].fecha)} → <b>${fdate(desp[i].fecha)}</b></div></div>
       <div><div class="l">Última cuota</div><div class="v" style="font-size:15px">${fdate(desp[desp.length-1].fecha)}</div></div>`;
  };
  document.getElementById('dpDia').addEventListener('change', info); info();
  document.getElementById('dpOk').onclick = ()=>{
    const dow = Number(document.getElementById('dpDia').value);
    if(dow===dowAct) return closeModal();
    const np = nuevaPrimera(dow);
    dbUpd('prestamos', p.id, {primeraCuota:np});
    closeModal(); render(); toast(`Listo: ahora paga ${losDias(dow)}`); modalDetalle(p.id);
  };
}

/* ---------- caja de cada ruta: su propia plata, sus ingresos y sus gastos ----------
   Caja de una ruta  = capital asignado − lo prestado + lo cobrado + ingresos − gastos
   Caja de la oficina = capital del negocio − capital entregado a las rutas − lo prestado + lo cobrado + ingresos − gastos (lo que no es de ninguna ruta)
   La suma de todas las cajas da el "Disponible" del panel. */
const esRutaViva = id => !!id && cobradores().some(u=>u.id===id);
const deCaja = (cob, id) => id==='_ofi' ? !esRutaViva(cob) : cob===id;
function cajasDisponibles(){ return [...cobradores().map(u=>({id:u.id, titulo:rutaDe(u), sub:u.nombre})), {id:'_ofi', titulo:'Oficina', sub:'Lo que no es de ninguna ruta'}]; }
function cajaRuta(id){
  const capRutas = DB.caprutas.filter(x=>esRutaViva(x.cobradorId)).reduce((s,x)=>s+(Number(x.valor)||0),0);
  const capital = id==='_ofi'
    ? (Number(DB.config.capitalInicial)||0) + DB.capital.reduce((s,x)=>s+(Number(x.valor)||0),0) - capRutas
    : DB.caprutas.filter(x=>x.cobradorId===id).reduce((s,x)=>s+(Number(x.valor)||0),0);
  const f = flujoRuta(id);
  return Object.assign(f, { capital, caja: capital - f.prestado + f.recaudo + f.ingresos - f.gastos });
}
// lo que entró y salió de esa caja (en un rango de fechas, o todo si no se da)
function flujoRuta(id, desde, hasta){
  const enR = f => !desde || (f && f>=desde && f<=hasta);
  const mios = new Set(DB.prestamos.filter(p=>deCaja(p.cobradorId, id)).map(p=>p.id));
  const prestado = DB.prestamos.filter(p=>mios.has(p.id) && !p.importado && enR(p.fecha)).reduce((s,p)=>s+p.monto,0);
  const pagos = DB.pagos.filter(x=>mios.has(x.prestamoId) && x.tipo!=='importado' && enR(x.fecha));
  const recaudo = pagos.reduce((s,x)=>s+x.monto,0);                                // incluye los cruces de renovación (cuadran con lo prestado)
  const cobrado = pagos.filter(efectivo).reduce((s,x)=>s+x.monto,0);               // plata que de verdad entró
  const ingresos = DB.ingresos.filter(x=>deCaja(x.cobradorId, id) && enR(x.fecha)).reduce((s,x)=>s+x.valor,0)
    + DB.movruta.filter(x=>x.tipo==='ingreso' && deCaja(x.cobradorId, id) && enR(x.fecha)).reduce((s,x)=>s+x.valor,0);
  const gastos = DB.salidas.filter(x=>deCaja(x.cobradorId, id) && enR(x.fecha)).reduce((s,x)=>s+x.valor,0)
    + DB.movruta.filter(x=>x.tipo==='gasto' && deCaja(x.cobradorId, id) && enR(x.fecha)).reduce((s,x)=>s+x.valor,0);
  // en una renovación solo sale en efectivo la diferencia: lo que se cruzó con la deuda vieja no es plata entregada
  return { prestado, recaudo, cobrado, ingresos, gastos, entra: cobrado + ingresos, entregado: Math.max(0, prestado - (recaudo - cobrado)) };
}
/* selector de caja para gastos e ingresos de la oficina */
function selectCaja(idSel, actual){
  const v = esRutaViva(actual) ? actual : '';
  return `<label class="f full">¿De qué caja?<select class="input" id="${idSel}"><option value="" ${v===''?'selected':''}>Oficina (general)</option>${cobradores().map(u=>`<option value="${u.id}" ${v===u.id?'selected':''}>${esc(rutaCompleta(u))}</option>`).join('')}</select></label>`;
}
const cajaPorDefecto = () => (viewState && viewState.cob && viewState.cob!=='_yo') ? viewState.cob : '';
const nombreCaja = id => esRutaViva(id) ? nombreRuta(id) : 'Oficina';
/* panel: caja de cada ruta y quién entra / gasta más este mes */
function tablaCajasRutas(){
  if(!cobradores().length) return '';
  const R = rangoPeriodo('mes');
  const filas = cajasDisponibles().map(c=>({c, k:cajaRuta(c.id), m:flujoRuta(c.id, ...R.act)}))
    .filter(f=>f.c.id!=='_ofi' || Math.abs(f.k.caja)>0.5 || f.m.entra || f.m.gastos);
  const soloRutas = filas.filter(f=>f.c.id!=='_ofi');
  const maxG = Math.max(0, ...soloRutas.map(f=>f.m.gastos)), maxE = Math.max(0, ...soloRutas.map(f=>f.m.entra));
  const total = filas.reduce((s,f)=>s+f.k.caja,0);
  return `<div class="card pad" style="margin-top:16px"><div class="row" style="margin-bottom:6px"><h2 style="margin:0">Caja de cada ruta</h2><span class="spacer"></span><span class="muted" style="font-size:12.5px">Movimiento de este mes</span>${isCeo()?`<button class="btn sm" onclick="modalSalida()">+ Gasto</button><button class="btn sm" onclick="modalMovimiento('ingreso')">+ Ingreso</button>`:''}</div>
  <div class="tablewrap"><table><thead><tr><th>Caja</th><th class="num">Disponible</th><th class="num">Entró (cobros + ingresos)</th><th class="num">Gastos</th><th class="num">Prestado</th><th class="num">Neto del mes</th></tr></thead><tbody>
  ${filas.map(({c,k,m})=>{ const neto = m.entra - m.gastos - m.entregado;
    const tags = c.id==='_ofi' ? '' : (m.entra>0.5 && m.entra===maxE && soloRutas.length>1 ? ' <span class="pill p-ok">Más entra</span>' : '') + (m.gastos>0.5 && m.gastos===maxG && soloRutas.length>1 ? ' <span class="pill p-mora">Más gasta</span>' : '');
    return `<tr${c.id!=='_ofi'?` class="click" onclick="go('cobros',{cob:'${c.id}'})"`:''}><td><b>${esc(c.titulo)}</b>${tags}<div class="muted" style="font-size:12px">${esc(c.sub||'')}</div></td>
    <td class="num"><b style="color:${k.caja<0?'var(--red)':'inherit'}">${fmt(k.caja)}</b></td><td class="num" style="color:var(--green)">${fmt(m.entra)}</td><td class="num" style="color:${m.gastos>0.5?'var(--red)':'inherit'}">${fmt(m.gastos)}</td>
    <td class="num">${fmt(m.entregado)}</td><td class="num" style="color:${neto<0?'var(--red)':'var(--green)'}">${neto<0?'− ':''}${fmt(Math.abs(neto))}</td></tr>`; }).join('')}
  <tr><td><b>Total</b></td><td class="num"><b>${fmt(total)}</b></td><td colspan="4"></td></tr>
  </tbody></table></div>
  <p class="muted" style="font-size:12px;margin:8px 0 0">Disponible = capital asignado − lo prestado + lo cobrado + ingresos − gastos de esa caja. Al registrar un gasto o ingreso escoges de qué caja es.</p></div>`;
}

/* ---------- en "Ver el día": lo que se prestó y renovó, y de dónde salió la plata ---------- */
function prestadoDeRutaDia(uid, fecha){
  const fRen = r=>r.entregadoEn ? ymd(new Date(r.entregadoEn)) : (r.fechaRenovacion||'');
  const renDia = new Set(DB.renovaciones.filter(r=>r.estado==='entregada' && r.entregadoPor===uid && fRen(r)===fecha).map(r=>r.nuevoPrestamoId));
  return DB.prestamos.filter(p=>!p.importado && p.cobradorId===uid && (p.fecha===fecha || renDia.has(p.id)))
    .sort((a,b)=>(a.creado||0)-(b.creado||0));
}
function seccionPrestadoDia(uid, fecha){
  const ps = prestadoDeRutaDia(uid, fecha);
  const hora = t => t ? new Date(t).toLocaleTimeString('es-CO',{hour:'numeric',minute:'2-digit'}) : '';
  const o = ps.map(p=>({p, o:origenCredito(p), ren: p.renovacionDe ? (DB.renovaciones.find(r=>r.nuevoPrestamoId===p.id)||{}) : null}));
  const deRuta = o.filter(x=>x.o.k==='ruta' || (x.o.k==='ren' && x.ren && x.ren.estado==='entregada' && x.ren.entregadoPor===uid && x.ren.medioEntrega!=='transferencia'));
  const totRuta = deRuta.reduce((s,x)=>s+(x.o.k==='ren' ? (Number(x.ren.excedente)||0) : x.p.monto),0);
  const totOfi = o.filter(x=>x.o.k==='ofi').reduce((s,x)=>s+x.p.monto,0);
  const totTrans = o.filter(x=>x.o.k==='ren' && x.ren && x.ren.medioEntrega==='transferencia').reduce((s,x)=>s+(Number(x.ren.excedente)||0),0);
  return `<div class="card pad" style="background:var(--panel-2);grid-column:1/-1"><div class="row" style="margin-bottom:8px"><b>Prestado y renovado</b><span class="pill p-pag">${ps.length}</span><span class="spacer"></span><b>${fmt(ps.reduce((s,p)=>s+p.monto,0))}</b></div>
    ${ps.length ? `<div class="tablewrap" style="max-height:300px"><table><tbody>${o.map(({p,o,ren})=>`<tr class="click" onclick="closeModal();modalDetalle('${p.id}')">
      <td>${esc(nombreCliente(p.clienteId))}<div class="muted" style="font-size:12px">${hora(ren&&ren.entregadoEn||p.creado)} · ${p.cuotas} cuotas ${p.periodo.toLowerCase()}</div><div style="font-size:12px;margin-top:3px">${o.html}</div></td>
      <td class="num">${fmt(p.monto)}</td></tr>`).join('')}</tbody></table></div>
    <div class="row" style="gap:14px;margin-top:10px;font-size:13px;flex-wrap:wrap"><span>Del cuadre de la ruta (efectivo): <b>${fmt(totRuta)}</b></span>${totOfi?`<span>De la oficina: <b>${fmt(totOfi)}</b></span>`:''}${totTrans?`<span>Por transferencia: <b>${fmt(totTrans)}</b></span>`:''}</div>`
    : '<p class="muted" style="margin:0">No se prestó ni renovó ese día.</p>'}</div>`;
}
