// Compila la app web en la carpeta www/ (la usan el APK y la versión para PC)
import * as esbuild from 'esbuild';
import fs from 'fs';
import crypto from 'crypto';
fs.rmSync('www', { recursive: true, force: true });
fs.mkdirSync('www');
await esbuild.build({
  entryPoints: ['src/store.js'], bundle: true, minify: true, format: 'iife',
  target: ['es2019', 'chrome80'], outfile: 'www/store.js'
});
for (const f of ['index.html', 'app.js', 'plan.js', 'styles.css', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'logo_dark.png', 'logo_light.png', 'portal.html', 'portal.js', 'campo.js', 'equipo.js', 'ruta.js', 'fase2.js', 'avisos.js'])
  fs.copyFileSync('src/' + f, 'www/' + f);
// mapa (Leaflet) servido desde la propia app
if (fs.existsSync('node_modules/leaflet/dist')) fs.cpSync('node_modules/leaflet/dist', 'www/leaflet', { recursive: true });
// versión para las actualizaciones automáticas de la app instalada. "nativo" cambia solo cuando cambia la parte
// nativa (plugins de Capacitor, permisos, configuración): en ese caso hace falta instalar el APK nuevo
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const nativos = Object.entries(pkg.dependencies || {}).filter(([k]) => /^@cap/.test(k)).sort().map(([k, v]) => k + '@' + v).join(',');
const nativo = crypto.createHash('sha256').update(nativos + fs.readFileSync('capacitor.config.json', 'utf8') + fs.readFileSync('ci/android-setup.mjs', 'utf8')).digest('hex').slice(0, 16);
fs.writeFileSync('www/version.json', JSON.stringify({ version: Number(process.env.GITHUB_RUN_NUMBER) || 0, nativo }));
console.log('Listo: www/');
