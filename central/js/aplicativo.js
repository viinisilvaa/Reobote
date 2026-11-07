/**
 * Página "Aplicativo" da Central: onde baixar e como instalar o aplicativo REOBOTE nos celulares.
 *
 * Mostra:
 *  - o botão de download do APK e um QR Code com o link (o colaborador aponta a câmera e baixa direto);
 *  - o endereço do servidor que deve ser digitado no aplicativo no primeiro acesso (também em QR Code);
 *  - a opção de usar o aplicativo pelo navegador (versão web em /app/);
 *  - o passo a passo de instalação no Android.
 *
 * O link do APK vem de Configurações ("Link de download do APK"). Sem link configurado, usa o arquivo
 * /downloads/reobote.apk do próprio servidor.
 */
window.ReobotePage = {
  // Monta a página dentro de "root"; R são os utilitários da Central (app-core.js).
  async mount(root, R) {
    const { esc } = R;
    const downloads = R.session.downloads || { apkUrl: "/downloads/reobote.apk", customApkUrl: false };
    // Endereços completos (com http/https), necessários para os QR Codes funcionarem no celular.
    const apkUrl = new URL(downloads.apkUrl, location.origin).href;
    const serverUrl = location.origin;
    const webAppUrl = `${location.origin}/app/`;

    // Gera um QR Code como imagem (biblioteca qrcode-generator, em js/vendor).
    function qrImage(text) {
      if (typeof window.qrcode !== "function") return "";
      const qr = window.qrcode(0, "M");
      qr.addData(text);
      qr.make();
      return `<img class="qr-image" src="${qr.createDataURL(5, 10)}" alt="QR Code para ${esc(text)}">`;
    }

    // Confere se o APK existe no servidor (quando o link é o arquivo local /downloads/reobote.apk).
    let apkAvailable = true;
    if (!downloads.customApkUrl) {
      try {
        const response = await fetch(downloads.apkUrl, { method: "HEAD" });
        apkAvailable = response.ok;
      } catch {
        apkAvailable = false;
      }
    }

    const isLocalServer = /^(localhost|127\.)/.test(location.hostname);

    root.innerHTML = `${R.heading("download")}
      <div class="content-grid">
        <section class="panel content-panel">
          <div class="content-panel-heading"><h2><i class="fa-brands fa-android"></i><i class="fa-solid fa-mobile-screen-button"></i> Baixar o aplicativo (Android)</h2></div>
          ${apkAvailable ? `<div class="download-box">
              <div class="download-qr">${qrImage(apkUrl)}<small>Aponte a câmera do celular para baixar</small></div>
              <div class="download-copy">
                <p>Arquivo de instalação para celulares Android.</p>
                <a class="button-primary" href="${esc(apkUrl)}" download="reobote.apk"><i class="fa-solid fa-download"></i> Baixar reobote.apk</a>
                <p class="panel-description">Link para enviar aos colaboradores:<br><code class="copy-text">${esc(apkUrl)}</code></p>
                <button type="button" class="button-secondary small-button" data-copy="${esc(apkUrl)}"><i class="fa-solid fa-copy"></i> Copiar link</button>
              </div>
            </div>`
          : R.emptyState("fa-box-open", "APK ainda não publicado",
            "Gere o APK pelo GitHub (veja o passo a passo no README, seção “Aplicativo Android”). Depois, cole o link de download em Configurações ou coloque o arquivo reobote.apk na pasta downloads do servidor.",
            R.has("settings") ? '<a class="button-primary" href="configuracoes.html">Abrir Configurações</a>' : "")}
        </section>

        <section class="panel content-panel">
          <div class="content-panel-heading"><h2><i class="fa-solid fa-server"></i> Endereço do servidor</h2></div>
          <p class="panel-description">No primeiro acesso, o aplicativo pede o endereço do servidor. Informe este:</p>
          <div class="download-box">
            <div class="download-qr">${qrImage(serverUrl)}</div>
            <div class="download-copy">
              <code class="copy-text big">${esc(serverUrl)}</code>
              <button type="button" class="button-secondary small-button" data-copy="${esc(serverUrl)}"><i class="fa-solid fa-copy"></i> Copiar endereço</button>
              ${isLocalServer ? `<p class="form-hint warn-text"><i class="fa-solid fa-triangle-exclamation"></i> Este endereço só funciona neste computador. Para testar no celular pela rede Wi-Fi, inicie o servidor com <code>php -S 0.0.0.0:3000 server/router.php</code> e use o IP do computador (ex.: http://192.168.0.10:3000).</p>` : ""}
            </div>
          </div>
        </section>
      </div>

      <section class="panel content-panel wide-panel">
        <div class="content-panel-heading"><h2><i class="fa-solid fa-list-ol"></i> Como instalar no celular</h2></div>
        <ol class="install-steps">
          <li><strong>Baixe o arquivo</strong> reobote.apk pelo QR Code ou pelo link acima.</li>
          <li><strong>Permita a instalação</strong>: ao abrir o arquivo, o Android pede permissão para instalar apps desta fonte (navegador ou gerenciador de arquivos). Toque em “Configurações” e ative “Permitir desta fonte”.</li>
          <li><strong>Instale e abra</strong> o aplicativo REOBOTE.</li>
          <li><strong>Informe o servidor</strong> (endereço ao lado), o e-mail corporativo e a senha temporária entregue pela Central. No primeiro acesso, crie a senha definitiva.</li>
          <li><strong>Permita a câmera</strong> quando o app pedir: ela é usada para ler os QR Codes dos veículos e das unidades. A localização é opcional.</li>
        </ol>
        <p class="panel-description">Ao instalar uma versão nova do APK, os registros guardados no celular são mantidos.</p>
      </section>

      <section class="panel content-panel">
        <div class="content-panel-heading"><h2><i class="fa-solid fa-globe"></i> Sem instalar (iPhone ou navegador)</h2></div>
        <div class="download-box">
          <div class="download-qr">${qrImage(webAppUrl)}</div>
          <div class="download-copy">
            <p>O mesmo aplicativo funciona pelo navegador do celular, inclusive no iPhone. Ele pode ser adicionado à tela inicial.</p>
            <a class="button-secondary" href="/app/" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square"></i> Abrir o aplicativo web</a>
            <p class="form-hint">A câmera no navegador exige endereço com https:// (exceto em localhost).</p>
          </div>
        </div>
      </section>`;

    // Botões "Copiar" para enviar os links aos colaboradores (WhatsApp, e-mail etc.).
    root.addEventListener("click", async event => {
      const button = event.target.closest("[data-copy]");
      if (!button) return;
      try {
        await navigator.clipboard.writeText(button.dataset.copy);
        R.toast("Copiado.");
      } catch {
        R.toast("Não foi possível copiar automaticamente. Selecione o texto e copie.");
      }
    });
  }
};
