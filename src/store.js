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
  deleteDoc, onSnapshot, query, where, getDoc, getDocs, writeBatch } from 'firebase/firestore';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { firebaseConfig } from './firebase-config.js';

window.CapPlugins = { Filesystem, Directory, Encoding, Share };

const configured = !!(firebaseConfig && firebaseConfig.apiKey && !String(firebaseConfig.apiKey).startsWith('PEGA'));
let app, auth, db;
if (configured) {
  app = initializeApp(firebaseConfig);
  auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
}

const clean = o => { const r = {}; for (const [k, v] of Object.entries(o)) if (k !== 'id' && v !== undefined) r[k] = v; return r; };
const list = snap => snap.docs.map(d => ({ id: d.id, ...d.data() }));
let EID = '';                                       // empresa del usuario con sesión
const ruta = c => c === 'users' ? 'users' : `empresas/${EID}/${c}`;

async function perfil(u) {
  const s = await getDoc(doc(db, 'users', u.uid));
  if (!s.exists()) return null;
  return { uid: u.uid, id: u.uid, ...s.data() };
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
    const cols = admin ? ['clientes', 'prestamos', 'pagos', 'salidas', 'capital', 'ingresos', 'entregas'] : ['clientes', 'prestamos', 'pagos', 'entregas'];
    for (const c of cols) {
      const q = admin ? collection(db, ruta(c)) : query(collection(db, ruta(c)), where('cobradorId', '==', me.uid));
      uns.push(onSnapshot(q, snap => cb(c, list(snap)), err => cb('error', err)));
    }
    if (admin) uns.push(onSnapshot(query(collection(db, 'users'), where('empresaId', '==', EID)), s => cb('users', list(s)), err => cb('error', err)));
    else uns.push(onSnapshot(doc(db, 'users', me.uid), s => { if (s.exists()) cb('users', [{ id: s.id, ...s.data() }]); }, err => cb('error', err)));
    uns.push(onSnapshot(doc(db, ruta('config'), 'general'), s => cb('config', s.exists() ? s.data() : {}), err => cb('error', err)));
    return () => uns.forEach(u => u());
  },
  newId: c => doc(collection(db, ruta(c))).id,
  set: (c, id, data) => setDoc(doc(db, ruta(c), id), clean(data)),
  update: (c, id, data) => updateDoc(doc(db, ruta(c), id), clean(data)),
  remove: (c, id) => deleteDoc(doc(db, ruta(c), id)),
  setConfig: data => setDoc(doc(db, ruta('config'), 'general'), clean(data)),
  async batchSet(ops) {
    for (let i = 0; i < ops.length; i += 400) {
      const b = writeBatch(db);
      for (const o of ops.slice(i, i + 400)) b.set(doc(db, ruta(o.col), o.id), clean(o.data), o.merge ? { merge: true } : {});
      await b.commit();
    }
  },
  /* el CEO solicita un usuario: queda pendiente hasta que Kuota lo active */
  async solicitarUsuario(nombre, email, pass, rol) {
    const uid = await crearCuenta(email, pass);
    await setDoc(doc(db, 'users', uid), { nombre, email, rol, empresaId: EID, activo: false, estado: 'pendiente', creado: Date.now(), creadoPor: auth.currentUser.uid });
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
    set: (path, data, merge) => setDoc(doc(db, path), clean(data), merge ? { merge: true } : {}),
    update: (path, data) => updateDoc(doc(db, path), clean(data)),
    remove: path => deleteDoc(doc(db, path)),
    async crearEmpresaConCeo(emp, ceo) {
      const eid = doc(collection(db, 'empresas')).id;
      const uid = await crearCuenta(ceo.email, ceo.pass);
      const b = writeBatch(db);
      b.set(doc(db, 'empresas', eid), clean({ ...emp, ceoUid: uid }));
      b.set(doc(db, 'users', uid), { nombre: ceo.nombre, email: ceo.email, rol: 'ceo', empresaId: eid, activo: true, estado: 'activo', creado: Date.now() });
      b.set(doc(db, 'empresas', eid, 'config', 'general'), { negocio: emp.nombre, capitalInicial: 0 });
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
