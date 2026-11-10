<!-- REOBOTE | docs/GUIA.md — Guia completo: instalação, mapa, APK, regras e API -->
# Guia completo do REOBOTE

Instalação, configuração do mapa, geração do APK, regras de jornada, segurança e rotas da API. Para a visão geral do projeto, veja o [README](../README.md).

## Instalação

1. Instale o PHP 8.1 ou superior com as extensões `pdo_mysql` e `mbstring`, e de preferência também a `gd` (ela redimensiona as fotos e remove os metadados delas). Instale também o MySQL 8 ou o MariaDB 10.6 ou superior.
2. Copie `.env.example` para `server/.env` e preencha os dados do banco e o `SESSION_SECRET`, que precisa de pelo menos 32 caracteres aleatórios.
3. Execute `php server/setup.php`. Ele cria ou atualiza o banco sem apagar dados. O mesmo comando também cria as jornadas e os cargos iniciais (Ajudante Geral, Técnico Júnior, Técnico Pleno e Supervisor) e os feriados nacionais fixos. Pode ser executado de novo depois de cada atualização do sistema.
4. Crie o primeiro administrador com `php server/create-user.php`. As demais contas são criadas pela Central, em **Colaboradores**.
5. Para testar localmente, rode `php -S 127.0.0.1:3000 server/router.php` e acesse `http://localhost:3000/central/` (Central) ou `http://localhost:3000/app/` (aplicativo).
6. Em produção, use **HTTPS** com Apache e os módulos `mod_rewrite` e `mod_headers` (o `.htaccess` já está pronto). A câmera, o GPS e a instalação do aplicativo só funcionam em HTTPS, com exceção do `localhost`.
7. O mapa usa o OpenStreetMap, que é gratuito e **não precisa de chave**.

Faça backup diário do banco (`mysqldump`) e da pasta `server/storage`, que guarda as fotos.

## Rodar no XAMPP (Windows)

O XAMPP pode servir o REOBOTE direto da pasta do projeto, na porta 3000. Assim, basta dar **Start** no **Apache** e no **MySQL** pelo painel do XAMPP e abrir `http://localhost:3000/central/`.

No final de `C:
mpp\apache\confxtra\httpd-vhosts.conf`, acrescente (troque o caminho pela pasta do projeto):

```apache
Listen 3000
<VirtualHost *:3000>
    DocumentRoot "C:/Users/SEU-USUARIO/Documents/Reobote"
    <Directory "C:/Users/SEU-USUARIO/Documents/Reobote">
        Options -Indexes +FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>
</VirtualHost>
```

Depois, no painel do XAMPP, clique em **Stop** e em **Start** no Apache. O `.htaccess` do projeto cuida das rotas da API e bloqueia o acesso à pasta `server/`.

## Mapa em tempo real

O mapa da Central usa o **OpenStreetMap** (biblioteca Leaflet, em `central/js/vendor/leaflet`). É gratuito e não precisa de chave nem de cadastro.

Para aparecer no mapa:

- **Unidades:** cadastre a latitude e a longitude em **Unidades e QR Codes**. A unidade aparece no mapa com as fotos dos técnicos presentes, conforme as leituras do QR Code, e o raio de chegada.
- **Técnicos em movimento:** durante a jornada (do primeiro QR Code até o encerramento), o APK acompanha o técnico **mesmo com a tela apagada ou com outro app aberto** (por exemplo, dirigindo o carro). Enquanto isso, o Android mostra a notificação fixa "REOBOTE: jornada em andamento". No mapa, ele aparece como um alfinete com a foto e o primeiro nome, na cor da situação. Selecione o técnico e toque em **Seguir técnico** para manter o mapa centralizado nele. O celular envia a posição a cada 10 metros percorridos (no máximo a cada 15 segundos); o mapa se atualiza a cada 5 segundos e mostra a última posição dos últimos 10 minutos. Fora da jornada, nada é enviado. Na versão pelo navegador, o acompanhamento só funciona com o app aberto na tela.
- **Técnicos na unidade:** ao ler o QR Code de uma unidade, o técnico passa a aparecer no ícone dela (foto, número e nomes), sem limite de técnicos por unidade.

## Aplicativo Android (APK)

O APK é gerado automaticamente na nuvem do GitHub, de graça. Não é preciso instalar nada no computador. Ele contém o mesmo aplicativo da pasta `app/`, com câmera para os QR Codes, funcionamento sem internet e login próprio. O endereço do servidor vai **embutido no APK** (veja abaixo), então o colaborador só digita o e-mail e a senha.

### Gerar o APK (uma vez, e de novo a cada atualização do app)

1. Crie uma conta em https://github.com, se ainda não tiver.
2. Instale o **GitHub Desktop** (https://desktop.github.com) e entre com a sua conta.
3. No GitHub Desktop, use **File > Add local repository** e escolha a pasta `Reobote`. Ele vai avisar que a pasta não é um repositório: clique em **create a repository** e depois em **Create repository**.
4. Clique em **Publish repository**. Pode deixar o repositório como privado. O arquivo `server/.env`, que tem as senhas, **não** é enviado, porque está no `.gitignore`.
5. No site do GitHub, abra o repositório e vá em **Actions**. A automação **Gerar APK do aplicativo** começa sozinha e leva uns 5 minutos. Se ela não aparecer, clique nela e depois em **Run workflow**.
6. Quando terminar, o arquivo `reobote.apk` aparece em **Releases**, na coluna da direita da página do repositório.

Cada vez que você alterar o aplicativo e enviar pelo GitHub Desktop (**Commit** e depois **Push**), um APK novo é gerado. Ele instala por cima do anterior sem perder os registros guardados no celular.

### Endereço do servidor dentro do APK

Quando o sistema estiver numa hospedagem, informe o endereço ao GitHub para ele ir dentro do APK:

1. No repositório, abra **Settings > Secrets and variables > Actions > Variables** e clique em **New repository variable**.
2. Nome: `SERVIDOR_APP`. Valor: o endereço da Central, por exemplo `https://reobote.com.br`.
3. Em **Actions**, rode **Gerar APK do aplicativo** de novo (**Run workflow**).

Sem essa variável, o APK sai sem servidor e mostra "Este aplicativo ainda não tem servidor configurado" ao tentar entrar.

### Disponibilizar para os colaboradores

A página **Aplicativo** da Central (no menu lateral) apresenta o aplicativo e mostra o botão de download, um **QR Code para baixar pelo celular** e o passo a passo de instalação. O link aponta para a versão mais nova publicada nas Releases do GitHub. Para usar outro link (por exemplo, o arquivo `downloads/reobote.apk` no próprio servidor), preencha **Configurações > Link de download do APK**.

### Testar no celular antes de ter um servidor na internet

1. Inicie o servidor aceitando conexões da rede: `php -S 0.0.0.0:3000 server/router.php`.
2. Descubra o IP do computador. No Windows, rode `ipconfig` e anote o "Endereço IPv4", por exemplo `192.168.0.10`.
3. No app, na tela de login, **toque 5 vezes no logotipo REOBOTE**. Abre a tela **Servidor**: informe `http://192.168.0.10:3000` e toque em **Salvar**. O celular precisa estar no mesmo Wi-Fi. Se não conectar, libere a porta 3000 no Firewall do Windows.

Em produção, use um endereço com `https://`.

### Colocar o REOBOTE na internet (testes fora do seu Wi-Fi)

Com o Apache e o MySQL ligados no XAMPP, dê dois cliques em **`Ligar REOBOTE na internet.bat`**, na pasta do projeto. Ele liga um túnel gratuito da Cloudflare (programa em `C:
mpp\cloudflared\cloudflared.exe`), gera um endereço `https://....trycloudflare.com`, grava esse endereço no `servidor.json` e envia ao GitHub. Os aplicativos leem esse arquivo ao abrir e passam a usar o endereço novo (pode levar até 5 minutos). **Deixe a janela aberta**: fechar a janela desliga o REOBOTE da internet. Se o endereço publicado não responder, o app tenta o endereço do PC na rede Wi-Fi (`app/js/config.js`).

### Alternativa: gerar no próprio computador

Com Node.js 20, Java 17 e Android Studio instalados, rode dentro de `aplicativo-android/`: `npm install`, `npm run preparar`, `npx cap add android`, `npm run android:configurar`, `npx cap sync android` e, por fim, `npx cap open android`. No Android Studio, use **Build > Build APK(s)**.

## Como funciona na prática

1. Em **Unidades e QR Codes**, cadastre os hospitais e locais de atendimento. Cada unidade recebe um QR Code automaticamente. Gere também os QR Codes dos veículos e imprima as etiquetas.
2. Em **Jornadas e Escalas**, configure os horários: entrada, saída, intervalo de almoço, dias da semana ou escala em ciclo (12x36), tolerância de atraso (15 min por padrão) e se o trabalho em folgas e feriados conta como hora extra.
3. Em **Cargos e Permissões**, defina o que cada cargo pode acessar e qual é a jornada padrão dele.
4. Em **Colaboradores**, cadastre a pessoa com foto, e-mail corporativo, cargo, unidade e, se for o caso, uma jornada individual. O sistema mostra uma **senha temporária** uma única vez. No primeiro acesso, o colaborador é obrigado a criar a própria senha.
5. O colaborador abre o aplicativo, toca em **Escanear QR Code** e lê o QR Code do veículo (início do expediente) e depois o da unidade (chegada). O almoço é registrado com **Horário de Almoço** e **Retorno do Almoço**. Para **Encerrar Jornada**, ele escaneia de novo um QR Code (veículo ou unidade): sem a leitura, o encerramento não é aceito.
6. A Central recebe os registros: a cada registro aparece um aviso no canto da tela, estilo WhatsApp (ex.: "Fulano chegou à unidade Hospital Central"), com som. O painel, o mapa, as notificações e os relatórios se atualizam sozinhos.

### Aviso ao responsável da unidade (WhatsApp)

Em **Unidades e QR Codes**, cada unidade pode ter um **responsável** e o **WhatsApp** dele. Quando um técnico lê o QR Code dessa unidade, o aviso da chegada na Central (no canto da tela e na página Notificações) mostra o botão **"Avisar no WhatsApp"**: ele abre a conversa com o responsável já com a mensagem pronta ("Olá, Fulano! O técnico Nome chegou na unidade X às 08:20. — Grupo REOBOTE"). Basta apertar **Enviar**. O envio totalmente automático exige um serviço pago de WhatsApp (Z-API ou a API oficial da Meta) e pode ser ligado depois.

### Histórico

Os registros de ponto nunca são apagados. No aplicativo (**Meu Histórico**) e no perfil do colaborador na Central, dá para consultar os últimos 7 dias, um mês inteiro (até 12 meses atrás), o último ano ou um período personalizado de até 1 ano, com horário de chegada, atrasos, faltas e horas extras.

### Regras de jornada (calculadas no servidor, em `server/lib/journey.php`)

- **Turno**: começa na primeira leitura de QR Code e termina no encerramento. Turnos que atravessam a meia-noite contam para o dia em que começaram. Se o colaborador esquecer de encerrar, o turno é fechado depois do intervalo configurado (16 h por padrão) e aparece como pendência.
- **Atraso**: diferença entre o primeiro registro do dia e a entrada prevista. Só é contado quando passa da tolerância.
- **Horas extras**: horas trabalhadas, já descontado o almoço, que passam das previstas e da tolerância. Em folgas e feriados, as horas contam inteiras como extras se a jornada estiver configurada assim.
- **Falta**: dia de trabalho previsto, fora de feriado, sem nenhum registro.
- **Sequência**: o sistema recusa registros fora de ordem, como encerrar durante o almoço, e ignora leituras repetidas em menos de 2 minutos.

### Funcionamento sem internet

O aplicativo guarda cada registro no celular com o **horário original**, já corrigido pela diferença entre o relógio do aparelho e o do servidor, e um identificador único. Quando a conexão volta, ele envia os registros em ordem cronológica e o servidor descarta duplicados. Na Central, esses registros aparecem como "sincronizado depois". Registros mais antigos que o prazo configurado (7 dias por padrão) são recusados. Um service worker (`app/sw.js`) mantém as telas do aplicativo disponíveis sem conexão.

### Segurança e LGPD

- A sessão usa cookie `HttpOnly`, e as senhas são guardadas com hash. As operações de escrita exigem a mesma origem e o cabeçalho `X-Reobote`. O login tem limite de tentativas.
- As permissões são verificadas no servidor a cada requisição, conforme o perfil da conta (Administrador, Gestor ou Colaborador) e as permissões do cargo. Desativar um cadastro bloqueia o acesso na hora.
- As fotos ficam fora da pasta pública (`server/storage/photos`) e só são entregues a quem pode ver o colaborador.
- A localização é coletada somente durante a jornada (do início ao encerramento), com aviso ao colaborador na tela **Perfil** do aplicativo, e fica guardada por 30 dias.
- Registros de ponto nunca são apagados. Uma correção é feita por **lançamento manual** ou por **anulação**, sempre com justificativa, e fica no **histórico de alterações** (Configurações).
- Recuperação de acesso: pela opção "Esqueci minha senha", a administração recebe um aviso e gera uma nova senha temporária.

## Organização do código

A Central e o aplicativo ficam em pastas separadas. Cada um tem as próprias páginas, estilos, scripts e tela de login:

```
central/          Central REOBOTE (painel administrativo)
  *.html          uma página por área (entrar, painel-principal, colaboradores, cargos, jornadas, unidades, ...)
  css/            design.css e theme.css (base e tema escuro), components.css e estilos de cada página
  js/             app-core.js (sessão, menu por permissões, diálogos) e um módulo por página
  js/vendor/      qrcode-generator (gera os QR Codes para impressão)
  assets/         logotipos dos parceiros
app/              Aplicativo REOBOTE do colaborador (PWA)
  index.html      tela única: login, início, registro por QR Code, histórico e conta
  css/app.css     estilos do aplicativo
  js/app.js       lógica do aplicativo e fila offline
  js/vendor/      jsQR (leitura de QR Code pela câmera)
  icons/          ícones de instalação
  manifest.webmanifest e sw.js (instalação e funcionamento sem internet)
compartilhado/    o mínimo usado pelas duas partes
  js/api-client.js  comunicação com a API
  js/theme.js       tema claro/escuro
  assets/           logotipo REOBOTE
aplicativo-android/  projeto que transforma a pasta app/ em APK Android (Capacitor)
  package.json, capacitor.config.json, scripts/ e LEIA-ME.md (explica cada configuração)
.github/workflows/gerar-apk.yml  automação do GitHub que compila e publica o APK
downloads/        coloque aqui o reobote.apk para ser baixado pelo servidor
docs/capturas/    imagens das telas usadas neste README
server/           API PHP: api.php, routes/, lib/ (autenticação, motor de jornada, notificações), setup.php e create-user.php
```
## Principais rotas da API

| Área | Rotas |
| --- | --- |
| Sessão | `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`, `POST /api/auth/change-password`, `POST /api/auth/forgot` |
| Aplicativo | `GET /api/me/today`, `POST /api/me/attendance` (lote, offline), `GET /api/me/history`, `PUT /api/me/location-sharing`, `POST /api/me/locations` |
| Colaboradores | `GET/POST /api/employees`, `GET/PUT /api/employees/:id`, `POST /api/employees/:id/reset-password`, `GET/POST/DELETE /api/employees/:id/photo`, `GET /api/employees/:id/profile`, `GET/POST /api/employees/:id/attendance`, `POST /api/attendance/:id/void` |
| Cadastros | `/api/jobs`, `/api/schedules`, `/api/holidays`, `/api/units`, `/api/qr-codes` (+ `/regenerate`), `GET /api/permissions` |
| Central | `GET /api/dashboard`, `GET /api/map`, `GET /api/notifications`, `GET /api/notifications/count`, `POST /api/notifications/read`, `GET /api/reports`, `GET/PUT /api/settings`, `GET /api/audit` |
