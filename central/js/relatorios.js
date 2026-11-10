// REOBOTE | central/js/relatorios.js — Central: relatórios com filtros e exportação CSV/PDF
// Relatórios: frequência, entradas e saídas, atrasos, faltas, horas extras, intervalos e horas trabalhadas.
// Exporta em CSV (planilha) e em PDF (pela impressão do navegador, com layout próprio para papel).
window.ReobotePage = {
  // Monta a página de relatórios dentro de "root"; R são os utilitários da Central (app-core.js).
  async mount(root, R) {
    const { esc, api, fmt } = R;
    const [{ jobs }, { units }, { employees }] = await Promise.all([
      api.get("/api/jobs"), api.get("/api/units"), api.get("/api/employees?active=all")
    ]);
    const today = R.localDate();
    const state = { from: today.slice(0, 8) + "01", to: today, jobId: "", unitId: "", employeeId: "", report: null, detail: null };

    // Datas inicial e final para os períodos prontos (este mês, mês anterior, últimos N dias).
    function presetRange(preset) {
      const [y, m] = today.split("-").map(Number);
      // 5 -> "05".
      const pad = n => String(n).padStart(2, "0");
      if (preset === "month") return [`${y}-${pad(m)}-01`, today];
      if (preset === "last-month") {
        const ly = m === 1 ? y - 1 : y;
        const lm = m === 1 ? 12 : m - 1;
        const last = new Date(Date.UTC(ly, lm, 0)).getUTCDate();
        return [`${ly}-${pad(lm)}-01`, `${ly}-${pad(lm)}-${pad(last)}`];
      }
      const days = Number(preset);
      return [R.localDate(-(days - 1)), today];
    }

    root.innerHTML = `${R.heading("reports")}
      <section class="panel content-panel wide-panel no-print">
        <form class="report-filters" id="report-filters">
          <label class="field"><span>Período</span><select class="text-control" name="preset">
            <option value="month">Este mês</option><option value="last-month">Mês anterior</option><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option><option value="90">Últimos 90 dias</option><option value="custom">Personalizado</option></select></label>
          <label class="field"><span>De</span><input class="text-control" type="date" name="from" value="${state.from}" max="${today}" required></label>
          <label class="field"><span>Até</span><input class="text-control" type="date" name="to" value="${state.to}" max="${today}" required></label>
          <label class="field"><span>Cargo</span><select class="text-control" name="jobId"><option value="">Todos</option>${jobs.map(j => `<option value="${esc(j.id)}">${esc(j.name)}</option>`).join("")}</select></label>
          <label class="field"><span>Unidade</span><select class="text-control" name="unitId"><option value="">Todas</option>${units.map(u => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join("")}</select></label>
          <label class="field"><span>Colaborador</span><select class="text-control" name="employeeId"><option value="">Todos</option>${employees.map(e => `<option value="${esc(e.id)}">${esc(e.name)}${e.active ? "" : " (desativado)"}</option>`).join("")}</select></label>
          <div class="report-filter-actions">
            <button type="submit" class="save"><i class="fa-solid fa-magnifying-glass"></i> Gerar relatório</button>
            <button type="button" class="button-secondary" data-action="csv"><i class="fa-solid fa-file-csv"></i> CSV</button>
            <button type="button" class="button-secondary" data-action="pdf"><i class="fa-solid fa-file-pdf"></i> PDF</button>
          </div>
        </form>
      </section>
      <div id="report-output">${R.loading("Gerando relatório...")}</div>`;

    const form = root.querySelector("#report-filters");
    const output = root.querySelector("#report-output");

    // 80.5 -> "80,5%".
    function percent(value) {
      return value === null || value === undefined ? "—" : `${String(value).replace(".", ",")}%`;
    }

    // Cartão de indicador do relatório.
    function stat(icon, tone, label, value, note) {
      return `<div class="stat-card"><span class="stat-icon ${tone}"><i class="fa-solid ${icon}"></i></span><span class="stat-copy"><small>${label}</small><strong>${value}</strong><em>${note}</em></span></div>`;
    }

    // Cabeçalho que só aparece na impressão/PDF (empresa, título, período e quem gerou).
    function printHeader(title) {
      const report = state.report;
      return `<header class="print-header"><img src="../compartilhado/assets/reobote-mark.png" alt=""><div><strong>${esc(report.company)}</strong><span>${esc(title)}</span>
        <small>Período: ${fmt.dayFull(report.from)} a ${fmt.dayFull(report.to)} • Gerado em ${fmt.dateTime(report.generatedAt)} por ${esc(report.generatedBy)}</small></div></header>`;
    }

    // Espelho de jornada de um colaborador: um dia por linha, com entradas, saídas, almoço, atraso e extras.
    function renderDetail() {
      const detail = state.detail;
      if (!detail) return "";
      const t = detail.totals;
      const rows = detail.days.filter(day => day.status !== "off" || day.events.length).map(day => {
        const first = day.events[0];
        const last = day.events[day.events.length - 1];
        const breaks = day.events.filter(e => e.eventType === "break_start").map(e => fmt.time(e.occurredAt)).join(", ");
        return `<tr>
          <td>${fmt.day(day.date)}${day.holiday ? `<small class="cell-note">${esc(day.holiday)}</small>` : ""}</td>
          <td>${R.dayPill(day.status)}${day.flags.includes("missing_departure") ? '<small class="cell-note warn">Sem encerramento</small>' : ""}${day.flags.includes("missing_start") ? '<small class="cell-note warn">Sem início</small>' : ""}</td>
          <td>${first ? fmt.time(first.occurredAt) : "—"}</td>
          <td>${last && last.eventType === "departure" ? fmt.time(last.occurredAt) : "—"}</td>
          <td>${breaks || "—"}${day.breakMinutes ? ` <small>(${fmt.duration(day.breakMinutes)})</small>` : ""}</td>
          <td>${day.workedMinutes ? fmt.duration(day.workedMinutes) : "—"}</td>
          <td>${day.expectedMinutes ? fmt.duration(day.expectedMinutes) : "—"}</td>
          <td class="${day.lateMinutes ? "text-danger" : ""}">${day.lateMinutes ? fmt.duration(day.lateMinutes) : "—"}</td>
          <td class="${day.overtimeMinutes ? "text-success" : ""}">${day.overtimeMinutes ? fmt.duration(day.overtimeMinutes) : "—"}</td>
          <td class="events-cell">${day.events.length ? `<ul class="report-events">${day.events.map(e => `<li><time>${fmt.time(e.occurredAt)}</time><i class="fa-solid ${R.eventIcons[e.eventType] || "fa-clock"}"></i><span><strong>${esc(e.label)}</strong>${e.place ? `<small>${esc(e.place)}</small>` : ""}</span></li>`).join("")}</ul>` : "—"}</td>
        </tr>`;
      }).join("");
      return `<section class="panel content-panel wide-panel report-section" id="report-detail">
        ${printHeader(`Espelho de jornada — ${detail.employee.name}`)}
        <div class="content-panel-heading"><h2><i class="fa-solid fa-user-clock"></i> ${esc(detail.employee.name)}</h2><span class="heading-spacer"></span>
          <button type="button" class="button-secondary small-button no-print" data-action="close-detail"><i class="fa-solid fa-xmark"></i> Fechar</button></div>
        <p class="panel-description">${esc(detail.employee.job || "Sem cargo")} • ${esc(detail.schedule?.description || "Sem jornada definida")} • ${esc(detail.employee.email)}</p>
        <div class="stats-grid">
          ${stat("fa-calendar-check", "green-bg", "Dias trabalhados", t.daysWorked, `${t.absences} falta(s)`)}
          ${stat("fa-clock", "orange-bg", "Atrasos", fmt.duration(t.lateMinutes), `${t.lateDays} dia(s)`)}
          ${stat("fa-business-time", "purple-bg", "Horas extras", fmt.duration(t.overtimeMinutes), "Acima da tolerância")}
          ${stat("fa-hourglass-half", "blue-bg", "Trabalhadas", fmt.duration(t.workedMinutes), `Previstas ${fmt.duration(t.expectedMinutes)}`)}
        </div>
        <div class="table-wrap"><table class="data-table report-table"><thead><tr><th>Dia</th><th>Situação</th><th>Entrada</th><th>Saída</th><th>Almoço</th><th>Trabalhadas</th><th>Previstas</th><th>Atraso</th><th>Extra</th><th>Registros</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="10" class="empty-state">Sem dias previstos ou registros no período.</td></tr>`}</tbody></table></div>
        <div class="print-signatures"><span>Colaborador</span><span>Responsável</span></div>
      </section>`;
    }

    // Desenha o resumo coletivo e, se houver, o detalhamento individual.
    function render() {
      const report = state.report;
      const o = report.overall;
      output.innerHTML = `<section class="panel content-panel wide-panel report-section${state.detail ? " print-hidden" : ""}" id="report-summary">
          ${printHeader("Relatório de frequência e jornada")}
          <div class="stats-grid">
            ${stat("fa-user-check", "green-bg", "Frequência", percent(o.attendanceRate), `${o.daysWorked} dia(s) trabalhados • ${o.absences} falta(s)`)}
            ${stat("fa-clock", "orange-bg", "Atrasos", fmt.duration(o.lateMinutes), `${o.lateDays} ocorrência(s)`)}
            ${stat("fa-business-time", "purple-bg", "Horas extras", fmt.duration(o.overtimeMinutes), "Somadas no período")}
            ${stat("fa-hourglass-half", "blue-bg", "Horas trabalhadas", fmt.duration(o.workedMinutes), `Intervalos ${fmt.duration(o.breakMinutes)}`)}
          </div>
          <div class="content-panel-heading"><h2><i class="fa-solid fa-table"></i> Resumo por colaborador (${o.employees})</h2></div>
          <div class="table-wrap"><table class="data-table report-table"><thead><tr><th>Colaborador</th><th>Cargo</th><th>Dias trab.</th><th>Faltas</th><th>Frequência</th><th>Atrasos</th><th>Horas extras</th><th>Intervalos</th><th>Trabalhadas</th><th>Previstas</th><th>Pendências</th><th class="no-print"></th></tr></thead>
          <tbody>${report.rows.map(row => `<tr>
            <td><span class="person-cell">${R.avatar(row.employee, "person-avatar")}<span><strong>${esc(row.employee.name)}</strong><small>${esc(row.employee.unit || "")}</small></span></span></td>
            <td>${esc(row.employee.job || "—")}</td>
            <td>${row.totals.daysWorked}</td>
            <td class="${row.totals.absences ? "text-danger" : ""}">${row.totals.absences}</td>
            <td>${percent(row.attendanceRate)}</td>
            <td class="${row.totals.lateMinutes ? "text-danger" : ""}">${row.totals.lateDays ? `${row.totals.lateDays}× • ${fmt.duration(row.totals.lateMinutes)}` : "—"}</td>
            <td class="${row.totals.overtimeMinutes ? "text-success" : ""}">${row.totals.overtimeMinutes ? fmt.duration(row.totals.overtimeMinutes) : "—"}</td>
            <td>${fmt.duration(row.totals.breakMinutes)}</td>
            <td>${fmt.duration(row.totals.workedMinutes)}</td>
            <td>${fmt.duration(row.totals.expectedMinutes)}</td>
            <td>${row.totals.incompleteDays ? `<span class="state-pill warning">${row.totals.incompleteDays} dia(s)</span>` : "—"}</td>
            <td class="no-print"><button type="button" class="button-secondary small-button" data-detail="${esc(row.employee.id)}">Detalhar</button></td>
          </tr>`).join("") || `<tr><td colspan="12" class="empty-state">Nenhum colaborador encontrado com esses filtros.</td></tr>`}</tbody></table></div>
          <p class="panel-description">Faltas consideram dias previstos na jornada sem registro (exceto feriados). Atrasos e horas extras respeitam a tolerância de cada jornada. “Pendências” são dias sem encerramento ou sem início registrado.</p>
        </section>
        ${renderDetail()}`;
    }

    // Gera o relatório com os filtros do formulário.
    async function load() {
      const data = new FormData(form);
      Object.assign(state, { from: data.get("from"), to: data.get("to"), jobId: data.get("jobId"), unitId: data.get("unitId"), employeeId: data.get("employeeId") });
      const params = new URLSearchParams({ from: state.from, to: state.to, inactive: "1" });
      ["jobId", "unitId", "employeeId"].forEach(key => state[key] && params.set(key, state[key]));
      output.innerHTML = R.loading("Gerando relatório...");
      try {
        state.report = await api.get(`/api/reports?${params}`);
        state.detail = state.employeeId ? await api.get(`/api/employees/${state.employeeId}/attendance?from=${state.from}&to=${state.to}`) : null;
        render();
      } catch (error) {
        output.innerHTML = `<section class="panel content-panel">${R.emptyState("fa-triangle-exclamation", "Não foi possível gerar o relatório", error.message)}</section>`;
      }
    }

    // Abre o espelho de jornada de um colaborador e rola a tela até ele.
    async function openDetail(id) {
      try {
        state.detail = await api.get(`/api/employees/${id}/attendance?from=${state.report.from}&to=${state.report.to}`);
        render();
        root.querySelector("#report-detail")?.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (error) {
        R.toast(error.message, "error");
      }
    }

    // Exporta para planilha (CSV): o espelho individual, se aberto, ou o resumo coletivo.
    function exportCsv() {
      if (!state.report) return;
      const period = `${state.report.from}_a_${state.report.to}`;
      if (state.detail) {
        const d = state.detail;
        const rows = [["Colaborador", "Cargo", "Dia", "Situação", "Entrada", "Saída", "Almoço (min)", "Trabalhadas (min)", "Previstas (min)", "Atraso (min)", "Hora extra (min)", "Registros"]];
        d.days.filter(day => day.status !== "off" || day.events.length).slice().reverse().forEach(day => {
          const first = day.events[0];
          const last = day.events[day.events.length - 1];
          rows.push([d.employee.name, d.employee.job || "", fmt.dayFull(day.date), R.dayLabel(day.status), first ? fmt.time(first.occurredAt) : "", last?.eventType === "departure" ? fmt.time(last.occurredAt) : "",
            day.breakMinutes, day.workedMinutes, day.expectedMinutes, day.lateMinutes, day.overtimeMinutes,
            day.events.map(e => `${fmt.time(e.occurredAt)} ${e.label}${e.place ? ` (${e.place})` : ""}`).join(" | ")]);
        });
        const slug = d.employee.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase();
        R.downloadCsv(`espelho-${slug}-${period}.csv`, rows);
        return;
      }
      const rows = [["Colaborador", "E-mail", "Cargo", "Unidade", "Dias trabalhados", "Faltas", "Frequência (%)", "Dias com atraso", "Atraso (min)", "Horas extras (min)", "Intervalos (min)", "Trabalhadas (min)", "Previstas (min)", "Dias com pendência"]];
      state.report.rows.forEach(row => rows.push([row.employee.name, row.employee.email, row.employee.job || "", row.employee.unit || "", row.totals.daysWorked, row.totals.absences,
        row.attendanceRate ?? "", row.totals.lateDays, row.totals.lateMinutes, row.totals.overtimeMinutes, row.totals.breakMinutes, row.totals.workedMinutes, row.totals.expectedMinutes, row.totals.incompleteDays]));
      R.downloadCsv(`relatorio-reobote-${period}.csv`, rows);
    }

    form.addEventListener("submit", event => { event.preventDefault(); load(); });
    form.elements.preset.addEventListener("change", event => {
      if (event.target.value === "custom") return;
      const [from, to] = presetRange(event.target.value);
      form.elements.from.value = from;
      form.elements.to.value = to;
      load();
    });
    ["from", "to"].forEach(name => form.elements[name].addEventListener("change", () => { form.elements.preset.value = "custom"; }));
    root.addEventListener("click", event => {
      const detail = event.target.closest("[data-detail]");
      if (detail) openDetail(detail.dataset.detail);
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (action === "close-detail") { state.detail = null; render(); }
      if (action === "csv") exportCsv();
      if (action === "pdf") {
        if (!state.report) return;
        R.toast("Na janela de impressão, escolha “Salvar como PDF”.");
        document.body.classList.add("printing-report");
        // Depois da impressão, volta a página ao normal.
        const done = () => { document.body.classList.remove("printing-report"); window.removeEventListener("afterprint", done); };
        window.addEventListener("afterprint", done);
        setTimeout(() => window.print(), 300);
      }
    });

    await load();
  }
};
