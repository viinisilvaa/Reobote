<!-- REOBOTE | aplicativo-android/LEIA-ME.md — Explica a configuração do projeto Android (Capacitor) -->
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

## Localização em segundo plano

O plugin `@capacitor-community/background-geolocation` (em `package.json`) acompanha o técnico durante a jornada mesmo com a tela apagada. Ele acrescenta sozinho ao Android o serviço de localização e as permissões `FOREGROUND_SERVICE_LOCATION` e `POST_NOTIFICATIONS`. O script `configurar-android.mjs` dá o nome em português ao canal da notificação ("Localização da jornada"). O app liga o acompanhamento no primeiro QR Code do dia e desliga no encerramento da jornada ou ao sair da conta.

## Salvar PDF no celular

Os plugins `@capacitor/filesystem` e `@capacitor/share` permitem baixar o PDF do "Meu Histórico" dentro do APK: o arquivo é gravado no celular e o Android abre a janela para salvar em Arquivos ou enviar pelo WhatsApp, Drive ou e-mail.

## Atualização automática (sem reinstalar o APK)

O plugin `@capgo/capacitor-updater` é usado só no modo manual, sem serviço externo (`plugins.CapacitorUpdater` em `capacitor.config.json`: `autoUpdate` desligado e sem estatísticas).

1. A cada geração, o GitHub publica em Releases, junto com o `reobote.apk`:
   - `atualizacao.zip`: as telas do app (pasta `www`);
   - `atualizacao.json`: a versão, o nível nativo e o link do zip.
2. Ao abrir, o APK lê o `atualizacao.json` da versão mais recente. Se a versão for mais nova, baixa o zip em segundo plano e usa as telas novas na próxima abertura. Na tela **Mais**, também dá para usar a versão nova na hora.
3. Se a versão nova não abrir direito, o plugin volta sozinho para a anterior.

O campo **`reoboteNativo`** do `package.json` é o "nível nativo". **Aumente esse número sempre que mudar algo que só um APK novo traz**: plugin novo, permissão nova ou código Java em `nativo/`. Celulares com outro nível não aplicam a atualização automática; eles mostram o aviso para instalar o APK novo.
