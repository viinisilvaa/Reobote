// Notificações geradas pelos registros do aplicativo e pelas verificações do sistema (atrasos, ausências, horas extras).
window.ReobotePage = {
  // Monta a central de notificações dentro de "root"; R são os utilitários da Central (app-core.js).
  async mount(root, R) {
    const { esc, api, fmt } = R;
    const types = {
      "": "Todos os tipos", vehicle_checkin: "Chegada ao veículo", unit_checkin: "Chegada à unidade", break_start: "Início do almoço",
      break_end: "Retorno do almoço", departure: "Encerramento", late: "Atrasos", absence: "Ausências", overtime: "Horas extras",
      out_of_range: "Fora do raio da unidade", access_request: "Pedidos de acesso"
    };
    const alertTypes = ["late", "absence", "out_of_range", "access_request"];
    let filter = "all";
    let type = "";
    let items = [];
    let hasMore = false;

    root.innerHTML = `${R.heading("notifications")}
      <section class="panel content-panel wide-panel">
        <div class="toolbar">
          <label class="select-control"><span>Exibir</span><select id="notification-filter"><option value="all">Todas</option><option value="unread">Não lidas</option><option value="read">Lidas</option></select></label>
          <label class="select-control"><span>Tipo</span><select id="notification-type">${Object.entries(types).map(([key, label]) => `<option value="${key}">${label}</option>`).join("")}</select></label>
          <span class="result-count" id="unread-count"></span>
          <button type="button" class="button-secondary" data-action="read-all"><i class="fa-solid fa-check-double"></i> Marcar todas como lidas</button>
        </div>
        <div class="notification-list" id="notification-list">${R.loading()}</div>
        <div class="list-footer"><button type="button" class="button-secondary" data-action="more" hidden>Carregar mais</button></div>
      </section>`;

    const list = root.querySelector("#notification-list");

    // Desenha os cartões das notificações; alertas (atraso, ausência, fora do raio) ficam destacados.
    function render(unread) {
      root.querySelector("#unread-count").textContent = `${unread} não lida(s)`;
      list.innerHTML = items.map(item => `<article class="notification-card ${item.read ? "read" : ""} ${alertTypes.includes(item.type) ? "alert" : ""}">
        <span class="notification-icon"><i class="fa-solid ${esc(item.icon)}"></i></span>
        <div class="notification-copy">
          <strong>${esc(item.title)}</strong>
          ${item.detail ? `<p>${esc(item.detail)}</p>` : ""}
          <time datetime="${esc(item.createdAt)}">${fmt.dateTime(item.createdAt)} • ${fmt.relative(item.createdAt)}</time>
        </div>
        <div class="notification-actions">
          ${item.employeeId ? `<a class="button-secondary small-button" href="${item.type === "access_request" ? "colaboradores.html" : `perfil-colaborador.html?id=${encodeURIComponent(item.employeeId)}`}">${item.type === "access_request" ? "Colaboradores" : "Ver perfil"}</a>` : ""}
          ${item.read ? '<span class="read-label">Lida</span>' : `<button type="button" class="button-secondary small-button" data-read="${esc(item.id)}">Marcar como lida</button>`}
        </div>
      </article>`).join("") || R.emptyState("fa-bell-slash", "Nenhuma notificação", "Os avisos aparecem aqui conforme os colaboradores registram a jornada.");
      root.querySelector('[data-action="more"]').hidden = !hasMore;
    }

    // Busca notificações; append=true carrega as mais antigas abaixo das atuais ("Carregar mais").
    async function load(append = false) {
      const params = new URLSearchParams({ filter, limit: "50" });
      if (type) params.set("type", type);
      if (append && items.length) params.set("before", items[items.length - 1].id);
      const data = await api.get(`/api/notifications?${params}`);
      items = append ? items.concat(data.notifications) : data.notifications;
      hasMore = data.hasMore;
      render(data.unread);
      R.refreshBadge();
    }

    // Marca como lidas e recarrega a lista e o contador.
    async function markRead(body) {
      try {
        await api.post("/api/notifications/read", body);
        await load();
      } catch (error) {
        R.toast(error.message, "error");
      }
    }

    root.addEventListener("click", event => {
      const read = event.target.closest("[data-read]");
      if (read) markRead({ ids: [read.dataset.read] });
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (action === "read-all") markRead({ all: true }).then(() => R.toast("Todas as notificações foram marcadas como lidas."));
      if (action === "more") load(true).catch(error => R.toast(error.message, "error"));
    });
    root.querySelector("#notification-filter").addEventListener("change", event => { filter = event.target.value; load(); });
    root.querySelector("#notification-type").addEventListener("change", event => { type = event.target.value; load(); });

    await load();
    setInterval(() => { if (!document.hidden && filter !== "read") load().catch(() => {}); }, 30000);
  }
};
