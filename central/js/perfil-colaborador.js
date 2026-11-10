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
    // Período do histórico: "d:30" = últimos 30 dias; "m:2026-11" = um mês inteiro. Até 1 ano.
    let range = "d:30";
    let period = { from: null, to: null }; // datas do período carregado
    let data;
    let units = [];
    if (R.has("employees")) units = (await api.get("/api/units").catch(() => ({ units: [] }))).units;

    // Opções do período: últimos dias (até 1 ano) e cada um dos últimos 12 meses.
    function rangeOptions() {
      const option = (value, label) => `<option value="${value}" ${value === range ? "selected" : ""}>${label}</option>`;
      const recent = [["d:7", "Últimos 7 dias"], ["d:30", "Últimos 30 dias"], ["d:90", "Últimos 90 dias"], ["d:182", "Últimos 6 meses"], ["d:365", "Último ano"]];
      return recent.map(([value, label]) => option(value, label)).join("")
        + `<optgroup label="Por mês">${lastMonths().map(month => option(`m:${month}`, monthName(month))).join("")}</optgroup>`;
    }

    // Os últimos 12 meses (AAAA-MM), do atual para o mais antigo.
    function lastMonths() {
      const [year, month] = R.localDate().split("-").map(Number);
      return Array.from({ length: 12 }, (_, index) => {
        const date = new Date(Date.UTC(year, month - 1 - index, 1));
        return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
      });
    }

    // "2026-11" -> "Novembro de 2026".
    function monthName(value) {
      const [year, month] = value.split("-").map(Number);
      const name = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", month: "long" }).format(new Date(Date.UTC(year, month - 1, 1)));
      return `${name.charAt(0).toUpperCase()}${name.slice(1)} de ${year}`;
    }

    // Localizações recentes, resumidas em PARADAS: posições seguidas a até 60 m umas das outras viram uma
    // linha só (horário de chegada e saída, quantidade de posições). Mostra só as 3 mais recentes: quando o
    // técnico manda uma posição nova, ela entra no topo e as anteriores descem (atualiza a cada 15 s).
    function locationStops() {
      const meters = (a, b) => {
        const rad = Math.PI / 180;
        const dLat = (b.latitude - a.latitude) * rad;
        const dLng = (b.longitude - a.longitude) * rad;
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLng / 2) ** 2;
        return 6371000 * 2 * Math.asin(Math.sqrt(h));
      };
      const stops = [];
      for (const point of data.locations) { // do mais recente para o mais antigo
        const last = stops[stops.length - 1];
        if (last && meters(last.point, point) <= 60) {
          last.from = point.recordedAt;
          last.count++;
          last.best = Math.min(last.best, point.accuracyM ?? 9999);
        } else {
          stops.push({ point, from: point.recordedAt, to: point.recordedAt, count: 1, best: point.accuracyM ?? 9999 });
        }
      }
      if (!stops.length) return '<p class="profile-empty">Nenhuma localização registrada.</p>';
      const visibleStops = stops.slice(0, 3);
      let lastDay = null;
      const rows = visibleStops.map(stop => {
        const day = R.localDate ? fmt.day(new Intl.DateTimeFormat("en-CA", { timeZone: R.session.rules.timezone }).format(new Date(stop.to))) : "";
        const header = day !== lastDay ? `<tr class="stop-day"><th colspan="4">${esc(day)}</th></tr>` : "";
        lastDay = day;
        const period = stop.count > 1 ? `${fmt.time(stop.from)} – ${fmt.time(stop.to)}` : fmt.time(stop.to);
        return `${header}<tr>
          <td class="stop-time">${period}</td>
          <td><a href="https://www.google.com/maps?q=${stop.point.latitude},${stop.point.longitude}" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-map-location-dot"></i> Abrir no mapa</a> <small>${stop.point.latitude.toFixed(5)}, ${stop.point.longitude.toFixed(5)}</small></td>
          <td>${stop.best < 9999 ? `${Math.round(stop.best)} m` : "—"}</td>
          <td>${stop.count}</td></tr>`;
      }).join("");
      return `<div class="table-wrap"><table class="data-table location-stops"><thead><tr><th>Horário</th><th>Local</th><th>Precisão</th><th>Posições</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }

    // Desenha dados, indicadores do período, histórico de jornada, cargos e localizações.
    function render() {
      const person = data.employee;
      const t = data.journey.totals;
      const days = data.journey.days.filter(day => day.status !== "off" || day.events.length);
      root.innerHTML = `<section class="employee-profile" aria-label="Perfil do colaborador">
        <a class="profile-back" href="${R.has("employees") ? "colaboradores.html" : "painel-principal.html"}"><i class="fa-solid fa-arrow-left"></i> Voltar</a>
        <header class="profile-card profile-hero">
          <span class="profile-photo">${person.hasPhoto ? `<img src="/api/employees/${encodeURIComponent(person.id)}/photo?v=${esc(person.photoVersion)}" alt="Foto de ${esc(person.name)}" data-fallback="${esc(R.initials(person.name))}">` : esc(R.initials(person.name))}</span>
          <div class="profile-heading"><h1>${esc(person.name)}</h1><p>${person.registration ? `Mat. ${esc(person.registration)} • ` : ""}${esc(person.email)}</p>${person.active ? R.statePill(person.state, person.stateLabel) : '<span class="state-pill muted">Cadastro desativado</span>'}</div>
          <div class="profile-contact">
            <span><i class="fa-solid fa-briefcase"></i>${esc(person.job || "Cargo não informado")}</span>
            <span><i class="fa-solid fa-hospital"></i>${esc(person.unit || "Sem unidade fixa")}</span>
            <span><i class="fa-solid fa-calendar-days"></i>${esc(person.schedule?.description || "Sem jornada")}</span>
            <span><i class="fa-solid fa-phone"></i>${esc(person.phone || "Telefone não informado")}</span>
            <span><i class="fa-solid fa-clock"></i>${person.lastEvent ? `Último registro: ${esc(person.lastEvent.label)} • ${fmt.dateTime(person.lastEvent.occurredAt)}` : "Nenhum registro ainda"}</span>
          </div>
        </header>

        <div class="profile-toolbar">
          <label class="select-control"><span>Período</span><select id="profile-range">${rangeOptions()}</select></label>
          ${data.canManage ? '<button type="button" class="button-primary" data-action="add-record"><i class="fa-solid fa-plus"></i> Lançar registro</button>' : ""}
          <button type="button" class="button-secondary" data-action="download-pdf"><i class="fa-solid fa-file-pdf"></i> Baixar PDF</button>
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
          <div class="profile-history">${days.map((day, index) => `${index === 0 || day.date.slice(0, 7) !== days[index - 1].date.slice(0, 7) ? `<h3 class="profile-month">${monthName(day.date.slice(0, 7))}</h3>` : ""}
          <details class="profile-day" ${index < 2 ? "open" : ""}>
            <!-- Linha do dia (clique abre/fecha): data, situação e números principais. Os 2 dias mais recentes vêm abertos. -->
            <summary>
              <i class="fa-solid fa-chevron-right profile-day-chevron"></i>
              <strong class="profile-day-date">${fmt.day(day.date)}</strong>${R.dayPill(day.status)}${day.holiday ? ` <small>${esc(day.holiday)}</small>` : ""}
              <span class="profile-day-numbers">
                ${day.events.length ? `<span>${fmt.duration(day.workedMinutes)} trabalhadas</span>` : day.expectedMinutes ? `<span>${fmt.duration(day.expectedMinutes)} previstas</span>` : ""}
                ${day.breakMinutes ? `<span>almoço ${fmt.duration(day.breakMinutes)}</span>` : ""}
                ${day.lateMinutes ? `<span class="late">atraso ${fmt.duration(day.lateMinutes)}</span>` : ""}
                ${day.overtimeMinutes ? `<span class="overtime">extra ${fmt.duration(day.overtimeMinutes)}</span>` : ""}
                ${day.flags.includes("missing_departure") ? '<span class="late">sem encerramento</span>' : ""}
                ${day.flags.includes("missing_start") ? '<span class="late">sem início</span>' : ""}
              </span>
              ${day.events.length ? `<span class="profile-day-count">${day.events.length} registro${day.events.length === 1 ? "" : "s"}</span>` : ""}
            </summary>
            ${day.justification ? `<p class="profile-justification"><i class="fa-solid fa-circle-check"></i> Justificado: ${esc(day.justification.reason)}${day.justification.author ? ` • por ${esc(day.justification.author)}` : ""}${data.canManage ? ` <button type="button" class="link-button" data-unjustify="${esc(day.date)}">remover</button>` : ""}</p>` : ""}
            ${data.canManage && !day.justification && day.workday && (day.status === "absent" || day.status === "not_arrived" || day.lateMinutes > 0) ? `<button type="button" class="link-button profile-justify" data-justify="${esc(day.date)}"><i class="fa-solid fa-comment-medical"></i> Justificar ${day.status === "absent" || day.status === "not_arrived" ? "falta" : "atraso"} e liberar o registro</button>` : ""}
            <!-- Registros do dia: um por linha, alinhados em colunas (horário, o que foi, local, marcas e anular). -->
            ${day.events.length ? `<ul class="profile-event-list">${day.events.map(event => `<li>
              <time>${fmt.time(event.occurredAt)}</time>
              <i class="fa-solid ${R.eventIcons[event.eventType] || "fa-clock"}"></i>
              <span class="event-label">${esc(event.label)}</span>
              <span class="event-place">${event.place ? esc(event.place) : ""}${event.distanceM !== null ? `${event.place ? " • " : ""}${event.distanceM < 1000 ? event.distanceM + " m" : (event.distanceM / 1000).toFixed(1) + " km"} da unidade` : ""}</span>
              <span class="event-tags">${event.syncedLater ? '<em title="Registrado sem internet e sincronizado depois">offline</em>' : ""}${event.source === "admin" ? `<em title="${esc(event.notes || "")}">lançado pela Central</em>` : ""}</span>
              ${data.canManage ? `<button type="button" class="link-button" data-void="${esc(event.id)}" aria-label="Anular registro">anular</button>` : "<span></span>"}
            </li>`).join("")}</ul>` : ""}
          </details>`).join("") || '<p class="profile-empty">Nenhum dia previsto ou registro no período.</p>'}</div>
        </section>

        <section class="profile-card profile-section"><h2><i class="fa-solid fa-briefcase"></i> Histórico de cargos e jornadas</h2>
          <div class="profile-job-list">${data.jobs.map(job => `<article class="profile-job"><i class="fa-solid fa-briefcase"></i><span><strong>${esc(job.title)}</strong>
            <small>${fmt.date(job.assignedAt)}${job.endedAt ? ` — ${fmt.date(job.endedAt)}` : " — atual"}${job.schedule ? ` • ${esc(job.schedule)}` : ""}</small></span></article>`).join("") || '<p class="profile-empty">Nenhum cargo registrado.</p>'}</div>
        </section>

        <section class="profile-card profile-section"><h2><i class="fa-solid fa-location-dot"></i> Localizações recentes</h2>
          <p class="panel-description">Enviadas automaticamente pelo aplicativo durante a jornada e guardadas por 30 dias. Posições seguidas no mesmo lugar aparecem juntas.</p>
          <div id="location-stops">${locationStops()}</div>
        </section>
      </section>`;
    }

    // Busca o perfil e a jornada do período escolhido.
    async function load() {
      let to = R.localDate();
      let from = R.localDate(-(Number(range.slice(2)) - 1));
      if (range.startsWith("m:")) {
        // Mês inteiro: do dia 1 ao último dia (ou até hoje, no mês atual).
        const month = range.slice(2);
        const [year, number] = month.split("-").map(Number);
        const last = `${month}-${String(new Date(Date.UTC(year, number, 0)).getUTCDate()).padStart(2, "0")}`;
        from = `${month}-01`;
        to = last < to ? last : to;
      }
      data = await api.get(`/api/employees/${id}/profile?from=${from}&to=${to}`);
      period = { from, to }; // usado no PDF
      document.title = `REOBOTE | ${data.employee.name}`;
      render();
    }

    // PDF do perfil (espelho de ponto) ------------------------------------------------------------
    // Gera o arquivo no próprio navegador com a biblioteca jsPDF (js/vendor/jspdf), carregada só no
    // primeiro clique, e baixa direto, sem passar pela página de Relatórios.
    function loadScript(src) {
      return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = src;
        script.onload = resolve;
        script.onerror = () => reject(new Error("biblioteca de PDF não carregou"));
        document.head.append(script);
      });
    }

    async function downloadPdf() {
      if (!window.jspdf?.jsPDF) {
        await loadScript("js/vendor/jspdf/jspdf.umd.min.js");
        await loadScript("js/vendor/jspdf/jspdf.plugin.autotable.min.js");
      }
      const person = data.employee;
      const t = data.journey.totals;
      const doc = new window.jspdf.jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const brDate = iso => iso.split("-").reverse().join("/");
      const time = value => value ? fmt.time(value) : "-";

      // Cabeçalho: empresa, colaborador e período.
      doc.setFillColor(84, 35, 189);
      doc.rect(0, 0, 297, 20, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(15);
      doc.text("REOBOTE - Espelho de ponto", 12, 13);
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text(R.session.company.name || "Central REOBOTE", 285, 13, { align: "right" });
      doc.setTextColor(30, 24, 56);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.text(person.name, 12, 30);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      const info = [person.registration ? `Matrícula: ${person.registration}` : null, person.job ? `Cargo: ${person.job}` : null, `Unidade: ${person.unit || "Sem unidade fixa"}`, `Jornada: ${person.schedule?.description || "Sem jornada"}`].filter(Boolean).join("   |   ");
      doc.text(info, 12, 36);
      doc.text(`Período: ${brDate(period.from)} a ${brDate(period.to)}   |   Gerado em ${new Date().toLocaleString("pt-BR")}`, 12, 42);

      // Totais do período.
      const totals = [["Dias trabalhados", String(t.daysWorked)], ["Faltas", String(t.absences)], ["Atrasos", fmt.duration(t.lateMinutes)], ["Horas extras", fmt.duration(t.overtimeMinutes)], ["Trabalhadas", fmt.duration(t.workedMinutes)], ["Intervalos", fmt.duration(t.breakMinutes)]];
      doc.autoTable({ startY: 47, head: [totals.map(item => item[0])], body: [totals.map(item => item[1])], theme: "grid", styles: { fontSize: 10, halign: "center" }, headStyles: { fillColor: [236, 229, 255], textColor: [40, 22, 79] } });

      // Um dia por linha, do mais antigo para o mais recente.
      const days = data.journey.days.filter(day => day.status !== "off" || day.events.length).slice().sort((a, b) => a.date.localeCompare(b.date));
      const rows = days.map(day => {
        const end = [...day.events].reverse().find(event => event.eventType === "departure");
        return [
          fmt.day(day.date),
          R.dayLabel(day.status) + (day.justification ? ` (${day.justification.reason})` : ""),
          time(day.events[0]?.occurredAt),
          time(end?.occurredAt),
          day.events.length ? fmt.duration(day.breakMinutes) : "-",
          day.events.length ? fmt.duration(day.workedMinutes) : "-",
          day.lateMinutes ? fmt.duration(day.lateMinutes) : "-",
          day.overtimeMinutes ? fmt.duration(day.overtimeMinutes) : "-",
          day.events.map(event => `${time(event.occurredAt)}  ${event.label}${event.place ? ` - ${event.place}` : ""}`).join("\n") || "-"
        ];
      });
      doc.autoTable({
        startY: doc.lastAutoTable.finalY + 6,
        head: [["Dia", "Situação", "Entrada", "Saída", "Almoço", "Trabalhadas", "Atraso", "Extra", "Registros"]],
        body: rows.length ? rows : [["Nenhum dia previsto ou registro no período.", "", "", "", "", "", "", "", ""]],
        theme: "striped",
        styles: { fontSize: 9, cellPadding: 2, valign: "top" },
        headStyles: { fillColor: [84, 35, 189] },
        columnStyles: { 0: { cellWidth: 24 }, 1: { cellWidth: 34 }, 8: { cellWidth: 105 } }
      });

      // Assinaturas.
      let y = doc.lastAutoTable.finalY + 18;
      if (y > 198) { doc.addPage(); y = 30; } // sem espaço na página: assinaturas vão para a próxima
      doc.setDrawColor(120, 110, 150);
      doc.line(20, y, 120, y);
      doc.line(170, y, 270, y);
      doc.setFontSize(9);
      doc.text(person.name, 70, y + 5, { align: "center" });
      doc.text("Responsável pela Central", 220, y + 5, { align: "center" });

      const slug = person.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      doc.save(`ponto-${slug}-${period.from}-a-${period.to}.pdf`);
      R.toast("PDF baixado.");
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
      if (event.target.closest('[data-action="download-pdf"]')) downloadPdf().catch(error => R.toast(`Não foi possível gerar o PDF: ${error.message}`, "error"));
      // Justificar falta/atraso (ex.: o técnico avisou pelo WhatsApp): a falta deixa de contar e o
      // técnico volta a conseguir registrar o ponto naquele dia.
      const justifyButton = event.target.closest("[data-justify]");
      if (justifyButton) {
        const reason = await R.askReason({ title: "Justificar e liberar", message: `${data.employee.name} • ${fmt.day(justifyButton.dataset.justify)}. A falta deixa de contar e o técnico volta a conseguir registrar o ponto neste dia.`, label: "Motivo (ex.: avisou pelo WhatsApp que o pneu furou)", confirmLabel: "Justificar" });
        if (!reason) return;
        try {
          await api.post(`/api/employees/${id}/justifications`, { date: justifyButton.dataset.justify, reason });
          R.toast("Justificado. O técnico já pode registrar o ponto.");
          load();
        } catch (error) {
          R.toast(error.message, "error");
        }
        return;
      }
      const unjustifyButton = event.target.closest("[data-unjustify]");
      if (unjustifyButton) {
        if (!(await R.confirm({ title: "Remover justificativa?", message: "O dia volta a contar como falta (se não houver registro).", confirmLabel: "Remover", danger: true }))) return;
        try {
          await api.del(`/api/employees/${id}/justifications/${unjustifyButton.dataset.unjustify}`);
          R.toast("Justificativa removida.");
          load();
        } catch (error) {
          R.toast(error.message, "error");
        }
        return;
      }
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
        range = event.target.value;
        load().catch(error => R.toast(error.message, "error"));
      }
    });

    await load();

    // A cada 15 segundos, busca as localizações mais recentes e atualiza só essa parte da página.
    setInterval(async () => {
      if (document.hidden || !data) return;
      try {
        const { locations } = await api.get(`/api/employees/${id}/locations`);
        data.locations = locations;
        const box = root.querySelector("#location-stops");
        if (box) box.innerHTML = locationStops();
      } catch {
        // Sem conexão: mantém a lista atual.
      }
    }, 15000);
  }
};
