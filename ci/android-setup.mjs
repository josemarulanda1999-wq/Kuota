// Personaliza el proyecto Android generado por Capacitor: íconos y colores
import fs from 'fs';
import path from 'path';
const res = 'android/app/src/main/res';
for (const d of fs.readdirSync('ci/icons')) {
  const dest = path.join(res, d);
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(path.join('ci/icons', d))) fs.copyFileSync(path.join('ci/icons', d, f), path.join(dest, f));
}
const bg = path.join(res, 'values/ic_launcher_background.xml');
fs.writeFileSync(bg, '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#0E0E10</color>\n</resources>\n');
const strings = path.join(res, 'values/strings.xml');
let s = fs.readFileSync(strings, 'utf8');
s = s.replace(/<string name="app_name">[^<]*<\/string>/, '<string name="app_name">Kuota</string>')
     .replace(/<string name="title_activity_main">[^<]*<\/string>/, '<string name="title_activity_main">Kuota</string>');
// aviso fijo del GPS durante la jornada
if (!s.includes('capacitor_background_geolocation_notification_channel_name'))
  s = s.replace('</resources>', '    <string name="capacitor_background_geolocation_notification_channel_name">Jornada Kuota</string>\n    <string name="capacitor_background_geolocation_notification_color">#C6F432</string>\n</resources>');
fs.writeFileSync(strings, s);
// Seguridad: sin copias de seguridad por ADB y firma de producción leída de variables de entorno (secreto de GitHub)
const manifest = 'android/app/src/main/AndroidManifest.xml';
let m = fs.readFileSync(manifest, 'utf8');
m = m.replace(/android:allowBackup="true"/, 'android:allowBackup="false"');
if (!m.includes('android:allowBackup')) m = m.replace('<application', '<application android:allowBackup="false"');
if (!m.includes('android:fullBackupContent')) m = m.replace('<application', '<application android:fullBackupContent="false"');
// GPS (ubicación de clientes, cobros y jornada en segundo plano)
const permisos = ['android.permission.ACCESS_COARSE_LOCATION', 'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.FOREGROUND_SERVICE', 'android.permission.FOREGROUND_SERVICE_LOCATION', 'android.permission.POST_NOTIFICATIONS'];
for (const pm of permisos) if (!m.includes(`"${pm}"`)) m = m.replace('</manifest>', `    <uses-permission android:name="${pm}" />\n</manifest>`);
if (!m.includes('android.hardware.location.gps')) m = m.replace('</manifest>', '    <uses-feature android:name="android.hardware.location.gps" android:required="false" />\n</manifest>');
fs.writeFileSync(manifest, m);
const gradle = 'android/app/build.gradle';
fs.appendFileSync(gradle, `
// --- firma de producción de Kuota (la llave nunca está en el repositorio) ---
android {
    signingConfigs {
        kuotaRelease {
            if (System.getenv("KUOTA_KS")) {
                storeFile file(System.getenv("KUOTA_KS"))
                storePassword System.getenv("KUOTA_KS_PASS")
                keyAlias "kuota"
                keyPassword System.getenv("KUOTA_KS_PASS")
            }
        }
    }
    buildTypes {
        release {
            if (System.getenv("KUOTA_KS")) { signingConfig signingConfigs.kuotaRelease }
            debuggable false
        }
    }
}
`);
console.log('Android personalizado');
