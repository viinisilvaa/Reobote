# aplicativo-android

Esta pasta transforma o aplicativo web (pasta `../app`) num **APK Android** usando o [Capacitor](https://capacitorjs.com). O APK é gerado automaticamente pelo GitHub Actions (`.github/workflows/gerar-apk.yml`). Veja o passo a passo no README principal, seção "Aplicativo Android (APK)".

Arquivos JSON não aceitam comentários, então eles estão explicados aqui.

## package.json

- `dependencies`: `@capacitor/core` e `@capacitor/android` (versão 6.2.0) são o núcleo do Capacitor e a plataforma Android.
- `devDependencies`: `@capacitor/cli` é a ferramenta de linha de comando `npx cap`.
- `scripts`:
  - `preparar`: copia `app/` e `compartilhado/` para a pasta `www/`, que vai dentro do APK (`scripts/preparar-www.mjs`).
  - `android:criar`: cria o projeto Android nativo (pasta `android/`).
  - `android:configurar`: adiciona as permissões de câmera e localização, o ícone e a versão (`scripts/configurar-android.mjs`).
  - `android:sincronizar`: copia o `www/` atualizado para dentro do projeto Android.
  - `android:abrir`: abre o projeto no Android Studio.

## capacitor.config.json

- `appId` (`br.com.reobote.app`): identificador único do app no Android. **Não mude**, senão o celular trata como outro aplicativo e não atualiza o instalado.
- `appName`: nome que aparece embaixo do ícone.
- `webDir` (`www`): pasta com as telas que entram no APK.
- `server.androidScheme` (`https`): o app roda como `https://localhost`, o que libera câmera e armazenamento.
- `android.allowMixedContent`: permite falar com um servidor `http://` em testes na rede local.
- `plugins.CapacitorHttp` e `plugins.CapacitorCookies`: as chamadas à API passam pelo Android nativo. Assim o servidor não precisa de configuração de CORS, e o cookie de sessão funciona.

As pastas `node_modules/`, `www/` e `android/` são geradas automaticamente e não vão para o GitHub (`.gitignore`).

## Endereço do servidor (app/js/config.js)

O APK já sai com o endereço da Central embutido, então o colaborador só digita o e-mail e a senha. Na geração, o script `preparar-www.mjs` grava em `www/app/js/config.js` o valor da variável **`SERVIDOR_APP`** do repositório no GitHub (Settings > Secrets and variables > Actions > Variables).

Para testes, dá para trocar o endereço no próprio celular: na tela de login, toque 5 vezes no logotipo REOBOTE.
