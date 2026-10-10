/* Capa de datos: Firebase Auth + Firestore (tiempo real y modo sin señal).
   Se empaqueta con esbuild en www/store.js y expone window.S */
import { initializeApp, deleteApp } from 'firebase/app';
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, inMemoryPersistence,
  onAuthStateChanged, signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, setDoc, updateDoc,
  deleteDoc, onSnapshot, query, where, getDoc, writeBatch } from 'firebase/firestore';
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
async function perfil(u) {
  const s = await getDoc(doc(db, 'users', u.uid));
  if (!s.exists()) return null;
  const m = await getDoc(doc(db, 'meta', 'admin')).catch(() => null);
  const ceoUid = m && m.exists() ? m.data().uid : '';
  return { uid: u.uid, id: u.uid, ...s.data(), ceoUid, esCeo: ceoUid === u.uid };
}

window.S = {
  configured,
  watchAuth(cb) {
    return onAuthStateChanged(auth, async u => {
      if (!u) return cb(null, null);
      try { cb(u, await perfil(u)); } catch (e) { console.error(e); cb(u, null); }
    });
  },
  login: (email, pass) => signInWithEmailAndPassword(auth, email, pass),
  logout: () => signOut(auth),
  resetPassword: email => sendPasswordResetEmail(auth, email),
  async adminExists() { const s = await getDoc(doc(db, 'meta', 'admin')); return s.exists(); },
  async registerAdmin(nombre, email, pass) {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    const b = writeBatch(db);
    b.set(doc(db, 'meta', 'admin'), { uid: cred.user.uid });
    b.set(doc(db, 'users', cred.user.uid), { nombre, email, rol: 'admin', activo: true, creado: Date.now() });
    try { await b.commit(); } catch (e) { await cred.user.delete().catch(() => {}); throw e; }
    return { uid: cred.user.uid, id: cred.user.uid, nombre, email, rol: 'admin', activo: true, ceoUid: cred.user.uid, esCeo: true };
  },
  async createUser(nombre, email, pass, rol) {
    // App secundaria para crear el usuario sin cerrar la sesión del administrador
    const sec = initializeApp(firebaseConfig, 'crear-' + Date.now());
    const a2 = initializeAuth(sec, { persistence: inMemoryPersistence });
    try {
      const cred = await createUserWithEmailAndPassword(a2, email, pass);
      await setDoc(doc(db, 'users', cred.user.uid), { nombre, email, rol, activo: true, creado: Date.now(), creadoPor: auth.currentUser.uid });
      return cred.user.uid;
    } finally {
      await signOut(a2).catch(() => {});
      await deleteApp(sec).catch(() => {});
    }
  },
  subscribe(me, cb) {
    const uns = [];
    const admin = me.rol === 'admin';
    const cols = admin ? ['clientes', 'prestamos', 'pagos', 'salidas', 'capital', 'ingresos', 'entregas', 'users']
                       : ['clientes', 'prestamos', 'pagos', 'entregas'];
    for (const c of cols) {
      const q = admin ? collection(db, c) : query(collection(db, c), where('cobradorId', '==', me.uid));
      uns.push(onSnapshot(q, snap => cb(c, snap.docs.map(d => ({ id: d.id, ...d.data() }))), err => cb('error', err)));
    }
    uns.push(onSnapshot(doc(db, 'config', 'general'), s => cb('config', s.exists() ? s.data() : {}), err => cb('error', err)));
    if (!admin) uns.push(onSnapshot(doc(db, 'users', me.uid), s => { if (s.exists()) cb('users', [{ id: s.id, ...s.data() }]); }, err => cb('error', err)));
    return () => uns.forEach(u => u());
  },
  newId: c => doc(collection(db, c)).id,
  set: (c, id, data) => setDoc(doc(db, c, id), clean(data)),
  update: (c, id, data) => updateDoc(doc(db, c, id), clean(data)),
  remove: (c, id) => deleteDoc(doc(db, c, id)),
  setConfig: data => setDoc(doc(db, 'config', 'general'), clean(data)),
  async batchSet(ops) {
    for (let i = 0; i < ops.length; i += 400) {
      const b = writeBatch(db);
      for (const o of ops.slice(i, i + 400)) b.set(doc(db, o.col, o.id), clean(o.data), o.merge ? { merge: true } : {});
      await b.commit();
    }
  }
};
