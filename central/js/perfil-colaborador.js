// REOBOTE | central/js/perfil-colaborador.js — Central: histórico e correções de ponto do colaborador
// Perfil do colaborador: dados, situação atual, histórico de cargos e jornada calculada pelo servidor.
// Gestores podem lançar registros esquecidos e anular registros incorretos, sempre com justificativa auditada.
window.ReobotePage = {
  // Monta o perfil dentro de "root"; R são os utilitários da Central (app-core.js).
  async mount(root, R) {
    const { esc, api, fmt } = R;
    const id = new URLSearchParams(location.search).get("id") || R.user.employeeId;
    if (!id || !/^\d+$/.test(id)) {
      root.innerHTML = R.heading("profile") + `<section class="panel content-panel">${R.emptyState("fa-user-slash", "Colaborador não informado", "Abra o perfil a partir da lista de colaboradores.")}</section>`;
      return;
    }
    let range = 30;
    let data;
    let units = [];
    if (R.has("employees")) units = (await api.get("/api/units").catch(() => ({ units: [] }))).units;

    // Desenha dados, indicadores do período, histórico de jornada, cargos e localizações.
    function render() {
      const person = data.employee;
      const t = data.journey.totals;
      const days = data.journey.days.filter(day => day.status !== "off" || day.events.length);
      root.innerHTML = `<section class="employee-profile" aria-label="Perfil do colaborador">
        <a class="profile-back" href="${R.has("employees") ? "colaboradores.html" : "painel-principal.html"}"><i class="fa-solid fa-arrow-left"></i> Voltar</a>
        <header class="profile-card profile-hero">
          <span class="profile-photo">${person.hasPhoto ? `<img src="/api/employees/${encodeURIComponent(person.id)}/photo?v=${esc(person.photoVersion)}" alt="Foto de ${esc(person.name)}" data-fallback="${esc(R.initials(person.name))}">` : esc(R.initials(person.name))}</span>
          <div class="profile-heading"><h1>${esc(person.name)}</h1><p>${esc(person.email)}</p>${person.active ? R.statePill(person.state, person.stateLabel) : '<span class="state-pill muted">Cadastro desativado</span>'}</div>
          <div class="profile-contact">
            <span><i class="fa-solid fa-briefcase"></i>${esc(person.job || "Cargo não informado")}</span>
            <span><i class="fa-solid fa-hospital"></i>${esc(person.unit || "Sem unidade fixa")}</span>
            <span><i class="fa-solid fa-calendar-days"></i>${esc(person.schedule?.description || "Sem jornada")}</span>
            <span><i class="fa-solid fa-phone"></i>${esc(person.phone || "Telefone não informado")}</span>
            <span><i class="fa-solid fa-clock"></i>${person.lastEvent ? `Último registro: ${esc(person.lastEvent.label)} • ${fmt.dateTime(person.lastEvent.occurredAt)}` : "Nenhum registro ainda"}</span>
          </div>
        </header>

        <div class="profile-toolbar">
          <label class="select-control"><span>Período</span><select id="profile-range">${[7, 30, 60, 90].map(value => `<option value="${value}" ${value === range ? "selected" : ""}>Últimos ${value} dias</option>`).join("")}</select></label>
          ${data.canManage ? '<button type="button" class="button-primary" data-action="add-record"><i class="fa-solid fa-plus"></i> Lançar registro</button>' : ""}
          ${R.has("reports") ? `<a class="button-secondary" href="relatorios.html"><i class="fa-solid fa-file-pdf"></i> Relatórios</a>` : ""}
        </div>

        <div class="profile-stats">
          <article class="profile-stat"><span>Dias trabalhados</span><strong>${t.daysWorked}</strong></article>
          <article class="profile-stat"><span>Faltas</span><strong>${t.absences}</strong></article>
          <article class="profile-stat"><span>Atrasos</span><strong>${fmt.duration(t.lateMinutes)}</strong></article>
          <article class="profile-stat"><span>Horas extras</span><strong>${fmt.duration(t.overtimeMinutes)}</strong></article>
          <article class="profile-stat"><span>Trabalhadas</span><strong>${fmt.duration(t.workedMinutes)}</strong></article>
          <article class="profile-stat"><span>Intervalos</span><strong>${fmt.duration(t.breakMinutes)}</strong></article>
        </div>

        <section class="profile-card profile-section"><h2><i class="fa-solid fa-clock-rotate-left"></i> Histórico de jornada</h2>
          <div class="profile-history">${days.map(day => `<article class="profile-day">
            <h3>${fmt.day(day.date)} ${R.dayPill(day.status)}${day.holiday ? ` <small>${esc(day.holiday)}</small>` : ""}</h3>
            <div class="profile-day-summary">
              ${day.events.length ? `<span>Trabalhadas: ${fmt.duration(day.workedMinutes)}</span><span>Almoço: ${fmt.duration(day.breakMinutes)}</span>` : ""}
              ${day.expectedMinutes ? `<span>Previstas: ${fmt.duration(day.expectedMinutes)}</span>` : ""}
              ${day.lateMinutes ? `<span class="late">Atraso: ${fmt.duration(day.lateMinutes)}</span>` : ""}
              ${day.overtimeMinutes ? `<span class="overtime">Horas extras: ${fmt.duration(day.overtimeMinutes)}</span>` : ""}
              ${day.flags.includes("missing_departure") ? '<span class="late">Jornada sem encerramento</span>' : ""}
              ${day.flags.includes("missing_start") ? '<span class="late">Sem registro de início</span>' : ""}
            </div>
            <div class="profile-events">${day.events.map(event => `<span class="profile-event"><i class="fa-solid ${R.eventIcons[event.eventType] || "fa-clock"}"></i>${esc(event.label)} • ${fmt.time(event.occurredAt)}${event.place ? ` • ${esc(event.place)}` : ""}${event.distanceM !== null ? ` • ${event.distanceM} m da unidade` : ""}${event.syncedLater ? ' <em title="Registrado sem internet e sincronizado depois">offline</em>' : ""}${event.source === "admin" ? ` <em title="${esc(event.notes || "")}">lançado pela Central</em>` : ""}
              ${data.canManage ? `<button type="button" class="link-button" data-void="${esc(event.id)}" aria-label="Anular registro">anular</button>` : ""}</span>`).join("")}</div>
          </article>`).join("") || '<p class="profile-empty">Nenhum dia previsto ou registro no período.</p>'}</div>
        </section>

        <section class="profile-card profile-section"><h2><i class="fa-solid fa-briefcase"></i> Histórico de cargos e jornadas</h2>
          <div class="profile-job-list">${data.jobs.map(job => `<article class="profile-job"><i class="fa-solid fa-briefcase"></i><span><strong>${esc(job.title)}</strong>
            <small>${fmt.date(job.assignedAt)}${job.endedAt ? ` — ${fmt.date(job.endedAt)}` : " — atual"}${job.schedule ? ` • ${esc(job.schedule)}` : ""}</small></span></article>`).join("") || '<p class="profile-empty">Nenhum cargo registrado.</p>'}</div>
        </section>

        <section class="profile-card profile-section"><h2><i class="fa-solid fa-location-dot"></i> Localizações compartilhadas recentes</h2>
          <p class="panel-description">${person.trackingEnabled ? "O colaborador autorizou o compartilhamento de localização." : "O colaborador não está compartilhando a localização."}</p>
          <div class="profile-history">${data.locations.map(location => `<span class="profile-event"><i class="fa-solid fa-location-dot"></i>${fmt.dateTime(location.recordedAt)} •
            <a href="https://www.google.com/maps?q=${location.latitude},${location.longitude}" target="_blank" rel="noopener noreferrer">${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}</a> • precisão ${Math.round(location.accuracyM || 0)} m</span>`).join("") || '<p class="profile-empty">Nenhuma localização registrada.</p>'}</div>
        </section>
      </section>`;
    }

    // Busca o perfil e a jornada do período escolhido.
    async function load() {
      const to = R.localDate();
      const from = R.localDate(-(range - 1));
      data = await api.get(`/api/employees/${id}/profile?from=${from}&to=${to}`);
      document.title = `REOBOTE | ${data.employee.name}`;
      render();
    }

    // Lançamento manual de registro esquecido, com justificativa obrigatória (fica na auditoria).
    async function addRecord() {
      const now = R.localDate() + "T" + new Intl.DateTimeFormat("pt-BR", { timeZone: R.session.rules.timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
      const saved = await R.openDialog({
        title: "Lançar registro manual",
        subtitle: `${data.employee.name} • use quando o colaborador não conseguiu registrar pelo aplicativo.`,
        submitLabel: "Lançar registro",
        body: `<label class="field"><span>Tipo *</span><select class="text-control" name="eventType" required>
            <option value="vehicle_checkin">Chegada ao veículo</option><option value="unit_checkin" selected>Chegada à unidade</option>
            <option value="break_start">Início do almoço</option><option value="break_end">Retorno do almoço</option><option value="departure">Encerramento da jornada</option></select></label>
          <label class="field"><span>Data e hora *</span><input class="text-control" type="datetime-local" name="occurredAt" required value="${esc(now)}" max="${esc(now)}"></label>
          <label class="field"><span>Unidade</span><select class="text-control" name="unitId"><option value="">Não se aplica</option>${units.filter(u => u.active).map(u => `<option value="${esc(u.id)}" ${u.id === data.employee.unitId ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select></label>
          <label class="field"><span>Justificativa *</span><textarea class="text-control" name="notes" rows="3" required maxlength="300" placeholder="Ex.: celular sem bateria; chegada confirmada pelo supervisor."></textarea></label>
          <p class="form-hint"><i class="fa-solid fa-circle-info"></i> O lançamento fica identificado como feito pela Central e entra no histórico de alterações.</p>`,
        onSubmit: form => api.post(`/api/employees/${id}/attendance`, { eventType: form.get("eventType"), occurredAt: form.get("occurredAt"), unitId: form.get("unitId") || null, notes: form.get("notes") })
      });
      if (saved) {
        R.toast("Registro lançado.");
        load();
      }
    }

    root.addEventListener("click", async event => {
      if (event.target.closest('[data-action="add-record"]')) addRecord();
      const voidButton = event.target.closest("[data-void]");
      if (voidButton) {
        const reason = await R.askReason({ title: "Anular registro", message: "O registro deixará de contar nos cálculos de jornada, mas continuará guardado no histórico de alterações.", confirmLabel: "Anular", danger: true });
        if (!reason) return;
        try {
          await api.post(`/api/attendance/${voidButton.dataset.void}/void`, { reason });
          R.toast("Registro anulado.");
          load();
        } catch (error) {
          R.toast(error.message, "error");
        }
      }
    });
    root.addEventListener("change", event => {
      if (event.target.id === "profile-range") {
        range = Number(event.target.value);
        load().catch(error => R.toast(error.message, "error"));
      }
    });

    await load();
  }
};
