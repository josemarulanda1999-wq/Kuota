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
fs.writeFileSync(strings, s);
console.log('Android personalizado');
