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
import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
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

// Página inicial do APK: abre direto o aplicativo.
writeFileSync(join(www, "index.html"), `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta http-equiv="refresh" content="0; url=app/index.html"><title>REOBOTE</title></head>
<body></body>
</html>
`);

console.log("Pasta www preparada com o aplicativo REOBOTE.");
