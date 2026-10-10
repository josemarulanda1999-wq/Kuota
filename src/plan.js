/* Kuota — precios y estado de la suscripción (lo usan la app y el portal) */
const PRECIOS = { activacion: 200000, mensual: 80000, cobradorExtra: 20000, adminExtra: 35000, incluidosAdmins: 1, incluidosCobradores: 1 };

function planMensual(emp){
  const a = Math.max(1, Number(emp.cupoAdmins)||1), c = Math.max(1, Number(emp.cupoCobradores)||1);
  return PRECIOS.mensual + (a-PRECIOS.incluidosAdmins)*PRECIOS.adminExtra + (c-PRECIOS.incluidosCobradores)*PRECIOS.cobradorExtra;
}
function planDetalle(emp){
  const a = Math.max(1, Number(emp.cupoAdmins)||1), c = Math.max(1, Number(emp.cupoCobradores)||1);
  const r = [['Plan base (1 administrador + 1 cobrador)', PRECIOS.mensual]];
  if (a>1) r.push([`${a-1} administrador${a>2?'es':''} adicional${a>2?'es':''} × $35.000`, (a-1)*PRECIOS.adminExtra]);
  if (c>1) r.push([`${c-1} cobrador${c>2?'es':''} adicional${c>2?'es':''} × $20.000`, (c-1)*PRECIOS.cobradorExtra]);
  return r;
}
function ymdK(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function hoyK(){ return ymdK(new Date()); }
function sumarMeses(s, n){
  const [y,m,d] = s.split('-').map(Number);
  const f = new Date(y, m-1+n, 1); const ult = new Date(f.getFullYear(), f.getMonth()+1, 0).getDate();
  f.setDate(Math.min(d, ult)); return ymdK(f);
}
function sumarDias(s, n){ const [y,m,d]=s.split('-').map(Number); return ymdK(new Date(y,m-1,d+n)); }
/* momento exacto (ms) en que se bloquea: fin del último día de gracia, hora Colombia */
function calcVenceMs(pagadoHasta, gracia){
  if (!pagadoHasta) return 0;
  const [y,m,d] = pagadoHasta.split('-').map(Number);
  return Date.UTC(y, m-1, d + (Number(gracia)||0) + 1, 5, 0, 0);
}
function estadoSuscripcion(emp){
  if (!emp) return { estado:'sin-empresa' };
  const gracia = Number(emp.diasGracia ?? 5);
  if (emp.estado === 'bloqueada') return { estado:'bloqueada', texto:'Bloqueada por Kuota' };
  if (!emp.pagadoHasta) return { estado:'pendiente', texto:'Pendiente de activación' };
  const hoy = hoyK(), limite = sumarDias(emp.pagadoHasta, gracia);
  const dias = Math.round((new Date(emp.pagadoHasta+'T00:00:00') - new Date(hoy+'T00:00:00'))/864e5);
  if (hoy <= emp.pagadoHasta) return { estado:'activa', texto: dias<=5 ? `Vence en ${dias} día${dias===1?'':'s'}` : 'Al día', dias, limite };
  if (Date.now() < (emp.venceMs||0)) return { estado:'gracia', texto:`Venció, se bloquea el ${limite}`, dias, limite };
  return { estado:'vencida', texto:'Bloqueada por falta de pago', dias, limite };
}
const fmtK = n => '$ ' + Math.round(Number(n)||0).toLocaleString('es-CO');

/* Confirmaciones propias (sin ventanas del navegador, que algunos navegadores bloquean) */
function confirmar(msg, opt){
  opt = opt || {};
  return new Promise(res=>{
    const w=document.createElement('div'); w.className='modal-bg'; w.style.zIndex='80';
    const h=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    w.innerHTML=`<div class="card modal" style="width:min(460px,100%)"><p style="white-space:pre-line;margin:0 0 4px;font-size:15px;line-height:1.5">${h(msg)}</p>
      <div class="actions">${opt.solo?'':`<button class="btn" data-r="0">${h(opt.no||'Cancelar')}</button>`}<button class="btn ${opt.peligro?'danger':'pri'}" data-r="1">${h(opt.ok||'Aceptar')}</button></div></div>`;
    const fin=v=>{ w.remove(); document.removeEventListener('keydown',kd,true); res(v); };
    const kd=e=>{ if(e.key==='Escape'){ e.stopPropagation(); fin(false); } };
    w.addEventListener('mousedown',e=>{ if(e.target===w) fin(false); });
    w.querySelectorAll('[data-r]').forEach(b=>b.onclick=()=>fin(b.dataset.r==='1'));
    document.addEventListener('keydown',kd,true);
    document.body.appendChild(w); w.querySelector('[data-r="1"]').focus();
  });
}
const avisar = (msg) => confirmar(msg, {solo:true, ok:'Entendido'});
