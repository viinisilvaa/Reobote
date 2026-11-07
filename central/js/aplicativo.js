/**
 * Página "Aplicativo" da Central: apresenta o aplicativo REOBOTE e oferece o download.
 *
 * Mostra:
 *  - apresentação do aplicativo e o que ele faz;
 *  - botão de download do APK + QR Code (o colaborador aponta a câmera do celular e baixa direto);
 *  - passo a passo de instalação no Android;
 *  - opção de usar pelo navegador (iPhone), também com QR Code.
 *
 * O link do APK vem do servidor (sessão): por padrão é a versão mais nova publicada no GitHub;
 * pode ser trocado em Configurações > "Link de download do APK".
 */
window.ReobotePage = {
  // Monta a página dentro de "root"; R são os utilitários da Central (app-core.js).
  async mount(root, R) {
    const { esc } = R;
    // Endereços completos (com https), necessários para os QR Codes funcionarem no celular.
    const apkUrl = new URL(R.session.downloads?.apkUrl || "/downloads/reobote.apk", location.origin).href;
    const webAppUrl = `${location.origin}/app/`;
    const isLocalServer = /^(localhost|127\.)/.test(location.hostname);

    // Gera um QR Code como imagem (biblioteca qrcode-generator, em js/vendor).
    function qrImage(text, label) {
      if (typeof window.qrcode !== "function") return "";
      const qr = window.qrcode(0, "M");
      qr.addData(text);
      qr.make();
      return `<img class="qr-image" src="${qr.createDataURL(5, 10)}" alt="${esc(label)}">`;
    }

    // Recursos do aplicativo mostrados na apresentação: [ícone, título, descrição].
    const features = [
      ["fa-qrcode", "Ponto por QR Code", "Lê o QR Code do veículo e da unidade para registrar a chegada."],
      ["fa-utensils", "Almoço e encerramento", "Início e fim do almoço e encerramento da jornada com um toque."],
      ["fa-wifi", "Funciona sem internet", "Guarda os registros com o horário original e envia quando a conexão voltar."],
      ["fa-clock-rotate-left", "Histórico", "O colaborador consulta os próprios dias, horas trabalhadas, atrasos e extras."],
      ["fa-location-dot", "Localização opcional", "Compartilha a posição com a Central somente com autorização (LGPD)."],
      ["fa-moon", "Tema claro e escuro", "Interface simples, com botões grandes, pensada para uso em campo."]
    ];

    root.innerHTML = `${R.heading("download")}
      <section class="panel content-panel wide-panel app-hero">
        <div class="app-hero-copy">
          <img src="../compartilhado/assets/reobote-mark.png" alt="" class="app-hero-logo">
          <div>
            <h2>Aplicativo REOBOTE</h2>
            <p>O aplicativo do colaborador. Com ele, cada técnico registra a jornada pelo celular e a Central acompanha tudo em tempo real.</p>
          </div>
        </div>
        <ul class="app-features">
          ${features.map(([icon, title, text]) => `<li><i class="fa-solid ${icon}"></i><span><strong>${esc(title)}</strong>${esc(text)}</span></li>`).join("")}
        </ul>
      </section>

      <div class="content-grid">
        <section class="panel content-panel">
          <div class="content-panel-heading"><h2><i class="fa-solid fa-download"></i> Baixar para Android</h2></div>
          <div class="download-box">
            <div class="download-qr">${qrImage(apkUrl, "QR Code para baixar o aplicativo")}<small>Aponte a câmera do celular</small></div>
            <div class="download-copy">
              <p>Escaneie o QR Code com o celular ou envie o link para a equipe.</p>
              <a class="button-primary" href="${esc(apkUrl)}" download="reobote.apk"><i class="fa-solid fa-download"></i> Baixar reobote.apk</a>
              <button type="button" class="button-secondary small-button" data-copy="${esc(apkUrl)}"><i class="fa-solid fa-copy"></i> Copiar link de download</button>
              <p class="form-hint">Sempre baixa a versão mais nova do aplicativo.</p>
            </div>
          </div>
        </section>

        <section class="panel content-panel">
          <div class="content-panel-heading"><h2><i class="fa-solid fa-list-ol"></i> Como instalar</h2></div>
          <ol class="install-steps">
            <li><strong>Baixe</strong> o arquivo reobote.apk pelo QR Code ou pelo botão.</li>
            <li><strong>Permita a instalação</strong>: o Android pede autorização para instalar apps desta fonte. Toque em “Configurações” e ative “Permitir desta fonte”.</li>
            <li><strong>Abra o REOBOTE</strong> e entre com o e-mail corporativo e a senha temporária entregue pela Central. No primeiro acesso, crie a sua senha.</li>
            <li><strong>Permita a câmera</strong> para ler os QR Codes dos veículos e das unidades.</li>
          </ol>
          <p class="panel-description">Ao instalar uma versão nova, os registros guardados no celular são mantidos.</p>
        </section>
      </div>

      <section class="panel content-panel wide-panel">
        <div class="content-panel-heading"><h2><i class="fa-solid fa-globe"></i> iPhone ou sem instalar</h2></div>
        <div class="download-box">
          ${isLocalServer ? "" : `<div class="download-qr">${qrImage(webAppUrl, "QR Code para abrir o aplicativo no navegador")}</div>`}
          <div class="download-copy">
            <p>O mesmo aplicativo funciona pelo navegador do celular, inclusive no iPhone, e pode ser adicionado à tela inicial.</p>
            <a class="button-secondary" href="/app/" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square"></i> Abrir o aplicativo web</a>
          </div>
        </div>
      </section>`;

    // Botão "Copiar" para enviar o link aos colaboradores (WhatsApp, e-mail etc.).
    root.addEventListener("click", async event => {
      const button = event.target.closest("[data-copy]");
      if (!button) return;
      try {
        await navigator.clipboard.writeText(button.dataset.copy);
        R.toast("Link copiado.");
      } catch {
        R.toast("Não foi possível copiar automaticamente. Selecione o texto e copie.");
      }
    });
  }
};
