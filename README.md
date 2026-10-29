# Kuota

App para llevar el control de créditos con **un administrador y varios cobradores**, sincronizada en tiempo real con Firebase.

- **Administrador:** ve todo. Crea usuarios, asigna clientes a cada cobrador, hace préstamos, registra gastos, ve los movimientos de la caja y el cuadre diario de cada cobrador.
- **Cobrador:** ve solo su ruta. Registra pagos, crea clientes y ve su cuadre. Funciona sin señal y sube los cobros cuando vuelve el internet.

## Cómo se instala

1. **Firebase:** pega la configuración de tu proyecto en `src/firebase-config.js` y copia el contenido de `firestore.rules` en *Firestore Database → Reglas → Publicar*.
   Para que las reglas se publiquen solas en cada cambio, agrega en GitHub el secreto `FIREBASE_SERVICE_ACCOUNT` (la llave JSON de una cuenta de servicio de Firebase con permiso para publicar reglas).
2. **GitHub:** cada vez que se sube un cambio a `main`, GitHub Actions compila todo solo (unos 6 minutos):
   - El **APK** queda en la sección **Releases** del repositorio (`Kuota.apk`).
   - La **versión para PC** se publica en GitHub Pages. Actívalo una vez en *Settings → Pages → Source: GitHub Actions*.
3. **Celular:** descarga `Kuota.apk` en el Android, ábrelo y permite "instalar apps de origen desconocido" si te lo pide.
4. **Primera vez:** abre la app y toca **"Primera vez: crear cuenta de administrador"**. Desde *Usuarios* creas a los cobradores.

## Estructura

- `src/app.js`: pantallas y lógica de préstamos.
- `src/store.js`: conexión con Firebase.
- `src/styles.css`: diseño.
- `firestore.rules`: permisos de cada rol.
- `.github/workflows/build.yml`: compila el APK y la versión web.
