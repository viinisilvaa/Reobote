// Painel principal: indicadores do dia, presenças no período, situação da equipe e registros recentes.
window.ReobotePage = {
  // Monta o painel dentro de "root"; R são os utilitários da Central (app-core.js).
  async mount(root, R) {
    const { esc, fmt } = R;
    let period = 7;
    let timer;

    // Gráfico de linha (SVG) de presenças por dia, ou por semana no período de 90 dias.
    function chart(points, total) {
      if (!points.length) return R.emptyState("fa-chart-line", "Sem dados no período");
      const width = 600;
      const top = 18;
      const bottom = 156;
      const max = Math.max(4, total, ...points.map(point => point.present));
      const step = Math.ceil(max / 4);
      const scaleMax = step * 4;
      const coords = points.map((point, index) => ({
        ...point,
        x: points.length === 1 ? width / 2 : 12 + (index * (width - 24)) / (points.length - 1),
        y: bottom - (point.present / scaleMax) * (bottom - top)
      }));
      const line = coords.slice(1).reduce((path, point, index) => {
        const previous = coords[index];
        const dx = (point.x - previous.x) / 3;
        return `${path} C ${previous.x + dx},${previous.y} ${point.x - dx},${point.y} ${point.x},${point.y}`;
      }, `M ${coords[0].x},${coords[0].y}`);
      const area = `${line} L ${coords[coords.length - 1].x},${bottom} L ${coords[0].x},${bottom} Z`;
      const labelEvery = Math.ceil(points.length / 8);
      return `<div class="dashboard-chart" role="img" aria-label="Presenças por ${period === 90 ? "semana" : "dia"} no período selecionado">
        <div class="chart-axis" aria-hidden="true">${[4, 3, 2, 1, 0].map(i => `<span>${i * step}</span>`).join("")}</div>
        <svg viewBox="0 0 ${width} 180" preserveAspectRatio="none" aria-hidden="true">
          <defs><linearGradient id="dashboard-chart-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#7b3fe0" stop-opacity=".38"></stop><stop offset="100%" stop-color="#7b3fe0" stop-opacity=".04"></stop></linearGradient></defs>
          <g class="chart-grid-lines">${[18, 52.5, 87, 121.5, 156].map(y => `<line x1="0" x2="${width}" y1="${y}" y2="${y}"></line>`).join("")}</g>
          <path class="chart-area" d="${area}"></path>
          <path class="chart-line" d="${line}"></path>
          <g class="chart-points">${coords.map(point => `<circle cx="${point.x}" cy="${point.y}" r="${points.length > 31 ? 3 : 5}"><title>${esc(point.label)}: ${point.present} presença(s), ${point.late} com atraso</title></circle>`).join("")}</g>
        </svg>
        <div class="chart-labels" aria-hidden="true">${coords.map((point, index) => `<span>${index % labelEvery === 0 ? esc(point.label) : ""}</span>`).join("")}</div>
      </div>`;
    }

    // Cartão de indicador do topo do painel (número, título, observação e link).
    function metric(className, icon, value, label, note, href, tone = "positive") {
      return `<a class="dashboard-metric ${className}" href="${href}">
        <span class="metric-icon"><i class="fa-solid ${icon}"></i></span>
        <span class="metric-copy"><strong>${esc(value)}</strong><span>${esc(label)}</span></span>
        <span class="metric-trend trend-${tone}">${esc(note)}</span>
        <svg class="metric-wave" viewBox="0 0 300 55" preserveAspectRatio="none" aria-hidden="true"><path d="M0 43 C35 38 39 48 73 37 S125 44 156 29 S195 40 220 23 S260 31 300 10 V55 H0Z"></path></svg>
      </a>`;
    }

    // Desenha o painel completo a partir dos dados de /api/dashboard.
    function render(data) {
      const m = data.metrics;
      const attention = data.team.filter(person => person.todayLateMinutes > 0 || (person.todayStatus === "not_arrived" && person.state === "waiting"));
      const order = { working: 0, in_transit: 1, on_break: 2, waiting: 3, finished: 4 };
      const team = [...data.team].sort((a, b) => (order[a.state] ?? 9) - (order[b.state] ?? 9) || a.name.localeCompare(b.name, "pt-BR"));

      root.innerHTML = `
        <section class="dashboard-overview dashboard-overview-5" aria-label="Indicadores de hoje">
          ${metric("metric-employees", "fa-users", m.total, "Colaboradores cadastrados", "Cadastros ativos", "colaboradores.html")}
          ${metric("metric-presence", "fa-user-check", m.active, "Colaboradores ativos", `${m.onBreak} em almoço agora`, "mapa-tempo-real.html")}
          ${metric("metric-absence", "fa-clock", m.late, "Atrasados hoje", "Além da tolerância", "relatorios.html", m.late ? "negative" : "positive")}
          ${metric("metric-shift", "fa-user-xmark", m.absent, "Ausentes hoje", "Sem início após a tolerância", "notificacoes.html", m.absent ? "negative" : "positive")}
          ${metric("metric-overtime", "fa-business-time", fmt.duration(m.overtimeMinutes), "Horas extras", `Últimos ${data.period} dias`, "relatorios.html")}
        </section>

        <nav class="dashboard-quick-actions" aria-label="Ações rápidas">
          ${R.has("employees") ? '<a class="button-primary" href="colaboradores.html#novo"><i class="fa-solid fa-user-plus"></i> Novo colaborador</a>' : ""}
          ${R.has("units") ? '<a class="button-secondary" href="unidades.html"><i class="fa-solid fa-qrcode"></i> QR Codes</a>' : ""}
          ${R.has("jobs") ? '<a class="button-secondary" href="jornadas.html"><i class="fa-solid fa-calendar-days"></i> Jornadas</a>' : ""}
          ${R.has("reports") ? '<a class="button-secondary" href="relatorios.html"><i class="fa-solid fa-file-pdf"></i> Relatórios</a>' : ""}
          <span class="dashboard-updated"><i class="fa-solid fa-rotate"></i> Atualizado às ${fmt.time(data.serverTime)}</span>
        </nav>

        <section class="dashboard-main-grid" aria-label="Atividade e desempenho">
          <article class="dashboard-card performance-card">
            <header class="dashboard-card-heading">
              <h2><i class="fa-solid fa-chart-column"></i> Presenças registradas</h2>
              <label class="dashboard-period"><span class="sr-only">Período do gráfico</span>
                <select id="dashboard-period">${[7, 30, 90].map(value => `<option value="${value}" ${value === data.period ? "selected" : ""}>Últimos ${value} dias</option>`).join("")}</select>
                <i class="fa-solid fa-chevron-down"></i></label>
            </header>
            ${chart(data.chart, m.total)}
            <p class="dashboard-preview-note">Colaboradores com início de jornada registrado ${data.period === 90 ? "por semana (soma diária)" : "por dia"}. Atrasos acumulados no período: ${fmt.duration(m.lateMinutes)}.</p>
          </article>

          <article class="dashboard-card team-card">
            <header class="dashboard-card-heading">
              <h2><i class="fa-solid fa-user-group"></i> Situação da equipe</h2>
              <span class="online-count"><i></i> Ativos: ${m.active}</span>
            </header>
            <ul class="situation-list">${team.slice(0, 8).map(person => `<li>
              <a href="perfil-colaborador.html?id=${encodeURIComponent(person.id)}">${R.avatar(person, "avatar small")}
                <span class="situation-copy"><strong>${esc(person.name)}</strong><small>${esc(person.job || "Sem cargo")}${person.lastEvent ? ` • ${esc(person.lastEvent.label)} às ${fmt.time(person.lastEvent.occurredAt)}` : ""}</small></span>
                ${R.statePill(person.state, person.stateLabel)}</a></li>`).join("") || `<li>${R.emptyState("fa-users", "Nenhum colaborador ativo")}</li>`}</ul>
            ${team.length > 8 ? `<a class="dashboard-pill-link" href="mapa-tempo-real.html">Ver todos (${team.length}) <i class="fa-solid fa-arrow-right"></i></a>` : ""}
          </article>

          <article class="dashboard-card activities-card">
            <header class="dashboard-card-heading">
              <h2><i class="fa-solid fa-clock-rotate-left"></i> Atividades recentes</h2>
              ${R.has("notifications") ? '<a class="dashboard-pill-link" href="notificacoes.html">Notificações <i class="fa-solid fa-arrow-right"></i></a>' : ""}
            </header>
            <ul class="dashboard-activities">${data.recent.map(event => `<li class="dashboard-activity">
              ${R.avatar(event, "avatar small")}
              <span class="activity-copy">
                <strong><i class="fa-solid ${R.eventIcons[event.eventType] || "fa-clock"}"></i> ${esc(event.employeeName)} — ${esc(event.label)}</strong>
                <small>${esc(event.job || "")}${event.place ? ` • ${esc(event.place)}` : ""} <b>•</b> ${fmt.dateTime(event.occurredAt)}${event.syncedLater ? " • sincronizado depois (offline)" : ""}${event.source === "admin" ? " • lançado pela Central" : ""}</small>
              </span></li>`).join("") || `<li class="dashboard-empty">Nenhum registro recebido ainda. Os registros aparecem aqui assim que os colaboradores usam o aplicativo.</li>`}</ul>
          </article>

          <article class="dashboard-card attention-card">
            <header class="dashboard-card-heading"><h2><i class="fa-solid fa-triangle-exclamation"></i> Atenção hoje</h2></header>
            <ul class="situation-list">${attention.map(person => `<li><a href="perfil-colaborador.html?id=${encodeURIComponent(person.id)}">${R.avatar(person, "avatar small")}
              <span class="situation-copy"><strong>${esc(person.name)}</strong><small>${person.todayLateMinutes > 0 ? `Chegou com atraso de ${fmt.duration(person.todayLateMinutes)}` : `Não iniciou a jornada prevista para ${esc(person.schedule?.start || "")}`}</small></span>
              <span class="state-pill ${person.todayLateMinutes > 0 ? "warning" : "danger"}">${person.todayLateMinutes > 0 ? "Atraso" : "Ausente"}</span></a></li>`).join("")
              || `<li>${R.emptyState("fa-circle-check", "Tudo em dia", "Nenhum atraso ou ausência até agora.")}</li>`}</ul>
          </article>
        </section>`;

      root.querySelector("#dashboard-period").addEventListener("change", event => {
        period = Number(event.target.value);
        load();
      });
    }

    // Busca os dados do painel e agenda uma nova atualização em 30 segundos.
    async function load() {
      clearTimeout(timer);
      try {
        render(await R.api.get(`/api/dashboard?period=${period}`));
      } catch (error) {
        if (!root.querySelector(".dashboard-overview")) throw error;
        R.toast(error.message, "error");
      }
      timer = setTimeout(load, 30000);
    }

    await load();
  }
};
