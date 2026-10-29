/* Kuota — precios y estado de la suscripción (lo usan la app y el portal) */
const PRECIOS = { activacion: 200000, mensual: 80000, cobradorExtra: 20000, adminExtra: 35000, incluidosAdmins: 1, incluidosCobradores: 1 };

function planMensual(emp){
  const a = Math.max(1, Number(emp.cupoAdmins)||1), c = Math.max(1, Number(emp.cupoCobradores)||1);
  return PRECIOS.mensual + (a-PRECIOS.incluidosAdmins)*PRECIOS.adminExtra + (c-PRECIOS.incluidosCobradores)*PRECIOS.cobradorExtra;
}
function planDetalle(emp){
  const a = Math.max(1, Number(emp.cupoAdmins)||1), c = Math.max(1, Number(emp.cupoCobradores)||1);
  const r = [['Plan base (1 administrador + 1 ruta)', PRECIOS.mensual]];
  if (a>1) r.push([`${a-1} administrador${a>2?'es':''} adicional${a>2?'es':''} × $35.000`, (a-1)*PRECIOS.adminExtra]);
  if (c>1) r.push([`${c-1} ruta${c>2?'s':''} adicional${c>2?'es':''} × $20.000`, (c-1)*PRECIOS.cobradorExtra]);
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

/* ---------- saneado de datos (defensa contra datos manipulados fuera de la app) ----------
   Se descartan documentos con ids raros (podrían inyectar código en los botones) y se fuerzan
   los tipos de los campos que se muestran o se usan en cálculos. */
const ID_SEGURO = /^[A-Za-z0-9_-]{1,40}$/;
const CAMPOS_NUM = ['monto','tasa','meses','cuotas','valorCuota','interesMes','total','valor','excedente','saldoCancelado','saldoAlSolicitar',
  'capitalInicial','creado','revisadoEn','entregadoEn','cupoAdmins','cupoCobradores','diasGracia','venceMs','meses','lat','lng','prec','t','ubicadoEn','registrado','ultimoUso','orden','maxPrestamo','maxGasto','cerradoEn','actualizado','salario','pctRecaudo','pctVentas','maxCuotas','maxRenov'];
const CAMPOS_ID = ['prestamoId','clienteId','cobradorId','registradoPor','creadoPor','entregadoPor','revisadoPor','nuevoPrestamoId','renovacionDe','empresaId','ceoUid','uid'];
const CAMPOS_TXT = ['nombre','cedula','tel1','tel2','direccion','ciudad','obs','nota','concepto','email','estado','rol','tipo','negocio','nit','contacto',
  'telefono','notas','metodo','ruta','fuente','modelo','plataforma','resultado','motivo','volver','modoInteres','texto','accion','col','docId','detalle','periodoPago','canal','empresaNombre','fecha','pagadoHasta','anterior','nuevo','fechaRenovacion','fechaCapital','primeraCuota'];
const PERIODOS_OK = ['DIARIO','SEMANAL','QUINCENAL','MENSUAL'];
const FECHA_OK = /^\d{4}-\d{2}-\d{2}$/;
function sanearDoc(x){
  const o = {...x};
  for (const k of CAMPOS_NUM) if (k in o) { const n = Number(o[k]); o[k] = isFinite(n) ? n : 0; }
  if ('cuotas' in o) o.cuotas = Math.min(1000, Math.max(1, Math.round(o.cuotas)));
  if (('periodo' in o || 'monto' in o && 'valorCuota' in o) && !PERIODOS_OK.includes(o.periodo)) o.periodo = 'MENSUAL';
  for (const k of CAMPOS_TXT) if (k in o && typeof o[k] !== 'string') o[k] = o[k] == null ? '' : String(o[k]);
  for (const k of ['fecha','pagadoHasta','anterior','nuevo','fechaRenovacion','fechaCapital','volver','primeraCuota']) if (o[k] && !FECHA_OK.test(o[k])) o[k] = '';
  if (('lat' in o || 'lng' in o) && !(Math.abs(o.lat) <= 90 && Math.abs(o.lng) <= 180 && (o.lat || o.lng))) { delete o.lat; delete o.lng; }
  for (const k of CAMPOS_ID) if (k in o && (typeof o[k] !== 'string' || (o[k] && !ID_SEGURO.test(o[k])))) o[k] = '';
  return o;
}
function sanearLista(col, arr){
  return (arr || []).filter(x => x && ID_SEGURO.test(String(x.id)))
    .map(sanearDoc)
    .filter(x => !(col === 'prestamos' || col === 'pagos') || FECHA_OK.test(x.fecha));
}

/* moneda de cada país (la usan la app y el portal al crear empresas) */
const MONEDAS = {
  CO:{pais:'Colombia', simbolo:'$', dec:0, loc:'es-CO', tel:'57'}, PE:{pais:'Perú', simbolo:'S/', dec:2, loc:'es-PE', tel:'51'},
  BR:{pais:'Brasil', simbolo:'R$', dec:2, loc:'pt-BR', tel:'55'}, CL:{pais:'Chile', simbolo:'$', dec:0, loc:'es-CL', tel:'56'},
  AR:{pais:'Argentina', simbolo:'$', dec:0, loc:'es-AR', tel:'54'}, UY:{pais:'Uruguay', simbolo:'$U', dec:2, loc:'es-UY', tel:'598'},
  PY:{pais:'Paraguay', simbolo:'₲', dec:0, loc:'es-PY', tel:'595'},
  EC:{pais:'Ecuador', simbolo:'US$', dec:2, loc:'es-EC', tel:'593'}, MX:{pais:'México', simbolo:'$', dec:2, loc:'es-MX', tel:'52'},
  VE:{pais:'Venezuela', simbolo:'$', dec:2, loc:'es-VE', tel:'58'}, BO:{pais:'Bolivia', simbolo:'Bs', dec:2, loc:'es-BO', tel:'591'},
  PA:{pais:'Panamá', simbolo:'B/.', dec:2, loc:'es-PA', tel:'507'}, DO:{pais:'Rep. Dominicana', simbolo:'RD$', dec:2, loc:'es-DO', tel:'1'},
  GT:{pais:'Guatemala', simbolo:'Q', dec:2, loc:'es-GT', tel:'502'}, US:{pais:'Estados Unidos', simbolo:'US$', dec:2, loc:'en-US', tel:'1'}
};

/* ---------- seguridad común (app y portal) ---------- */
// al exportar a Excel, un texto que empiece con = + - @ se toma como fórmula: se neutraliza
function celdaSegura(v){
  v = v==null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(v) && !/^-?\d+([.,]\d+)?$/.test(v)) v = "'" + v;
  return /[";\n\r]/.test(v) ? '"'+v.replace(/"/g,'""')+'"' : v;
}
// contraseñas nuevas: mínimo 8 caracteres con letras y números
function claveDebil(p){
  p = String(p||'');
  if(p.length < 8) return 'La contraseña debe tener mínimo 8 caracteres';
  if(!/[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(p) || !/\d/.test(p)) return 'La contraseña debe tener letras y números';
  if(/^(12345678|password|contraseña|kuota123|qwerty12)/i.test(p)) return 'Esa contraseña es muy fácil de adivinar';
  return '';
}
// nadie puede meter Kuota dentro de otra página para engañar al usuario (clickjacking)
try{ if(window.top !== window.self){ document.documentElement.style.display='none'; window.top.location = window.self.location.href; } }catch(e){ document.documentElement.style.display='none'; }
// en la versión web: la página solo puede conectarse con Firebase y cargar imágenes del mapa (si alguien lograra meter código, no podría mandar datos a otro servidor)
try{
  const nativo = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  if(!nativo && !document.querySelector('meta[http-equiv="Content-Security-Policy"]')){
    const m=document.createElement('meta'); m.httpEquiv='Content-Security-Policy';
    m.content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://tile.openstreetmap.org https://server.arcgisonline.com; "
      +"font-src 'self' data:; connect-src 'self' data: blob: https://tile.openstreetmap.org https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://*.firebaseapp.com; "
      +"frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; worker-src 'self' blob:; manifest-src 'self'";
    document.head.appendChild(m);
    const r=document.createElement('meta'); r.name='referrer'; r.content='strict-origin-when-cross-origin'; document.head.appendChild(r);
  }
}catch(e){}


/* ---------- valores de plata: se separan los miles mientras se escriben (ej. 1.500.000) ---------- */
const CAMPOS_PLATA_EXTRA = ['pSeg','uCap','rSal','rMax','rGas','kVal'];
function formatearPlata(el){
  const m = (typeof MON==='function') ? MON() : {loc:'es-CO', dec:0};
  const dsep = (1.5).toLocaleString(m.loc).charAt(1), tsep = (1000).toLocaleString(m.loc).replace(/\d/g,'') || (dsep===','?'.':',');
  const raw = el.value, caret = el.selectionStart==null ? raw.length : el.selectionStart;
  const sig = s => (s.match(new RegExp('[0-9' + (m.dec ? '\\' + dsep : '') + ']', 'g')) || []).length;
  const antes = sig(raw.slice(0, caret));
  let ent = raw, dec = null;
  if(m.dec && raw.includes(dsep)){ const i = raw.indexOf(dsep); ent = raw.slice(0, i); dec = raw.slice(i+1).replace(/\D/g,'').slice(0, m.dec); }
  ent = ent.replace(/\D/g,'').replace(/^0+(?=\d)/,'');
  const nuevo = ent.replace(/\B(?=(\d{3})+(?!\d))/g, tsep) + (dec!==null ? dsep + dec : '');
  if(nuevo === raw) return;
  el.value = nuevo;
  let k = 0, pos = 0; while(pos < nuevo.length && k < antes){ if(/[0-9]/.test(nuevo[pos]) || (m.dec && nuevo[pos]===dsep)) k++; pos++; }
  try{ el.setSelectionRange(pos, pos); }catch(e){}
}
document.addEventListener('input', e=>{
  const el = e.target;
  if(!el || el.tagName!=='INPUT' || !el.classList.contains('input')) return;
  if(el.getAttribute('inputmode')==='numeric' || CAMPOS_PLATA_EXTRA.includes(el.id) || el.hasAttribute('data-plata')) formatearPlata(el);
}, true);
