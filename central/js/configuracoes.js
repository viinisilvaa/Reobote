// Configurações: dados institucionais, regras do sistema, conta do usuário e histórico de alterações (auditoria).
window.ReobotePage = {
  // Monta a página de configurações; partes administrativas só aparecem com a permissão "settings".
  async mount(root, R) {
    const { esc, api, fmt } = R;
    const canManage = R.has("settings");
    const settings = canManage ? (await api.get("/api/settings")).settings : null;
    const timezones = ["America/Sao_Paulo", "America/Manaus", "America/Cuiaba", "America/Belem", "America/Fortaleza", "America/Recife", "America/Bahia", "America/Porto_Velho", "America/Rio_Branco", "America/Noronha"];

    root.innerHTML = `${R.heading("settings")}
      <div class="content-grid settings-grid">
        ${canManage ? `<section class="panel content-panel"><div class="content-panel-heading"><h2><i class="fa-solid fa-building"></i> Dados institucionais</h2></div>
          <form id="company-form" class="settings-form">
            <label class="field"><span>Nome da central *</span><input class="text-control" name="companyName" required maxlength="120" value="${esc(settings.companyName)}"></label>
            <label class="field"><span>E-mail de contato</span><input class="text-control" type="email" name="companyEmail" maxlength="190" value="${esc(settings.companyEmail)}"></label>
            <label class="field"><span>Telefone</span><input class="text-control" name="companyPhone" maxlength="32" value="${esc(settings.companyPhone)}"></label>
            <div class="form-actions"><button type="submit" class="save"><i class="fa-solid fa-floppy-disk"></i> Salvar</button></div>
          </form></section>` : ""}

        <section class="panel content-panel"><div class="content-panel-heading"><h2><i class="fa-solid fa-user-lock"></i> Minha conta</h2></div>
          <p class="panel-description">${esc(R.user.name)} • ${esc(R.user.email)} • ${esc(R.user.roleLabel)}</p>
          <form id="password-form" class="settings-form" autocomplete="on">
            <input type="hidden" name="username" autocomplete="username" value="${esc(R.user.email)}">
            <label class="field"><span>Senha atual *</span><input class="text-control" type="password" name="currentPassword" required autocomplete="current-password" maxlength="256"></label>
            <label class="field"><span>Nova senha *</span><input class="text-control" type="password" name="newPassword" required autocomplete="new-password" minlength="10" maxlength="256"></label>
            <label class="field"><span>Confirmar nova senha *</span><input class="text-control" type="password" name="confirmPassword" required autocomplete="new-password" minlength="10" maxlength="256"></label>
            <p class="form-hint">Mínimo de 10 caracteres, com letras e números.</p>
            <div class="form-actions"><button type="submit" class="save"><i class="fa-solid fa-key"></i> Alterar senha</button></div>
          </form></section>
      </div>

      ${canManage ? `<section class="panel content-panel wide-panel"><div class="content-panel-heading"><h2><i class="fa-solid fa-sliders"></i> Regras do sistema</h2></div>
        <form id="rules-form" class="form-grid rules-grid">
          <label class="field"><span>Domínio dos e-mails corporativos</span><input class="text-control" name="emailDomain" maxlength="120" value="${esc(settings.emailDomain)}" placeholder="reobote.com"></label>
          <label class="field"><span>Fuso horário da empresa</span><select class="text-control" name="timezone">${timezones.map(tz => `<option ${tz === settings.timezone ? "selected" : ""}>${tz}</option>`).join("")}</select></label>
          <label class="field"><span>Prazo para sincronizar registros offline (dias)</span><input class="text-control" type="number" name="offlineMaxDays" min="1" max="30" value="${settings.offlineMaxDays}"></label>
          <label class="field"><span>Turno sem encerramento é fechado após (horas)</span><input class="text-control" type="number" name="shiftGapHours" min="4" max="24" value="${settings.shiftGapHours}"></label>
          <label class="field span-2"><span>Link de download do APK (página “Aplicativo”)</span><input class="text-control" type="url" name="apkDownloadUrl" maxlength="500" value="${esc(settings.apkDownloadUrl || "")}" placeholder="https://github.com/USUARIO/REPOSITORIO/releases/latest/download/reobote.apk"></label>
          <p class="form-hint span-2">Deixe em branco para usar a versão mais nova publicada no GitHub do projeto.</p>
          <label class="checkbox-line span-2"><input type="checkbox" name="requireEmailDomain" ${settings.requireEmailDomain ? "checked" : ""}> Exigir o domínio corporativo no cadastro de colaboradores</label>
          <label class="checkbox-line span-2"><input type="checkbox" name="requestGpsOnCheckin" ${settings.requestGpsOnCheckin ? "checked" : ""}> Pedir a localização do aparelho (com permissão do colaborador) ao ler um QR Code, para conferir a distância até a unidade</label>
          <p class="form-hint span-2"><i class="fa-solid fa-circle-info"></i> Horários, tolerâncias, intervalos e regras de horas extras ficam em <a href="jornadas.html">Jornadas e Escalas</a>. Permissões ficam em <a href="cargos.html">Cargos</a>.</p>
          <div class="form-actions span-2"><button type="submit" class="save"><i class="fa-solid fa-floppy-disk"></i> Salvar regras</button></div>
        </form></section>

      <section class="panel content-panel wide-panel"><div class="content-panel-heading"><h2><i class="fa-solid fa-clock-rotate-left"></i> Histórico de alterações administrativas</h2></div>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>Data</th><th>Responsável</th><th>Ação</th><th>Detalhes</th></tr></thead><tbody id="audit-rows"><tr><td colspan="4">${R.loading()}</td></tr></tbody></table></div>
      </section>` : ""}

      <section class="panel content-panel"><div class="content-panel-heading"><h2><i class="fa-solid fa-shield-halved"></i> Privacidade e LGPD</h2></div>
        <ul class="plain-list">
          <li>Fotos de identificação ficam armazenadas no servidor e só são exibidas para quem tem acesso à equipe.</li>
          <li>A localização por GPS só é coletada com autorização do próprio colaborador, que pode revogá-la no aplicativo. As localizações contínuas são mantidas por 30 dias.</li>
          <li>Registros de jornada não são apagados: correções são feitas por lançamento ou anulação justificados, registrados neste histórico.</li>
          <li>Faça backup diário do banco de dados (por exemplo, com <code>mysqldump</code>) e da pasta <code>server/storage</code>.</li>
        </ul>
      </section>`;

    // Carrega o histórico de alterações administrativas (últimas 100).
    async function loadAudit() {
      const body = root.querySelector("#audit-rows");
      if (!body) return;
      try {
        const { entries } = await api.get("/api/audit?limit=100");
        body.innerHTML = entries.map(entry => `<tr><td>${fmt.dateTime(entry.createdAt)}</td><td>${esc(entry.author)}</td><td>${esc(entry.label)}</td>
          <td class="audit-details">${entry.details ? esc(Object.entries(entry.details).map(([key, value]) => `${key}: ${typeof value === "object" && value !== null ? JSON.stringify(value) : value}`).join(" • ")) : "—"}</td></tr>`).join("")
          || '<tr><td colspan="4" class="empty-state">Nenhuma alteração registrada.</td></tr>';
      } catch (error) {
        body.innerHTML = `<tr><td colspan="4" class="empty-state">${esc(error.message)}</td></tr>`;
      }
    }

    root.addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.target;
      const data = new FormData(form);
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        if (form.id === "company-form") {
          await api.put("/api/settings", { companyName: data.get("companyName"), companyEmail: data.get("companyEmail"), companyPhone: data.get("companyPhone") });
          R.toast("Dados institucionais salvos.");
        }
        if (form.id === "rules-form") {
          await api.put("/api/settings", {
            emailDomain: data.get("emailDomain"), timezone: data.get("timezone"), offlineMaxDays: Number(data.get("offlineMaxDays")),
            shiftGapHours: Number(data.get("shiftGapHours")), requireEmailDomain: data.has("requireEmailDomain"), requestGpsOnCheckin: data.has("requestGpsOnCheckin"),
            apkDownloadUrl: String(data.get("apkDownloadUrl") || "").trim()
          });
          R.toast("Regras salvas.");
        }
        if (form.id === "password-form") {
          if (data.get("newPassword") !== data.get("confirmPassword")) throw new Error("A confirmação não confere com a nova senha.");
          await api.post("/api/auth/change-password", { currentPassword: data.get("currentPassword"), newPassword: data.get("newPassword") });
          form.reset();
          R.toast("Senha alterada com sucesso.");
        }
        loadAudit();
      } catch (error) {
        R.toast(error.message, "error");
      } finally {
        button.disabled = false;
      }
    });

    loadAudit();
  }
};
