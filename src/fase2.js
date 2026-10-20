/* =========================================================
   KUOTA — herramientas de la oficina (fase 2)
   · Importar clientes y créditos desde Excel (CSV)
   · Restricciones por ruta y multa por no pago
   · Festivos, castigo de cartera, seguro del crédito y notas a la ruta
   · Liquidación de empleados y auditoría
   ========================================================= */

ICONS.nomina = '<path d="M3 6h18v12H3zm2 2v8h14V8zm4 1h6v2H9zm0 3h4v2H9z"/>';
ICONS.auditoria = '<path d="M12 2L4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5zm-1 14l-4-4 1.4-1.4 2.6 2.6 5.6-5.6L18 9z"/>';

/* ---------- importar desde Excel ---------- */
const COLS_IMPORT = ['nombre','cedula','telefono','telefono2','direccion','ciudad','ruta','monto','interes','meses','periodo','fecha','pagado','valor_cuota','cuotas','credito_no'];
function descargarPlantilla(){
  const filas = [COLS_IMPORT, ['María Pérez','1012345678','3001234567','','Cra 10 # 20-30','Cali','Ruta Norte','500000','20','1','DIARIO','2026-10-01','120000','',''],
    ['Juan Ruiz','','3109876543','','Calle 5 # 8-12','Cali','Ruta Sur','1000000','20','2','SEMANAL','2026-09-15','400000','150000','8']];
  const txt = '﻿' + filas.map(f=>f.join(';')).join('\r\n');
  descargar('plantilla_importar_kuota.csv', txt, 'text/csv;charset=utf-8');
}
function parsearCSV(txt){
  txt = txt.replace(/^﻿/,'');
  const prim = txt.split(/\r?\n/)[0]||'';
  const sep = [';','\t',','].map(c=>[c, prim.split(c).length]).sort((a,b)=>b[1]-a[1])[0][0];
  const filas=[]; let fila=[], campo='', q=false;
  for(let i=0;i<txt.length;i++){
    const c=txt[i];
    if(q){ if(c==='"'){ if(txt[i+1]==='"'){ campo+='"'; i++; } else q=false; } else campo+=c; continue; }
    if(c==='"') q=true; else if(c===sep){ fila.push(campo); campo=''; }
    else if(c==='\n'){ fila.push(campo); filas.push(fila); fila=[]; campo=''; }
    else if(c!=='\r') campo+=c;
  }
  if(campo||fila.length){ fila.push(campo); filas.push(fila); }
  return filas.filter(f=>f.some(x=>String(x).trim()));
}
const sinTilde = s => String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
function fechaImport(v){
  v = String(v||'').trim(); if(!v) return '';
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if(m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  m = v.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/); if(m){ const y=m[3].length===2?'20'+m[3]:m[3]; return `${y}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`; }
  return '';
}
function rutaPorNombre(t){
  t = sinTilde(t); if(!t) return '';
  const u = cobradores().find(u=>sinTilde(u.ruta)===t || sinTilde(u.nombre)===t || sinTilde(u.email)===t || sinTilde(rutaDe(u))===t);
  return u ? u.id : null;
}
function importarExcel(file){
  if(!file) return;
  const r = new FileReader();
  r.onload = async ()=>{
    const filas = parsearCSV(String(r.result||''));
    if(filas.length<2) return avisar('El archivo está vacío. Usa la plantilla y guárdala como CSV.');
    const head = filas[0].map(sinTilde);
    const ix = k => head.indexOf(k);
    if(ix('nombre')<0) return avisar('No encontré la columna "nombre". Descarga la plantilla y copia tus datos en ella.');
    const val = (f,k) => ix(k)>=0 ? String(f[ix(k)]||'').trim() : '';
    const plan = {clientes:[], prestamos:[], pagos:[], errores:[]};
    const porCedula = {};
    for(const c of DB.clientes) if(c.cedula) porCedula[c.cedula.trim()] = c.id;
    filas.slice(1).forEach((f,i)=>{
      const n = i+2, nombre = val(f,'nombre');
      if(!nombre) return plan.errores.push(`Fila ${n}: falta el nombre`);
      const rutaTxt = val(f,'ruta'), cob = rutaPorNombre(rutaTxt);
      if(cob===null){ plan.sinRuta = plan.sinRuta || {}; plan.sinRuta[rutaTxt] = (plan.sinRuta[rutaTxt]||0)+1; }
      const ced = val(f,'cedula');
      let cid = ced && porCedula[ced];
      if(!cid){ cid = S.newId('clientes'); if(ced) porCedula[ced]=cid;
        plan.clientes.push({id:cid, _pend:cob===null, nombre:nombre.slice(0,120), cedula:ced.slice(0,40), tel1:val(f,'telefono').slice(0,40), tel2:val(f,'telefono2').slice(0,40),
          direccion:val(f,'direccion').slice(0,200), ciudad:val(f,'ciudad').slice(0,80), obs:'Importado', cobradorId:cob||''}); }
      const monto = num(val(f,'monto'));
      if(!monto) return;
      const tasa = num(val(f,'interes')), meses = num(val(f,'meses'))||1;
      const per = (val(f,'periodo')||'DIARIO').toUpperCase(), periodo = PERIODOS.includes(per)?per:'DIARIO';
      const fecha = fechaImport(val(f,'fecha')) || todayStr();
      const vc = num(val(f,'valor_cuota')), nc = Math.round(num(val(f,'cuotas')));
      const exacto = vc>0 && nc>0;                                   // viene con cuotas y valor de cuota del otro sistema
      const k = exacto ? calcularCuotas(monto, tasa, nc, periodo, 'total') : calcular(monto, tasa, meses, periodo);
      const pid = S.newId('prestamos'), nro = val(f,'credito_no');
      plan.prestamos.push({id:pid, _pend:cob===null, clienteId:cid, fecha, monto, tasa, meses: exacto ? k.meses : meses, periodo, ...(exacto?{modoInteres:'total'}:{}),
        excluirDomingos:!!DB.config.excluirDomingos, nota:'Importado de otro sistema'+(nro?' · Nº '+nro.slice(0,40):''),
        cuotas: nc>0?nc:k.cuotas, valorCuota: vc>0?vc:k.valorCuota, interesMes:k.interesMes, total: (vc>0&&nc>0)?vc*nc:k.total, cobradorId:cob||'', fuente:'oficina', importado:true});
      const pagado = num(val(f,'pagado'));
      if(pagado>0) plan.pagos.push({id:S.newId('pagos'), _pend:cob===null, prestamoId:pid, fecha:todayStr(), monto:pagado, nota:'Pagado antes de pasar a Kuota', tipo:'importado', cobradorId:cob||'', registradoPor:ME.uid});
    });
    const tot = plan.prestamos.reduce((s,p)=>s+p.monto,0);
    openModal(`<h3>Importar desde Excel</h3>
      <div class="kpis" style="margin-bottom:12px"><div class="kpi sky"><div class="l">Clientes nuevos</div><div class="v">${plan.clientes.length}</div></div>
      <div class="kpi hl"><div class="l">Créditos</div><div class="v">${plan.prestamos.length}</div><div class="n">${fmt(tot)} prestados</div></div>
      <div class="kpi cream"><div class="l">Saldos ya pagados</div><div class="v">${fmt(plan.pagos.reduce((s,x)=>s+x.monto,0))}</div></div></div>
      ${plan.sinRuta?`<div class="banner" style="display:block">${Object.entries(plan.sinRuta).map(([r,c])=>`${c} crédito(s) vienen de la ruta "<b>${esc(r||'sin ruta')}</b>", que no existe en Kuota.`).join('<br>')}
        <label class="f" style="margin-top:8px">Asignarlos a<select class="input" id="impRuta"><option value="">Sin ruta (los manejo yo)</option>${cobradores().map(u=>`<option value="${u.id}">${esc(rutaCompleta(u))}</option>`).join('')}</select></label></div>`:''}
      ${plan.errores.length?`<div class="banner bad" style="display:block;max-height:140px;overflow:auto">${plan.errores.slice(0,30).map(esc).join('<br>')}</div>`:''}
      <p class="muted" style="font-size:13px">Los créditos importados no mueven tu caja (ya se prestaron antes). Desde hoy, cada cobro sí entra a la caja y al cuadre de su ruta.</p>
      <div class="actions"><button class="btn" onclick="closeModal()">Cancelar</button><button class="btn pri" id="impOk" ${plan.prestamos.length||plan.clientes.length?'':'disabled'}>Importar</button></div>`, true);
    document.getElementById('impOk').onclick = async ()=>{
      const b=document.getElementById('impOk'); b.disabled=true; b.textContent='Importando…';
      const now = Date.now(), ops=[];
      const rSel = (document.getElementById('impRuta')||{}).value || '';
      for(const x of [...plan.clientes, ...plan.prestamos, ...plan.pagos]){ if(x._pend) x.cobradorId = rSel; delete x._pend; }
      for(const c of plan.clientes){ const {id,...d}=c; ops.push({col:'clientes', id, data:{...d, creado:now, creadoPor:ME.uid}}); }
      for(const p of plan.prestamos){ const {id,...d}=p; ops.push({col:'prestamos', id, data:{...d, creado:now, creadoPor:ME.uid}}); }
      for(const x of plan.pagos){ const {id,...d}=x; ops.push({col:'pagos', id, data:{...d, creado:now, creadoPor:ME.uid}}); }
      try{ await S.batchSet(ops); closeModal(); auditar('importar', 'clientes', '', `${plan.clientes.length} clientes y ${plan.prestamos.length} créditos`); toast('Importación lista'); }
      catch(e){ falloNube(e); b.disabled=false; b.textContent='Importar'; }
    };
  };
  r.readAsText(file, 'utf-8');
}

/* ---------- castigar cartera (depurar morosos) ---------- */
async function castigarPrestamo(id, volver){
  const p = DB.prestamos.find(x=>x.id===id); if(!p) return;
  if(!volver && !await confirmar(`¿Castigar el crédito de ${nombreCliente(p.clienteId)}? Sale de la cartera y de la ruta de cobro, pero queda en el historial. Si el cliente vuelve a pagar, lo puedes reactivar.`, {peligro:true, ok:'Castigar'})) return;
  dbUpd('prestamos', id, {castigado: !volver});
  auditar(volver?'reactivar':'castigar', 'prestamos', id, nombreCliente(p.clienteId));
  closeModal(); render(); toast(volver?'Crédito reactivado':'Crédito castigado');
}

/* ---------- notas de la oficina a la ruta ---------- */
function modalNota(cobradorId){
  openModal(`<h3>Nota para ${esc(nombreRuta(cobradorId))}</h3>
    <div class="form"><label class="f full">Mensaje<textarea class="input" id="nTxt" rows="3" maxlength="300" placeholder="Ej: Mañana pasar primero por donde Ana Gil"></textarea></label></div>
    <div class="actions"><button class="btn" onclick="closeModal()">Cancelar</button><button class="btn pri" id="nOk">Enviar</button></div>`);
  document.getElementById('nOk').onclick = ()=>{
    const t = document.getElementById('nTxt').value.trim(); if(!t) return toast('Escribe la nota');
    dbAdd('notas', {cobradorId, texto:t.slice(0,300), fecha:todayStr(), leida:false}); closeModal(); render(); toast('Nota enviada a la ruta');
  };
}
function bloqueNotasRuta(){
  if(isAdmin()) return '';
  const ns = DB.notas.filter(n=>n.cobradorId===ME.uid && !n.leida);
  return ns.map(n=>`<div class="banner"><b>Nota de la oficina:</b> ${esc(n.texto)}<span class="spacer"></span><button class="btn sm" onclick="dbUpd('notas','${n.id}',{leida:true});render()">Entendido</button></div>`).join('');
}

/* ---------- seguro al crear el crédito ---------- */
function registrarSeguro(valor, prestamoId, clienteId, cobradorId, fuenteRuta){
  if(!(valor>0)) return;
  const nota = 'Seguro del crédito de '+nombreCliente(clienteId);
  if(fuenteRuta && cobradorId) dbAdd('movruta', {cobradorId, fecha:todayStr(), tipo:'ingreso', concepto:'Seguro del cliente', valor, nota});
  else if(isCeo()) dbAdd('ingresos', {fecha:todayStr(), concepto:'Seguro del cliente — '+nombreCliente(clienteId), valor});
}

/* ---------- ajustes: festivos, multa, seguro ---------- */
const FESTIVOS_CO = ['2026-01-01','2026-01-12','2026-03-23','2026-04-02','2026-04-03','2026-05-01','2026-05-18','2026-06-08','2026-06-15','2026-06-29','2026-07-20','2026-08-07','2026-08-17','2026-10-12','2026-11-02','2026-11-16','2026-12-08','2026-12-25',
  '2027-01-01','2027-01-11','2027-03-22','2027-03-25','2027-03-26','2027-05-01','2027-05-10','2027-05-31','2027-06-07','2027-07-05','2027-07-20','2027-08-07','2027-08-16','2027-10-18','2027-11-01','2027-11-15','2027-12-08','2027-12-25'];
function bloqueAjustesFase2(){
  const c = DB.config, m = c.multa||{};
  return `<div class="card pad">
    <h2>Cobros: festivos, multas y seguro</h2>
    <div class="form">
      <label class="f full">Días festivos sin cobro (préstamos diarios). Uno por línea, AAAA-MM-DD
        <textarea class="input" id="sFest" rows="4">${esc((c.festivos||[]).join('\n'))}</textarea></label>
      <div class="f full"><button type="button" class="btn sm" onclick="document.getElementById('sFest').value=FESTIVOS_CO.join('\\n')">Cargar festivos de Colombia 2026-2027</button></div>
      <label class="chk full"><input type="checkbox" id="sMulA" ${m.activa?'checked':''}> Cobrar multa cuando el cliente no paga</label>
      <label class="f">Cada cuántos "no pagó"<input class="input" id="sMulN" inputmode="numeric" value="${esc(m.cada||3)}"></label>
      <label class="f">La multa es<select class="input" id="sMulT"><option value="cuota" ${m.tipo!=='fijo'?'selected':''}>Una cuota más</option><option value="fijo" ${m.tipo==='fijo'?'selected':''}>Un valor fijo</option></select></label>
      <label class="f">Valor fijo<input class="input" id="sMulV" inputmode="decimal" value="${m.valor?fmtIn(m.valor):''}" placeholder="Si es valor fijo"></label>
      <label class="f">Aplicar desde<input type="date" class="input" id="sMulD" value="${esc(m.desde||todayStr())}"></label>
      <label class="f">Seguro sugerido por crédito (%)<input class="input" id="sSeg" inputmode="decimal" value="${esc(c.seguroPct||0)}"></label>
    </div>
    <div class="actions row" style="margin-top:16px"><button class="btn pri" onclick="guardarAjustesFase2()">Guardar</button></div>
    <p class="muted" style="font-size:12px;margin-top:10px">Los festivos corren las fechas de cobro de los préstamos diarios. La multa se suma al saldo del crédito automáticamente.</p>
  </div>`;
}
function guardarAjustesFase2(){
  const v = id => document.getElementById(id).value;
  DB.config.festivos = v('sFest').split(/\s+/).map(x=>x.trim()).filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x)).slice(0,120);
  DB.config.multa = {activa:document.getElementById('sMulA').checked, cada:Math.max(1,Math.round(num(v('sMulN')))||3), tipo:v('sMulT'), valor:num(v('sMulV')), desde:v('sMulD')||todayStr()};
  DB.config.seguroPct = Math.max(0, Math.min(20, num(v('sSeg'))));
  cfgSave(); auditar('ajustes', 'config', 'general', 'Festivos, multas o seguro'); render(); toast('Ajustes guardados');
}

/* ---------- auditoría ---------- */
function auditar(accion, col, id, detalle){
  if(!ME) return;
  S.auditar({accion, col, docId:id||'', detalle:String(detalle||'').slice(0,200), por:ME.uid, nombre:(ME.nombre||'').slice(0,80), t:Date.now(), fecha:todayStr()}).catch(()=>{});
}
let AUD = [];
async function cargarAuditoria(){ AUD = sanearLista('auditoria', await S.leerAuditoria()); if(view==='auditoria') render(); }
VIEWS.auditoria = () => {
  if(!viewState._cargado){ viewState._cargado=1; cargarAuditoria(); }
  const q = (viewState.q||'').toLowerCase();
  const rows = AUD.filter(a=>!q || (a.nombre+' '+a.accion+' '+a.detalle+' '+a.col).toLowerCase().includes(q)).sort((a,b)=>(b.t||0)-(a.t||0));
  const nom = {borrar:'Borró', editar:'Editó', castigar:'Castigó', reactivar:'Reactivó', importar:'Importó', ajustes:'Cambió ajustes', reabrir:'Reabrió ruta', suspender:'Suspendió', liquidar:'Liquidó'};
  return `<div class="head"><div><h1>Auditoría</h1><p class="sub">Quién borró, editó o cambió algo importante, y cuándo.</p></div></div>
  <div class="toolbar"><input class="input search" placeholder="Buscar persona, acción o detalle" value="${esc(viewState.q||'')}" onchange="go('auditoria',{q:this.value,_cargado:1})"></div>
  <div class="card">${rows.length?`<div class="tablewrap"><table><thead><tr><th>Cuándo</th><th>Quién</th><th>Acción</th><th>Qué</th><th>Detalle</th></tr></thead><tbody>
  ${rows.slice(0,500).map(a=>`<tr><td style="white-space:nowrap">${horaDe(a.t)}</td><td>${esc(a.nombre)}</td><td><span class="pill ${a.accion==='borrar'?'p-mora':'p-pag'}">${esc(nom[a.accion]||a.accion)}</span></td><td>${esc(a.col)}</td><td class="muted">${esc(a.detalle)}</td></tr>`).join('')}
  </tbody></table></div>`:'<div class="empty">Todavía no hay registros. Desde ahora queda guardado cada borrado y cambio importante.</div>'}</div>`;
};

/* ---------- liquidación de empleados (nómina de las rutas) ---------- */
function bloqueNominaRuta(uid){
  const r = rutaCfg(uid);
  return `<div class="f full"><span>Pago al cobrador</span></div>
    <label class="f">Sueldo fijo por período<input class="input" id="rSal" inputmode="decimal" value="${r.salario?fmtIn(r.salario):''}"></label>
    <label class="f">Período de pago<select class="input" id="rPer">${['SEMANAL','QUINCENAL','MENSUAL'].map(x=>`<option ${(r.periodoPago||'QUINCENAL')===x?'selected':''}>${x}</option>`).join('')}</select></label>
    <label class="f">% sobre lo cobrado<input class="input" id="rPR" inputmode="decimal" value="${esc(r.pctRecaudo||0)}"></label>
    <label class="f">% sobre lo prestado<input class="input" id="rPV" inputmode="decimal" value="${esc(r.pctVentas||0)}"></label>
    <label class="f">Topes: máximo de cuotas por crédito<input class="input" id="rMC" inputmode="numeric" value="${r.maxCuotas||''}" placeholder="Sin límite"></label>
    <label class="f">Máximo de renovaciones por cliente<input class="input" id="rMR" inputmode="numeric" value="${r.maxRenov||''}" placeholder="Sin límite"></label>`;
}
VIEWS.nomina = () => {
  const desde = viewState.desde || ymd(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()<=15?1:16));
  const hasta = viewState.hasta || todayStr();
  const filas = cobradores().map(u=>{
    const r = rutaCfg(u.id), m = metricasRuta(u.id, desde, hasta);
    const anticipos = DB.movruta.filter(x=>x.cobradorId===u.id && x.tipo==='gasto' && /anticipo/i.test(x.concepto) && x.fecha>=desde && x.fecha<=hasta).reduce((s,x)=>s+x.valor,0)
                    + DB.salidas.filter(x=>/anticipo/i.test(x.concepto||'') && x.cobradorId===u.id && x.fecha>=desde && x.fecha<=hasta).reduce((s,x)=>s+x.valor,0);
    const comR = m.cobrado*(Number(r.pctRecaudo)||0)/100, comV = m.prestado*(Number(r.pctVentas)||0)/100, sal = Number(r.salario)||0;
    return {u, r, m, sal, comR, comV, anticipos, neto: sal+comR+comV-anticipos};
  });
  return `<div class="head"><div><h1>Liquidación de empleados</h1><p class="sub">Sueldo + comisiones de cada ruta − anticipos del período. Configúralo en Usuarios → Editar.</p></div>
  <div class="row"><input type="date" class="input" style="width:auto" value="${desde}" onchange="go('nomina',Object.assign({},viewState,{desde:this.value}))"><input type="date" class="input" style="width:auto" value="${hasta}" onchange="go('nomina',Object.assign({},viewState,{hasta:this.value}))"></div></div>
  ${filas.length?`<div class="card"><div class="tablewrap"><table><thead><tr><th>Ruta</th><th class="num">Sueldo</th><th class="num">Cobrado</th><th class="num">Comisión cobro</th><th class="num">Prestado</th><th class="num">Comisión ventas</th><th class="num">Anticipos</th><th class="num">A pagar</th><th></th></tr></thead><tbody>
  ${filas.map(f=>`<tr><td><div class="who">${ava(f.u.nombre)}<div><b>${esc(rutaDe(f.u))}</b><div class="muted" style="font-size:12px">${esc(f.u.nombre)} · ${esc((f.r.periodoPago||'QUINCENAL').toLowerCase())}</div></div></div></td>
    <td class="num">${fmt(f.sal)}</td><td class="num">${fmt(f.m.cobrado)}</td><td class="num">${fmt(f.comR)} <span class="muted">(${fmtN(f.r.pctRecaudo||0)}%)</span></td>
    <td class="num">${fmt(f.m.prestado)}</td><td class="num">${fmt(f.comV)} <span class="muted">(${fmtN(f.r.pctVentas||0)}%)</span></td>
    <td class="num" style="color:var(--red)">${fmt(f.anticipos)}</td><td class="num"><b>${fmt(f.neto)}</b></td>
    <td class="right"><button class="btn sm pri" onclick="pagarNomina('${f.u.id}',${Math.round(f.neto*100)/100},'${desde}','${hasta}')">Registrar pago</button></td></tr>`).join('')}
  </tbody></table></div></div>
  <p class="muted" style="font-size:12.5px;margin-top:12px">Los anticipos se toman de los gastos con concepto que diga "Anticipo". Al registrar el pago queda como egreso en la caja.</p>`
  :'<div class="card"><div class="empty">Aún no tienes rutas.</div></div>'}`;
};
async function pagarNomina(uid, valor, desde, hasta){
  if(!(valor>0)) return avisar('No hay valor a pagar en este período.');
  if(!await confirmar(`¿Registrar el pago de ${fmt(valor)} a ${nombreRuta(uid)} (${fdate(desde)} a ${fdate(hasta)})? Queda como egreso de la caja.`, {ok:'Registrar pago'})) return;
  dbAdd('salidas', {fecha:todayStr(), concepto:`Nómina ${nombreRuta(uid)} (${fdateShort(desde)} a ${fdateShort(hasta)})`, valor});
  auditar('liquidar', 'nomina', uid, `${nombreRuta(uid)}: ${fmt(valor)}`);
  render(); toast('Pago de nómina registrado');
}

/* ---------- capital asignado a cada ruta ----------
   El CEO destina un fondo a cada ruta (ej. 40 millones). Disponible para prestar = capital asignado − capital en la calle − pérdidas. */
function capitalRuta(uid){
  const asignado = DB.caprutas.filter(x=>x.cobradorId===uid).reduce((s,x)=>s+(Number(x.valor)||0),0);
  let enCalle=0, perdido=0, ganado=0;
  for(const p of DB.prestamos.filter(p=>p.cobradorId===uid)){
    const e = estadoPrestamo(p), base = (Number(p.valorCuota)||0)*(Number(p.cuotas)||0);
    const recuperado = base>0 ? Math.min(p.monto, e.pagado*p.monto/base) : 0;
    const pend = Math.max(0, p.monto - recuperado);
    ganado += e.utilidad;
    if(e.estado==='Castigado') perdido += pend; else if(e.estado!=='Pagado') enCalle += pend;
  }
  return { asignado, enCalle, perdido, ganado, disponible: asignado - enCalle - perdido, tiene: DB.caprutas.some(x=>x.cobradorId===uid) };
}
function bloqueCapitalRuta(uid){
  const k = capitalRuta(uid), movs = DB.caprutas.filter(x=>x.cobradorId===uid).sort((a,b)=>(b.creado||0)-(a.creado||0));
  return `<div class="f full"><span>Capital de la ruta</span>
    <div class="capruta">
      <div><span>Asignado</span><b>${fmt(k.asignado)}</b></div><div><span>En la calle</span><b>${fmt(k.enCalle)}</b></div>
      <div><span>Disponible para prestar</span><b style="color:${k.disponible<0?'var(--red)':'var(--green)'}">${fmt(k.disponible)}</b></div>
    </div>
    ${isCeo()?`<div class="row" style="margin-top:8px"><button type="button" class="btn sm pri" onclick="modalCapitalRuta('${uid}',1)">+ Añadir capital</button><button type="button" class="btn sm" onclick="modalCapitalRuta('${uid}',-1)">Retirar capital</button></div>`:''}
    ${movs.length?`<div class="muted" style="font-size:12px;margin-top:6px">${movs.slice(0,4).map(x=>`${fdate(x.fecha)}: ${x.valor>=0?'+ ':'− '}${fmt(Math.abs(x.valor))}${x.nota?' · '+esc(x.nota):''}`).join('<br>')}</div>`:''}</div>`;
}
function modalCapitalRuta(uid, signo){
  openModal(`<h3>${signo>0?'Añadir capital a':'Retirar capital de'} ${esc(nombreRuta(uid))}</h3>
    <p class="muted" style="margin-top:-8px">${signo>0?'Es la plata que destinas solo para esta ruta. La ruta puede prestar hasta lo disponible.':'Baja el fondo de la ruta (por ejemplo, si le sobra capital).'}</p>
    <div class="form"><label class="f">Valor<input class="input" id="kVal" inputmode="decimal" placeholder="Ej: 40.000.000"></label>
    <label class="f">Fecha<input type="date" class="input" id="kFec" value="${todayStr()}"></label>
    <label class="f full">Nota<input class="input" id="kNot" placeholder="Opcional"></label></div>
    <div class="actions"><button class="btn" onclick="closeModal()">Cancelar</button><button class="btn pri" id="kOk">${signo>0?'Añadir':'Retirar'}</button></div>`);
  const v=document.getElementById('kVal'); v.addEventListener('blur',()=>{ const n=num(v.value); if(n) v.value=fmtIn(n); });
  document.getElementById('kOk').onclick = ()=>{
    const n = num(v.value); if(n<=0) return toast('Escribe el valor');
    dbAdd('caprutas', {cobradorId:uid, fecha:document.getElementById('kFec').value||todayStr(), valor:signo*n, nota:document.getElementById('kNot').value.trim().slice(0,200)});
    auditar('capital', 'ruta', uid, `${nombreRuta(uid)}: ${signo>0?'+':'−'}${fmt(n)}`);
    closeModal(); render(); toast(signo>0?'Capital añadido a la ruta':'Capital retirado de la ruta');
  };
}
/* al prestar en una ruta con capital asignado, avisa si se pasa de lo disponible */
async function revisarCapitalAlPrestar(cobradorId, monto){
  if(!cobradorId) return true;
  const k = capitalRuta(cobradorId);
  if(!k.tiene || monto <= k.disponible + 0.5) return true;
  if(!isAdmin()) return 'solicitud';
  return confirmar(`${nombreRuta(cobradorId)} solo tiene ${fmt(Math.max(0,k.disponible))} disponible de su capital. Este crédito es de ${fmt(monto)}.${isCeo()?'\n\nPuedes añadirle capital en Usuarios → Editar.':''}\n\n¿Prestar de todas formas?`, {ok:'Prestar igual'});
}
