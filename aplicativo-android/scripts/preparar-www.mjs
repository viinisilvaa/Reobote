// REOBOTE | aplicativo-android/scripts/preparar-www.mjs — APK: copia o aplicativo para o APK e embute o servidor
/**
 * Prepara a pasta "www", que é o conteúdo colocado dentro do APK.
 *
 * O APK usa exatamente os mesmos arquivos do aplicativo web:
 *   ../app            -> www/app            (telas, estilos, scripts, ícones e leitor de QR Code)
 *   ../compartilhado  -> www/compartilhado  (cliente da API, tema e logotipo)
 * Mantendo a mesma estrutura de pastas, os caminhos relativos (ex.: "../compartilhado/js/theme.js")
 * continuam funcionando sem nenhuma alteração.
 *
 * Uso: npm run preparar  (executado automaticamente pelo GitHub antes de gerar o APK)
 */
import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync, copyFileSync, readFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const project = join(here, "..");        // pasta aplicativo-android
const root = join(project, "..");        // raiz do projeto REOBOTE
const www = join(project, "www");

// Começa sempre de uma pasta limpa, para não levar arquivos antigos para o APK.
rmSync(www, { recursive: true, force: true });
mkdirSync(www, { recursive: true });

for (const folder of ["app", "compartilhado"]) {
  const source = join(root, folder);
  if (!existsSync(source)) {
    throw new Error(`Pasta ${source} não encontrada. Execute este script dentro do projeto REOBOTE.`);
  }
  cpSync(source, join(www, folder), {
    recursive: true,
    // O service worker só é usado na versão web; dentro do APK os arquivos já estão no aparelho.
    filter: path => !path.endsWith("sw.js")
  });
}

// Endereço do servidor embutido no APK. Vem da variável de ambiente SERVIDOR_APP
// (no GitHub: Settings > Secrets and variables > Actions > Variables > SERVIDOR_APP).
// Sem a variável, vale o endereço escrito em app/js/config.js. No celular, o endereço
// também pode ser trocado com 5 toques no logotipo da tela de login.
const servidor = (process.env.SERVIDOR_APP || "").trim().replace(/\/+$/, "");
if (servidor && !/^https?:\/\/[^\s"'\\]+$/i.test(servidor)) {
  throw new Error(`SERVIDOR_APP inválido: "${servidor}". Use algo como https://reobote.com.br`);
}
if (servidor) {
  // A variável do GitHub tem prioridade sobre o endereço escrito em app/js/config.js.
  // Só troca o endereço: a "descoberta" e a "atualizacao" de app/js/config.js continuam valendo.
  appendFileSync(join(www, "app", "js", "config.js"), `window.REOBOTE_CONFIG.servidor = ${JSON.stringify(servidor)}; // variável SERVIDOR_APP
`);
  console.log(`Servidor embutido no APK (variável SERVIDOR_APP): ${servidor}`);
} else {
  // Sem a variável, o APK usa o endereço que está em app/js/config.js (já copiado acima).
  console.log("Servidor embutido no APK: o endereço de app/js/config.js.");
}

// Versão do APK (o GitHub passa VERSAO_APP = número da execução): aparece na tela Mais e no diagnóstico,
// para conferir qual APK está instalado no celular.
const versao = `1.0.${Number.parseInt(process.env.VERSAO_APP || "0", 10) || 0}`;
// "Nível nativo" (campo reoboteNativo do package.json): sobe de número quando muda algo que só um APK
// novo traz (plugins, permissões, código Java). O app só aplica atualizações automáticas do mesmo nível.
const nativo = Number(JSON.parse(readFileSync(join(project, "package.json"), "utf8")).reoboteNativo) || 1;
appendFileSync(join(www, "app", "js", "config.js"), `window.REOBOTE_VERSAO = ${JSON.stringify(versao)};
window.REOBOTE_NATIVO = ${nativo};
`);

// Descrição da atualização automática (vai para Releases junto com o APK e o atualizacao.zip).
// O app lê este arquivo ao abrir; se a versão for mais nova, baixa o zip e troca as telas sozinho.
const repositorio = process.env.GITHUB_REPOSITORY || "viinisilvaa/Reobote";
const tag = `apk-${Number.parseInt(process.env.VERSAO_APP || "0", 10) || 0}`;
writeFileSync(join(project, "atualizacao.json"), JSON.stringify({
  version: versao,
  nativo,
  url: `https://github.com/${repositorio}/releases/download/${tag}/atualizacao.zip`
}, null, 2) + "\n");
console.log(`Atualização automática: versão ${versao}, nível nativo ${nativo}.`);

// Ponte JavaScript do Capacitor (@capacitor/core): sem ela, o app não enxerga os plugins nativos
// (detector de GPS falso e localização em segundo plano). O arquivo vai para www/app/js/vendor e é
// carregado no index.html do APK antes dos scripts do aplicativo. A versão web não precisa dele.
const core = join(project, "node_modules", "@capacitor", "core", "dist", "capacitor.js");
if (!existsSync(core)) {
  throw new Error("@capacitor/core não encontrado. Execute npm install antes de npm run preparar.");
}
copyFileSync(core, join(www, "app", "js", "vendor", "capacitor.js"));
const indexPath = join(www, "app", "index.html");
const indexHtml = readFileSync(indexPath, "utf8");
const firstScript = indexHtml.indexOf("<script ");
if (firstScript < 0) throw new Error("app/index.html sem scripts.");
writeFileSync(indexPath, indexHtml.slice(0, firstScript) + "<script src=\"js/vendor/capacitor.js\"></script>\n  " + indexHtml.slice(firstScript));
console.log("Ponte do Capacitor incluída no app (js/vendor/capacitor.js).");

// Página inicial do APK: abre direto o aplicativo.
writeFileSync(join(www, "index.html"), `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta http-equiv="refresh" content="0; url=app/index.html"><title>REOBOTE</title></head>
<body></body>
</html>
`);

console.log("Pasta www preparada com o aplicativo REOBOTE.");
