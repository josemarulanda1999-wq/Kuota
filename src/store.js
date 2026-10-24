/* Kuota — capa de datos (Firebase Auth + Firestore). Multiempresa:
   empresas/{eid}            datos del negocio cliente (plan, estado, vencimiento)
   empresas/{eid}/<col>/...  clientes, prestamos, pagos, salidas, capital, ingresos, entregas, config
   users/{uid}               {nombre, email, rol: ceo|admin|cobrador, empresaId, activo, estado}
   superadmins/{uid}         equipo de Kuota (portal)
   facturacion/{id}          pagos de suscripción de cada empresa
   meta/kuota                datos de contacto y de pago de Kuota
   Se empaqueta con esbuild en www/store.js y expone window.S */
import { initializeApp, deleteApp } from 'firebase/app';
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, inMemoryPersistence,
  onAuthStateChanged, signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, setDoc, updateDoc,
  deleteDoc, onSnapshot, query, where, getDoc, getDocs, writeBatch, arrayUnion } from 'firebase/firestore';
import { registerPlugin, CapacitorHttp, Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Device } from '@capacitor/device';
import { firebaseConfig } from './firebase-config.js';

// GPS en segundo plano (servicio con notificación mientras el cobrador está en jornada)
const BackgroundGeolocation = registerPlugin('BackgroundGeolocation');
const LocalNotifications = registerPlugin('LocalNotifications');
window.CapPlugins = { Filesystem, Directory, Encoding, Share, BackgroundGeolocation, Device, LocalNotifications };

const configured = !!(firebaseConfig && firebaseConfig.apiKey && !String(firebaseConfig.apiKey).startsWith('PEGA'));
let app, auth, db;
if (configured) {
  app = initializeApp(firebaseConfig);
  auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  // pide al navegador no borrar por su cuenta los datos guardados (cobros sin subir, sesión) cuando falta espacio
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) {}
}

const clean = o => { const r = {}; for (const [k, v] of Object.entries(o)) if (k !== 'id' && v !== undefined) r[k] = v; return r; };
const list = snap => snap.docs.map(d => ({ id: d.id, ...d.data() }));
let EID = '';                                       // empresa del usuario con sesión
const ruta = c => c === 'users' ? 'users' : `empresas/${EID}/${c}`;

async function perfil(u) {
  // modo soporte: el equipo Kuota entra a una empresa como si fuera su CEO.
  // Va primero: si el superadmin también es CEO de su propio negocio, igual debe ver la empresa que escogió en el portal.
  let eid = ''; try { eid = localStorage.getItem('kuota_soporte') || ''; } catch (e) {}
  if (/^[A-Za-z0-9_-]{1,40}$/.test(eid)) {
    const sup = await getDoc(doc(db, 'superadmins', u.uid)).catch(() => null);
    if (sup && sup.exists()) return { uid: u.uid, id: u.uid, nombre: (sup.data().nombre || 'Kuota') + ' (soporte)', email: u.email, rol: 'ceo', empresaId: eid, activo: true, estado: 'activo', soporte: true };
    try { localStorage.removeItem('kuota_soporte'); } catch (e) {}
  }
  const s = await getDoc(doc(db, 'users', u.uid));
  if (s.exists()) return { uid: u.uid, id: u.uid, ...s.data() };
  return null;
}

/* crea una cuenta de acceso sin cerrar la sesión actual */
async function crearCuenta(email, pass) {
  const sec = initializeApp(firebaseConfig, 'crear-' + Date.now());
  const a2 = initializeAuth(sec, { persistence: inMemoryPersistence });
  try { const cred = await createUserWithEmailAndPassword(a2, email, pass); return cred.user.uid; }
  finally { await signOut(a2).catch(() => {}); await deleteApp(sec).catch(() => {}); }
}

window.S = {
  configured,
  watchAuth(cb) {
    return onAuthStateChanged(auth, async u => {
      if (!u) return cb(null, null);
      try { cb(u, await perfil(u)); } catch (e) { console.error(e); cb(u, null); }
    });
  },
  uid: () => auth.currentUser ? auth.currentUser.uid : '',
  login: (email, pass) => signInWithEmailAndPassword(auth, email, pass),
  logout: () => signOut(auth),
  resetPassword: email => sendPasswordResetEmail(auth, email),

  /* ---------- app del negocio ---------- */
  setEmpresa(eid) { EID = eid; },
  watchEmpresa(eid, cb, err) { return onSnapshot(doc(db, 'empresas', eid), s => cb(s.exists() ? { id: s.id, ...s.data() } : null), err); },
  watchKuota(cb) { return onSnapshot(doc(db, 'meta', 'kuota'), s => cb(s.exists() ? s.data() : {}), () => cb({})); },
  watchFacturas(eid, cb) { return onSnapshot(query(collection(db, 'facturacion'), where('empresaId', '==', eid)), s => cb(list(s)), () => cb([])); },
  subscribe(me, cb) {
    const uns = [];
    const admin = me.rol === 'ceo' || me.rol === 'admin';
    const ceo = me.rol === 'ceo';
    const ruta_ = ['movruta', 'visitas', 'cierres', 'aprobaciones', 'rutas', 'notas', 'caprutas', 'avisos'];
    const cols = (ceo ? ['clientes', 'prestamos', 'pagos', 'salidas', 'capital', 'ingresos', 'entregas', 'renovaciones'] : ['clientes', 'prestamos', 'pagos', 'entregas', 'renovaciones']).concat(ruta_);
    for (const c of cols) {
      const q = admin ? collection(db, ruta(c)) : query(collection(db, ruta(c)), where('cobradorId', '==', me.uid));
      uns.push(onSnapshot(q, snap => cb(c, list(snap)), err => cb('error', err)));
    }
    if (admin) uns.push(onSnapshot(query(collection(db, 'users'), where('empresaId', '==', EID)), s => cb('users', list(s)), err => cb('error', err)));
    else uns.push(onSnapshot(doc(db, 'users', me.uid), s => { if (s.exists()) cb('users', [{ id: s.id, ...s.data() }]); }, err => cb('error', err)));
    uns.push(onSnapshot(doc(db, ruta('config'), 'general'), s => cb('config', s.exists() ? s.data() : {}), err => cb('error', err)));
    uns.push(onSnapshot(doc(db, ruta('config'), 'marca'), s => cb('marca', s.exists() ? s.data() : {}), () => {}));
    if (ceo) uns.push(onSnapshot(doc(db, ruta('config'), 'finanzas'), s => cb('finanzas', s.exists() ? s.data() : {}), err => cb('error', err)));
    return () => uns.forEach(u => u());
  },
  newId: c => doc(collection(db, ruta(c))).id,
  set: (c, id, data) => setDoc(doc(db, ruta(c), id), clean(data)),
  update: (c, id, data) => updateDoc(doc(db, ruta(c), id), clean(data)),
  remove: (c, id) => deleteDoc(doc(db, ruta(c), id)),
  setConfig: data => setDoc(doc(db, ruta('config'), 'general'), clean(data)),
  setMarca: data => setDoc(doc(db, ruta('config'), 'marca'), clean(data)),
  setFinanzas: data => setDoc(doc(db, ruta('config'), 'finanzas'), clean(data)),
  async batchSet(ops) {
    for (let i = 0; i < ops.length; i += 400) {
      const b = writeBatch(db);
      for (const o of ops.slice(i, i + 400)) b.set(doc(db, ruta(o.col), o.id), clean(o.data), o.merge ? { merge: true } : {});
      await b.commit();
    }
  },
  /* ---------- GPS y fotos ---------- */
  setUbicacion: (uid, data) => setDoc(doc(db, ruta('ubicaciones'), uid), clean(data), { merge: true }),
  /* lee del servidor la ubicación propia (permiso del GPS y si ya terminó la jornada), por si se borró la caché */
  async getUbicacion(uid) { try { const s = await getDoc(doc(db, ruta('ubicaciones'), uid)); return s.exists() ? s.data() : null; } catch (e) { return null; } },
  addPunto: (uid, fecha, punto) => setDoc(doc(db, ruta('recorridos'), uid + '_' + fecha), { uid, fecha, puntos: arrayUnion(punto) }, { merge: true }),
  /* Envía la posición del GPS. En el celular va por HTTP nativo (la WebView se frena en segundo plano);
     en el navegador usa el SDK normal. Las reglas de Firestore validan igual en ambos caminos. */
  async gpsEnviar(uid, fecha, ubic, punto) {
    const nativo = Capacitor.isNativePlatform && Capacitor.isNativePlatform();
    if (!nativo || !auth.currentUser) {
      await window.S.setUbicacion(uid, ubic);
      if (punto) await window.S.addPunto(uid, fecha, punto);
      return;
    }
    const token = await auth.currentUser.getIdToken();
    const base = `projects/${firebaseConfig.projectId}/databases/(default)/documents/`;
    const val = v => typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'string' ? { stringValue: v }
      : Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    const campos = o => { const f = {}; for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null) f[k] = val(v); return f; };
    const u = campos(ubic);
    const writes = [{ update: { name: base + ruta('ubicaciones') + '/' + uid, fields: u }, updateMask: { fieldPaths: Object.keys(u) } }];
    if (punto) writes.push({ update: { name: base + ruta('recorridos') + '/' + uid + '_' + fecha, fields: campos({ uid, fecha }) },
      updateMask: { fieldPaths: ['uid', 'fecha'] },
      updateTransforms: [{ fieldPath: 'puntos', appendMissingElements: { values: [{ mapValue: { fields: campos(punto) } }] } }] });
    const r = await CapacitorHttp.request({ method: 'POST', url: `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents:commit`,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, data: { writes } });
    if (r.status >= 300) throw new Error('gps ' + r.status);
  },
  watchUbicaciones(cb) { return onSnapshot(collection(db, ruta('ubicaciones')), s => cb(list(s)), () => cb([])); },
  async getRecorrido(uid, fecha) { const s = await getDoc(doc(db, ruta('recorridos'), uid + '_' + fecha)); return s.exists() ? s.data() : null; },
  async getFotos(pid) { try { const s = await getDoc(doc(db, ruta('fotos'), pid)); return s.exists() ? s.data() : null; } catch (e) { return null; } },
  setFotos: (pid, data) => setDoc(doc(db, ruta('fotos'), pid), clean(data)),
  auditar: data => setDoc(doc(collection(db, ruta('auditoria'))), clean(data)),
  async leerAuditoria() { try { const s = await getDocs(collection(db, ruta('auditoria'))); return list(s); } catch (e) { return []; } },
  async getComprobante(id) { try { const s = await getDoc(doc(db, ruta('comprobantes'), id)); return s.exists() ? s.data() : null; } catch (e) { return null; } },
  setComprobante: (id, data) => setDoc(doc(db, ruta('comprobantes'), id), clean(data)),
  /* ---------- equipo autorizado (cada ruta solo entra desde su celular) ---------- */
  equipo: {
    async get(uid) { const s = await getDoc(doc(db, ruta('equipos'), uid)); return s.exists() ? s.data() : null; },
    registrar: (uid, data) => setDoc(doc(db, ruta('equipos'), uid), clean(data)),
    tocar: (uid, data) => updateDoc(doc(db, ruta('equipos'), uid), clean(data)),
    liberar: uid => deleteDoc(doc(db, ruta('equipos'), uid)),
    intento: data => setDoc(doc(collection(db, ruta('intentos'))), clean(data)),
    watch(cb) { return onSnapshot(collection(db, ruta('equipos')), s => cb(list(s)), () => cb([])); },
    watchIntentos(cb) { return onSnapshot(collection(db, ruta('intentos')), s => cb(list(s)), () => cb([])); },
    borrarIntento: id => deleteDoc(doc(db, ruta('intentos'), id))
  },
  /* el CEO solicita un usuario: queda pendiente hasta que Kuota lo active */
  async solicitarUsuario(nombre, email, pass, rol, ruta) {
    const uid = await crearCuenta(email, pass);
    await setDoc(doc(db, 'users', uid), { nombre, email, rol, ...(ruta ? { ruta } : {}), empresaId: EID, activo: false, estado: 'pendiente', creado: Date.now(), creadoPor: auth.currentUser.uid });
    return uid;
  },

  /* ---------- portal Kuota (superadministrador) ---------- */
  portal: {
    async soySuper() { const u = auth.currentUser; if (!u) return false; const s = await getDoc(doc(db, 'superadmins', u.uid)); return s.exists(); },
    async hayEquipo() { const s = await getDoc(doc(db, 'meta', 'super')); return s.exists(); },
    async activarmeSuper(nombre) {
      const u = auth.currentUser; const b = writeBatch(db);
      b.set(doc(db, 'meta', 'super'), { uid: u.uid });
      b.set(doc(db, 'superadmins', u.uid), { nombre, email: u.email, creado: Date.now() });
      await b.commit();
    },
    async crearCuentaSuper(email, pass) { return crearCuenta(email, pass); },
    watch(cb) {
      const uns = [];
      uns.push(onSnapshot(collection(db, 'empresas'), s => cb('empresas', list(s)), e => cb('error', e)));
      uns.push(onSnapshot(collection(db, 'users'), s => cb('users', list(s)), e => cb('error', e)));
      uns.push(onSnapshot(collection(db, 'facturacion'), s => cb('facturacion', list(s)), e => cb('error', e)));
      uns.push(onSnapshot(doc(db, 'meta', 'kuota'), s => cb('kuota', s.exists() ? s.data() : {}), e => cb('error', e)));
      return () => uns.forEach(u => u());
    },
    newId: c => doc(collection(db, c)).id,
    /* borra una empresa con todos sus datos y sus usuarios (no se puede deshacer) */
    async borrarEmpresa(eid, progreso) {
      const cols = ['clientes','prestamos','pagos','salidas','capital','ingresos','entregas','renovaciones','movruta','visitas','cierres',
        'aprobaciones','rutas','notas','caprutas','avisos','auditoria','fotos','comprobantes','ubicaciones','recorridos','equipos','intentos','config'];
      let n = 0;
      for (const c of cols) {
        const s = await getDocs(collection(db, 'empresas', eid, c));
        for (let i = 0; i < s.docs.length; i += 400) {
          const b = writeBatch(db); s.docs.slice(i, i + 400).forEach(d => b.delete(d.ref)); await b.commit();
          n += Math.min(400, s.docs.length - i); progreso && progreso(c, n);
        }
      }
      const us = await getDocs(query(collection(db, 'users'), where('empresaId', '==', eid)));
      for (const d of us.docs) await deleteDoc(d.ref);
      await deleteDoc(doc(db, 'empresas', eid));
      return { docs: n, usuarios: us.size };
    },
    set: (path, data, merge) => setDoc(doc(db, path), clean(data), merge ? { merge: true } : {}),
    update: (path, data) => updateDoc(doc(db, path), clean(data)),
    remove: path => deleteDoc(doc(db, path)),
    async crearEmpresaConCeo(emp, ceo) {
      const eid = doc(collection(db, 'empresas')).id;
      const uid = await crearCuenta(ceo.email, ceo.pass);
      const b = writeBatch(db);
      b.set(doc(db, 'empresas', eid), clean({ ...emp, ceoUid: uid }));
      b.set(doc(db, 'users', uid), { nombre: ceo.nombre, email: ceo.email, rol: 'ceo', empresaId: eid, activo: true, estado: 'activo', creado: Date.now() });
      b.set(doc(db, 'empresas', eid, 'config', 'general'), { negocio: emp.nombre, pais: emp.pais || 'CO' });
      b.set(doc(db, 'empresas', eid, 'config', 'finanzas'), { capitalInicial: 0 });
      await b.commit();
      return eid;
    },
    async crearUsuario(eid, nombre, email, pass, rol) {
      const uid = await crearCuenta(email, pass);
      await setDoc(doc(db, 'users', uid), { nombre, email, rol, empresaId: eid, activo: true, estado: 'activo', creado: Date.now() });
      return uid;
    },
    /* mueve los datos de la primera versión (colecciones sueltas) a una empresa */
    async migrarLegado(eid, ceoUid) {
      const cols = ['clientes', 'prestamos', 'pagos', 'salidas', 'capital', 'ingresos', 'entregas'];
      const ops = []; let n = 0;
      for (const c of cols) {
        const s = await getDocs(collection(db, c));
        for (const d of s.docs) { ops.push(['set', `empresas/${eid}/${c}/${d.id}`, d.data()]); ops.push(['del', `${c}/${d.id}`]); n++; }
      }
      const cfg = await getDoc(doc(db, 'config', 'general'));
      if (cfg.exists()) { ops.push(['set', `empresas/${eid}/config/general`, cfg.data()]); ops.push(['del', 'config/general']); }
      const us = await getDocs(collection(db, 'users'));
      for (const d of us.docs) {
        const u = d.data(); if (u.empresaId) continue;
        const rol = d.id === ceoUid ? 'ceo' : (u.rol === 'admin' ? 'admin' : 'cobrador');
        ops.push(['merge', `users/${d.id}`, { empresaId: eid, rol, estado: 'activo' }]);
      }
      for (let i = 0; i < ops.length; i += 400) {
        const b = writeBatch(db);
        for (const [t, p, data] of ops.slice(i, i + 400)) {
          if (t === 'set') b.set(doc(db, p), data); else if (t === 'merge') b.set(doc(db, p), data, { merge: true }); else b.delete(doc(db, p));
        }
        await b.commit();
      }
      return n;
    },
    async legado() {
      const m = await getDoc(doc(db, 'meta', 'admin'));
      const c = await getDocs(collection(db, 'clientes'));
      const p = await getDocs(collection(db, 'salidas'));
      return { ceoUid: m.exists() ? m.data().uid : '', clientes: c.size, salidas: p.size };
    }
  }
};
