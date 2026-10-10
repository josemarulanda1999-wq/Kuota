/* =========================================================
   CONTROL DE PRÉSTAMOS — versión en la nube (Firebase)
   Administrador + cobradores, datos sincronizados en tiempo real.
   La capa de datos está en store.js (window.S).
   ========================================================= */
const PERIODOS = ['DIARIO','SEMANAL','QUINCENAL','MENSUAL'];
const COLS = ['clientes','prestamos','pagos','salidas','capital','ingresos','entregas','users'];

const defaultConfig = () => ({ negocio:'Kuota', capitalInicial:0, fechaCapital:'',
  factores:{DIARIO:30,SEMANAL:4,QUINCENAL:2,MENSUAL:1}, tasaDefecto:20, excluirDomingos:false, redondeo:0 });
const emptyDB = () => ({ config:defaultConfig(), clientes:[], prestamos:[], pagos:[], salidas:[], capital:[], ingresos:[], entregas:[], users:[] });

let DB = emptyDB();
let ME = null;            // perfil del usuario: {uid, nombre, email, rol, activo}
let view = 'panel';
let viewState = {};
let unsub = null;
const isAdmin = () => ME && ME.rol==='admin';            // CEO y Admin ven todo el negocio
const isCeo = () => !!(ME && ME.rol==='admin' && ME.esCeo); // solo el CEO edita, borra y configura
let CEO_UID = '';
const rolDe = u => !u ? '' : (u.id===CEO_UID || u.uid===CEO_UID) ? 'CEO' : u.rol==='admin' ? 'Admin' : 'Cobrador';
const horaDe = t => t ? new Date(t).toLocaleString('es-CO',{day:'2-digit',month:'short',hour:'numeric',minute:'2-digit'}) : '';
const isNative = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

function migrateConfig(c){
  const base = defaultConfig();
  const out = Object.assign(base, c||{});
  out.factores = Object.assign(defaultConfig().factores, (c||{}).factores||{});
  return out;
}

/* ---- escritura en la nube: se aplica local de inmediato y se sincroniza ---- */
function falloNube(e){ console.error(e); toast(e && e.code==='permission-denied' ? 'No tienes permiso para hacer eso' : 'No se pudo guardar en la nube'); }
function dbAdd(col, data){
  const id = S.newId(col);
  const obj = Object.assign({id, creado:Date.now(), creadoPor: ME?ME.uid:''}, data);
  DB[col].push(obj);
  S.set(col, id, obj).catch(falloNube);
  return id;
}
function dbUpd(col, id, data){
  const cur = DB[col].find(x=>x.id===id);
  if(cur) Object.assign(cur, data);
  S.update(col, id, data).catch(falloNube);
}
function dbDel(col, id){
  DB[col] = DB[col].filter(x=>x.id!==id);
  S.remove(col, id).catch(falloNube);
}
function cfgSave(){ S.setConfig(DB.config).catch(falloNube); }
function save(){ /* compatibilidad: la nube guarda en cada operación */ }

/* ---- render diferido si el usuario está escribiendo ---- */
let pendingRender=false;
function scheduleRender(){
  const a=document.activeElement, m=document.getElementById('main');
  if(a && m && m.contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName)){
    if(!pendingRender){ pendingRender=true; a.addEventListener('blur',()=>{ pendingRender=false; render(); },{once:true}); }
    return;
  }
  render();
}

/* ---------- utilidades ---------- */
const fmt = n => '$ ' + Math.round(Number(n)||0).toLocaleString('es-CO');
const fmtN = n => (Number(n)||0).toLocaleString('es-CO',{maximumFractionDigits:2});
const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const todayStr = () => { const d=new Date(); return ymd(d); };
const ymd = d => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const parseD = s => { const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d); };
const fdate = s => { if(!s) return ''; const d=parseD(s); return d.toLocaleDateString('es-CO',{day:'2-digit',month:'short',year:'numeric'}); };
const fdateShort = s => { const d=parseD(s); return d.toLocaleDateString('es-CO',{day:'2-digit',month:'short'}); };
const num = v => { if(typeof v==='number') return v; const s=String(v||'').replace(/[^\d,.-]/g,'').replace(/\./g,'').replace(',','.'); return Number(s)||0; };
const clienteById = id => DB.clientes.find(c=>c.id===id);
const nombreCliente = id => (clienteById(id)||{}).nombre || '(cliente borrado)';
const userById = id => DB.users.find(u=>u.id===id);
const nombreUsuario = id => !id ? 'Sin asignar' : (ME && ME.uid===id ? (ME.nombre||'Yo') : ((userById(id)||{}).nombre || 'Usuario'));
const cobradores = () => DB.users.filter(u=>u.rol==='cobrador').sort((a,b)=>(a.nombre||'').localeCompare(b.nombre||''));

function toast(msg){
  const t=document.createElement('div'); t.className='toast'; t.textContent=msg;
  document.body.appendChild(t); setTimeout(()=>t.remove(),2300);
}

/* ---------- cálculos (misma lógica del Excel) ---------- */
// Interés mensual = valor * %; Total = valor + interés mensual * meses
// No. cuotas = meses * factor (DIARIO 30, SEMANAL 4, QUINCENAL 2, MENSUAL 1)
// Valor cuota = Total / cuotas ; capital x cuota = valor/cuotas ; interés x cuota = interés total / cuotas
function calcular(monto, tasa, meses, periodo){
  const f = DB.config.factores[periodo] || 1;
  const cuotas = Math.max(1, Math.round(meses * f));
  const interesMes = monto * tasa/100;
  const interesTotal = interesMes * meses;
  const total = monto + interesTotal;
  let valorCuota = total / cuotas;
  const r = Number(DB.config.redondeo)||0;
  if(r>0) valorCuota = Math.ceil(valorCuota / r) * r;
  return { cuotas, interesMes, interesTotal, total, valorCuota,
           capitalCuota: monto/cuotas, interesCuota: interesTotal/cuotas };
}
function addPeriodo(d, periodo, excluirDomingos){
  const n = new Date(d);
  if(periodo==='DIARIO'){ n.setDate(n.getDate()+1); if(excluirDomingos && n.getDay()===0) n.setDate(n.getDate()+1); }
  else if(periodo==='SEMANAL') n.setDate(n.getDate()+7);
  else if(periodo==='QUINCENAL') n.setDate(n.getDate()+15);
  else { const day=n.getDate(); n.setMonth(n.getMonth()+1); if(n.getDate()!==day) n.setDate(0); }
  return n;
}
function cronograma(p){
  const out=[]; let d=parseD(p.fecha);
  for(let i=1;i<=p.cuotas;i++){ d=addPeriodo(d,p.periodo,p.excluirDomingos); out.push({n:i,fecha:ymd(d)}); }
  return out;
}
function pagosDe(id){ return DB.pagos.filter(x=>x.prestamoId===id).sort((a,b)=>a.fecha.localeCompare(b.fecha)); }
function estadoPrestamo(p, hoy=todayStr()){
  const pagos = pagosDe(p.id);
  const pagado = pagos.reduce((s,x)=>s+x.monto,0);
  const totalReal = p.valorCuota * p.cuotas; // lo que realmente se cobra
  const saldo = Math.max(0, totalReal - pagado);
  const cron = cronograma(p);
  const vencidas = cron.filter(c=>c.fecha<=hoy).length;
  const esperado = Math.min(totalReal, vencidas * p.valorCuota);
  let atraso = Math.max(0, esperado - pagado); if(atraso<1) atraso=0;          // pendiente hasta hoy (incluye la cuota de hoy)
  const vencidasAntes = cron.filter(c=>c.fecha<hoy).length;
  let atrasoMora = Math.max(0, Math.min(totalReal, vencidasAntes*p.valorCuota) - pagado); if(atrasoMora<1) atrasoMora=0; // solo cuotas de días anteriores
  const cuotasAtraso = atrasoMora>0 ? Math.ceil(atrasoMora / p.valorCuota - 1e-6) : 0;
  const cuotasPagadas = Math.min(p.cuotas, Math.floor((pagado+1) / p.valorCuota));
  const proxima = cron.find(c=>c.n>cuotasPagadas);
  const fracInteres = totalReal>0 ? (totalReal - p.monto)/totalReal : 0;
  const utilidad = Math.min(pagado, totalReal) * fracInteres;
  const venceHoy = cron.some(c=>c.fecha===hoy);
  let estado = 'Al día';
  if(saldo<1) estado='Pagado';
  else if(atrasoMora>0) estado='En mora';
  const diasMora = (estado==='En mora' && proxima) ? Math.max(0, Math.round((parseD(hoy)-parseD(proxima.fecha))/864e5)) : 0;
  return { pagado, saldo, totalReal, atraso, atrasoMora, cuotasAtraso, cuotasPagadas, proxima, utilidad, estado, venceHoy, cron, pagos, diasMora,
           ultimoPago: pagos.length? pagos[pagos.length-1].fecha : null };
}
function resumen(){
  const hoy = todayStr();
  let prestado=0, recaudo=0, utilidad=0, cartera=0, mora=0, activos=0, enMora=0;
  for(const p of DB.prestamos){
    const e = estadoPrestamo(p,hoy);
    prestado += p.monto; recaudo += e.pagado; utilidad += e.utilidad;
    if(e.estado!=='Pagado'){ cartera += e.saldo; activos++; }
    if(e.estado==='En mora'){ mora += e.atrasoMora; enMora++; }
  }
  const salidas = DB.salidas.reduce((s,x)=>s+x.valor,0);
  const aportes = DB.capital.reduce((s,x)=>s+x.valor,0);
  const ingresos = DB.ingresos.reduce((s,x)=>s+x.valor,0);
  const capital = DB.config.capitalInicial + aportes;
  const caja = capital - prestado + recaudo + ingresos - salidas;
  const recaudoHoy = DB.pagos.filter(x=>x.fecha===hoy).reduce((s,x)=>s+x.monto,0);
  return { prestado, recaudo, utilidad, cartera, mora, activos, enMora, salidas, caja, capital,
           efectivoTotal: capital + utilidad + ingresos, utilidadNeta: utilidad + ingresos - salidas, recaudoHoy, ingresos };
}
function cobrosDelDia(hoy=todayStr()){
  const out=[];
  for(const p of DB.prestamos){
    const e = estadoPrestamo(p,hoy);
    if(e.estado==='Pagado') continue;
    const pagadoHoy = e.pagos.filter(x=>x.fecha===hoy).reduce((s,x)=>s+x.monto,0);
    if(e.atraso>0.5 || e.venceHoy || pagadoHoy>0){
      out.push({p,e,pagadoHoy,cobrar: e.atraso});
    }
  }
  return out.sort((a,b)=>b.e.atraso-a.e.atraso);
}

/* ---------- navegación ---------- */
const ICONS = {
  panel:'<path d="M3 13h8V3H3zm0 8h8v-6H3zm10 0h8V11h-8zm0-18v6h8V3z"/>',
  cobros:'<path d="M12 2a10 10 0 100 20 10 10 0 000-20zm1 15h-2v-2h2zm0-4h-2V7h2z"/>',
  prestamos:'<path d="M21 7H3a1 1 0 00-1 1v8a1 1 0 001 1h18a1 1 0 001-1V8a1 1 0 00-1-1zm-9 8a3 3 0 110-6 3 3 0 010 6z"/>',
  clientes:'<path d="M16 11a4 4 0 10-4-4 4 4 0 004 4zm-8 0a3 3 0 10-3-3 3 3 0 003 3zm8 2c-2.7 0-8 1.3-8 4v3h16v-3c0-2.7-5.3-4-8-4zm-8 0c-.3 0-.7 0-1.1.1A4.7 4.7 0 019 17v3H1v-3c0-2.2 4.4-4 7-4z"/>',
  salidas:'<path d="M5 20h14v-2H5zm7-17l-7 7h4v6h6v-6h4z"/>',
  calculadora:'<path d="M7 2h10a2 2 0 012 2v16a2 2 0 01-2 2H7a2 2 0 01-2-2V4a2 2 0 012-2zm0 2v4h10V4zm1 7v2h2v-2zm4 0v2h2v-2zm4 0v6h2v-6zm-8 4v2h2v-2zm4 0v2h2v-2z"/>',
  movimientos:'<path d="M7 3L3 7l4 4V8h11V6H7zm10 10v3H6v2h11v3l4-4z"/>',
  ajustes:'<path d="M19.4 13a7.5 7.5 0 000-2l2.1-1.6-2-3.5-2.5 1a7.6 7.6 0 00-1.7-1L15 3h-4l-.4 2.7a7.6 7.6 0 00-1.7 1l-2.5-1-2 3.5L6.6 11a7.5 7.5 0 000 2l-2.1 1.6 2 3.5 2.5-1a7.6 7.6 0 001.7 1L11 21h4l.4-2.7a7.6 7.6 0 001.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 110-7 3.5 3.5 0 010 7z"/>'
};
ICONS.cuadre='<path d="M3 6h18v12H3zm2 2v8h14V8zm7 1.5a2.5 2.5 0 110 5 2.5 2.5 0 010-5z"/>';
ICONS.usuarios='<path d="M12 12a4 4 0 100-8 4 4 0 000 8zm0 2c-3.3 0-8 1.7-8 5v1h16v-1c0-3.3-4.7-5-8-5zm7-6h2v2h2v2h-2v2h-2v-2h-2v-2h2z"/>';
const NAV_ADMIN = [['panel','Panel','Panel'],['cobros','Cobros del día','Cobros'],['movimientos','Movimientos','Caja'],['cuadre','Cuadre de caja','Cuadre'],['prestamos','Préstamos','Préstamos'],['clientes','Clientes','Clientes'],['salidas','Salidas de dinero','Gastos'],['usuarios','Usuarios','Usuarios'],['calculadora','Calculadora','Calcular'],['ajustes','Ajustes y respaldo','Ajustes']];
const NAV_COB = [['cobros','Mi ruta','Ruta'],['clientes','Mis clientes','Clientes'],['prestamos','Préstamos','Préstamos'],['cuadre','Mi cuadre','Cuadre']];
const PERMITIDAS_COB = ['cobros','clientes','prestamos','cuadre'];
function renderNav(){
  const n = cobrosDelDia().filter(c=>c.cobrar>0.5).length;
  const NAV = isAdmin()? NAV_ADMIN.filter(([k])=>isCeo() || !['usuarios','ajustes'].includes(k)) : NAV_COB;
  document.getElementById('nav').innerHTML = NAV.map(([k,t,c])=>
    `<button class="${view===k?'on':''}" data-go="${k}"><svg viewBox="0 0 24 24" fill="currentColor">${ICONS[k]}</svg><span class="nl">${t}</span><span class="ns">${c}</span>${k==='cobros'&&n?`<span class="badge">${n}</span>`:''}</button>`).join('');
  document.getElementById('logoName').innerHTML = esc(DB.config.negocio)+'<small>Control de créditos</small>';
  const who = `<div class="who" style="margin-bottom:8px">${ava(ME.nombre)}<div style="min-width:0"><b style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(ME.nombre||ME.email)}</b><span>${rolDe(ME)}</span></div></div>`;
  document.getElementById('userBox').innerHTML = who + `<button onclick="cerrarSesion()">Cerrar sesión</button>`;
  document.getElementById('topUser').innerHTML = `<b>${esc(DB.config.negocio)}</b><span class="spacer"></span>${ava(ME.nombre)}<button class="btn sm" onclick="cerrarSesion()">Salir</button>`;
}
const movil = () => window.innerWidth < 760;
let _eraMovil = movil();
window.addEventListener('resize',()=>{ if(movil()!==_eraMovil){ _eraMovil=movil(); if(ME) render(); } });
function go(v, st={}){ view=v; viewState=st; render(); window.scrollTo(0,0); }
document.addEventListener('click', e=>{
  const g = e.target.closest('[data-go]'); if(g){ go(g.dataset.go); }
});
function render(){
  if(!ME) return;
  if(!isAdmin() && !PERMITIDAS_COB.includes(view)) view='cobros';
  if(!isCeo() && ['usuarios','ajustes'].includes(view)) view='panel';
  renderNav();
  const m = document.getElementById('main');
  m.innerHTML = (VIEWS[view]||VIEWS.panel)();
  if(AFTER[view]) AFTER[view]();
}

/* ---------- vistas ---------- */
const VIEWS = {}, AFTER = {};

VIEWS.panel = () => {
  const r = resumen();
  const dias = [];
  const hoy = new Date();
  for(let i=13;i>=0;i--){ const d=new Date(hoy); d.setDate(d.getDate()-i); const s=ymd(d);
    dias.push({s, v: DB.pagos.filter(x=>x.fecha===s).reduce((a,x)=>a+x.monto,0)}); }
  const max = Math.max(1,...dias.map(d=>d.v));
  const cobros = cobrosDelDia().slice(0,8);
  const banner = '';
  const total14 = dias.reduce((a,d)=>a+d.v,0);
  const W=600,H=170,pl=6,pr=6,pt=16,pb=24;
  const pts = dias.map((d,i)=>[pl+i*(W-pl-pr)/13, pt+(H-pt-pb)*(1-d.v/max)]);
  const line = pts.map(p=>p.map(n=>n.toFixed(1)).join(',')).join(' ');
  const area = `M${pts[0][0]},${H-pb} L`+line.replace(/ /g,' L')+` L${pts[13][0]},${H-pb} Z`;
  const ic = {
    plus:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    cobrar:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7 7 7-7"/></svg>',
    gasto:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12l7-7 7 7"/></svg>',
    cliente:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>'
  };
  return `
  ${banner}
  <div class="head"><div><h1>Panel</h1><p class="sub">${new Date().toLocaleDateString('es-CO',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</p></div>
  <div class="row"><button class="btn" onclick="modalPago()">Registrar pago</button><button class="btn pri" onclick="modalPrestamo()">+ Nuevo préstamo</button></div></div>
  <div class="hero">
    <div class="card balance">
      <div class="l">Efectivo en caja</div>
      <div class="v">${fmt(r.caja)}</div>
      <div class="n">Capital ${fmt(r.capital)} − prestado + recaudo − salidas</div>
      <div class="acciones">
        <button class="accion main" onclick="modalPrestamo()"><i>${ic.plus}</i>Prestar</button>
        <button class="accion" onclick="modalPago()"><i>${ic.cobrar}</i>Cobrar</button>
        <button class="accion" onclick="modalSalida()"><i>${ic.gasto}</i>Gasto</button>
        <button class="accion" onclick="modalCliente()"><i>${ic.cliente}</i>Cliente</button>
      </div>
    </div>
    <div class="kpis">
      <div class="kpi sky"><div class="l">Cartera por cobrar</div><div class="v">${fmt(r.cartera)}</div><div class="n">${r.activos} préstamos activos</div></div>
      <div class="kpi hl"><div class="l">Utilidad (intereses)</div><div class="v">${fmt(r.utilidad)}</div><div class="n">Neta después de salidas: ${fmt(r.utilidadNeta)}</div></div>
      <div class="kpi card"><div class="l">En mora</div><div class="v" style="color:${r.mora>0?'var(--red)':'inherit'}">${fmt(r.mora)}</div><div class="n">${r.enMora} préstamos atrasados</div></div>
      <div class="kpi cream"><div class="l">Recaudo total</div><div class="v">${fmt(r.recaudo)}</div><div class="n">Hoy: ${fmt(r.recaudoHoy)}</div></div>
    </div>
  </div>
  <div class="grid2">
    <div class="card pad">
      <div class="row" style="margin-bottom:6px"><h2 style="margin:0">Cobros pendientes de hoy</h2><span class="spacer"></span><button class="btn sm" data-go="cobros">Ver todos</button></div>
      ${cobros.length? `<div class="tablewrap"><table><tbody>
      ${cobros.map(c=>`<tr><td><div class="who">${ava(nombreCliente(c.p.clienteId))}<div>${esc(nombreCliente(c.p.clienteId))}<div class="muted" style="font-size:12px">${c.p.periodo.toLowerCase()} · cuota ${fmt(c.p.valorCuota)}</div></div></div></td>
        <td>${pill(c.e)}</td><td class="num"><b>${fmt(c.cobrar)}</b></td>
        <td class="right">${c.cobrar>0.5?`<button class="btn sm pri" onclick="modalPago('${c.p.id}')">Cobrar</button>`:`<span class="pill p-ok">Pagó ${fmt(c.pagadoHoy)}</span>`}</td></tr>`).join('')}
      </tbody></table></div>` : `<div class="empty">No hay cobros pendientes para hoy.</div>`}
    </div>
    <div class="card pad">
      <div class="row"><h2 style="margin:0">Recaudo últimos 14 días</h2><span class="spacer"></span><span class="pill p-ok">${fmt(total14)}</span></div>
      <svg class="linechart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        <defs><linearGradient id="limeFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c8f169" stop-opacity=".35"/><stop offset="1" stop-color="#c8f169" stop-opacity="0"/></linearGradient></defs>
        <path class="area" d="${area}"/>
        <polyline class="ln" points="${line}" vector-effect="non-scaling-stroke"/>
      </svg>
      <div class="row muted" style="justify-content:space-between;font-size:11px;margin-top:4px">${dias.filter((d,i)=>i%2===1).map(d=>`<span>${parseD(d.s).getDate()}</span>`).join('')}</div>
      <div class="detail-grid" style="margin:18px 0 0">
        <div><div class="l">Capital</div><div class="v">${fmt(r.capital)}</div></div>
        <div><div class="l">Total prestado</div><div class="v">${fmt(r.prestado)}</div></div>
        <div><div class="l">Salidas</div><div class="v">${fmt(r.salidas)}</div></div>
        <div><div class="l">Efectivo total</div><div class="v">${fmt(r.efectivoTotal)}</div></div>
        <div><div class="l">En manos de cobradores</div><div class="v" style="color:var(--amber)">${fmt(cobradores().reduce((s,u)=>s+cuadreCobrador(u.id).enMano,0))}</div></div>
      </div>
    </div>
  </div>
  <div class="card pad" style="margin-top:16px">
    <div class="row" style="margin-bottom:6px"><h2 style="margin:0">Últimos movimientos</h2><span class="spacer"></span><button class="btn sm" data-go="movimientos">Ver todos</button></div>
    ${(()=>{const ms=movimientos().slice(-6).reverse(); return ms.length?`<div class="tablewrap"><table><tbody>${ms.map(filaMov).join('')}</tbody></table></div>`:'<div class="empty">Aún no hay movimientos.</div>';})()}
  </div>`;
};

const AVA_COL=['#c8f169','#cfe4f4','#efeac2','#f5c7d9','#c9c3f7','#bdeee0'];
function ava(nombre){
  const n=String(nombre||'?').trim(); const parts=n.split(/\s+/);
  const ini=((parts[0]||'?')[0]+((parts[1]||'')[0]||'')).toUpperCase();
  let h=0; for(const ch of n) h=(h*31+ch.charCodeAt(0))>>>0;
  return `<span class="ava" style="background:${AVA_COL[h%AVA_COL.length]}">${esc(ini)}</span>`;
}

function pill(e){
  if(e.estado==='Pagado') return '<span class="pill p-pag">Pagado</span>';
  if(e.estado==='En mora') return `<span class="pill p-mora">Mora · ${e.cuotasAtraso} cuota${e.cuotasAtraso>1?'s':''}</span>`;
  if(e.venceHoy && e.atraso>0) return '<span class="pill p-hoy">Paga hoy</span>';
  return '<span class="pill p-ok">Al día</span>';
}

function filtroCobrador(vista){
  if(!isAdmin() || !cobradores().length) return '';
  const v=viewState.cob??'';
  return `<select class="input" style="width:auto" onchange="go('${vista}',Object.assign({},viewState,{cob:this.value}))">
    <option value="" ${v===''?'selected':''}>Todas las rutas</option><option value="_yo" ${v==='_yo'?'selected':''}>Sin asignar (míos)</option>
    ${cobradores().map(u=>`<option value="${u.id}" ${v===u.id?'selected':''}>Ruta de ${esc(u.nombre)}</option>`).join('')}</select>`;
}
function pasaFiltroCob(cobradorId){
  const v=viewState.cob||''; if(!v) return true;
  return v==='_yo' ? !cobradorId : cobradorId===v;
}
function cobroCard(c, fecha){
  const cl=clienteById(c.p.clienteId)||{};
  const tel=(cl.tel1||'').replace(/[^\d+]/g,'');
  return `<div class="card cobro">
    <div class="who" onclick="modalDetalle('${c.p.id}')" style="cursor:pointer">${ava(cl.nombre)}<div style="min-width:0;flex:1"><b>${esc(cl.nombre||'(sin cliente)')}</b><div class="muted" style="font-size:12.5px">${esc(cl.direccion||'Sin dirección')}</div></div>${pill(c.e)}</div>
    <div class="cobro-nums">
      <div><span>Cuota</span><b>${fmt(c.p.valorCuota)}</b></div>
      <div><span>Pendiente</span><b style="color:${c.cobrar>0.5?'var(--red)':'inherit'}">${fmt(c.cobrar)}</b></div>
      <div><span>Saldo</span><b>${fmt(c.e.saldo)}</b></div>
    </div>
    <div class="row">
      ${tel?`<a class="btn sm" href="tel:${esc(tel)}">Llamar</a>`:''}
      <span class="spacer"></span>
      ${c.pagadoHoy?`<span class="pill p-ok">Pagó ${fmt(c.pagadoHoy)}</span>`:''}
      ${c.cobrar>0.5?`<button class="btn pri" onclick="modalPago('${c.p.id}',null,'${fecha}')">Cobrar</button>`:''}
    </div></div>`;
}
VIEWS.cobros = () => {
  const fecha = viewState.fecha || todayStr();
  const list = cobrosDelDia(fecha).filter(c=>pasaFiltroCob(c.p.cobradorId));
  const tarjetas = !isAdmin() || movil();
  const totalCobrar = list.reduce((s,c)=>s+c.cobrar,0);
  const totalPagado = list.reduce((s,c)=>s+c.pagadoHoy,0);
  return `
  <div class="head"><div><h1>${isAdmin()?'Cobros del día':'Mi ruta'}</h1><p class="sub">Cuotas que vencen y préstamos atrasados. Marca el pago apenas cobres.</p></div>
  <div class="row">${filtroCobrador('cobros')}<input type="date" class="input" style="width:auto" value="${fecha}" onchange="go('cobros',Object.assign({},viewState,{fecha:this.value}))">${isNative()?'':'<button class="btn no-print" onclick="window.print()">Imprimir ruta</button>'}</div></div>
  <div class="kpis">
    <div class="kpi sky"><div class="l">Clientes a visitar</div><div class="v">${list.length}</div></div>
    <div class="kpi cream"><div class="l">Pendiente por cobrar</div><div class="v">${fmt(totalCobrar)}</div></div>
    <div class="kpi hl"><div class="l">Cobrado ese día</div><div class="v">${fmt(totalPagado)}</div></div>
  </div>
  ${tarjetas ? (list.length? `<div class="cobros-grid">${list.map(c=>cobroCard(c,fecha)).join('')}</div>` : `<div class="card"><div class="empty">Nada que cobrar en esta fecha.</div></div>`) : `<div class="card">
  ${list.length? `<div class="tablewrap"><table><thead><tr><th>Cliente</th><th>Teléfono / Dirección</th><th>Estado</th><th class="num">Cuota</th><th class="num">Pendiente</th><th class="num">Saldo</th><th class="num">Pagó</th><th></th></tr></thead><tbody>
  ${list.map(c=>{const cl=clienteById(c.p.clienteId)||{};return `<tr>
    <td><div class="who">${ava(cl.nombre)}<div><b>${esc(cl.nombre||'(sin cliente)')}</b><div class="muted" style="font-size:12px">${c.p.periodo.toLowerCase()}${cobradores().length?' · '+esc(nombreUsuario(c.p.cobradorId)):''}</div></div></div></td>
    <td>${esc(cl.tel1||'')}<div class="muted" style="font-size:12px">${esc(cl.direccion||'')}</div></td>
    <td>${pill(c.e)}</td><td class="num">${fmt(c.p.valorCuota)}</td><td class="num" style="color:${c.e.atraso>0?'var(--red)':'inherit'}">${fmt(c.e.atraso)}</td>
    <td class="num">${fmt(c.e.saldo)}</td><td class="num">${c.pagadoHoy?fmt(c.pagadoHoy):'—'}</td>
    <td class="right no-print" style="white-space:nowrap">${c.cobrar>0.5?`<button class="btn sm pri" onclick="modalPago('${c.p.id}',null,'${fecha}')">Cobrar</button>`:'<span class="pill p-ok">Cobrado</span>'} <button class="btn sm" onclick="modalDetalle('${c.p.id}')">Ver</button></td></tr>`}).join('')}
  </tbody></table></div>` : `<div class="empty">Nada que cobrar en esta fecha.</div>`}
  </div>`}`;
};

VIEWS.prestamos = () => {
  const q = (viewState.q||'').toLowerCase();
  const f = viewState.f||'activos';
  let rows = DB.prestamos.filter(p=>pasaFiltroCob(p.cobradorId)).map(p=>({p,e:estadoPrestamo(p),c:clienteById(p.clienteId)||{}}));
  if(q) rows = rows.filter(r=>(r.c.nombre||'').toLowerCase().includes(q) || (r.c.cedula||'').includes(q));
  if(f==='activos') rows = rows.filter(r=>r.e.estado!=='Pagado');
  if(f==='mora') rows = rows.filter(r=>r.e.estado==='En mora');
  if(f==='pagados') rows = rows.filter(r=>r.e.estado==='Pagado');
  rows.sort((a,b)=>b.p.fecha.localeCompare(a.p.fecha));
  const fb = (k,t)=>`<button class="btn sm ${f===k?'pri':''}" onclick="go('prestamos',Object.assign({},viewState,{f:'${k}'}))">${t}</button>`;
  return `
  <div class="head"><div><h1>Préstamos</h1><p class="sub">${DB.prestamos.length} préstamos registrados</p></div>
  ${isAdmin()?`<div class="row"><button class="btn" onclick="exportCSV('prestamos')">Exportar a Excel</button><button class="btn pri" onclick="modalPrestamo()">+ Nuevo préstamo</button></div>`:''}</div>
  <div class="toolbar">
    <input class="input search" id="qPrest" placeholder="Buscar por nombre o cédula" value="${esc(viewState.q||'')}">
    ${filtroCobrador('prestamos')}
    ${fb('activos','Activos')}${fb('mora','En mora')}${fb('pagados','Pagados')}${fb('todos','Todos')}
  </div>
  ${movil() ? (rows.length?`<div class="cobros-grid">${rows.map(({p,e,c})=>`<div class="card cobro" onclick="modalDetalle('${p.id}')" style="cursor:pointer">
      <div class="who">${ava(c.nombre)}<div style="min-width:0;flex:1"><b>${esc(c.nombre||'(sin cliente)')}</b><div class="muted" style="font-size:12.5px">${fdate(p.fecha)} · ${p.cuotas} cuotas ${p.periodo.toLowerCase()}</div></div>${pill(e)}</div>
      <div class="cobro-nums"><div><span>Prestado</span><b>${fmt(p.monto)}</b></div><div><span>Cuota</span><b>${fmt(p.valorCuota)}</b></div><div><span>Saldo</span><b>${fmt(e.saldo)}</b></div></div>
      <div><div class="progress"><i style="width:${Math.min(100,e.pagado/e.totalReal*100)}%"></i></div><div class="muted" style="font-size:11.5px;margin-top:4px">${e.cuotasPagadas} de ${p.cuotas} cuotas pagadas</div></div></div>`).join('')}</div>`:`<div class="card"><div class="empty">${DB.prestamos.length?'No hay préstamos con ese filtro.':(isAdmin()?'Aún no hay préstamos.':'Todavía no tienes préstamos asignados.')}</div></div>`) : `<div class="card">
  ${rows.length? `<div class="tablewrap"><table><thead><tr><th>Deudor</th><th>Fecha</th><th class="num">Valor</th><th class="num">% Int.</th><th>Periodo</th><th class="num">Cuota</th><th>Avance</th><th class="num">Saldo</th><th>Estado</th></tr></thead><tbody>
  ${rows.map(({p,e,c})=>`<tr class="click" onclick="modalDetalle('${p.id}')">
    <td><div class="who">${ava(c.nombre)}<div><b>${esc(c.nombre||'(sin cliente)')}</b><div class="muted" style="font-size:12px">${esc(c.cedula||'')}${isAdmin()&&cobradores().length?' · '+esc(nombreUsuario(p.cobradorId)):''}</div></div></div></td>
    <td>${fdate(p.fecha)}</td><td class="num">${fmt(p.monto)}</td><td class="num">${fmtN(p.tasa)}%</td>
    <td>${p.periodo.charAt(0)+p.periodo.slice(1).toLowerCase()} · ${p.cuotas}</td><td class="num">${fmt(p.valorCuota)}</td>
    <td style="min-width:110px"><div class="progress"><i style="width:${Math.min(100,e.pagado/e.totalReal*100)}%"></i></div><div class="muted" style="font-size:11px;margin-top:3px">${e.cuotasPagadas}/${p.cuotas} cuotas</div></td>
    <td class="num">${fmt(e.saldo)}</td><td>${pill(e)}</td></tr>`).join('')}
  </tbody></table></div>` : `<div class="empty">${DB.prestamos.length?'No hay préstamos con ese filtro.':(isAdmin()?'Aún no hay préstamos. Crea el primero con “+ Nuevo préstamo”.':'Todavía no tienes préstamos asignados.')}</div>`}
  </div>`}`;
};
AFTER.prestamos = () => {
  const i = document.getElementById('qPrest');
  i.addEventListener('input', ()=>{ viewState.q=i.value; const pos=i.selectionStart; render(); const j=document.getElementById('qPrest'); j.focus(); j.setSelectionRange(pos,pos); });
};

VIEWS.clientes = () => {
  const q=(viewState.q||'').toLowerCase();
  let rows = DB.clientes.filter(c=>pasaFiltroCob(c.cobradorId)).filter(c=>!q || (c.nombre||'').toLowerCase().includes(q) || (c.cedula||'').includes(q) || (c.tel1||'').includes(q));
  rows.sort((a,b)=>(a.nombre||'').localeCompare(b.nombre||''));
  return `
  <div class="head"><div><h1>${isAdmin()?'Clientes':'Mis clientes'}</h1><p class="sub">${rows.length} clientes</p></div>
  <div class="row">${isAdmin()?`<button class="btn" onclick="exportCSV('clientes')">Exportar a Excel</button>`:''}<button class="btn pri" onclick="modalCliente()">+ Nuevo cliente</button></div></div>
  <div class="toolbar"><input class="input search" id="qCli" placeholder="Buscar nombre, cédula o teléfono" value="${esc(viewState.q||'')}">${filtroCobrador('clientes')}</div>
  ${movil() ? (rows.length?`<div class="cobros-grid">${rows.map(c=>{const ps=DB.prestamos.filter(p=>p.clienteId===c.id);const saldo=ps.reduce((s,p)=>s+estadoPrestamo(p).saldo,0);const tel=(c.tel1||'').replace(/[^\d+]/g,'');return `<div class="card cobro">
      <div class="who">${ava(c.nombre)}<div style="min-width:0;flex:1"><b>${esc(c.nombre)}</b><div class="muted" style="font-size:12.5px">${esc(c.direccion||c.tel1||'')}</div></div></div>
      <div class="cobro-nums"><div><span>Préstamos</span><b>${ps.length}</b></div><div><span>Saldo</span><b>${fmt(saldo)}</b></div><div><span>${isAdmin()?'Ruta':'Cédula'}</span><b style="font-size:13px">${esc(isAdmin()?nombreUsuario(c.cobradorId):(c.cedula||'—'))}</b></div></div>
      <div class="row">${tel?`<a class="btn sm" href="tel:${esc(tel)}">Llamar</a>`:''}<span class="spacer"></span>${isAdmin()?`<button class="btn sm" onclick="modalPrestamo(null,'${c.id}')">Prestar</button>`:''}<button class="btn sm" onclick="modalCliente('${c.id}')">Editar</button></div></div>`}).join('')}</div>`:`<div class="card"><div class="empty">${DB.clientes.length?'Sin resultados.':'Aún no hay clientes registrados.'}</div></div>`) : `<div class="card">
  ${rows.length? `<div class="tablewrap"><table><thead><tr><th>Nombre</th><th># Identificación</th><th>Teléfono 1</th><th>Teléfono 2</th><th>Dirección</th><th>Ciudad</th>${isAdmin()?'<th>Cobrador</th>':''}<th class="num">Préstamos</th><th class="num">Saldo</th><th></th></tr></thead><tbody>
  ${rows.map(c=>{const ps=DB.prestamos.filter(p=>p.clienteId===c.id);const saldo=ps.reduce((s,p)=>s+estadoPrestamo(p).saldo,0);return `<tr>
    <td><div class="who">${ava(c.nombre)}<div><b>${esc(c.nombre)}</b>${c.obs?`<div class="muted" style="font-size:12px">${esc(c.obs)}</div>`:''}</div></div></td><td>${esc(c.cedula)}</td><td>${esc(c.tel1)}</td><td>${esc(c.tel2)}</td>
    <td>${esc(c.direccion)}</td><td>${esc(c.ciudad)}</td>${isAdmin()?`<td>${esc(nombreUsuario(c.cobradorId))}</td>`:''}<td class="num">${ps.length}</td><td class="num">${fmt(saldo)}</td>
    <td class="right" style="white-space:nowrap">${isAdmin()?`<button class="btn sm" onclick="modalPrestamo(null,'${c.id}')">Prestar</button>`:''} <button class="btn sm" onclick="modalCliente('${c.id}')">Editar</button></td></tr>`}).join('')}
  </tbody></table></div>` : `<div class="empty">${DB.clientes.length?'Sin resultados.':'Aún no hay clientes registrados.'}</div>`}
  </div>`}`;
};
AFTER.clientes = () => {
  const i = document.getElementById('qCli');
  i.addEventListener('input', ()=>{ viewState.q=i.value; const pos=i.selectionStart; render(); const j=document.getElementById('qCli'); j.focus(); j.setSelectionRange(pos,pos); });
};

VIEWS.salidas = () => {
  const rows = [...DB.salidas].sort((a,b)=>b.fecha.localeCompare(a.fecha));
  const total = rows.reduce((s,x)=>s+x.valor,0);
  const mes = todayStr().slice(0,7);
  const totalMes = rows.filter(x=>x.fecha.startsWith(mes)).reduce((s,x)=>s+x.valor,0);
  return `
  <div class="head"><div><h1>Salidas de dinero</h1><p class="sub">Gastos y retiros que se descuentan de la caja.</p></div>
  <div class="row"><button class="btn" onclick="exportCSV('salidas')">Exportar a Excel</button><button class="btn pri" onclick="modalSalida()">+ Registrar salida</button></div></div>
  <div class="kpis"><div class="kpi cream"><div class="l">Total salidas</div><div class="v">${fmt(total)}</div></div><div class="kpi sky"><div class="l">Este mes</div><div class="v">${fmt(totalMes)}</div></div></div>
  <div class="card">
  ${rows.length? `<div class="tablewrap"><table><thead><tr><th>Fecha</th><th>Concepto</th><th class="num">Valor</th><th>Registró</th><th></th></tr></thead><tbody>
  ${rows.map(s=>`<tr><td>${fdate(s.fecha)}</td><td>${esc(s.concepto)}</td><td class="num">${fmt(s.valor)}</td><td class="muted">${esc(nombreUsuario(s.creadoPor))}</td><td class="right">${isCeo()?`<button class="btn sm" onclick="modalSalida('${s.id}')">Editar</button>`:''}</td></tr>`).join('')}
  </tbody></table></div>`:`<div class="empty">No hay salidas registradas.</div>`}
  </div>`;
};

VIEWS.calculadora = () => {
  const s = viewState.calc || {monto:200000,tasa:DB.config.tasaDefecto,meses:1};
  const rows = PERIODOS.map(per=>{const c=calcular(num(s.monto),num(s.tasa),num(s.meses),per);return {per,c};});
  return `
  <div class="head"><div><h1>Calculadora de cuotas</h1><p class="sub">Simula un préstamo antes de hacerlo.</p></div></div>
  <div class="card pad" style="margin-bottom:16px">
    <div class="form" style="grid-template-columns:repeat(3,1fr)">
      <label class="f">Valor del préstamo<input class="input" id="cMonto" value="${esc(s.monto)}" inputmode="numeric"></label>
      <label class="f">% interés mensual<input class="input" id="cTasa" value="${esc(s.tasa)}" inputmode="decimal"></label>
      <label class="f">No. de meses<input class="input" id="cMeses" value="${esc(s.meses)}" inputmode="decimal"></label>
    </div>
    <p class="muted" style="margin:12px 0 0">Interés por mes: <b style="color:var(--ink)">${fmt(num(s.monto)*num(s.tasa)/100)}</b> · Total a pagar: <b style="color:var(--ink)">${fmt(num(s.monto)+num(s.monto)*num(s.tasa)/100*num(s.meses))}</b></p>
  </div>
  <div class="card"><table><thead><tr><th>Forma de pago</th><th class="num"># de cuotas</th><th class="num">Valor cuota</th><th class="num">Capital x cuota</th><th class="num">Interés x cuota</th><th class="num">Total a pagar</th><th></th></tr></thead><tbody>
  ${rows.map(({per,c})=>`<tr><td><b>${per.charAt(0)+per.slice(1).toLowerCase()}</b></td><td class="num">${c.cuotas}</td><td class="num"><b>${fmt(c.valorCuota)}</b></td><td class="num">${fmt(c.capitalCuota)}</td><td class="num">${fmt(c.interesCuota)}</td><td class="num">${fmt(c.valorCuota*c.cuotas)}</td>
  <td class="right"><button class="btn sm" onclick="modalPrestamo(null,null,{monto:${num(s.monto)},tasa:${num(s.tasa)},meses:${num(s.meses)},periodo:'${per}'})">Crear préstamo</button></td></tr>`).join('')}
  </tbody></table></div>`;
};
AFTER.calculadora = () => {
  ['cMonto','cTasa','cMeses'].forEach(id=>{
    const i=document.getElementById(id);
    i.addEventListener('input',()=>{ viewState.calc={monto:document.getElementById('cMonto').value,tasa:document.getElementById('cTasa').value,meses:document.getElementById('cMeses').value};
      const pos=i.selectionStart; render(); const j=document.getElementById(id); j.focus(); j.setSelectionRange(pos,pos); });
  });
};

VIEWS.ajustes = () => {
  const c = DB.config;
  return `
  <div class="head"><div><h1>Ajustes y respaldo</h1><p class="sub">Configura el negocio y protege tu información.</p></div></div>
  <div class="grid2">
  <div class="card pad">
    <h2>Datos del negocio</h2>
    <div class="form">
      <label class="f full">Nombre del negocio<input class="input" id="sNeg" value="${esc(c.negocio)}"></label>
      <label class="f">Capital inicial<input class="input" id="sCap" value="${esc(c.capitalInicial)}" inputmode="numeric"></label>
      <label class="f">Fecha del capital inicial<input type="date" class="input" id="sFecCap" value="${esc(c.fechaCapital||'')}"></label>
      <label class="f">% interés por defecto<input class="input" id="sTasa" value="${esc(c.tasaDefecto)}"></label>
      <label class="f">Cuotas por mes (diario)<input class="input" id="fD" value="${c.factores.DIARIO}"></label>
      <label class="f">Cuotas por mes (semanal)<input class="input" id="fS" value="${c.factores.SEMANAL}"></label>
      <label class="f">Cuotas por mes (quincenal)<input class="input" id="fQ" value="${c.factores.QUINCENAL}"></label>
      <label class="f">Cuotas por mes (mensual)<input class="input" id="fM" value="${c.factores.MENSUAL}"></label>
      <label class="f">Redondear cuota a múltiplos de<select class="input" id="sRed">${[0,50,100,500,1000].map(v=>`<option value="${v}" ${Number(c.redondeo)===v?'selected':''}>${v?fmt(v):'Sin redondeo'}</option>`).join('')}</select></label>
      <label class="chk full"><input type="checkbox" id="sDom" ${c.excluirDomingos?'checked':''}> Por defecto, no cobrar los domingos en préstamos diarios</label>
    </div>
    <div class="actions row" style="margin-top:16px"><button class="btn pri" onclick="guardarAjustes()">Guardar ajustes</button></div>
    <p class="muted" style="font-size:12px;margin-top:12px">Los cambios de cuotas por mes y redondeo aplican a préstamos nuevos. Los existentes conservan sus cuotas.</p>
    <hr style="border:none;border-top:1px solid var(--line);margin:18px 0">
    <h2>Aportes o retiros de capital</h2>
    <p class="muted" style="margin-top:-6px">Si metes más plata al negocio (o sacas capital), regístralo aquí.</p>
    ${DB.capital.length?`<table style="margin-bottom:10px"><tbody>${DB.capital.map(x=>`<tr><td>${fdate(x.fecha)}</td><td>${esc(x.concepto)}</td><td class="num">${fmt(x.valor)}</td><td class="right"><button class="btn sm danger" onclick="borrarCapital('${x.id}')">Borrar</button></td></tr>`).join('')}</tbody></table>`:''}
    <button class="btn" onclick="modalCapital()">+ Registrar aporte / retiro</button>
  </div>
  <div class="card pad">
    <h2>Respaldo de la información</h2>
    <p class="muted" style="margin-top:-6px">Todo queda guardado en la nube y se sincroniza con los celulares de los cobradores. Igual puedes descargar una copia cuando quieras.</p>
    <div class="row" style="margin-bottom:10px">
      <button class="btn" onclick="descargarRespaldo()">Descargar copia (.json)</button>
      <button class="btn" onclick="document.getElementById('impFile').click()">Subir datos de la app anterior</button>
      <input type="file" id="impFile" accept=".json,application/json" style="display:none" onchange="importar(this.files[0])">
    </div>
    <div class="row" style="margin-bottom:10px">
      <button class="btn" onclick="exportCSV('prestamos')">Préstamos a Excel</button>
      <button class="btn" onclick="exportCSV('pagos')">Pagos a Excel</button>
      <button class="btn" onclick="exportCSV('clientes')">Clientes a Excel</button>
      <button class="btn" onclick="exportCSV('salidas')">Salidas a Excel</button>
      <button class="btn" onclick="exportCSV('movimientos')">Movimientos a Excel</button>
    </div>
  </div>
  </div>`;
};


/* ---------- movimientos de dinero (libro de caja) ---------- */
const TIPOS_MOV = {
  capital:{t:'Capital',c:'p-pag'}, aporte:{t:'Aporte',c:'p-pag'}, retiro:{t:'Retiro',c:'p-hoy'},
  prestamo:{t:'Préstamo',c:'p-mora'}, pago:{t:'Pago recibido',c:'p-ok'}, gasto:{t:'Gasto',c:'p-hoy'}, ingreso:{t:'Ingreso extra',c:'p-ok'}
};
function primeraFecha(){
  const fs=[...DB.prestamos,...DB.pagos,...DB.salidas,...DB.capital,...DB.ingresos].map(x=>x.fecha).filter(Boolean).sort();
  return fs[0] || todayStr();
}
function movimientos(){
  const L=[];
  const cap = Number(DB.config.capitalInicial)||0;
  if(cap) L.push({key:'cap0',fecha:DB.config.fechaCapital||primeraFecha(),orden:0,creado:0,tipo:'capital',concepto:'Capital inicial',detalle:'Plata con la que empezó el negocio',ent:cap,sal:0,por:CEO_UID});
  for(const x of DB.capital){
    if(x.valor>=0) L.push({key:'k'+x.id,id:x.id,fecha:x.fecha,orden:1,creado:x.creado||0,tipo:'aporte',concepto:'Aporte de capital',detalle:x.concepto,ent:x.valor,sal:0,por:x.creadoPor});
    else L.push({key:'k'+x.id,id:x.id,fecha:x.fecha,orden:4,creado:x.creado||0,tipo:'retiro',concepto:'Retiro de capital',detalle:x.concepto,ent:0,sal:-x.valor,por:x.creadoPor});
  }
  for(const p of DB.prestamos){
    const per={DIARIO:'diarias',SEMANAL:'semanales',QUINCENAL:'quincenales',MENSUAL:'mensuales'}[p.periodo]||'';
    L.push({key:'p'+p.id,id:p.id,fecha:p.fecha,orden:3,creado:p.creado||0,tipo:'prestamo',concepto:'Préstamo a '+nombreCliente(p.clienteId),detalle:`${fmtN(p.tasa)}% mensual, ${p.cuotas} cuotas ${per} de ${fmt(p.valorCuota)}`,ent:0,sal:p.monto,por:p.creadoPor});
  }
  for(const x of DB.pagos){
    const p=DB.prestamos.find(y=>y.id===x.prestamoId); if(!p) continue;
    const tot=p.valorCuota*p.cuotas, fr= tot>0?(tot-p.monto)/tot:0, int=x.monto*fr;
    L.push({key:'g'+x.id,id:x.id,prestamoId:p.id,fecha:x.fecha,orden:2,creado:x.creado||0,tipo:'pago',concepto:'Pago de '+nombreCliente(p.clienteId),detalle:`Capital ${fmt(x.monto-int)} + interés ${fmt(int)}${x.nota?' — '+x.nota:''}`,ent:x.monto,sal:0,interes:int,por:x.registradoPor||x.creadoPor});
  }
  for(const x of DB.salidas) L.push({key:'s'+x.id,id:x.id,fecha:x.fecha,orden:4,creado:x.creado||0,tipo:'gasto',concepto:x.concepto,detalle:'Salida de dinero',ent:0,sal:x.valor,por:x.creadoPor});
  for(const x of DB.ingresos) L.push({key:'i'+x.id,id:x.id,fecha:x.fecha,orden:2,creado:x.creado||0,tipo:'ingreso',concepto:x.concepto,detalle:'Ingreso extra',ent:x.valor,sal:0,por:x.creadoPor});
  L.sort((a,b)=>a.fecha.localeCompare(b.fecha)||a.orden-b.orden||a.creado-b.creado);
  let s=0; for(const m of L){ s+=m.ent-m.sal; m.saldo=s; }
  return L;
}
function abrirMov(key){
  const m=movimientos().find(x=>x.key===key); if(!m) return;
  if(m.tipo==='prestamo') return modalDetalle(m.id);
  if(!isCeo()) return modalVerMov(m);
  if(m.tipo==='capital') return go('ajustes');
  if(m.tipo==='prestamo') return modalDetalle(m.id);
  if(m.tipo==='pago') return modalPago(null,m.id);
  if(m.tipo==='gasto') return modalSalida(m.id);
  if(m.tipo==='ingreso') return modalMovimiento('ingreso',m.id);
  return modalMovimiento(m.tipo,m.id);
}
const flecha = ent => ent
  ? '<span class="mv-ic in"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12l7 7 7-7"/></svg></span>'
  : '<span class="mv-ic out"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg></span>';
function quienHizo(m){
  return m.por ? `<div class="who" style="white-space:nowrap">${ava(nombreUsuario(m.por)).replace('class="ava"','class="ava mini"')}<div><span>${esc(nombreUsuario(m.por))}</span><div class="muted" style="font-size:11.5px">${esc(rolDe(userById(m.por)||{id:m.por}))}${m.creado?' · '+horaDe(m.creado):''}</div></div></div>` : '<span class="muted">—</span>';
}
function modalVerMov(m){
  const tp=TIPOS_MOV[m.tipo];
  openModal(`<div class="row" style="margin-bottom:14px">${flecha(m.ent>0)}<h3 style="margin:0">${esc(m.concepto)}</h3><span class="pill ${tp.c}">${tp.t}</span></div>
  <div class="detail-grid">
    <div><div class="l">Fecha</div><div class="v">${fdate(m.fecha)}</div></div>
    <div><div class="l">${m.ent?'Entrada':'Salida'}</div><div class="v" style="color:${m.ent?'var(--green)':'var(--red)'}">${fmt(m.ent||m.sal)}</div></div>
    <div><div class="l">Saldo en caja después</div><div class="v">${fmt(m.saldo)}</div></div>
  </div>
  <p class="muted">${esc(m.detalle||'')}</p>
  <div class="calcbox" style="grid-template-columns:1fr"><div><div class="l">Registrado por</div><div style="margin-top:6px">${quienHizo(m)}</div></div></div>
  <p class="muted" style="font-size:12.5px;margin-top:14px">Solo el CEO puede editar o borrar movimientos.</p>
  <div class="actions"><button class="btn" onclick="closeModal()">Cerrar</button></div>`);
}
function filaMov(m){
  const tp=TIPOS_MOV[m.tipo];
  return `<tr class="click" onclick="abrirMov('${m.key}')">
    <td style="white-space:nowrap">${fdate(m.fecha)}</td>
    <td><div class="who">${flecha(m.ent>0)}<div><b>${esc(m.concepto)}</b><div class="muted" style="font-size:12px">${esc(m.detalle||'')}</div></div></div></td>
    <td><span class="pill ${tp.c}">${tp.t}</span></td>
    <td>${quienHizo(m)}</td>
    <td class="num" style="color:var(--green)">${m.ent?'+ '+fmt(m.ent):''}</td>
    <td class="num" style="color:var(--red)">${m.sal?'− '+fmt(m.sal):''}</td>
    <td class="num"><b>${fmt(m.saldo)}</b></td></tr>`;
}
function rangoMov(r){
  const h=parseD(todayStr());
  if(r==='hoy') return [todayStr(),todayStr()];
  if(r==='semana'){ const d=new Date(h); d.setDate(d.getDate()-6); return [ymd(d),todayStr()]; }
  if(r==='mes') return [todayStr().slice(0,8)+'01',todayStr()];
  if(r==='mespasado'){ const d=new Date(h.getFullYear(),h.getMonth()-1,1), e=new Date(h.getFullYear(),h.getMonth(),0); return [ymd(d),ymd(e)]; }
  return ['',''];
}
VIEWS.movimientos = () => {
  const st = Object.assign({r:'mes',t:'todos',q:'',desde:'',hasta:''}, viewState);
  let [desde,hasta] = st.r==='custom' ? [st.desde,st.hasta] : rangoMov(st.r);
  const all = movimientos();
  const enRango = all.filter(m=>(!desde||m.fecha>=desde)&&(!hasta||m.fecha<=hasta));
  const antes = desde ? all.filter(m=>m.fecha<desde) : [];
  const saldoIni = antes.length ? antes[antes.length-1].saldo : 0;
  const ent = enRango.reduce((s,m)=>s+m.ent,0), sal = enRango.reduce((s,m)=>s+m.sal,0);
  const sum = t => enRango.filter(m=>m.tipo===t).reduce((s,m)=>s+m.ent+m.sal,0);
  const intereses = enRango.filter(m=>m.tipo==='pago').reduce((s,m)=>s+m.interes,0);
  let rows = enRango;
  if(st.t==='entradas') rows=rows.filter(m=>m.ent>0);
  else if(st.t==='salidas') rows=rows.filter(m=>m.sal>0);
  else if(st.t!=='todos') rows=rows.filter(m=>m.tipo===st.t || (st.t==='capital' && (m.tipo==='aporte'||m.tipo==='retiro')));
  const q=(st.q||'').toLowerCase();
  if(q) rows=rows.filter(m=>(m.concepto+' '+m.detalle).toLowerCase().includes(q));
  rows=[...rows].reverse();
  const S = o=>JSON.stringify(Object.assign({},st,o)).replace(/"/g,'&quot;');
  const rb=(k,t)=>`<button class="btn sm ${st.r===k?'pri':''}" onclick="go('movimientos',${S({r:k})})">${t}</button>`;
  const tb=(k,t)=>`<option value="${k}" ${st.t===k?'selected':''}>${t}</option>`;
  const nombreRango = {hoy:'hoy',semana:'los últimos 7 días',mes:'este mes',mespasado:'el mes pasado',todo:'todo el tiempo',custom:'el periodo elegido'}[st.r];
  return `
  <div class="head"><div><h1>Movimientos</h1><p class="sub">Todo lo que entra y sale de la caja: préstamos, pagos, gastos y capital.</p></div>
  <div class="row"><button class="btn" onclick="exportCSV('movimientos')">Exportar a Excel</button><button class="btn pri" onclick="modalMovimiento()">+ Registrar movimiento</button></div></div>
  <div class="toolbar">
    ${rb('hoy','Hoy')}${rb('semana','7 días')}${rb('mes','Este mes')}${rb('mespasado','Mes pasado')}${rb('todo','Todo')}
    <input type="date" class="input" style="width:auto" value="${desde}" onchange="go('movimientos',Object.assign(${S({r:'custom'})},{desde:this.value,hasta:'${hasta}'}))" title="Desde">
    <input type="date" class="input" style="width:auto" value="${hasta}" onchange="go('movimientos',Object.assign(${S({r:'custom'})},{desde:'${desde}',hasta:this.value}))" title="Hasta">
  </div>
  <div class="kpis">
    <div class="kpi card"><div class="l">Saldo al empezar</div><div class="v">${fmt(saldoIni)}</div><div class="n">${desde?'Antes del '+fdate(desde):'Inicio del negocio'}</div></div>
    <div class="kpi hl"><div class="l">Entradas</div><div class="v">+ ${fmt(ent)}</div><div class="n">${enRango.filter(m=>m.ent>0).length} movimientos</div></div>
    <div class="kpi cream"><div class="l">Salidas</div><div class="v">− ${fmt(sal)}</div><div class="n">${enRango.filter(m=>m.sal>0).length} movimientos</div></div>
    <div class="kpi sky"><div class="l">Saldo al final</div><div class="v">${fmt(saldoIni+ent-sal)}</div><div class="n">${ent-sal>=0?'Subió':'Bajó'} ${fmt(Math.abs(ent-sal))} en ${nombreRango}</div></div>
  </div>
  <div class="card pad" style="margin-bottom:16px">
    <div class="detail-grid" style="margin:0">
      <div><div class="l">Cobrado en pagos</div><div class="v" style="color:var(--green)">${fmt(sum('pago'))}</div></div>
      <div><div class="l">De eso, intereses</div><div class="v">${fmt(intereses)}</div></div>
      <div><div class="l">Prestado</div><div class="v" style="color:var(--red)">${fmt(sum('prestamo'))}</div></div>
      <div><div class="l">Gastos</div><div class="v">${fmt(sum('gasto'))}</div></div>
      <div><div class="l">Ingresos extra</div><div class="v">${fmt(sum('ingreso'))}</div></div>
      <div><div class="l">Capital (inicial + aportes − retiros)</div><div class="v">${fmt(sum('aporte')+sum('capital')-sum('retiro'))}</div></div>
    </div>
  </div>
  <div class="toolbar">
    <input class="input search" id="qMov" placeholder="Buscar cliente o concepto" value="${esc(st.q)}">
    <select class="input" style="width:auto" onchange="go('movimientos',Object.assign(${S({})},{t:this.value}))">
      ${tb('todos','Todos los movimientos')}${tb('entradas','Solo entradas')}${tb('salidas','Solo salidas')}${tb('prestamo','Préstamos')}${tb('pago','Pagos recibidos')}${tb('gasto','Gastos')}${tb('ingreso','Ingresos extra')}${tb('capital','Capital')}
    </select>
    <span class="muted" style="margin-left:auto;font-size:13px">${rows.length} movimiento${rows.length===1?'':'s'}</span>
  </div>
  <div class="card">
  ${rows.length?`<div class="tablewrap"><table><thead><tr><th>Fecha</th><th>Movimiento</th><th>Tipo</th><th>Registró</th><th class="num">Entrada</th><th class="num">Salida</th><th class="num">Saldo en caja</th></tr></thead><tbody>
  ${rows.map(filaMov).join('')}</tbody></table></div>`:`<div class="empty">No hay movimientos en ${nombreRango}. Cuando prestes, cobres o registres un gasto aparecerá aquí.</div>`}
  </div>`;
};
AFTER.movimientos = () => {
  const i=document.getElementById('qMov');
  i.addEventListener('input',()=>{ viewState=Object.assign({r:'mes',t:'todos'},viewState,{q:i.value}); const pos=i.selectionStart; render(); const j=document.getElementById('qMov'); j.focus(); j.setSelectionRange(pos,pos); });
};

function modalMovimiento(tipo='ingreso', id){
  let rec=null;
  if(id){ rec = tipo==='ingreso' ? DB.ingresos.find(x=>x.id===id) : DB.capital.find(x=>x.id===id); }
  const opts=[['ingreso','Ingreso extra (entra plata)'],['gasto','Gasto (sale plata)'],...(isCeo()?[['aporte','Aporte de capital (entra plata)'],['retiro','Retiro de capital (sale plata)']]:[]),['prestamo','Nuevo préstamo'],['pago','Pago de un cliente']];
  openModal(`<h3>${id?'Editar movimiento':'Registrar movimiento'}</h3>
  <div class="form">
    <label class="f full">Tipo de movimiento<select class="input" id="mvTip" ${id?'disabled':''}>${opts.map(([k,t])=>`<option value="${k}" ${k===tipo?'selected':''}>${t}</option>`).join('')}</select></label>
    <label class="f">Fecha<input type="date" class="input" id="mvFec" value="${rec?rec.fecha:todayStr()}"></label>
    <label class="f">Valor<input class="input" id="mvVal" inputmode="numeric" value="${rec?Math.round(Math.abs(rec.valor)).toLocaleString('es-CO'):''}"></label>
    <label class="f full">Concepto<input class="input" id="mvCon" value="${esc(rec?rec.concepto:'')}" placeholder="Ej: multa por mora, aporte de socio, papelería"></label>
  </div>
  <div class="actions">${id?`<button class="btn danger" style="margin-right:auto" id="mvDel">Borrar</button>`:''}<button class="btn" onclick="closeModal()">Cancelar</button><button class="btn pri" id="mvSave">Guardar</button></div>`);
  const sel=document.getElementById('mvTip');
  sel.addEventListener('change',()=>{
    if(sel.value==='prestamo') return modalPrestamo();
    if(sel.value==='pago') return modalPago();
  });
  const val=document.getElementById('mvVal'); val.addEventListener('blur',()=>{ const n=num(val.value); if(n) val.value=n.toLocaleString('es-CO'); });
  if(id) document.getElementById('mvDel').onclick=()=>{
    if(!confirm('¿Borrar este movimiento?')) return;
    dbDel(tipo==='ingreso'?'ingresos':'capital', id);
    closeModal(); render(); toast('Movimiento borrado');
  };
  document.getElementById('mvSave').onclick=()=>{
    const t=sel.value, v=num(val.value), f=document.getElementById('mvFec').value||todayStr(), c=document.getElementById('mvCon').value.trim();
    if(v<=0) return toast('Escribe el valor');
    if(t==='gasto'){ if(!c) return toast('Escribe el concepto'); dbAdd('salidas',{fecha:f,concepto:c,valor:v}); }
    else if(t==='ingreso'){ if(!c) return toast('Escribe el concepto');
      if(rec) dbUpd('ingresos',rec.id,{fecha:f,concepto:c,valor:v}); else dbAdd('ingresos',{fecha:f,concepto:c,valor:v}); }
    else { const sign=t==='aporte'?1:-1; const data={fecha:f,concepto:c||(sign>0?'Aporte':'Retiro'),valor:v*sign};
      if(rec) dbUpd('capital',rec.id,data); else dbAdd('capital',data); }
    closeModal(); render(); toast('Movimiento guardado');
  };
}

/* ---------- modales ---------- */
function openModal(html, wide){
  const root=document.getElementById('modalRoot');
  root.innerHTML = `<div class="modal-bg" id="mbg"><div class="card modal ${wide?'wide':''}">${html}</div></div>`;
  document.getElementById('mbg').addEventListener('mousedown',e=>{ if(e.target.id==='mbg') closeModal(); });
  const f = root.querySelector('input:not([type=hidden]):not([type=checkbox]),select'); if(f) setTimeout(()=>{ if(!root.contains(document.activeElement)) f.focus(); },30);
}
function closeModal(){ document.getElementById('modalRoot').innerHTML=''; }
document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeModal(); });

function clienteOptions(sel){
  return `<option value="">— Selecciona —</option>`+[...DB.clientes].sort((a,b)=>a.nombre.localeCompare(b.nombre)).map(c=>`<option value="${c.id}" ${c.id===sel?'selected':''}>${esc(c.nombre)}${c.cedula?' · '+esc(c.cedula):''}</option>`).join('')+`<option value="__new">+ Crear cliente nuevo…</option>`;
}

function modalCliente(id, onSaved){
  const c = id? clienteById(id) : {nombre:'',cedula:'',tel1:'',tel2:'',direccion:'',ciudad:'',obs:'',cobradorId:''};
  const cobSel = isAdmin() ? `<label class="f full">Cobrador asignado (ruta)<select class="input" id="mCob"><option value="">Sin asignar (lo manejo yo)</option>${cobradores().map(u=>`<option value="${u.id}" ${u.id===c.cobradorId?'selected':''}>${esc(u.nombre)}</option>`).join('')}</select></label>` : '';
  openModal(`<h3>${id?'Editar cliente':'Nuevo cliente'}</h3>
  <div class="form">
    <label class="f full">Nombre completo *<input class="input" id="mNom" value="${esc(c.nombre)}"></label>
    <label class="f"># de identificación<input class="input" id="mCed" value="${esc(c.cedula)}"></label>
    <label class="f">Ciudad<input class="input" id="mCiu" value="${esc(c.ciudad)}"></label>
    <label class="f">Teléfono 1<input class="input" id="mT1" value="${esc(c.tel1)}"></label>
    <label class="f">Teléfono 2<input class="input" id="mT2" value="${esc(c.tel2)}"></label>
    <label class="f full">Dirección<input class="input" id="mDir" value="${esc(c.direccion)}"></label>
    <label class="f full">Observaciones<textarea class="input" id="mObs" rows="2">${esc(c.obs)}</textarea></label>
    ${cobSel}
  </div>
  <div class="actions">${id&&isCeo()?`<button class="btn danger" style="margin-right:auto" onclick="borrarCliente('${id}')">Borrar</button>`:''}<button class="btn" onclick="closeModal()">Cancelar</button><button class="btn pri" id="mSave">Guardar</button></div>`);
  document.getElementById('mSave').onclick = ()=>{
    const v = k=>document.getElementById(k).value.trim();
    if(!v('mNom')) return toast('Escribe el nombre del cliente');
    const data = {nombre:v('mNom'),cedula:v('mCed'),tel1:v('mT1'),tel2:v('mT2'),direccion:v('mDir'),ciudad:v('mCiu'),obs:v('mObs')};
    let cid=id;
    const cob = isAdmin() ? document.getElementById('mCob').value : ME.uid;
    if(id){
      if(isAdmin() && cob!==(c.cobradorId||'')){ data.cobradorId=cob; reasignarCliente(id, cob); }
      dbUpd('clientes',id,data);
    } else cid = dbAdd('clientes',{...data, cobradorId:cob});
    closeModal(); toast('Cliente guardado');
    if(onSaved) onSaved(cid); else render();
  };
}
function borrarCliente(id){
  if(DB.prestamos.some(p=>p.clienteId===id)) return toast('Este cliente tiene préstamos; bórralos primero');
  if(!confirm('¿Borrar este cliente?')) return;
  dbDel('clientes',id); closeModal(); render();
}
function reasignarCliente(clienteId, cob){
  const ops=[];
  for(const p of DB.prestamos.filter(x=>x.clienteId===clienteId)){
    p.cobradorId=cob; ops.push({col:'prestamos',id:p.id,data:{cobradorId:cob},merge:true});
    for(const x of DB.pagos.filter(y=>y.prestamoId===p.id)){ x.cobradorId=cob; ops.push({col:'pagos',id:x.id,data:{cobradorId:cob},merge:true}); }
  }
  if(ops.length) S.batchSet(ops).catch(falloNube);
}

function modalPrestamo(id, clienteId, preset){
  const p = id ? DB.prestamos.find(x=>x.id===id) : Object.assign({clienteId:clienteId||'',fecha:todayStr(),monto:'',tasa:DB.config.tasaDefecto,meses:1,periodo:'DIARIO',excluirDomingos:DB.config.excluirDomingos,nota:''}, preset||{});
  const tienePagos = id && pagosDe(id).length>0;
  openModal(`<h3>${id?'Editar préstamo':'Nuevo préstamo'}</h3>
  <div class="form">
    <label class="f full">Deudor *<select class="input" id="pCli">${clienteOptions(p.clienteId)}</select></label>
    <label class="f">Fecha del préstamo<input type="date" class="input" id="pFec" value="${p.fecha}"></label>
    <label class="f">Valor del préstamo *<input class="input" id="pMon" value="${p.monto?Math.round(p.monto).toLocaleString('es-CO'):''}" inputmode="numeric" placeholder="Ej: 500.000"></label>
    <label class="f">% interés mensual<input class="input" id="pTas" value="${p.tasa}" inputmode="decimal"></label>
    <label class="f">No. de meses<input class="input" id="pMes" value="${p.meses}" inputmode="decimal"></label>
    <label class="f">Periodo de pago<select class="input" id="pPer">${PERIODOS.map(x=>`<option ${x===p.periodo?'selected':''}>${x}</option>`).join('')}</select></label>
    <label class="chk" style="align-self:end;padding-bottom:8px"><input type="checkbox" id="pDom" ${p.excluirDomingos?'checked':''}> No cobrar domingos (diario)</label>
    <label class="f full">Nota<input class="input" id="pNot" value="${esc(p.nota||'')}" placeholder="Opcional: fiador, garantía, etc."></label>
  </div>
  <div class="calcbox" id="pCalc" style="margin-top:16px"></div>
  ${tienePagos?'<p class="muted" style="font-size:12px">Este préstamo ya tiene pagos; si cambias valores, el saldo se recalcula con los pagos existentes.</p>':''}
  <div class="actions">${id?`<button class="btn danger" style="margin-right:auto" onclick="borrarPrestamo('${id}')">Borrar préstamo</button>`:''}<button class="btn" onclick="closeModal()">Cancelar</button><button class="btn pri" id="pSave">${id?'Guardar cambios':'Crear préstamo'}</button></div>`);
  const upd = ()=>{
    const c = calcular(num(g('pMon')),num(g('pTas')),num(g('pMes')),g('pPer'));
    document.getElementById('pCalc').innerHTML = `
      <div><div class="l">No. de cuotas</div><div class="v">${c.cuotas}</div></div>
      <div><div class="l">Valor cuota</div><div class="v">${fmt(c.valorCuota)}</div></div>
      <div><div class="l">Interés mensual</div><div class="v">${fmt(c.interesMes)}</div></div>
      <div><div class="l">Capital x cuota</div><div class="v">${fmt(c.capitalCuota)}</div></div>
      <div><div class="l">Interés x cuota</div><div class="v">${fmt(c.interesCuota)}</div></div>
      <div><div class="l">Total a pagar</div><div class="v">${fmt(c.valorCuota*c.cuotas)}</div></div>`;
  };
  const g = k=>document.getElementById(k).value;
  ['pMon','pTas','pMes','pPer'].forEach(k=>document.getElementById(k).addEventListener('input',upd));
  const mon=document.getElementById('pMon');
  mon.addEventListener('blur',()=>{ const n=num(mon.value); if(n) mon.value=n.toLocaleString('es-CO'); });
  document.getElementById('pCli').addEventListener('change',e=>{
    if(e.target.value==='__new'){
      const keep = {fecha:g('pFec'),monto:num(g('pMon')),tasa:num(g('pTas')),meses:num(g('pMes')),periodo:g('pPer'),excluirDomingos:document.getElementById('pDom').checked,nota:g('pNot')};
      modalCliente(null, cid=>modalPrestamo(id,cid,keep));
    }
  });
  upd();
  document.getElementById('pSave').onclick = ()=>{
    const cli=g('pCli'), monto=num(g('pMon')), tasa=num(g('pTas')), meses=num(g('pMes')), periodo=g('pPer');
    if(!cli||cli==='__new') return toast('Selecciona el deudor');
    if(monto<=0) return toast('Escribe el valor del préstamo');
    if(meses<=0) return toast('El número de meses debe ser mayor a 0');
    const c = calcular(monto,tasa,meses,periodo);
    const data = {clienteId:cli,fecha:g('pFec')||todayStr(),monto,tasa,meses,periodo,excluirDomingos:document.getElementById('pDom').checked,nota:g('pNot').trim(),
      cuotas:c.cuotas,valorCuota:c.valorCuota,interesMes:c.interesMes,total:c.total};
    const cobP = (clienteById(cli)||{}).cobradorId || '';
    if(id){ if(cli!==p.clienteId) data.cobradorId=cobP; dbUpd('prestamos',id,data); }
    else dbAdd('prestamos',{...data, cobradorId:cobP});
    closeModal(); toast(id?'Préstamo actualizado':'Préstamo creado');
    if(!id && view!=='prestamos') go('prestamos'); else render();
  };
}
function borrarPrestamo(id){
  const n = pagosDe(id).length;
  if(!confirm(`¿Borrar este préstamo${n?` y sus ${n} pagos`:''}? Esta acción no se puede deshacer.`)) return;
  for(const x of pagosDe(id)) dbDel('pagos',x.id);
  dbDel('prestamos',id);
  closeModal(); render(); toast('Préstamo borrado');
}

function modalPago(prestamoId, pagoId, fecha){
  const pago = pagoId ? DB.pagos.find(x=>x.id===pagoId) : null;
  const activos = DB.prestamos.filter(p=>estadoPrestamo(p).estado!=='Pagado' || p.id===prestamoId);
  const sel = pago? pago.prestamoId : (prestamoId||'');
  openModal(`<h3>${pago?'Editar pago':'Registrar pago'}</h3>
  <div class="form">
    <label class="f full">Préstamo<select class="input" id="gPre"><option value="">— Selecciona —</option>${activos.sort((a,b)=>nombreCliente(a.clienteId).localeCompare(nombreCliente(b.clienteId))).map(p=>`<option value="${p.id}" ${p.id===sel?'selected':''}>${esc(nombreCliente(p.clienteId))} · ${fmt(p.monto)} · ${p.periodo.toLowerCase()}</option>`).join('')}</select></label>
    <label class="f">Fecha del pago<input type="date" class="input" id="gFec" value="${pago?pago.fecha:(fecha||todayStr())}"></label>
    <label class="f">Valor pagado<input class="input" id="gVal" inputmode="numeric" value="${pago?Math.round(pago.monto).toLocaleString('es-CO'):''}"></label>
    <label class="f full">Nota<input class="input" id="gNot" value="${esc(pago?pago.nota:'')}" placeholder="Opcional"></label>
  </div>
  <div id="gInfo" class="calcbox" style="margin-top:14px"></div>
  <div class="actions">${pago&&isCeo()?`<button class="btn danger" style="margin-right:auto" onclick="borrarPago('${pago.id}')">Borrar pago</button>`:''}<button class="btn" onclick="closeModal()">Cancelar</button><button class="btn pri" id="gSave">Guardar pago</button></div>`);
  const info = ()=>{
    const id=document.getElementById('gPre').value; const box=document.getElementById('gInfo');
    if(!id){ box.style.display='none'; return; }
    box.style.display='';
    const p=DB.prestamos.find(x=>x.id===id), e=estadoPrestamo(p);
    box.innerHTML=`<div><div class="l">Cuota</div><div class="v">${fmt(p.valorCuota)}</div></div>
      <div><div class="l">Pendiente hasta hoy</div><div class="v" style="color:${e.atraso?'var(--red)':'inherit'}">${fmt(e.atraso)}</div></div>
      <div><div class="l">Saldo</div><div class="v">${fmt(e.saldo + (pago?pago.monto:0))}</div></div>
      <div><div class="l">Cuotas pagadas</div><div class="v">${e.cuotasPagadas}/${p.cuotas}</div></div>`;
    const val=document.getElementById('gVal'); if(!pago && !val.value) val.value=Math.round(Math.min(Math.max(p.valorCuota, e.atraso), e.saldo)).toLocaleString('es-CO');
  };
  document.getElementById('gPre').addEventListener('change',()=>{ if(!pago) document.getElementById('gVal').value=''; info(); });
  const val=document.getElementById('gVal'); val.addEventListener('blur',()=>{ const n=num(val.value); if(n) val.value=n.toLocaleString('es-CO'); });
  info();
  document.getElementById('gSave').onclick=()=>{
    const pid=document.getElementById('gPre').value, monto=num(val.value), f=document.getElementById('gFec').value||todayStr();
    if(!pid) return toast('Selecciona el préstamo');
    if(monto<=0) return toast('Escribe el valor pagado');
    const p=DB.prestamos.find(x=>x.id===pid), e=estadoPrestamo(p);
    const saldo = e.saldo + (pago&&pago.prestamoId===pid?pago.monto:0);
    if(monto > saldo+0.5 && !confirm(`El pago (${fmt(monto)}) es mayor que el saldo (${fmt(saldo)}). ¿Guardar de todas formas?`)) return;
    const nota=document.getElementById('gNot').value.trim();
    if(pago) dbUpd('pagos',pago.id,{prestamoId:pid,fecha:f,monto,nota,cobradorId:p.cobradorId||''});
    else dbAdd('pagos',{prestamoId:pid,fecha:f,monto,nota,cobradorId:p.cobradorId||'',registradoPor:ME.uid});
    closeModal(); render(); toast('Pago registrado');
    if(viewState._reopen){ viewState._reopen=0; modalDetalle(pid); }
  };
}
function borrarPago(id){
  if(!confirm('¿Borrar este pago?')) return;
  dbDel('pagos',id); closeModal(); render(); toast('Pago borrado');
}

function modalDetalle(id, tab='cuotas'){
  const p = DB.prestamos.find(x=>x.id===id); if(!p) return;
  const e = estadoPrestamo(p), c = clienteById(p.clienteId)||{};
  const hoy=todayStr();
  let acum=0;
  const cuotasHtml = e.cron.map(q=>{
    acum += p.valorCuota;
    const cubierta = e.pagado >= acum - 0.5;
    const parcial = !cubierta && e.pagado > acum - p.valorCuota + 0.5;
    const venc = q.fecha<=hoy;
    let st = cubierta?'<span class="cuota-ok">Pagada</span>': parcial? '<span style="color:var(--amber)">Abono parcial</span>' : venc?'<span class="cuota-venc">Vencida</span>':'<span class="muted">Pendiente</span>';
    return `<tr><td>${q.n}</td><td>${fdate(q.fecha)}${q.fecha===hoy?' <span class="pill p-hoy">hoy</span>':''}</td><td class="num">${fmt(p.valorCuota)}</td><td class="num">${fmt(p.monto/p.cuotas)}</td><td class="num">${fmt(p.valorCuota - p.monto/p.cuotas)}</td><td>${st}</td></tr>`;
  }).join('');
  const pagosHtml = e.pagos.length? e.pagos.map(x=>`<tr><td>${fdate(x.fecha)}</td><td class="num">${fmt(x.monto)}</td><td>${esc(x.nota||'')}</td><td class="muted" style="font-size:12px">${esc(nombreUsuario(x.registradoPor))}</td><td class="right no-print">${isCeo()?`<button class="btn sm" onclick="viewState._reopen=1;modalPago(null,'${x.id}')">Editar</button>`:''}</td></tr>`).join('') : `<tr><td colspan="5" class="muted">Sin pagos todavía.</td></tr>`;
  openModal(`
  <div class="row" style="margin-bottom:6px">${ava(c.nombre)}<h3 style="margin:0">${esc(c.nombre||'(sin cliente)')}</h3>${pill(e)}<span class="spacer"></span>
    ${isNative()?'':'<button class="btn sm" onclick="window.print()">Imprimir</button>'}${isCeo()?`<button class="btn sm" onclick="modalPrestamo('${p.id}')">Editar</button>`:''}<button class="btn sm pri" onclick="viewState._reopen=1;modalPago('${p.id}')">Registrar pago</button><button class="btn sm ghost" onclick="closeModal()">✕</button></div>
  <p class="muted" style="margin:0 0 14px">${esc(c.cedula||'')} ${c.tel1?'· '+esc(c.tel1):''} ${c.direccion?'· '+esc(c.direccion):''}${p.nota?'<br>Nota: '+esc(p.nota):''}</p>
  <div class="detail-grid">
    <div><div class="l">Fecha</div><div class="v">${fdate(p.fecha)}</div></div>
    <div><div class="l">Valor prestado</div><div class="v">${fmt(p.monto)}</div></div>
    <div><div class="l">Interés</div><div class="v">${fmtN(p.tasa)}% · ${fmtN(p.meses)} mes(es)</div></div>
    <div><div class="l">Forma de pago</div><div class="v">${p.periodo.charAt(0)+p.periodo.slice(1).toLowerCase()} · ${p.cuotas} cuotas</div></div>
    <div><div class="l">Valor cuota</div><div class="v">${fmt(p.valorCuota)}</div></div>
    <div><div class="l">Total a pagar</div><div class="v">${fmt(e.totalReal)}</div></div>
    <div><div class="l">Pagado</div><div class="v" style="color:var(--green)">${fmt(e.pagado)}</div></div>
    <div><div class="l">Saldo (deuda actual)</div><div class="v">${fmt(e.saldo)}</div></div>
    <div><div class="l">En mora</div><div class="v" style="color:${e.atrasoMora?'var(--red)':'inherit'}">${fmt(e.atrasoMora)}${e.diasMora?` · ${e.diasMora} días`:''}</div></div>
    <div><div class="l">Próxima cuota</div><div class="v">${e.proxima?fdate(e.proxima.fecha):'—'}</div></div>
  </div>
  <div class="progress" style="margin-bottom:16px"><i style="width:${Math.min(100,e.pagado/e.totalReal*100)}%"></i></div>
  <div class="tabs no-print"><button class="${tab==='cuotas'?'on':''}" onclick="modalDetalle('${id}','cuotas')">Cuotas (${p.cuotas})</button><button class="${tab==='pagos'?'on':''}" onclick="modalDetalle('${id}','pagos')">Pagos (${e.pagos.length})</button></div>
  <div class="tablewrap" style="max-height:380px">
  ${tab==='cuotas'?`<table><thead><tr><th>#</th><th>Fecha</th><th class="num">Cuota</th><th class="num">Capital</th><th class="num">Interés</th><th>Estado</th></tr></thead><tbody>${cuotasHtml}</tbody></table>`
  :`<table><thead><tr><th>Fecha</th><th class="num">Valor</th><th>Nota</th><th>Registró</th><th></th></tr></thead><tbody>${pagosHtml}</tbody></table>`}
  </div>`, true);
}

function modalSalida(id){
  const s = id? DB.salidas.find(x=>x.id===id) : {fecha:todayStr(),concepto:'',valor:''};
  openModal(`<h3>${id?'Editar salida':'+ Registrar salida de dinero'}</h3>
  <div class="form">
    <label class="f">Fecha<input type="date" class="input" id="sFec" value="${s.fecha}"></label>
    <label class="f">Valor<input class="input" id="sVal" inputmode="numeric" value="${s.valor?Math.round(s.valor).toLocaleString('es-CO'):''}"></label>
    <label class="f full">Concepto<input class="input" id="sCon" value="${esc(s.concepto)}" placeholder="Ej: gasolina, papelería, pago cobrador"></label>
  </div>
  <div class="actions">${id?`<button class="btn danger" style="margin-right:auto" onclick="borrarSalida('${id}')">Borrar</button>`:''}<button class="btn" onclick="closeModal()">Cancelar</button><button class="btn pri" id="sSave">Guardar</button></div>`);
  document.getElementById('sSave').onclick=()=>{
    const v=num(document.getElementById('sVal').value), con=document.getElementById('sCon').value.trim();
    if(v<=0) return toast('Escribe el valor');
    if(!con) return toast('Escribe el concepto');
    const data={fecha:document.getElementById('sFec').value||todayStr(),concepto:con,valor:v};
    if(id) dbUpd('salidas',id,data); else dbAdd('salidas',data);
    closeModal(); render(); toast('Salida guardada');
  };
}
function borrarSalida(id){ if(!confirm('¿Borrar esta salida?')) return; dbDel('salidas',id); closeModal(); render(); }

function modalCapital(){
  openModal(`<h3>Aporte o retiro de capital</h3>
  <div class="form">
    <label class="f">Fecha<input type="date" class="input" id="kFec" value="${todayStr()}"></label>
    <label class="f">Tipo<select class="input" id="kTip"><option value="1">Aporte (entra plata)</option><option value="-1">Retiro (sale capital)</option></select></label>
    <label class="f">Valor<input class="input" id="kVal" inputmode="numeric"></label>
    <label class="f">Concepto<input class="input" id="kCon" placeholder="Ej: aporte socio"></label>
  </div>
  <div class="actions"><button class="btn" onclick="closeModal()">Cancelar</button><button class="btn pri" id="kSave">Guardar</button></div>`);
  document.getElementById('kSave').onclick=()=>{
    const v=num(document.getElementById('kVal').value); if(v<=0) return toast('Escribe el valor');
    const sign=Number(document.getElementById('kTip').value);
    dbAdd('capital',{fecha:document.getElementById('kFec').value||todayStr(),concepto:document.getElementById('kCon').value.trim()||(sign>0?'Aporte':'Retiro'),valor:v*sign});
    save(); closeModal(); render();
  };
}
function borrarCapital(id){ if(!confirm('¿Borrar este movimiento?')) return; dbDel('capital',id); render(); }

function guardarAjustes(){
  const g=k=>document.getElementById(k).value;
  DB.config.negocio = g('sNeg').trim()||'Kuota';
  DB.config.capitalInicial = num(g('sCap'));
  DB.config.fechaCapital = g('sFecCap');
  DB.config.tasaDefecto = num(g('sTasa'));
  DB.config.factores = {DIARIO:num(g('fD'))||30,SEMANAL:num(g('fS'))||4,QUINCENAL:num(g('fQ'))||2,MENSUAL:num(g('fM'))||1};
  DB.config.redondeo = Number(g('sRed'));
  DB.config.excluirDomingos = document.getElementById('sDom').checked;
  cfgSave(); render(); toast('Ajustes guardados');
}

function csv(rows){
  const e=v=>{ v = v==null?'':String(v); return /[";\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v; };
  return '﻿'+rows.map(r=>r.map(e).join(';')).join('\r\n');
}
function exportCSV(tipo){
  let rows;
  if(tipo==='prestamos'){
    rows=[['DEUDOR','CEDULA','FECHA','VALOR PRESTAMO','% INTERES','No. DE MESES','PERIODO DE PAGO','No. DE CUOTAS','INTERES MENSUAL','VALOR CUOTA','CAPITAL X CUOTA','INTERES X CUOTA','TOTAL A PAGAR','PAGADO','DEUDA ACTUAL','ATRASO','ESTADO','NOTA']];
    for(const p of DB.prestamos){ const e=estadoPrestamo(p), c=clienteById(p.clienteId)||{};
      rows.push([c.nombre,c.cedula,p.fecha,Math.round(p.monto),p.tasa,p.meses,p.periodo,p.cuotas,Math.round(p.monto*p.tasa/100),Math.round(p.valorCuota),Math.round(p.monto/p.cuotas),Math.round(p.valorCuota-p.monto/p.cuotas),Math.round(e.totalReal),Math.round(e.pagado),Math.round(e.saldo),Math.round(e.atrasoMora),e.estado,p.nota||'']); }
  } else if(tipo==='pagos'){
    rows=[['FECHA','DEUDOR','VALOR','NOTA']];
    for(const x of [...DB.pagos].sort((a,b)=>a.fecha.localeCompare(b.fecha))){ const p=DB.prestamos.find(y=>y.id===x.prestamoId)||{}; rows.push([x.fecha,nombreCliente(p.clienteId),Math.round(x.monto),x.nota||'']); }
  } else if(tipo==='clientes'){
    rows=[['NOMBRE','# DE IDENTIFICACION','TELEFONO 1','TELEFONO 2','DIRECCION','CIUDAD','OBSERVACIONES']];
    for(const c of DB.clientes) rows.push([c.nombre,c.cedula,c.tel1,c.tel2,c.direccion,c.ciudad,c.obs]);
  } else if(tipo==='movimientos'){
    rows=[['FECHA','TIPO','MOVIMIENTO','DETALLE','REGISTRÓ','ENTRADA','SALIDA','SALDO EN CAJA']];
    for(const m of movimientos()) rows.push([m.fecha,TIPOS_MOV[m.tipo].t,m.concepto,m.detalle,m.por?nombreUsuario(m.por):'',Math.round(m.ent)||'',Math.round(m.sal)||'',Math.round(m.saldo)]);
  } else {
    rows=[['FECHA','CONCEPTO','VALOR']];
    for(const s of DB.salidas) rows.push([s.fecha,s.concepto,Math.round(s.valor)]);
  }
  descargar(`${tipo}_${todayStr()}.csv`, csv(rows), 'text/csv;charset=utf-8');
}
/* ---------- usuarios (solo administrador) ---------- */
VIEWS.usuarios = () => {
  const us=[...DB.users].sort((a,b)=>(a.rol===b.rol?0:a.rol==='admin'?-1:1)||(a.nombre||'').localeCompare(b.nombre||''));
  return `
  <div class="head"><div><h1>Usuarios</h1><p class="sub">Crea los usuarios de tus cobradores. Cada uno entra con su correo y contraseña y solo ve los clientes que le asignes.</p></div>
  <div class="row"><button class="btn pri" onclick="modalUsuario()">+ Nuevo usuario</button></div></div>
  <div class="card"><div class="tablewrap"><table><thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th class="num">Clientes</th><th class="num">Plata en mano</th><th>Estado</th><th></th></tr></thead><tbody>
  ${us.map(u=>{const nc=DB.clientes.filter(c=>c.cobradorId===u.id).length; const cu=cuadreCobrador(u.id); return `<tr>
    <td><div class="who">${ava(u.nombre)}<b>${esc(u.nombre)}</b>${u.id===ME.uid?' <span class="muted" style="margin-left:6px">(tú)</span>':''}</div></td>
    <td>${esc(u.email)}</td><td>${rolDe(u)==='CEO'?'<span class="pill p-hoy">CEO</span>':u.rol==='admin'?'<span class="pill p-pag">Admin</span>':'<span class="pill p-ok">Cobrador</span>'}</td>
    <td class="num">${u.rol==='cobrador'?nc:'—'}</td><td class="num">${u.rol==='cobrador'?fmt(cu.enMano):'—'}</td>
    <td>${u.activo===false?'<span class="pill p-mora">Bloqueado</span>':'<span class="pill p-ok">Activo</span>'}</td>
    <td class="right" style="white-space:nowrap">${u.id!==ME.uid&&u.id!==CEO_UID?`<button class="btn sm" onclick="modalUsuario('${u.id}')">Editar</button>`:''}</td></tr>`}).join('')}
  </tbody></table></div></div>
  <p class="muted" style="font-size:13px;margin-top:14px">Para quitarle el acceso a alguien, edítalo y márcalo como bloqueado. Si un cobrador olvida su contraseña, edítalo y envíale el correo para cambiarla.</p>`;
};
function modalUsuario(id){
  const u = id ? userById(id) : null;
  openModal(`<h3>${u?'Editar usuario':'Nuevo usuario'}</h3>
  <div class="form">
    <label class="f full">Nombre<input class="input" id="uNom" value="${esc(u?u.nombre:'')}" placeholder="Ej: Pedro cobrador"></label>
    ${u?`<label class="f full">Correo<input class="input" value="${esc(u.email)}" disabled></label>`:`
    <label class="f">Correo<input class="input" id="uMail" type="email" autocomplete="off" placeholder="pedro@gmail.com"></label>
    <label class="f">Contraseña inicial<input class="input" id="uPass" type="text" autocomplete="off" placeholder="Mínimo 6 caracteres"></label>`}
    <label class="f">Rol<select class="input" id="uRol"><option value="cobrador" ${!u||u.rol==='cobrador'?'selected':''}>Cobrador</option><option value="admin" ${u&&u.rol==='admin'?'selected':''}>Admin (registra, no edita ni borra)</option></select></label>
    ${u?`<label class="chk" style="align-self:end;padding-bottom:10px"><input type="checkbox" id="uBlq" ${u.activo===false?'checked':''}> Bloqueado (no puede entrar)</label>`:''}
  </div>
  ${u?`<p class="muted" style="font-size:13px">¿Olvidó la contraseña? <button class="btn sm" id="uReset">Enviarle correo para cambiarla</button></p>`:'<p class="muted" style="font-size:13px">Dale al cobrador su correo y esta contraseña para que entre a la app.</p>'}
  <div class="actions"><button class="btn" onclick="closeModal()">Cancelar</button><button class="btn pri" id="uSave">${u?'Guardar':'Crear usuario'}</button></div>`);
  if(u) document.getElementById('uReset').onclick=()=>S.resetPassword(u.email).then(()=>toast('Correo enviado a '+u.email)).catch(()=>toast('No se pudo enviar el correo'));
  document.getElementById('uSave').onclick=async ()=>{
    const nombre=document.getElementById('uNom').value.trim(), rol=document.getElementById('uRol').value;
    if(!nombre) return toast('Escribe el nombre');
    if(u){ dbUpd('users',u.id,{nombre,rol,activo:!document.getElementById('uBlq').checked}); closeModal(); render(); toast('Usuario actualizado'); return; }
    const email=document.getElementById('uMail').value.trim().toLowerCase(), pass=document.getElementById('uPass').value;
    if(!/^\S+@\S+\.\S+$/.test(email)) return toast('Escribe un correo válido');
    if(pass.length<6) return toast('La contraseña debe tener mínimo 6 caracteres');
    const btn=document.getElementById('uSave'); btn.disabled=true; btn.textContent='Creando…';
    try{ await S.createUser(nombre,email,pass,rol); closeModal(); toast('Usuario creado'); }
    catch(e){ btn.disabled=false; btn.textContent='Crear usuario';
      toast(e.code==='auth/email-already-in-use'?'Ese correo ya tiene un usuario':e.code==='auth/invalid-email'?'Correo no válido':'No se pudo crear el usuario'); }
  };
}

/* ---------- cuadre de caja por cobrador ---------- */
function cuadreCobrador(uidC, fecha){
  const pagos = DB.pagos.filter(x=>(x.registradoPor||'')===uidC);
  const entregas = DB.entregas.filter(x=>x.cobradorId===uidC);
  const tot = a=>a.reduce((s,x)=>s+(Number(x.monto ?? x.valor)||0),0);
  const pDia = fecha? pagos.filter(x=>x.fecha===fecha):[], eDia = fecha? entregas.filter(x=>x.fecha===fecha):[];
  return { cobradoDia:tot(pDia), nPagosDia:pDia.length, pagosDia:pDia, entregadoDia:tot(eDia), entregasDia:eDia,
           cobradoTotal:tot(pagos), entregadoTotal:tot(entregas), enMano: tot(pagos)-tot(entregas) };
}
VIEWS.cuadre = () => {
  const fecha = viewState.fecha || todayStr();
  const fechaInput = `<input type="date" class="input" style="width:auto" value="${fecha}" onchange="go('cuadre',{fecha:this.value})">`;
  if(!isAdmin()){
    const c = cuadreCobrador(ME.uid, fecha);
    return `
    <div class="head"><div><h1>Mi cuadre</h1><p class="sub">Lo que cobraste y lo que ya entregaste.</p></div>${fechaInput}</div>
    <div class="kpis">
      <div class="kpi hl"><div class="l">Cobrado ${fecha===todayStr()?'hoy':'ese día'}</div><div class="v">${fmt(c.cobradoDia)}</div><div class="n">${c.nPagosDia} pagos</div></div>
      <div class="kpi sky"><div class="l">Entregado ${fecha===todayStr()?'hoy':'ese día'}</div><div class="v">${fmt(c.entregadoDia)}</div></div>
      <div class="kpi cream"><div class="l">Plata en mano por entregar</div><div class="v">${fmt(c.enMano)}</div><div class="n">Todo lo cobrado menos todo lo entregado</div></div>
    </div>
    ${tablaPagosDia(c.pagosDia)}`;
  }
  const filas = [{id:ME.uid,nombre:(ME.nombre||'Yo')+' ('+rolDe(ME)+')'}, ...cobradores()].map(u=>({u,c:cuadreCobrador(u.id,fecha)}));
  const tot = k=>filas.reduce((s,f)=>s+f.c[k],0);
  const todosPagos = DB.pagos.filter(x=>x.fecha===fecha);
  return `
  <div class="head"><div><h1>Cuadre de caja</h1><p class="sub">Cuánto cobró cada cobrador, cuánto te entregó y cuánto tiene en la mano.</p></div>${fechaInput}</div>
  <div class="kpis">
    <div class="kpi hl"><div class="l">Cobrado ese día</div><div class="v">${fmt(todosPagos.reduce((s,x)=>s+x.monto,0))}</div><div class="n">${todosPagos.length} pagos</div></div>
    <div class="kpi sky"><div class="l">Entregado ese día</div><div class="v">${fmt(tot('entregadoDia'))}</div></div>
    <div class="kpi cream"><div class="l">En manos de cobradores</div><div class="v">${fmt(filas.slice(1).reduce((s,f)=>s+f.c.enMano,0))}</div><div class="n">Pendiente por entregarte</div></div>
  </div>
  <div class="card" style="margin-bottom:16px"><div class="tablewrap"><table><thead><tr><th>Cobrador</th><th class="num">Pagos</th><th class="num">Cobrado</th><th class="num">Entregado</th><th class="num">Plata en mano</th><th></th></tr></thead><tbody>
  ${filas.map(({u,c},i)=>`<tr><td><div class="who">${ava(u.nombre)}<b>${esc(u.nombre)}</b></div></td><td class="num">${c.nPagosDia}</td><td class="num">${fmt(c.cobradoDia)}</td><td class="num">${fmt(c.entregadoDia)}</td>
    <td class="num"><b style="color:${i&&c.enMano>0.5?'var(--amber)':'inherit'}">${i?fmt(c.enMano):'—'}</b></td>
    <td class="right">${i?`<button class="btn sm pri" onclick="modalEntrega('${u.id}','${fecha}')">Recibir plata</button>`:''}</td></tr>`).join('')}
  </tbody></table></div></div>
  ${(()=>{const es=DB.entregas.filter(x=>x.fecha===fecha); return es.length?`<div class="card pad" style="margin-bottom:16px"><h2>Entregas recibidas ese día</h2><table><tbody>${es.map(x=>`<tr><td>${esc(nombreUsuario(x.cobradorId))}</td><td>${esc(x.nota||'')}</td><td class="num">${fmt(x.valor)}</td><td class="muted">${esc(nombreUsuario(x.creadoPor))}</td><td class="right">${isCeo()?`<button class="btn sm danger" onclick="borrarEntrega('${x.id}')">Borrar</button>`:''}</td></tr>`).join('')}</tbody></table></div>`:'';})()}
  ${tablaPagosDia(todosPagos,true)}`;
};
function tablaPagosDia(pagos, conCobrador){
  if(!pagos.length) return `<div class="card"><div class="empty">No hay pagos registrados ese día.</div></div>`;
  return `<div class="card pad"><h2>Pagos del día</h2><div class="tablewrap"><table><thead><tr><th>Cliente</th>${conCobrador?'<th>Registró</th>':''}<th>Nota</th><th class="num">Valor</th></tr></thead><tbody>
  ${[...pagos].sort((a,b)=>(b.creado||0)-(a.creado||0)).map(x=>{const p=DB.prestamos.find(y=>y.id===x.prestamoId)||{}; return `<tr><td><div class="who">${ava(nombreCliente(p.clienteId))}${esc(nombreCliente(p.clienteId))}</div></td>${conCobrador?`<td>${esc(nombreUsuario(x.registradoPor))}</td>`:''}<td class="muted">${esc(x.nota||'')}</td><td class="num"><b>${fmt(x.monto)}</b></td></tr>`;}).join('')}
  </tbody></table></div></div>`;
}
function modalEntrega(cobradorId, fecha){
  const c=cuadreCobrador(cobradorId);
  openModal(`<h3>Recibir plata de ${esc(nombreUsuario(cobradorId))}</h3>
  <p class="muted" style="margin-top:-8px">Tiene en la mano ${fmt(c.enMano)}.</p>
  <div class="form">
    <label class="f">Fecha<input type="date" class="input" id="eFec" value="${fecha||todayStr()}"></label>
    <label class="f">Valor recibido<input class="input" id="eVal" inputmode="numeric" value="${c.enMano>0?Math.round(c.enMano).toLocaleString('es-CO'):''}"></label>
    <label class="f full">Nota<input class="input" id="eNot" placeholder="Opcional"></label>
  </div>
  <div class="actions"><button class="btn" onclick="closeModal()">Cancelar</button><button class="btn pri" id="eSave">Guardar entrega</button></div>`);
  document.getElementById('eSave').onclick=()=>{
    const v=num(document.getElementById('eVal').value); if(v<=0) return toast('Escribe el valor');
    dbAdd('entregas',{cobradorId,fecha:document.getElementById('eFec').value||todayStr(),valor:v,nota:document.getElementById('eNot').value.trim()});
    closeModal(); render(); toast('Entrega registrada');
  };
}
function borrarEntrega(id){ if(!confirm('¿Borrar esta entrega?')) return; dbDel('entregas',id); render(); }

/* ---------- respaldo / exportar ---------- */
async function descargar(nombre, contenido, tipo){
  if(isNative() && window.CapPlugins){
    try{
      const {Filesystem, Share, Directory, Encoding} = window.CapPlugins;
      const r = await Filesystem.writeFile({path:nombre, data:contenido, directory:Directory.Cache, encoding:Encoding.UTF8});
      await Share.share({title:nombre, url:r.uri});
      return;
    }catch(e){ if(String(e).includes('cancel')) return; toast('No se pudo compartir el archivo'); return; }
  }
  const b=new Blob([contenido],{type:tipo}); const a=document.createElement('a');
  a.href=URL.createObjectURL(b); a.download=nombre; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
function descargarRespaldo(){
  const d={...DB}; delete d.users;
  descargar(`respaldo_prestamos_${todayStr()}.json`, JSON.stringify(d,null,1),'application/json');
}
function importar(file){
  if(!file) return;
  const r=new FileReader();
  r.onload=async ()=>{
    let d; try{ d=JSON.parse(r.result); if(!d.prestamos||!d.clientes) throw 0; }catch(e){ return toast('El archivo no es una copia válida'); }
    if(!confirm(`Se van a subir a la nube ${d.clientes.length} clientes, ${d.prestamos.length} préstamos y ${(d.pagos||[]).length} pagos de la copia. Lo que ya está en la nube se conserva. ¿Continuar?`)) return;
    const ops=[];
    for(const col of ['clientes','prestamos','pagos','salidas','capital','ingresos']) for(const x of (d[col]||[])){
      const o={...x, cobradorId:x.cobradorId||'', creadoPor:ME.uid, creado:x.creado||Date.now()};
      if(col==='pagos'){ o.registradoPor=x.registradoPor||ME.uid; }
      ops.push({col,id:x.id||S.newId(col),data:o});
    }
    if(d.config && confirm('¿También quieres usar el capital inicial y los ajustes de la copia?')){ DB.config=migrateConfig(d.config); cfgSave(); }
    toast('Subiendo información…');
    try{ await S.batchSet(ops); toast('Copia subida a la nube'); }catch(e){ falloNube(e); }
  };
  r.readAsText(file);
}

/* ---------- arranque: login y sincronización ---------- */
function pantalla(html){
  document.getElementById('appShell').style.display='none';
  const l=document.getElementById('login'); l.style.display='flex'; l.innerHTML=`<div class="login-card card">${html}</div>`;
}
function verLogin(msg){
  pantalla(`<div class="login-logo">$</div><h1>Kuota</h1><p class="sub">Control de préstamos y cobros. Entra con tu usuario.</p>
    ${msg?`<div class="banner">${esc(msg)}</div>`:''}
    <form id="fLogin" class="form" style="grid-template-columns:1fr">
      <label class="f">Correo<input class="input" id="lMail" type="email" autocomplete="username" required></label>
      <label class="f">Contraseña<input class="input" id="lPass" type="password" autocomplete="current-password" required></label>
      <button class="btn pri" style="justify-content:center;padding:12px" id="lBtn">Entrar</button>
    </form>
    <p style="text-align:center;margin:14px 0 0"><button class="btn ghost sm" id="lOlvido">Olvidé mi contraseña</button></p>
    <p id="lAdmin" style="text-align:center;margin:6px 0 0"></p>`);
  document.getElementById('fLogin').onsubmit=async e=>{
    e.preventDefault(); const b=document.getElementById('lBtn'); b.disabled=true; b.textContent='Entrando…';
    try{ await S.login(document.getElementById('lMail').value.trim(), document.getElementById('lPass').value); }
    catch(err){ b.disabled=false; b.textContent='Entrar';
      toast(/invalid|wrong|not-found|credential/.test(err.code||'')?'Correo o contraseña incorrectos':err.code==='auth/too-many-requests'?'Demasiados intentos, espera un momento':err.code==='auth/network-request-failed'?'Sin conexión a internet':'No se pudo entrar'); }
  };
  document.getElementById('lOlvido').onclick=()=>{
    const m=document.getElementById('lMail').value.trim(); if(!m) return toast('Escribe tu correo primero');
    S.resetPassword(m).then(()=>toast('Te enviamos un correo para cambiar la contraseña')).catch(()=>toast('No se pudo enviar el correo'));
  };
  S.adminExists().then(ex=>{ if(!ex){ document.getElementById('lAdmin').innerHTML='<button class="btn sm" onclick="verRegistroAdmin()">Primera vez: crear cuenta de administrador</button>'; } }).catch(()=>{});
}
function verRegistroAdmin(){
  pantalla(`<div class="login-logo">$</div><h1>Crear administrador</h1><p class="sub">Esta cuenta controla todo el negocio. Solo se puede crear una vez.</p>
    <form id="fReg" class="form" style="grid-template-columns:1fr">
      <label class="f">Tu nombre<input class="input" id="rNom" required></label>
      <label class="f">Correo<input class="input" id="rMail" type="email" required></label>
      <label class="f">Contraseña<input class="input" id="rPass" type="password" minlength="6" required></label>
      <button class="btn pri" style="justify-content:center;padding:12px" id="rBtn">Crear y entrar</button>
    </form>
    <p style="text-align:center;margin:14px 0 0"><button class="btn ghost sm" onclick="verLogin()">Volver</button></p>`);
  document.getElementById('fReg').onsubmit=async e=>{
    e.preventDefault(); const b=document.getElementById('rBtn'); b.disabled=true; b.textContent='Creando…';
    try{ const prof = await S.registerAdmin(document.getElementById('rNom').value.trim(), document.getElementById('rMail').value.trim().toLowerCase(), document.getElementById('rPass').value); iniciarSesion(prof); }
    catch(err){ b.disabled=false; b.textContent='Crear y entrar'; toast(err.code==='auth/email-already-in-use'?'Ese correo ya está registrado':err.code==='permission-denied'?'Ya existe un administrador':'No se pudo crear la cuenta'); }
  };
}
function iniciarSesion(prof){
  if(ME && ME.uid===prof.uid && unsub) return;
  ME = prof; DB = emptyDB(); CEO_UID = prof.ceoUid||'';
  if(!isAdmin()) DB.users=[{id:ME.uid,...prof}];
  document.getElementById('login').style.display='none';
  document.getElementById('appShell').style.display='';
  view = isAdmin() ? 'panel' : 'cobros'; viewState={};
  if(unsub) unsub();
  unsub = S.subscribe(ME, (col, data)=>{
    if(col==='config') DB.config = migrateConfig(data);
    else if(col==='error'){ console.error(data); toast('Error de conexión con la nube'); return; }
    else DB[col] = data;
    if(col==='users'){ const me=data.find(u=>u.id===ME.uid); if(me && me.activo===false){ S.logout(); return; } if(me) ME=Object.assign(ME,me); }
    scheduleRender();
  });
  render();
}
function cerrarSesion(){
  openModal(`<h3>¿Cerrar sesión?</h3><p class="muted" style="margin-top:-8px">Para volver a entrar necesitas tu correo y contraseña.</p>
  <div class="actions"><button class="btn" onclick="closeModal()">Cancelar</button><button class="btn pri" id="btnSalir">Cerrar sesión</button></div>`);
  document.getElementById('btnSalir').onclick=async ()=>{
    closeModal(); if(unsub) unsub(); unsub=null; ME=null;
    try{ await S.logout(); }catch(e){ console.error(e); }
    verLogin();
  };
}

/* tema */
document.getElementById('themeBtn').onclick=()=>{
  const nx=document.documentElement.dataset.theme==='light'?'dark':'light';
  document.documentElement.dataset.theme=nx; try{localStorage.setItem('prestamos_tema',nx);}catch(e){}
};
try{ const t=localStorage.getItem('prestamos_tema'); if(t) document.documentElement.dataset.theme=t; }catch(e){}

window.addEventListener('beforeprint',()=>{ document.getElementById('main').classList.toggle('has-modal', !!document.getElementById('mbg')); });
window.addEventListener('afterprint',()=>{ document.getElementById('main').classList.remove('has-modal'); });
if(isNative()) document.documentElement.classList.add('native');

if(!S.configured){
  pantalla(`<div class="login-logo">$</div><h1>Falta conectar Firebase</h1><p class="sub">Pega la configuración de tu proyecto en <b>src/firebase-config.js</b> y vuelve a compilar.</p>`);
} else {
  S.watchAuth((user, prof)=>{
    if(!user){ if(unsub){unsub();unsub=null;} ME=null; verLogin(); return; }
    if(!prof){ return; } // registro en curso; iniciarSesion se llama al terminar
    if(prof.activo===false){ S.logout(); verLogin('Tu usuario está bloqueado. Habla con el administrador.'); return; }
    iniciarSesion(prof);
  });
}
