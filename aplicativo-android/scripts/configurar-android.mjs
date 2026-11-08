// REOBOTE | aplicativo-android/scripts/configurar-android.mjs — APK: permissões de câmera e GPS, ícone e versão do app
/**
 * Ajusta o projeto Android gerado pelo Capacitor ("npx cap add android") para o REOBOTE:
 *
 * 1. Permissões no AndroidManifest.xml:
 *    - CAMERA: leitura dos QR Codes de veículos e unidades;
 *    - ACCESS_FINE_LOCATION / ACCESS_COARSE_LOCATION: localização durante a jornada;
 *      (o plugin de localização em segundo plano acrescenta sozinho o serviço FOREGROUND_SERVICE_LOCATION
 *      e a permissão de notificação, usados para acompanhar o técnico com a tela apagada);
 *    - usesCleartextTraffic: permite servidor em http:// (útil em testes na rede Wi-Fi).
 *      Em produção, prefira um servidor com https://.
 * 2. Ícone do aplicativo: usa app/icons/icon-512.png em todas as densidades de tela.
 * 3. Textos da notificação fixa de localização (strings.xml), em português.
 * 4. Versão do APK: usa a variável VERSAO_APP (o GitHub passa o número da execução),
 *    para que cada APK novo instale por cima do anterior.
 *
 * Uso: npm run android:configurar  (depois de "npx cap add android")
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, copyFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const project = join(here, "..");
const androidApp = join(project, "android", "app");
const manifestPath = join(androidApp, "src", "main", "AndroidManifest.xml");

if (!existsSync(manifestPath)) {
  throw new Error("Projeto Android não encontrado. Execute antes: npx cap add android");
}

// 1. Permissões -----------------------------------------------------------------------------
let manifest = readFileSync(manifestPath, "utf8");
const permissions = [
  '<uses-permission android:name="android.permission.CAMERA" />',
  '<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />',
  '<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />',
  '<uses-feature android:name="android.hardware.camera" android:required="false" />'
];
for (const line of permissions) {
  // Acrescenta cada permissão uma única vez, logo antes do fechamento do manifesto.
  const name = line.match(/android:name="([^"]+)"/)[1];
  if (!manifest.includes(name)) manifest = manifest.replace("</manifest>", `    ${line}\n</manifest>`);
}
if (!manifest.includes("usesCleartextTraffic")) {
  manifest = manifest.replace("<application", '<application\n        android:usesCleartextTraffic="true"');
}
writeFileSync(manifestPath, manifest);

// 2. Ícone ------------------------------------------------------------------------------------
const icon = join(project, "..", "app", "icons", "icon-512.png");
const res = join(androidApp, "src", "main", "res");
for (const folder of readdirSync(res).filter(name => name.startsWith("mipmap-"))) {
  if (folder.includes("anydpi")) {
    // Remove o ícone adaptativo padrão do Capacitor para que o ícone REOBOTE (PNG) seja usado.
    rmSync(join(res, folder), { recursive: true, force: true });
    continue;
  }
  for (const name of ["ic_launcher.png", "ic_launcher_round.png", "ic_launcher_foreground.png"]) {
    if (existsSync(join(res, folder, name))) copyFileSync(icon, join(res, folder, name));
  }
}

// 3. Notificação de localização em segundo plano (plugin @capacitor-community/background-geolocation) --
// Nome do canal de notificação mostrado nas configurações do Android e cor do aviso.
const stringsPath = join(androidApp, "src", "main", "res", "values", "strings.xml");
if (existsSync(stringsPath)) {
  let strings = readFileSync(stringsPath, "utf8");
  const extras = {
    capacitor_background_geolocation_notification_channel_name: "Localização da jornada",
    capacitor_background_geolocation_notification_color: "#5423BD"
  };
  for (const [name, value] of Object.entries(extras)) {
    if (!strings.includes(`name="${name}"`)) strings = strings.replace("</resources>", `    <string name="${name}">${value}</string>
</resources>`);
  }
  writeFileSync(stringsPath, strings);
}

// 4. Versão -----------------------------------------------------------------------------------
const gradlePath = join(androidApp, "build.gradle");
const version = Number.parseInt(process.env.VERSAO_APP || "1", 10) || 1;
let gradle = readFileSync(gradlePath, "utf8");
gradle = gradle.replace(/versionCode \d+/, `versionCode ${version}`).replace(/versionName "[^"]*"/, `versionName "1.0.${version}"`);
writeFileSync(gradlePath, gradle);

console.log(`Projeto Android configurado (permissões, ícone e versão 1.0.${version}).`);
