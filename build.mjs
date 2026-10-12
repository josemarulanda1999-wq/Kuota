// Compila la app web en la carpeta www/ (la usan el APK y la versión para PC)
import * as esbuild from 'esbuild';
import fs from 'fs';
fs.rmSync('www', { recursive: true, force: true });
fs.mkdirSync('www');
await esbuild.build({
  entryPoints: ['src/store.js'], bundle: true, minify: true, format: 'iife',
  target: ['es2019', 'chrome80'], outfile: 'www/store.js'
});
for (const f of ['index.html', 'app.js', 'plan.js', 'styles.css', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'logo_dark.png', 'logo_light.png', 'portal.html', 'portal.js', 'campo.js', 'equipo.js', 'ruta.js'])
  fs.copyFileSync('src/' + f, 'www/' + f);
// mapa (Leaflet) servido desde la propia app
if (fs.existsSync('node_modules/leaflet/dist')) fs.cpSync('node_modules/leaflet/dist', 'www/leaflet', { recursive: true });
console.log('Listo: www/');
