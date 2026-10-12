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
const visitaDe = (prestamoId, fecha) => DB.visitas.filter(v=>v.prestamoId===prestamoId && v.fecha===fecha).sort((a,b)=>(b.creado||0)-(a.creado||0))[0];
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
  const v = visitaDe(p.id, fecha);
  if(v) return `<span class="pill p-mora" title="${esc(v.nota||'')}">No pagó · ${esc(v.motivo)}${v.volver?` · vuelve ${fdateShort(v.volver)}`:''}</span>`;
  const ap = DB.visitas.find(x=>x.prestamoId===p.id && x.volver===fecha);
  return ap ? `<span class="pill p-hoy">Aplazado para hoy</span>` : '';
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
  const visitas = DB.visitas.filter(v=>v.cobradorId===uid && v.fecha===fecha);
  return { cobrado:c.cobradoDia, pagos:c.nPagosDia, base:c.baseDia, gastos:c.gastosDia, ingresos:c.ingresosDia, prestado:c.prestadoDia + c.desembolsadoDia,
           entregado:c.entregadoDia, saldoFinal:c.saldoFinal, clientes:lista.length, noPagos:visitas.length };
}
async function cerrarMiRuta(){
  const fecha = todayStr();
  if(cierreDe(ME.uid, fecha)) return avisar('Tu ruta de hoy ya está cerrada.');
  const r = resumenCierre(ME.uid, fecha);
  const sinVisitar = cobrosDelDia(fecha).filter(x=>x.p.cobradorId===ME.uid && x.pagadoHoy<=0 && !visitaDe(x.p.id, fecha)).length;
  if(!await confirmar(`Cerrar la ruta de hoy\n\nCobrado: ${fmt(r.cobrado)} (${r.pagos} pagos)\nGastos: ${fmt(r.gastos)}\nPrestado: ${fmt(r.prestado)}\nDebes tener en la mano: ${fmt(r.saldoFinal)}${sinVisitar?`\n\nOjo: ${sinVisitar} cliente(s) sin pago ni visita registrada.`:''}\n\nDespués de cerrar no podrás registrar más cobros hoy.`, {ok:'Cerrar ruta'})) return;
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
  const k = calcular(a.monto, a.tasa, a.meses, a.periodo);
  return `<div class="card cobro">
    <div class="who">${ava(nombreCliente(a.clienteId))}<div style="min-width:0;flex:1"><b>${esc(nombreCliente(a.clienteId))}</b><div class="muted" style="font-size:12.5px">Crédito nuevo · ${esc(nombreRuta(a.cobradorId))} · ${fdate(a.fecha)}</div></div>${est}</div>
    <div class="cobro-nums"><div><span>Monto</span><b>${fmt(a.monto)}</b></div><div><span>Interés</span><b>${fmtN(a.tasa)}% · ${fmtN(a.meses)} m</b></div><div><span>Cuota</span><b>${fmt(k.valorCuota)}</b></div></div>
    <div class="muted" style="font-size:12.5px">Tope de la ruta: ${fmt(rutaCfg(a.cobradorId).maxPrestamo||0)}${a.nota?' · '+esc(a.nota):''}</div>
    ${a.estado==='pendiente'&&isAdmin()?`<div class="row"><button class="btn sm danger" onclick="responderAprobacion('${a.id}',false)">Rechazar</button><span class="spacer"></span><button class="btn sm pri" onclick="responderAprobacion('${a.id}',true)">Aprobar crédito</button></div>`:''}
  </div>`;
}
async function responderAprobacion(id, ok){
  const a = DB.aprobaciones.find(x=>x.id===id); if(!a || a.estado!=='pendiente') return;
  if(!ok){ if(!await confirmar('¿Rechazar esta solicitud de crédito?', {peligro:true, ok:'Rechazar'})) return;
    dbUpd('aprobaciones', id, {estado:'rechazada', revisadoPor:ME.uid, revisadoEn:Date.now()}); render(); return; }
  if(!await confirmar(`¿Aprobar el crédito de ${fmt(a.monto)} para ${nombreCliente(a.clienteId)}? La ruta entrega la plata y se descuenta de su caja.`, {ok:'Aprobar'})) return;
  const k = calcular(a.monto, a.tasa, a.meses, a.periodo);
  const pid = a.prestamoId || S.newId('prestamos');
  const obj = {clienteId:a.clienteId, fecha:todayStr(), monto:a.monto, tasa:a.tasa, meses:a.meses, periodo:a.periodo, excluirDomingos:!!a.excluirDomingos,
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
    `Valor pagado: ${fmt(x.monto)}\nCuotas pagadas: ${e.cuotasPagadas} de ${p.cuotas}\nSaldo pendiente: ${fmt(e.saldo)}\n`+
    `Recibió: ${nombreUsuario(x.registradoPor)}\n${DB.config.mensajeRecibo?'\n'+DB.config.mensajeRecibo:''}`;
}
function modalRecibo(pagoId){
  const x = DB.pagos.find(y=>y.id===pagoId); if(!x) return;
  const p = DB.prestamos.find(y=>y.id===x.prestamoId)||{}, c = clienteById(p.clienteId)||{};
  const t = textoRecibo(pagoId), wa = telWa(c.tel1);
  openModal(`<h3>Pago registrado</h3><pre class="recibo">${esc(t.replace(/\*/g,''))}</pre>
  <div class="actions"><button class="btn" onclick="closeModal()">Listo</button>
  ${wa?`<a class="btn pri" href="https://wa.me/${wa}?text=${encodeURIComponent(t)}" target="_blank" rel="noopener" onclick="setTimeout(closeModal,300)">Enviar por WhatsApp</a>`:''}
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
    <label class="chk"><input type="checkbox" id="rPrest" ${r.puedePrestar?'checked':''}> Puede crear créditos en la calle</label></div>
    <label class="f">Monto máximo por crédito<input class="input" id="rMax" inputmode="decimal" value="${r.maxPrestamo?fmtIn(r.maxPrestamo):''}" placeholder="Sin tope = pide aprobación siempre"></label>
    <label class="f">Gasto máximo por registro<input class="input" id="rGas" inputmode="decimal" value="${r.maxGasto?fmtIn(r.maxGasto):''}" placeholder="Sin límite"></label>`;
}
function guardarCfgRuta(uid){
  const el = document.getElementById('rPrest'); if(!el) return;
  const d = {cobradorId:uid, puedePrestar:el.checked, maxPrestamo:num(document.getElementById('rMax').value), maxGasto:num(document.getElementById('rGas').value), actualizado:Date.now()};
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
