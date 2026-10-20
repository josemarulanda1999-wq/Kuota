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
function rutaBloqueada(){ if(miRutaCerrada()){ avisar('Tu ruta de hoy ya está cerrada. Pídele a la oficina que la reabra si necesitas registrar algo más.'); return true; } return false; }

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
async function cerrarMiRuta(){
  const fecha = todayStr();
  if(cierreDe(ME.uid, fecha)) return avisar('Tu ruta de hoy ya está cerrada.');
  const r = resumenCierre(ME.uid, fecha);
  const sinVisitar = cobrosDelDia(fecha).filter(x=>x.p.cobradorId===ME.uid && x.pagadoHoy<=0 && !visitaDe(x.p.id, fecha)).length;
  if(!await confirmar(`Cerrar la ruta de hoy\n\nCobrado en efectivo: ${fmt(r.cobrado)} (${r.pagos} pagos)\nPor transferencia: ${fmt(r.transferencias)}\nGastos: ${fmt(r.gastos)}\nPrestado: ${fmt(r.prestado)}\nDebes tener en efectivo: ${fmt(r.saldoFinal)}${sinVisitar?`\n\nOjo: ${sinVisitar} cliente(s) sin pago ni visita registrada.`:''}\n\nDespués de cerrar no podrás registrar más cobros hoy.`, {ok:'Cerrar ruta'})) return;
  S.set('cierres', idCierre(ME.uid, fecha), {cobradorId:ME.uid, fecha, cerradoEn:Date.now(), resumen:r}).catch(falloNube);
  DB.cierres.push({id:idCierre(ME.uid, fecha), cobradorId:ME.uid, fecha, cerradoEn:Date.now(), resumen:r});
  if(typeof GPS!=='undefined' && GPS.activo) detenerJornada(true);
  render(); toast('Ruta cerrada');
}
async function cerrarRutaOficina(uid, fecha){
  if(cierreDe(uid, fecha)) return;
  if(!await confirmar(`¿Cerrar ${nombreRuta(uid)} del ${fdate(fecha)}? La ruta ya no podrá registrar movimientos ese día.`, {ok:'Cerrar ruta'})) return;
  const r = resumenCierre(uid, fecha);
  S.set('cierres', idCierre(uid, fecha), {cobradorId:uid, fecha, cerradoEn:Date.now(), resumen:r}).catch(falloNube);
  DB.cierres.push({id:idCierre(uid, fecha), cobradorId:uid, fecha, cerradoEn:Date.now(), resumen:r});
  render(); toast('Ruta cerrada');
}
async function reabrirRuta(uid, fecha){
  if(!await confirmar(`¿Reabrir ${nombreRuta(uid)} del ${fdate(fecha)}? Podrá volver a registrar cobros y gastos ese día.`, {ok:'Reabrir'})) return;
  dbDel('cierres', idCierre(uid, fecha)); render(); toast('Ruta reabierta');
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
    <div class="muted" style="font-size:12.5px">Tope de la ruta: ${fmt(rutaCfg(a.cobradorId).maxPrestamo||0)}${a.nota?' · '+esc(a.nota):''}</div>
    ${a.estado==='pendiente'&&isAdmin()?`<div class="row"><button class="btn sm danger" onclick="responderAprobacion('${a.id}',false)">Rechazar</button><span class="spacer"></span><button class="btn sm pri" onclick="responderAprobacion('${a.id}',true)">Aprobar crédito</button></div>`:''}
  </div>`;
}
async function responderAprobacion(id, ok){
  const a = DB.aprobaciones.find(x=>x.id===id); if(!a || a.estado!=='pendiente') return;
  if(!ok){ if(!await confirmar('¿Rechazar esta solicitud de crédito?', {peligro:true, ok:'Rechazar'})) return;
    dbUpd('aprobaciones', id, {estado:'rechazada', revisadoPor:ME.uid, revisadoEn:Date.now()}); render(); return; }
  if(!await confirmar(`¿Aprobar el crédito de ${fmt(a.monto)} para ${nombreCliente(a.clienteId)}? La ruta entrega la plata y se descuenta de su caja.`, {ok:'Aprobar'})) return;
  const k = (a.cuotas ? calcularCuotas(a.monto, a.tasa, a.cuotas, a.periodo, a.modoInteres||'mensual') : calcular(a.monto, a.tasa, a.meses, a.periodo));
  const pid = a.prestamoId || S.newId('prestamos');
  const obj = {clienteId:a.clienteId, fecha:todayStr(), monto:a.monto, tasa:a.tasa, meses:k.meses||a.meses, periodo:a.periodo, modoInteres:a.modoInteres||'mensual', excluirDomingos:!!a.excluirDomingos,
    nota:a.nota||'', cuotas:k.cuotas, valorCuota:k.valorCuota, interesMes:k.interesMes, total:k.total, cobradorId:a.cobradorId, fuente:'ruta', creado:Date.now(), creadoPor:ME.uid};
  DB.prestamos.push(Object.assign({id:pid}, obj)); S.set('prestamos', pid, obj).catch(falloNube);
  dbUpd('aprobaciones', id, {estado:'aprobada', prestamoId:pid, revisadoPor:ME.uid, revisadoEn:Date.now()});
  render(); toast('Crédito aprobado');
}

/* ---------- recibo de pago ---------- */
function textoRecibo(pagoId){
  const x = DB.pagos.find(y=>y.id===pagoId); if(!x) return '';
  const p = DB.prestamos.find(y=>y.id===x.prestamoId)||{}, c = clienteById(p.clienteId)||{}, e = estadoPrestamo(p);
  return `*${DB.config.negocio||'Kuota'}* — Recibo de pago\n`+
    `Cliente: ${c.nombre||''}\nFecha: ${fdate(x.fecha)}${x.creado?' '+new Date(x.creado).toLocaleTimeString('es-CO',{hour:'numeric',minute:'2-digit'}):''}\n`+
    `Valor pagado: ${fmt(x.monto)} (${x.medio==='transferencia'?'transferencia':'efectivo'})\nCuotas pagadas: ${e.cuotasPagadas} de ${p.cuotas}\nSaldo pendiente: ${fmt(e.saldo)}\n`+
    `Recibió: ${nombreUsuario(x.registradoPor)}\n${DB.config.mensajeRecibo?'\n'+DB.config.mensajeRecibo:''}`;
}
function modalRecibo(pagoId){
  const x = DB.pagos.find(y=>y.id===pagoId); if(!x) return;
  const p = DB.prestamos.find(y=>y.id===x.prestamoId)||{}, c = clienteById(p.clienteId)||{};
  const t = textoRecibo(pagoId), wa = telWa(c.tel1);
  openModal(`<h3>Pago registrado</h3><pre class="recibo">${esc(t.replace(/\*/g,''))}</pre>
  <div class="actions"><button class="btn" onclick="closeModal()">Listo</button>
  ${wa?`<a class="btn pri" href="https://wa.me/${wa}?text=${encodeURIComponent(t)}" target="_blank" rel="noopener" onclick="setTimeout(closeModal,300)">Enviar por WhatsApp</a>`:''}
  ${x.comprobante?`<button class="btn" onclick="verComprobante('${pagoId}')">Ver comprobante</button>`:''}
  ${urlReciboCorreo(pagoId)?`<a class="btn" href="${urlReciboCorreo(pagoId)}" onclick="setTimeout(closeModal,300)">Enviar por correo</a>`:''}
  <button class="btn ${wa?'':'pri'}" onclick="compartirRecibo('${pagoId}')">Compartir</button></div>`);
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
  const gastos = DB.movruta.filter(m=>m.cobradorId===uid && m.tipo==='gasto' && enR(m.fecha)).reduce((s,m)=>s+m.valor,0);
  const ingresos = DB.movruta.filter(m=>m.cobradorId===uid && m.tipo==='ingreso' && enR(m.fecha)).reduce((s,m)=>s+m.valor,0);
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
  <div class="card" style="margin-bottom:16px"><div class="tablewrap"><table><thead><tr><th>Ruta</th><th class="num">Capital asignado</th><th class="num">Disponible</th><th class="num">Plata en la ruta</th><th class="num">Cartera</th><th class="num">Clientes</th><th class="num">En mora</th><th class="num">Cobrado</th><th class="num">Prestado</th><th class="num">Gastos</th><th class="num">Utilidad</th><th>vs antes</th></tr></thead><tbody>
  ${filas.sort((x,y)=>y.a.utilidad-x.a.utilidad).map(({u,a,b,c})=>`<tr>
    <td><div class="who">${ava(u.nombre)}<div><b>${esc(rutaDe(u))}</b><div class="muted" style="font-size:12px">${esc(u.nombre)}</div>
      <div class="row" style="gap:6px;margin-top:6px"><button class="btn sm" onclick="go('cobros',{cob:'${u.id}'})">Ver ruta</button><button class="btn sm" onclick="go('clientes',{cob:'${u.id}'})">Clientes</button></div></div></div></td>
    ${(()=>{ const k=capitalRuta(u.id); return `<td class="num">${k.tiene?fmt(k.asignado)+capImpNota(k):'—'}</td><td class="num" style="color:${k.disponible<0?'var(--red)':'inherit'}">${k.tiene?fmt(k.disponible):'—'}</td>`; })()}
    <td class="num"><b>${fmt(c.enMano)}</b></td><td class="num">${fmt(c.cartera)}${c.multas>0.5?`<div class="muted" style="font-size:11.5px;color:var(--amber)">+ multas ${fmt(c.multas)}</div>`:''}</td><td class="num">${c.activos}</td>
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
