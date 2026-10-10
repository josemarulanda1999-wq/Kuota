/* =========================================================
   PORTAL KUOTA — equipo de Kuota (superadministradores)
   Empresas clientes, planes, pagos de suscripción, bloqueos y usuarios.
   ========================================================= */
const P = () => S.portal;
let D = { empresas:[], users:[], facturacion:[], kuota:{} };
let ME = null, view = 'resumen', vs = {}, unsub = null;

/* ---------- utilidades ---------- */
const fmt = fmtK;
const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = v => { if(typeof v==='number') return v; const s=String(v||'').replace(/[^\d,.-]/g,'').replace(/\./g,'').replace(',','.'); return Number(s)||0; };
const parseD = s => { const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d); };
const fdate = s => s ? parseD(s).toLocaleDateString('es-CO',{day:'2-digit',month:'short',year:'numeric'}) : '—';
const empById = id => D.empresas.find(e=>e.id===id);
const usuariosDe = eid => D.users.filter(u=>u.empresaId===eid);
const AVA_COL=['#c8f169','#cfe4f4','#efeac2','#f5c7d9','#c9c3f7','#bdeee0'];
function ava(nombre){ const n=String(nombre||'?').trim(), p=n.split(/\s+/); const ini=((p[0]||'?')[0]+((p[1]||'')[0]||'')).toUpperCase(); let h=0; for(const ch of n) h=(h*31+ch.charCodeAt(0))>>>0; return `<span class="ava" style="background:${AVA_COL[h%AVA_COL.length]}">${esc(ini)}</span>`; }
function toast(msg){ const t=document.createElement('div'); t.className='toast'; t.textContent=msg; document.body.appendChild(t); setTimeout(()=>t.remove(),2600); }
function falla(e){ console.error(e); toast(e&&e.code==='permission-denied'?'No tienes permiso para hacer eso':'No se pudo guardar'); }
function openModal(html, wide){ const r=document.getElementById('modalRoot'); r.innerHTML=`<div class="modal-bg" id="mbg"><div class="card modal ${wide?'wide':''}">${html}</div></div>`; document.getElementById('mbg').addEventListener('mousedown',e=>{ if(e.target.id==='mbg') closeModal(); }); }
function closeModal(){ document.getElementById('modalRoot').innerHTML=''; }
document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeModal(); });
const movil = () => window.innerWidth < 760;

function cuposUsados(eid){
  const act = usuariosDe(eid).filter(u=>u.activo!==false);
  return { admins: act.filter(u=>u.rol==='ceo'||u.rol==='admin').length, cobradores: act.filter(u=>u.rol==='cobrador').length };
}
function pill(emp){
  const st=estadoSuscripcion(emp);
  const c={activa:'p-ok',gracia:'p-hoy',vencida:'p-mora',bloqueada:'p-mora',pendiente:'p-pag'}[st.estado]||'p-pag';
  return `<span class="pill ${c}">${esc(st.texto)}</span>`;
}

/* ---------- navegación ---------- */
const ICON = {
  resumen:'<path d="M3 13h8V3H3zm0 8h8v-6H3zm10 0h8V11h-8zm0-18v6h8V3z"/>',
  empresas:'<path d="M4 21V5l8-3 8 3v16h-6v-5h-4v5zm4-12h2V7H8zm0 4h2v-2H8zm6-4h2V7h-2zm0 4h2v-2h-2z"/>',
  solicitudes:'<path d="M12 12a4 4 0 100-8 4 4 0 000 8zm0 2c-3.3 0-8 1.7-8 5v1h16v-1c0-3.3-4.7-5-8-5zm7-6h2v2h2v2h-2v2h-2v-2h-2v-2h2z"/>',
  pagos:'<path d="M21 7H3a1 1 0 00-1 1v8a1 1 0 001 1h18a1 1 0 001-1V8a1 1 0 00-1-1zm-9 8a3 3 0 110-6 3 3 0 010 6z"/>',
  ajustes:'<path d="M19.4 13a7.5 7.5 0 000-2l2.1-1.6-2-3.5-2.5 1a7.6 7.6 0 00-1.7-1L15 3h-4l-.4 2.7a7.6 7.6 0 00-1.7 1l-2.5-1-2 3.5L6.6 11a7.5 7.5 0 000 2l-2.1 1.6 2 3.5 2.5-1a7.6 7.6 0 001.7 1L11 21h4l.4-2.7a7.6 7.6 0 001.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 110-7 3.5 3.5 0 010 7z"/>'
};
const NAV=[['resumen','Resumen','Inicio'],['empresas','Empresas clientes','Empresas'],['solicitudes','Solicitudes de usuarios','Solicitudes'],['pagos','Pagos recibidos','Pagos'],['ajustes','Ajustes de Kuota','Ajustes']];
function renderNav(){
  const pend = D.users.filter(u=>u.estado==='pendiente').length;
  const venc = D.empresas.filter(e=>['gracia','vencida'].includes(estadoSuscripcion(e).estado)).length;
  document.getElementById('nav').innerHTML = NAV.map(([k,t,c])=>`<button class="${view===k?'on':''}" data-go="${k}"><svg viewBox="0 0 24 24" fill="currentColor">${ICON[k]}</svg><span class="nl">${t}</span><span class="ns">${c}</span>${k==='solicitudes'&&pend?`<span class="badge">${pend}</span>`:''}${k==='empresas'&&venc?`<span class="badge">${venc}</span>`:''}</button>`).join('');
  document.getElementById('userBox').innerHTML = `<div class="who" style="margin-bottom:8px">${ava(ME.nombre)}<div style="min-width:0"><b style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(ME.nombre||ME.email)}</b><span>Equipo Kuota</span></div></div><button onclick="salir()">Cerrar sesión</button>`;
  document.getElementById('topUser').innerHTML = `<img src="logo_dark.png" class="brand-img sm" alt="Kuota"><span class="muted" style="font-size:12px">Portal</span><span class="spacer"></span><button class="btn sm" onclick="salir()">Salir</button>`;
}
function go(v, st={}){ view=v; vs=st; render(); window.scrollTo(0,0); }
document.addEventListener('click', e=>{ const g=e.target.closest('[data-go]'); if(g) go(g.dataset.go); });
function render(){ if(!ME) return; renderNav(); document.getElementById('main').innerHTML=(V[view]||V.resumen)(); if(A[view]) A[view](); }
let pend=false;
function scheduleRender(){ const a=document.activeElement, m=document.getElementById('main'); if(a&&m&&m.contains(a)&&/INPUT|TEXTAREA|SELECT/.test(a.tagName)){ if(!pend){pend=true; a.addEventListener('blur',()=>{pend=false;render();},{once:true});} return; } render(); }
const V={}, A={};

/* ---------- resumen ---------- */
V.resumen = () => {
  const es = D.empresas.map(e=>({e,st:estadoSuscripcion(e)}));
  const cnt = k => es.filter(x=>x.st.estado===k).length;
  const mrr = es.filter(x=>['activa','gracia'].includes(x.st.estado)).reduce((s,x)=>s+planMensual(x.e),0);
  const mes = hoyK().slice(0,7);
  const cobradoMes = D.facturacion.filter(f=>(f.fecha||'').startsWith(mes)).reduce((s,f)=>s+(f.valor||0),0);
  const porVencer = es.filter(x=>x.st.estado==='activa' && x.st.dias<=5).sort((a,b)=>a.st.dias-b.st.dias);
  const atrasadas = es.filter(x=>['gracia','vencida'].includes(x.st.estado));
  const pendU = D.users.filter(u=>u.estado==='pendiente');
  const fila = ({e,st}) => `<tr class="click" onclick="verEmpresa('${e.id}')"><td><div class="who">${ava(e.nombre)}<b>${esc(e.nombre)}</b></div></td><td>${pill(e)}</td><td class="num">${fmt(planMensual(e))}</td><td>${fdate(e.pagadoHasta)}</td></tr>`;
  return `
  <div class="head"><div><h1>Resumen</h1><p class="sub">${new Date().toLocaleDateString('es-CO',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</p></div>
  <div class="row"><button class="btn" onclick="modalPagoKuota()">Registrar pago</button><button class="btn pri" onclick="modalEmpresa()">+ Nueva empresa</button></div></div>
  <div class="kpis">
    <div class="kpi hl"><div class="l">Ingreso mensual recurrente</div><div class="v">${fmt(mrr)}</div><div class="n">Suma de mensualidades de empresas activas</div></div>
    <div class="kpi sky"><div class="l">Cobrado este mes</div><div class="v">${fmt(cobradoMes)}</div><div class="n">${D.facturacion.filter(f=>(f.fecha||'').startsWith(mes)).length} pagos</div></div>
    <div class="kpi cream"><div class="l">Empresas</div><div class="v">${D.empresas.length}</div><div class="n">${cnt('activa')} al día · ${cnt('gracia')} en gracia · ${cnt('vencida')+cnt('bloqueada')} bloqueadas · ${cnt('pendiente')} sin activar</div></div>
  </div>
  <div class="grid2">
    <div class="card pad"><h2>Atrasadas en el pago</h2>
      ${atrasadas.length?`<table><tbody>${atrasadas.map(fila).join('')}</tbody></table>`:'<div class="empty">Ninguna empresa atrasada.</div>'}
      <h2 style="margin-top:22px">Vencen en los próximos 5 días</h2>
      ${porVencer.length?`<table><tbody>${porVencer.map(fila).join('')}</tbody></table>`:'<div class="empty">Ninguna por vencer.</div>'}
    </div>
    <div class="card pad"><div class="row" style="margin-bottom:6px"><h2 style="margin:0">Solicitudes de usuarios</h2><span class="spacer"></span><button class="btn sm" data-go="solicitudes">Ver todas</button></div>
      ${pendU.length?`<table><tbody>${pendU.slice(0,6).map(u=>`<tr><td><div class="who">${ava(u.nombre)}<div><b>${esc(u.nombre)}</b><div class="muted" style="font-size:12px">${u.rol==='admin'?'Admin':'Cobrador'} · ${esc((empById(u.empresaId)||{}).nombre||'')}</div></div></div></td><td class="right"><button class="btn sm pri" onclick="aprobarUsuario('${u.id}')">Activar</button></td></tr>`).join('')}</tbody></table>`:'<div class="empty">No hay solicitudes pendientes.</div>'}
    </div>
  </div>`;
};

/* ---------- empresas ---------- */
V.empresas = () => {
  const q=(vs.q||'').toLowerCase(), f=vs.f||'todas';
  let rows = D.empresas.map(e=>({e,st:estadoSuscripcion(e),c:cuposUsados(e.id)}));
  if(q) rows=rows.filter(r=>[r.e.nombre,r.e.nit,r.e.contacto,r.e.telefono,r.e.email,r.e.ciudad].join(' ').toLowerCase().includes(q));
  if(f==='aldia') rows=rows.filter(r=>r.st.estado==='activa');
  if(f==='atrasadas') rows=rows.filter(r=>['gracia','vencida'].includes(r.st.estado));
  if(f==='bloqueadas') rows=rows.filter(r=>['bloqueada','vencida'].includes(r.st.estado));
  if(f==='pendientes') rows=rows.filter(r=>r.st.estado==='pendiente');
  rows.sort((a,b)=>(a.e.nombre||'').localeCompare(b.e.nombre||''));
  const fb=(k,t)=>`<button class="btn sm ${f===k?'pri':''}" onclick="go('empresas',Object.assign({},vs,{f:'${k}'}))">${t}</button>`;
  return `
  <div class="head"><div><h1>Empresas clientes</h1><p class="sub">${D.empresas.length} negocios usan Kuota</p></div>
  <div class="row"><button class="btn" onclick="exportarEmpresas()">Exportar a Excel</button><button class="btn pri" onclick="modalEmpresa()">+ Nueva empresa</button></div></div>
  <div class="toolbar"><input class="input search" id="qEmp" placeholder="Buscar nombre, NIT, contacto o teléfono" value="${esc(vs.q||'')}">
    ${fb('todas','Todas')}${fb('aldia','Al día')}${fb('atrasadas','Atrasadas')}${fb('bloqueadas','Bloqueadas')}${fb('pendientes','Sin activar')}</div>
  <div class="card">${rows.length?`<div class="tablewrap"><table><thead><tr><th>Empresa</th><th>Contacto</th><th>Usuarios</th><th class="num">Mensualidad</th><th>Pagado hasta</th><th>Estado</th></tr></thead><tbody>
  ${rows.map(({e,c})=>`<tr class="click" onclick="verEmpresa('${e.id}')">
    <td><div class="who">${ava(e.nombre)}<div><b>${esc(e.nombre)}</b><div class="muted" style="font-size:12px">${esc(e.nit||'')}${e.ciudad?' · '+esc(e.ciudad):''}</div></div></div></td>
    <td>${esc(e.contacto||'')}<div class="muted" style="font-size:12px">${esc(e.telefono||'')}</div></td>
    <td>${c.admins}/${e.cupoAdmins||1} admin · ${c.cobradores}/${e.cupoCobradores||1} cob.</td>
    <td class="num">${fmt(planMensual(e))}</td><td>${fdate(e.pagadoHasta)}</td><td>${pill(e)}</td></tr>`).join('')}
  </tbody></table></div>`:`<div class="empty">${D.empresas.length?'Ninguna empresa con ese filtro.':'Aún no hay empresas. Crea la primera con “+ Nueva empresa”.'}</div>`}</div>`;
};
A.empresas = () => { const i=document.getElementById('qEmp'); i.addEventListener('input',()=>{ vs.q=i.value; const p=i.selectionStart; render(); const j=document.getElementById('qEmp'); j.focus(); j.setSelectionRange(p,p); }); };

function modalEmpresa(id){
  const e = id ? empById(id) : { nombre:'', nit:'', contacto:'', telefono:'', email:'', ciudad:'', notas:'', cupoAdmins:1, cupoCobradores:1, diasGracia:5 };
  openModal(`<h3>${id?'Editar empresa':'Nueva empresa'}</h3>
  <div class="form">
    <label class="f full">Nombre del negocio *<input class="input" id="eNom" value="${esc(e.nombre)}"></label>
    <label class="f">NIT o cédula<input class="input" id="eNit" value="${esc(e.nit)}"></label>
    <label class="f">Ciudad<input class="input" id="eCiu" value="${esc(e.ciudad)}"></label>
    <label class="f">Persona de contacto<input class="input" id="eCon" value="${esc(e.contacto)}"></label>
    <label class="f">Teléfono / WhatsApp<input class="input" id="eTel" value="${esc(e.telefono)}"></label>
    <label class="f full">Correo de contacto<input class="input" id="eMail" value="${esc(e.email)}"></label>
    <label class="f">Administradores (incluye al CEO)<input class="input" id="eCA" type="number" min="1" value="${e.cupoAdmins||1}"></label>
    <label class="f">Cobradores<input class="input" id="eCC" type="number" min="1" value="${e.cupoCobradores||1}"></label>
    <label class="f">Días de gracia antes de bloquear<input class="input" id="eGr" type="number" min="0" value="${e.diasGracia??5}"></label>
    <label class="f">Mensualidad<input class="input" id="eMen" disabled></label>
    <label class="f full">Notas internas<textarea class="input" id="eNot" rows="2">${esc(e.notas||'')}</textarea></label>
  </div>
  ${id?'':`<h3 style="font-size:16px;margin:20px 0 10px">Usuario CEO (dueño del negocio)</h3>
  <div class="form">
    <label class="f full">Nombre *<input class="input" id="cNom"></label>
    <label class="f">Correo para entrar *<input class="input" id="cMail" type="email" autocomplete="off"></label>
    <label class="f">Contraseña inicial *<input class="input" id="cPass" type="text" autocomplete="off" placeholder="Mínimo 6 caracteres"></label>
    <label class="chk full"><input type="checkbox" id="cPagado" checked> Ya pagó la activación (${fmt(PRECIOS.activacion)} + adicionales): activar desde hoy por un mes</label>
  </div>`}
  <div class="actions"><button class="btn" onclick="closeModal()">Cancelar</button><button class="btn pri" id="eSave">${id?'Guardar':'Crear empresa'}</button></div>`, true);
  const upd=()=>{ document.getElementById('eMen').value=fmt(planMensual({cupoAdmins:num(document.getElementById('eCA').value),cupoCobradores:num(document.getElementById('eCC').value)})); };
  ['eCA','eCC'].forEach(k=>document.getElementById(k).addEventListener('input',upd)); upd();
  document.getElementById('eSave').onclick=async ()=>{
    const g=k=>document.getElementById(k).value.trim();
    const data={ nombre:g('eNom'), nit:g('eNit'), ciudad:g('eCiu'), contacto:g('eCon'), telefono:g('eTel'), email:g('eMail'), notas:g('eNot'),
      cupoAdmins:Math.max(1,num(g('eCA'))), cupoCobradores:Math.max(1,num(g('eCC'))), diasGracia:Math.max(0,num(g('eGr'))) };
    if(!data.nombre) return toast('Escribe el nombre del negocio');
    if(id){
      const c=cuposUsados(id);
      if(data.cupoAdmins<c.admins || data.cupoCobradores<c.cobradores) return toast(`Tiene ${c.admins} admin y ${c.cobradores} cobradores activos; desactiva usuarios antes de bajar el cupo`);
      data.venceMs = calcVenceMs(e.pagadoHasta, data.diasGracia);
      P().update('empresas/'+id, data).then(()=>toast('Empresa actualizada')).catch(falla); closeModal(); return;
    }
    const ceo={nombre:g('cNom'), email:g('cMail').toLowerCase(), pass:document.getElementById('cPass').value};
    if(!ceo.nombre) return toast('Escribe el nombre del CEO');
    if(!/^\S+@\S+\.\S+$/.test(ceo.email)) return toast('Escribe un correo válido para el CEO');
    if(ceo.pass.length<6) return toast('La contraseña debe tener mínimo 6 caracteres');
    const pagado=document.getElementById('cPagado').checked;
    Object.assign(data,{ estado:'activa', creado:Date.now(), creadoPor:ME.uid, pagadoHasta:'', venceMs:0, activacionPagada:false });
    const b=document.getElementById('eSave'); b.disabled=true; b.textContent='Creando…';
    try{
      const eid = await P().crearEmpresaConCeo(data, ceo);
      if(pagado){
        const hasta = sumarDias(sumarMeses(hoyK(),1),-1);
        const valor = PRECIOS.activacion + (planMensual(data)-PRECIOS.mensual);
        await registrarPago({ empresaId:eid, empresaNombre:data.nombre, fecha:hoyK(), concepto:'Activación + primer mes', valor, meses:1, metodo:'', nota:'', anterior:'', nuevo:hasta, activacion:true, gracia:data.diasGracia });
      }
      closeModal(); toast('Empresa creada'); verEmpresa(eid);
      setTimeout(()=>avisar(`Datos de acceso para el CEO de ${data.nombre}:\n\nApp (celular): descargar Kuota.apk\nPC: ${location.origin}${location.pathname.replace(/portal\.html$/,'')}\nCorreo: ${ceo.email}\nContraseña: ${ceo.pass}`),300);
    }catch(err){ b.disabled=false; b.textContent='Crear empresa'; toast(err.code==='auth/email-already-in-use'?'Ese correo ya tiene un usuario en Kuota':'No se pudo crear la empresa'); console.error(err); }
  };
}

function verEmpresa(id){ go('empresa',{id}); }
V.empresa = () => {
  const e=empById(vs.id); if(!e) return '<div class="empty">Empresa no encontrada.</div>';
  const st=estadoSuscripcion(e), c=cuposUsados(e.id);
  const us=usuariosDe(e.id).sort((a,b)=>({ceo:0,admin:1,cobrador:2}[a.rol]-({ceo:0,admin:1,cobrador:2}[b.rol])));
  const fac=D.facturacion.filter(f=>f.empresaId===e.id).sort((a,b)=>(b.fecha||'').localeCompare(a.fecha||'')||(b.creado||0)-(a.creado||0));
  return `
  <div class="head"><div><p class="sub" style="margin:0 0 4px"><button class="btn ghost sm" data-go="empresas">← Empresas</button></p><h1>${esc(e.nombre)}</h1><p class="sub">${esc([e.nit,e.ciudad,e.contacto,e.telefono,e.email].filter(Boolean).join(' · '))}</p></div>
  <div class="row"><button class="btn" onclick="modalEmpresa('${e.id}')">Editar datos y plan</button>
    ${e.estado==='bloqueada'?`<button class="btn" onclick="bloquear('${e.id}',false)">Desbloquear</button>`:`<button class="btn danger" onclick="bloquear('${e.id}',true)">Bloquear</button>`}
    <button class="btn pri" onclick="modalPagoKuota('${e.id}')">Registrar pago</button></div></div>
  <div class="kpis">
    <div class="kpi card"><div class="l">Estado</div><div style="margin-top:8px">${pill(e)}</div><div class="n">${e.pagadoHasta?'Pagado hasta '+fdate(e.pagadoHasta)+(st.limite?' · se bloquea el '+fdate(st.limite):''):'Nunca ha pagado'}</div></div>
    <div class="kpi hl"><div class="l">Mensualidad</div><div class="v">${fmt(planMensual(e))}</div><div class="n">${planDetalle(e).map(x=>x[0]).join(' + ')}</div></div>
    <div class="kpi sky"><div class="l">Usuarios activos</div><div class="v">${c.admins+c.cobradores}</div><div class="n">${c.admins}/${e.cupoAdmins||1} administradores · ${c.cobradores}/${e.cupoCobradores||1} cobradores</div></div>
  </div>
  <div class="grid2">
    <div class="card pad"><div class="row" style="margin-bottom:8px"><h2 style="margin:0">Usuarios</h2><span class="spacer"></span><button class="btn sm" onclick="modalUsuarioPortal('${e.id}')">+ Crear usuario</button></div>
      <div class="tablewrap"><table><tbody>${us.map(u=>`<tr><td><div class="who">${ava(u.nombre)}<div><b>${esc(u.nombre)}</b><div class="muted" style="font-size:12px">${esc(u.email)}</div></div></div></td>
        <td>${u.rol==='ceo'?'<span class="pill p-hoy">CEO</span>':u.rol==='admin'?'<span class="pill p-pag">Admin</span>':'<span class="pill p-ok">Cobrador</span>'}</td>
        <td>${u.estado==='pendiente'?'<span class="pill p-hoy">Pendiente</span>':u.activo===false?'<span class="pill p-mora">Desactivado</span>':'<span class="pill p-ok">Activo</span>'}</td>
        <td class="right" style="white-space:nowrap">${u.rol==='ceo'?'':(u.activo===false?`<button class="btn sm pri" onclick="aprobarUsuario('${u.id}')">Activar</button>`:`<button class="btn sm" onclick="desactivarUsuario('${u.id}')">Desactivar</button>`)+` <button class="btn sm danger" onclick="eliminarUsuario('${u.id}')">Eliminar</button>`}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="card pad"><h2>Pagos de suscripción</h2>
      ${fac.length?`<table><tbody>${fac.map(f=>`<tr><td>${fdate(f.fecha)}<div class="muted" style="font-size:12px">${esc(f.concepto||'')}${f.metodo?' · '+esc(f.metodo):''}</div></td><td class="muted" style="font-size:12px">hasta ${fdate(f.nuevo)}</td><td class="num"><b>${fmt(f.valor)}</b></td><td class="right"><button class="btn sm danger" onclick="borrarPagoKuota('${f.id}')">Borrar</button></td></tr>`).join('')}</tbody></table>`:'<div class="empty">Sin pagos registrados.</div>'}
      ${e.notas?`<h2 style="margin-top:18px">Notas</h2><p class="muted">${esc(e.notas)}</p>`:''}
    </div>
  </div>`;
};

/* ---------- pagos de suscripción ---------- */
function proximoHasta(e, fecha, meses){
  const gr=Number(e.diasGracia??5);
  const base = (e.pagadoHasta && e.pagadoHasta >= sumarDias(fecha,-gr-1)) ? e.pagadoHasta : sumarDias(fecha,-1);
  return sumarMeses(base, meses);
}
function modalPagoKuota(eid){
  const opts = [...D.empresas].sort((a,b)=>(a.nombre||'').localeCompare(b.nombre||''));
  if(!opts.length) return toast('Primero crea una empresa');
  openModal(`<h3>Registrar pago de suscripción</h3>
  <div class="form">
    <label class="f full">Empresa<select class="input" id="kEmp">${opts.map(e=>`<option value="${e.id}" ${e.id===eid?'selected':''}>${esc(e.nombre)}</option>`).join('')}</select></label>
    <label class="f">Concepto<select class="input" id="kCon"><option value="mensualidad">Mensualidad</option><option value="activacion">Activación + primer mes</option><option value="otro">Otro</option></select></label>
    <label class="f">Meses que paga<input class="input" id="kMes" type="number" min="0" value="1"></label>
    <label class="f">Fecha del pago<input class="input" id="kFec" type="date" value="${hoyK()}"></label>
    <label class="f">Valor recibido<input class="input" id="kVal" inputmode="numeric"></label>
    <label class="f">Medio de pago<select class="input" id="kMet"><option>Nequi</option><option>Bancolombia</option><option>Daviplata</option><option>Transferencia</option><option>Efectivo</option><option>Otro</option></select></label>
    <label class="f">Queda pagado hasta<input class="input" id="kHas" type="date"></label>
    <label class="f full">Nota<input class="input" id="kNot" placeholder="Opcional: número de comprobante, etc."></label>
  </div>
  <p class="muted" id="kInfo" style="font-size:13px"></p>
  <div class="actions"><button class="btn" onclick="closeModal()">Cancelar</button><button class="btn pri" id="kSave">Guardar pago</button></div>`);
  const $=k=>document.getElementById(k);
  const recalcular=(cambiaValor)=>{
    const e=empById($('kEmp').value), con=$('kCon').value, meses=Math.max(0,num($('kMes').value)), fecha=$('kFec').value||hoyK();
    const extras=planMensual(e)-PRECIOS.mensual;
    if(cambiaValor) $('kVal').value = (con==='activacion' ? PRECIOS.activacion+extras+(Math.max(0,meses-1))*planMensual(e) : con==='mensualidad' ? planMensual(e)*meses : 0).toLocaleString('es-CO');
    $('kHas').value = con==='activacion' ? sumarDias(sumarMeses(fecha,Math.max(1,meses)),-1) : meses>0 ? proximoHasta(e,fecha,meses) : (e.pagadoHasta||'');
    $('kInfo').textContent = `Mensualidad de ${e.nombre}: ${fmt(planMensual(e))}. Hoy está pagado hasta ${fdate(e.pagadoHasta)}.`;
  };
  ['kEmp','kCon','kMes'].forEach(k=>$(k).addEventListener('change',()=>recalcular(true)));
  $('kMes').addEventListener('input',()=>recalcular(true)); $('kFec').addEventListener('change',()=>recalcular(false));
  $('kVal').addEventListener('blur',()=>{ const n=num($('kVal').value); if(n) $('kVal').value=n.toLocaleString('es-CO'); });
  recalcular(true);
  $('kSave').onclick=async ()=>{
    const e=empById($('kEmp').value), valor=num($('kVal').value), con=$('kCon').value;
    if(valor<=0) return toast('Escribe el valor recibido');
    const nuevo=$('kHas').value;
    await registrarPago({ empresaId:e.id, empresaNombre:e.nombre, fecha:$('kFec').value||hoyK(), concepto:{mensualidad:'Mensualidad',activacion:'Activación + primer mes',otro:'Otro'}[con]+(num($('kMes').value)>1?` (${num($('kMes').value)} meses)`:''),
      valor, meses:num($('kMes').value), metodo:$('kMet').value, nota:$('kNot').value.trim(), anterior:e.pagadoHasta||'', nuevo, activacion:con==='activacion', gracia:e.diasGracia??5 }).catch(falla);
    closeModal(); toast('Pago registrado'); render();
  };
}
async function registrarPago(p){
  const id=P().newId('facturacion');
  await P().set('facturacion/'+id, { empresaId:p.empresaId, empresaNombre:p.empresaNombre, fecha:p.fecha, concepto:p.concepto, valor:p.valor, meses:p.meses, metodo:p.metodo, nota:p.nota, anterior:p.anterior, nuevo:p.nuevo, registradoPor:ME.uid, creado:Date.now() });
  const upd={ pagadoHasta:p.nuevo, venceMs:calcVenceMs(p.nuevo, p.gracia) };
  if(p.activacion) upd.activacionPagada=true;
  await P().update('empresas/'+p.empresaId, upd);
}
async function borrarPagoKuota(id){
  const f=D.facturacion.find(x=>x.id===id); if(!f) return;
  const e=empById(f.empresaId);
  if(!await confirmar(`¿Borrar el pago de ${fmt(f.valor)} del ${fdate(f.fecha)}?${f.anterior!==undefined&&e&&e.pagadoHasta===f.nuevo?`\n\nLa empresa vuelve a quedar pagada hasta ${fdate(f.anterior)}.`:''}`)) return;
  P().remove('facturacion/'+id).catch(falla);
  if(e && e.pagadoHasta===f.nuevo){ P().update('empresas/'+e.id,{ pagadoHasta:f.anterior||'', venceMs:calcVenceMs(f.anterior||'', e.diasGracia??5) }).catch(falla); }
  toast('Pago borrado');
}
async function bloquear(eid, si){
  const e=empById(eid);
  if(si && !await confirmar(`¿Bloquear ${e.nombre}? Nadie del negocio podrá usar Kuota hasta que lo desbloquees.`)) return;
  P().update('empresas/'+eid,{estado:si?'bloqueada':'activa'}).then(()=>toast(si?'Empresa bloqueada':'Empresa desbloqueada')).catch(falla);
}
V.pagos = () => {
  const mes = vs.mes || hoyK().slice(0,7);
  const rows = D.facturacion.filter(f=>mes==='todo'||(f.fecha||'').startsWith(mes)).sort((a,b)=>(b.fecha||'').localeCompare(a.fecha||'')||(b.creado||0)-(a.creado||0));
  const total = rows.reduce((s,f)=>s+(f.valor||0),0);
  const meses=[...new Set(D.facturacion.map(f=>(f.fecha||'').slice(0,7)).concat([hoyK().slice(0,7)]))].sort().reverse();
  return `
  <div class="head"><div><h1>Pagos recibidos</h1><p class="sub">Lo que han pagado las empresas por usar Kuota.</p></div>
  <div class="row"><select class="input" style="width:auto" onchange="go('pagos',{mes:this.value})">${meses.map(m=>`<option value="${m}" ${m===mes?'selected':''}>${parseD(m+'-01').toLocaleDateString('es-CO',{month:'long',year:'numeric'})}</option>`).join('')}<option value="todo" ${mes==='todo'?'selected':''}>Todo</option></select>
  <button class="btn pri" onclick="modalPagoKuota()">Registrar pago</button></div></div>
  <div class="kpis"><div class="kpi hl"><div class="l">Total recibido</div><div class="v">${fmt(total)}</div><div class="n">${rows.length} pagos</div></div></div>
  <div class="card">${rows.length?`<div class="tablewrap"><table><thead><tr><th>Fecha</th><th>Empresa</th><th>Concepto</th><th>Medio</th><th>Pagado hasta</th><th class="num">Valor</th></tr></thead><tbody>
  ${rows.map(f=>`<tr class="click" onclick="verEmpresa('${f.empresaId}')"><td>${fdate(f.fecha)}</td><td><b>${esc((empById(f.empresaId)||{}).nombre||f.empresaNombre||'')}</b></td><td>${esc(f.concepto||'')}${f.nota?`<div class="muted" style="font-size:12px">${esc(f.nota)}</div>`:''}</td><td>${esc(f.metodo||'')}</td><td>${fdate(f.nuevo)}</td><td class="num"><b>${fmt(f.valor)}</b></td></tr>`).join('')}
  </tbody></table></div>`:'<div class="empty">No hay pagos en este periodo.</div>'}</div>`;
};

/* ---------- usuarios de las empresas ---------- */
V.solicitudes = () => {
  const pend = D.users.filter(u=>u.estado==='pendiente');
  return `
  <div class="head"><div><h1>Solicitudes de usuarios</h1><p class="sub">Usuarios que los negocios pidieron. Al activarlos se suman a su mensualidad si superan el cupo.</p></div></div>
  <div class="card">${pend.length?`<div class="tablewrap"><table><thead><tr><th>Usuario</th><th>Empresa</th><th>Rol</th><th>Cupo actual</th><th>Mensualidad si se activa</th><th></th></tr></thead><tbody>
  ${pend.map(u=>{ const e=empById(u.empresaId)||{}; const c=cuposUsados(u.empresaId); const ad=u.rol==='admin';
    const usado=ad?c.admins:c.cobradores, cupo=ad?(e.cupoAdmins||1):(e.cupoCobradores||1);
    const nuevoPlan = usado+1>cupo ? planMensual(Object.assign({},e, ad?{cupoAdmins:usado+1}:{cupoCobradores:usado+1})) : planMensual(e);
    return `<tr><td><div class="who">${ava(u.nombre)}<div><b>${esc(u.nombre)}</b><div class="muted" style="font-size:12px">${esc(u.email)}</div></div></div></td>
    <td>${esc(e.nombre||'')}</td><td>${ad?'Admin':'Cobrador'}</td><td>${usado} de ${cupo}</td>
    <td>${fmt(nuevoPlan)}${nuevoPlan>planMensual(e)?` <span class="pill p-hoy">+${fmt(nuevoPlan-planMensual(e))}</span>`:''}</td>
    <td class="right" style="white-space:nowrap"><button class="btn sm pri" onclick="aprobarUsuario('${u.id}')">Activar</button> <button class="btn sm danger" onclick="eliminarUsuario('${u.id}',true)">Rechazar</button></td></tr>`;}).join('')}
  </tbody></table></div>`:'<div class="empty">No hay solicitudes pendientes.</div>'}</div>`;
};
async function aprobarUsuario(uid){
  const u=D.users.find(x=>x.id===uid), e=empById(u.empresaId); if(!u||!e) return;
  const c=cuposUsados(e.id), ad=u.rol==='admin'||u.rol==='ceo';
  const usado=ad?c.admins:c.cobradores, cupo=ad?(e.cupoAdmins||1):(e.cupoCobradores||1);
  if(usado+1>cupo){
    const nuevo=Object.assign({},e, ad?{cupoAdmins:usado+1}:{cupoCobradores:usado+1});
    if(!await confirmar(`${e.nombre} ya usa ${usado} de ${cupo} ${ad?'administradores':'cobradores'}.\n\nActivar a ${u.nombre} sube el cupo a ${usado+1} y la mensualidad de ${fmt(planMensual(e))} a ${fmt(planMensual(nuevo))}. ¿Continuar?`)) return;
    P().update('empresas/'+e.id, ad?{cupoAdmins:usado+1}:{cupoCobradores:usado+1}).catch(falla);
  }
  P().update('users/'+uid,{activo:true,estado:'activo'}).then(()=>toast(u.nombre+' activado')).catch(falla);
}
async function preguntarBajarCupo(u){
  const e=empById(u.empresaId); if(!e) return;
  const ad=u.rol==='admin', campo=ad?'cupoAdmins':'cupoCobradores', cupo=e[campo]||1;
  if(cupo<=1) return;
  const nuevo=Object.assign({},e,{[campo]:cupo-1});
  if(await confirmar(`¿Bajar también el cupo de ${ad?'administradores':'cobradores'} de ${cupo} a ${cupo-1}? La mensualidad pasaría de ${fmt(planMensual(e))} a ${fmt(planMensual(nuevo))}.`))
    P().update('empresas/'+e.id,{[campo]:cupo-1}).catch(falla);
}
async function desactivarUsuario(uid){
  const u=D.users.find(x=>x.id===uid); if(!u) return;
  if(!await confirmar(`¿Desactivar a ${u.nombre}? No podrá entrar a Kuota.`)) return;
  P().update('users/'+uid,{activo:false,estado:'desactivado'}).then(()=>{ toast('Usuario desactivado'); preguntarBajarCupo(u); }).catch(falla);
}
async function eliminarUsuario(uid, rechazo){
  const u=D.users.find(x=>x.id===uid); if(!u) return;
  if(!await confirmar(rechazo?`¿Rechazar la solicitud de ${u.nombre}?`:`¿Eliminar a ${u.nombre} de ${(empById(u.empresaId)||{}).nombre}? Pierde el acceso de inmediato. Sus clientes asignados quedan sin cobrador hasta que el negocio los reasigne.`)) return;
  const eraActivo = u.activo!==false;
  P().remove('users/'+uid).then(()=>{ toast(rechazo?'Solicitud rechazada':'Usuario eliminado'); if(eraActivo && !rechazo) preguntarBajarCupo(u); }).catch(falla);
}
function modalUsuarioPortal(eid){
  const e=empById(eid);
  openModal(`<h3>Crear usuario en ${esc(e.nombre)}</h3>
  <div class="form">
    <label class="f full">Nombre<input class="input" id="uNom"></label>
    <label class="f">Correo<input class="input" id="uMail" type="email" autocomplete="off"></label>
    <label class="f">Contraseña inicial<input class="input" id="uPass" type="text" autocomplete="off"></label>
    <label class="f full">Rol<select class="input" id="uRol"><option value="cobrador">Cobrador</option><option value="admin">Admin</option></select></label>
  </div><p class="muted" style="font-size:13px" id="uInfo"></p>
  <div class="actions"><button class="btn" onclick="closeModal()">Cancelar</button><button class="btn pri" id="uSave">Crear y activar</button></div>`);
  const info=()=>{ const ad=document.getElementById('uRol').value==='admin', c=cuposUsados(eid), usado=ad?c.admins:c.cobradores, cupo=ad?(e.cupoAdmins||1):(e.cupoCobradores||1);
    document.getElementById('uInfo').textContent = usado+1>cupo ? `Supera el cupo (${usado} de ${cupo}): la mensualidad sube a ${fmt(planMensual(Object.assign({},e,ad?{cupoAdmins:usado+1}:{cupoCobradores:usado+1})))}.` : `Queda dentro del cupo (${usado+1} de ${cupo}).`; };
  document.getElementById('uRol').onchange=info; info();
  document.getElementById('uSave').onclick=async ()=>{
    const nombre=document.getElementById('uNom').value.trim(), email=document.getElementById('uMail').value.trim().toLowerCase(), pass=document.getElementById('uPass').value, rol=document.getElementById('uRol').value;
    if(!nombre||!/^\S+@\S+\.\S+$/.test(email)) return toast('Escribe nombre y correo válidos');
    if(pass.length<6) return toast('La contraseña debe tener mínimo 6 caracteres');
    const ad=rol==='admin', c=cuposUsados(eid), usado=ad?c.admins:c.cobradores, cupo=ad?(e.cupoAdmins||1):(e.cupoCobradores||1);
    try{ await P().crearUsuario(eid,nombre,email,pass,rol);
      if(usado+1>cupo) await P().update('empresas/'+eid, ad?{cupoAdmins:usado+1}:{cupoCobradores:usado+1});
      closeModal(); toast('Usuario creado'); }
    catch(err){ toast(err.code==='auth/email-already-in-use'?'Ese correo ya tiene un usuario':'No se pudo crear'); console.error(err); }
  };
}

/* ---------- ajustes ---------- */
V.ajustes = () => {
  const k=D.kuota||{};
  return `
  <div class="head"><div><h1>Ajustes de Kuota</h1><p class="sub">Datos que ven los negocios para pagar su suscripción.</p></div></div>
  <div class="grid2">
  <div class="card pad"><h2>Medios de pago y contacto</h2>
    <div class="form">
      <label class="f">WhatsApp de Kuota<input class="input" id="kW" value="${esc(k.whatsapp||'')}" placeholder="Ej: 573001234567"></label>
      <label class="f">Nequi<input class="input" id="kN" value="${esc(k.nequi||'')}"></label>
      <label class="f full">Cuenta bancaria<input class="input" id="kB" value="${esc(k.banco||'')}" placeholder="Ej: Bancolombia ahorros 000-000000-00 a nombre de…"></label>
      <label class="f full">Correo<input class="input" id="kC" value="${esc(k.correo||'')}"></label>
      <label class="f full">Nota para los clientes<textarea class="input" id="kT" rows="2" placeholder="Ej: Envía el comprobante por WhatsApp con el nombre de tu negocio">${esc(k.notaPago||'')}</textarea></label>
    </div>
    <div class="actions"><button class="btn pri" onclick="guardarKuota()">Guardar</button></div>
  </div>
  <div class="card pad"><h2>Precios</h2>
    <table><tbody>
      <tr><td>Activación (incluye el primer mes)</td><td class="num">${fmt(PRECIOS.activacion)}</td></tr>
      <tr><td>Mensualidad (1 administrador + 1 cobrador)</td><td class="num">${fmt(PRECIOS.mensual)}</td></tr>
      <tr><td>Cobrador adicional / mes</td><td class="num">${fmt(PRECIOS.cobradorExtra)}</td></tr>
      <tr><td>Administrador adicional / mes</td><td class="num">${fmt(PRECIOS.adminExtra)}</td></tr>
    </tbody></table>
    <h2 style="margin-top:22px">Datos de la primera versión</h2>
    <p class="muted">Si usaste Kuota antes de que existiera el portal, aquí mueves esos datos a una empresa.</p>
    <button class="btn" onclick="modalMigrar()">Mover datos anteriores a una empresa</button>
  </div></div>`;
};
function guardarKuota(){
  const g=k=>document.getElementById(k).value.trim();
  P().set('meta/kuota',{whatsapp:g('kW'),nequi:g('kN'),banco:g('kB'),correo:g('kC'),notaPago:g('kT')},true).then(()=>toast('Guardado')).catch(falla);
}
async function modalMigrar(){
  let L; try{ L=await P().legado(); }catch(e){ return falla(e); }
  const ceo=D.users.find(u=>u.id===L.ceoUid);
  openModal(`<h3>Mover datos anteriores</h3>
  <p class="muted">Encontré ${L.clientes} clientes y ${L.salidas} gastos de la primera versión${ceo?`, del usuario <b>${esc(ceo.nombre)}</b> (${esc(ceo.email)})`:''}.</p>
  <div class="form">
    <label class="f full">Nombre de la empresa<input class="input" id="mNom" value="${esc((ceo&&ceo.nombre)?'Negocio de '+ceo.nombre:'')}"></label>
    <label class="f">Administradores<input class="input" id="mCA" type="number" min="1" value="${Math.max(1,D.users.filter(u=>!u.empresaId&&u.rol==='admin').length)}"></label>
    <label class="f">Cobradores<input class="input" id="mCC" type="number" min="1" value="${Math.max(1,D.users.filter(u=>!u.empresaId&&u.rol==='cobrador').length)}"></label>
    <label class="f">Pagado hasta<input class="input" id="mHas" type="date" value="${sumarDias(sumarMeses(hoyK(),1),-1)}"></label>
  </div>
  <p class="muted" style="font-size:13px">Los usuarios de la primera versión pasan a esta empresa: ${ceo?esc(ceo.nombre)+' queda como CEO.':'elige el CEO después.'}</p>
  <div class="actions"><button class="btn" onclick="closeModal()">Cancelar</button><button class="btn pri" id="mGo">Mover datos</button></div>`);
  document.getElementById('mGo').onclick=async ()=>{
    const nombre=document.getElementById('mNom').value.trim(); if(!nombre) return toast('Escribe el nombre');
    const b=document.getElementById('mGo'); b.disabled=true; b.textContent='Moviendo…';
    try{
      const eid=P().newId('empresas'); const hasta=document.getElementById('mHas').value;
      await P().set('empresas/'+eid,{nombre, estado:'activa', cupoAdmins:Math.max(1,num(document.getElementById('mCA').value)), cupoCobradores:Math.max(1,num(document.getElementById('mCC').value)), diasGracia:5, pagadoHasta:hasta, venceMs:calcVenceMs(hasta,5), activacionPagada:true, ceoUid:L.ceoUid||'', creado:Date.now(), creadoPor:ME.uid});
      const n=await P().migrarLegado(eid, L.ceoUid);
      closeModal(); toast(`Listo: ${n} registros movidos`); verEmpresa(eid);
    }catch(e){ b.disabled=false; b.textContent='Mover datos'; falla(e); }
  };
}
function exportarEmpresas(){
  const rows=[['EMPRESA','NIT','CIUDAD','CONTACTO','TELEFONO','CORREO','ADMINS','COBRADORES','MENSUALIDAD','PAGADO HASTA','ESTADO']];
  for(const e of D.empresas) rows.push([e.nombre,e.nit,e.ciudad,e.contacto,e.telefono,e.email,e.cupoAdmins,e.cupoCobradores,planMensual(e),e.pagadoHasta,estadoSuscripcion(e).texto]);
  const csv='﻿'+rows.map(r=>r.map(v=>{v=v==null?'':String(v); return /[";\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;}).join(';')).join('\r\n');
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'})); a.download=`empresas_kuota_${hoyK()}.csv`; a.click();
}

/* ---------- acceso ---------- */
function pantalla(html){ document.getElementById('appShell').style.display='none'; const l=document.getElementById('login'); l.style.display='flex'; l.innerHTML=`<div class="login-card card">${html}</div>`; }
function verLogin(msg){
  pantalla(`<img src="logo_dark.png" class="login-brand" alt="Kuota"><h1 style="font-size:22px;margin-top:4px">Portal de la empresa</h1><p class="sub">Solo para el equipo de Kuota.</p>
    ${msg?`<div class="banner">${esc(msg)}</div>`:''}
    <form id="fLogin" class="form" style="grid-template-columns:1fr">
      <label class="f">Correo<input class="input" id="lMail" type="email" autocomplete="username" required></label>
      <label class="f">Contraseña<input class="input" id="lPass" type="password" autocomplete="current-password" required></label>
      <button class="btn pri" style="justify-content:center;padding:12px" id="lBtn">Entrar</button>
    </form>`);
  document.getElementById('fLogin').onsubmit=async e=>{ e.preventDefault(); const b=document.getElementById('lBtn'); b.disabled=true;
    try{ await S.login(document.getElementById('lMail').value.trim(), document.getElementById('lPass').value); }catch(err){ b.disabled=false; toast('Correo o contraseña incorrectos'); } };
}
async function noAutorizado(user){
  let hay=true; try{ hay=await P().hayEquipo(); }catch(e){}
  pantalla(`<img src="logo_dark.png" class="login-brand" alt="Kuota"><h1 style="font-size:22px">${hay?'Esta cuenta no es del equipo Kuota':'Activar el portal'}</h1>
    <p class="sub">${hay?'Entra con una cuenta de superadministrador.':`Todavía no hay superadministrador. La cuenta <b>${esc(user.email)}</b> quedará como dueña del portal de Kuota. Solo se puede hacer una vez.`}</p>
    ${hay?'':`<label class="f" style="margin-bottom:12px">Tu nombre<input class="input" id="sNom"></label><button class="btn pri" style="width:100%;justify-content:center;padding:12px" id="sGo">Activar como superadministrador</button>`}
    <p style="text-align:center;margin-top:14px"><button class="btn" onclick="salir(true)">Cerrar sesión</button></p>`);
  if(!hay) document.getElementById('sGo').onclick=async ()=>{ const n=document.getElementById('sNom').value.trim(); if(!n) return toast('Escribe tu nombre');
    try{ await P().activarmeSuper(n); entrar(user, n); }catch(e){ falla(e); } };
}
function entrar(user, nombre){
  ME={uid:user.uid, email:user.email, nombre:nombre||user.email};
  document.getElementById('login').style.display='none'; document.getElementById('appShell').style.display='';
  if(unsub) unsub();
  unsub=P().watch((col,data)=>{ if(col==='error'){ console.error(data); return; } D[col]=data; if(col==='users'){ const me=data.find(u=>u.id===ME.uid); if(me&&me.nombre&&ME.nombre===ME.email) ME.nombre=me.nombre; } scheduleRender(); });
  render();
}
function salir(directo){
  const fin=async()=>{ if(unsub) unsub(); unsub=null; ME=null; await S.logout().catch(()=>{}); verLogin(); };
  if(directo) return fin();
  openModal(`<h3>¿Cerrar sesión?</h3><div class="actions"><button class="btn" onclick="closeModal()">Cancelar</button><button class="btn pri" id="bS">Cerrar sesión</button></div>`);
  document.getElementById('bS').onclick=()=>{ closeModal(); fin(); };
}
document.getElementById('themeBtn').onclick=()=>{ const nx=document.documentElement.dataset.theme==='light'?'dark':'light'; document.documentElement.dataset.theme=nx; try{localStorage.setItem('prestamos_tema',nx);}catch(e){} };
try{ const t=localStorage.getItem('prestamos_tema'); if(t) document.documentElement.dataset.theme=t; }catch(e){}
window.addEventListener('resize',()=>{ if(ME) render(); });

S.watchAuth(async (user)=>{
  if(!user){ if(unsub){unsub();unsub=null;} ME=null; return verLogin(); }
  let ok=false; try{ ok=await P().soySuper(); }catch(e){ console.error(e); }
  if(!ok) return noAutorizado(user);
  let nombre=''; try{ const u=D.users.find(x=>x.id===user.uid); nombre=u&&u.nombre; }catch(e){}
  entrar(user, nombre);
});
