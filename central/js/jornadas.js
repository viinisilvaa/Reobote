// REOBOTE | central/js/jornadas.js — Central: jornadas, escalas 12x36, tolerância e feriados
// Jornadas e escalas: horários, intervalo de almoço, dias de trabalho, escalas 12x36, tolerância, horas extras e feriados.
window.ReobotePage = {
  // Monta a página de jornadas e feriados dentro de "root"; R são os utilitários da Central (app-core.js).
  async mount(root, R) {
    const { esc, api, fmt } = R;
    const dayNames = [["1", "Seg"], ["2", "Ter"], ["3", "Qua"], ["4", "Qui"], ["5", "Sex"], ["6", "Sáb"], ["7", "Dom"]];
    let schedules = [];
    let holidays = [];
    let holidayYear = new Date().getFullYear();

    root.innerHTML = `${R.heading("schedules", '<a class="button-secondary" href="cargos.html"><i class="fa-solid fa-briefcase"></i> Cargos</a><button type="button" class="button-primary" data-action="new"><i class="fa-solid fa-plus"></i> Nova jornada</button>')}
      <div class="stats-grid" id="schedule-stats"></div>
      <section class="panel content-panel wide-panel">
        <div class="content-panel-heading"><h2><i class="fa-solid fa-calendar-days"></i> Jornadas cadastradas</h2></div>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>Jornada</th><th>Horário</th><th>Intervalo</th><th>Dias / escala</th><th>Tolerância</th><th>Horas previstas</th><th>Folgas e feriados</th><th>Em uso</th><th><span class="sr-only">Ações</span></th></tr></thead>
          <tbody id="schedule-rows"><tr><td colspan="9">${R.loading()}</td></tr></tbody></table></div>
      </section>
      <section class="panel content-panel">
        <div class="content-panel-heading"><h2><i class="fa-solid fa-umbrella-beach"></i> Feriados</h2>
          <span class="heading-spacer"></span>
          <label class="select-control"><span>Ano</span><select id="holiday-year">${[-1, 0, 1].map(offset => { const y = new Date().getFullYear() + offset; return `<option ${offset === 0 ? "selected" : ""}>${y}</option>`; }).join("")}</select></label>
        </div>
        <p class="panel-description">Em feriados, ninguém é considerado ausente. Quem trabalhar tem as horas contadas como extras quando a jornada estiver configurada para isso.</p>
        <form id="holiday-form" class="inline-form">
          <label class="field"><span>Data</span><input class="text-control" type="date" name="date" required></label>
          <label class="field grow"><span>Nome do feriado</span><input class="text-control" name="name" required maxlength="120" placeholder="Ex.: Aniversário da cidade"></label>
          <button type="submit" class="save"><i class="fa-solid fa-plus"></i> Adicionar</button>
        </form>
        <ul class="holiday-list" id="holiday-list"></ul>
      </section>`;

    // Texto dos dias de trabalho: "Seg, Ter, Qua..." ou "Escala 1x1 (desde 01/11/2026)".
    function daysText(schedule) {
      if (schedule.mode === "cycle") return `Escala ${schedule.cycleWorkDays}x${schedule.cycleOffDays} (desde ${fmt.dayFull(schedule.cycleAnchor)})`;
      return dayNames.filter(([key]) => schedule.workDays.includes(key)).map(([, name]) => name).join(", ");
    }

    // Desenha os indicadores, a tabela de jornadas e a lista de feriados.
    function render() {
      const inUse = schedules.filter(s => s.employeeCount > 0).length;
      root.querySelector("#schedule-stats").innerHTML = `
        <div class="stat-card"><span class="stat-icon purple-bg"><i class="fa-solid fa-calendar-days"></i></span><span class="stat-copy"><small>Jornadas</small><strong>${schedules.length}</strong><em>${inUse} em uso</em></span></div>
        <div class="stat-card"><span class="stat-icon green-bg"><i class="fa-solid fa-users"></i></span><span class="stat-copy"><small>Colaboradores com jornada</small><strong>${schedules.reduce((sum, s) => sum + s.employeeCount, 0)}</strong><em>Individual ou pelo cargo</em></span></div>
        <div class="stat-card"><span class="stat-icon orange-bg"><i class="fa-solid fa-umbrella-beach"></i></span><span class="stat-copy"><small>Feriados em ${holidayYear}</small><strong>${holidays.length}</strong><em>Sem falta nesses dias</em></span></div>`;
      root.querySelector("#schedule-rows").innerHTML = schedules.map(s => `<tr>
        <td><strong>${esc(s.name)}</strong>${s.notes ? `<small class="cell-note">${esc(s.notes)}</small>` : ""}</td>
        <td>${esc(s.start)} às ${esc(s.end)}${s.end < s.start ? ' <span class="chip chip-muted">noturna</span>' : ""}</td>
        <td>${s.breakMinutes} min</td>
        <td>${esc(daysText(s))}</td>
        <td>${s.toleranceMinutes} min</td>
        <td>${fmt.duration(s.expectedMinutes)}</td>
        <td>${s.offDayOvertime ? "Contam como extra" : "Não contam"}</td>
        <td>${s.employeeCount} colab. • ${s.jobCount} cargo(s)</td>
        <td class="row-actions">
          <button type="button" class="icon-button" data-action="edit" data-id="${esc(s.id)}" aria-label="Editar ${esc(s.name)}"><i class="fa-solid fa-pen-to-square"></i></button>
          <button type="button" class="icon-button" data-action="copy" data-id="${esc(s.id)}" aria-label="Duplicar ${esc(s.name)}" title="Duplicar"><i class="fa-solid fa-copy"></i></button>
          <button type="button" class="icon-button danger" data-action="delete" data-id="${esc(s.id)}" aria-label="Excluir ${esc(s.name)}"><i class="fa-solid fa-trash-can"></i></button>
        </td></tr>`).join("") || `<tr><td colspan="9">${R.emptyState("fa-calendar-plus", "Nenhuma jornada cadastrada")}</td></tr>`;
      root.querySelector("#holiday-list").innerHTML = holidays.map(h => `<li><span class="holiday-date">${fmt.day(h.date)}</span><span>${esc(h.name)}</span>
        <button type="button" class="icon-button danger" data-action="delete-holiday" data-id="${esc(h.id)}" aria-label="Excluir feriado ${esc(h.name)}"><i class="fa-solid fa-trash-can"></i></button></li>`).join("")
        || `<li class="empty-state">Nenhum feriado cadastrado para ${holidayYear}.</li>`;
    }

    // Busca jornadas e feriados do ano selecionado.
    async function load() {
      const [scheduleData, holidayData] = await Promise.all([api.get("/api/schedules"), api.get(`/api/holidays?year=${holidayYear}`)]);
      schedules = scheduleData.schedules;
      holidays = holidayData.holidays;
      render();
    }

    // Formulário de jornada (nova, edição ou cópia de uma existente).
    async function openForm(schedule, copy = false) {
      const s = schedule || { start: "08:00", end: "18:00", breakMinutes: 60, toleranceMinutes: 15, mode: "weekly", workDays: "12345", cycleWorkDays: 1, cycleOffDays: 1, cycleAnchor: R.localDate(), offDayOvertime: true };
      const editing = schedule && !copy;
      const saved = await R.openDialog({
        title: editing ? "Editar jornada" : "Nova jornada",
        subtitle: "Usada para comparar os horários previstos com os registros do aplicativo.",
        submitLabel: editing ? "Salvar alterações" : "Cadastrar jornada",
        wide: true,
        body: `<div class="form-grid">
          <label class="field span-2"><span>Nome *</span><input class="text-control" name="name" required maxlength="120" placeholder="Ex.: Comercial 08h às 18h" value="${esc(copy ? `${s.name} (cópia)` : s.name || "")}"></label>
          <label class="field"><span>Entrada *</span><input class="text-control" type="time" name="start" required value="${esc(s.start)}"></label>
          <label class="field"><span>Saída *</span><input class="text-control" type="time" name="end" required value="${esc(s.end)}"></label>
          <label class="field"><span>Intervalo de almoço (min)</span><input class="text-control" type="number" name="breakMinutes" min="0" max="240" value="${s.breakMinutes}"></label>
          <label class="field"><span>Tolerância de atraso (min)</span><input class="text-control" type="number" name="toleranceMinutes" min="0" max="120" value="${s.toleranceMinutes}"></label>
          <fieldset class="span-2 radio-row"><legend>Tipo de escala</legend>
            <label class="checkbox-line"><input type="radio" name="mode" value="weekly" ${s.mode === "weekly" ? "checked" : ""}> Dias fixos da semana</label>
            <label class="checkbox-line"><input type="radio" name="mode" value="cycle" ${s.mode === "cycle" ? "checked" : ""}> Escala em ciclo (ex.: 12x36)</label>
          </fieldset>
          <fieldset class="span-2 weekday-picker" data-mode="weekly"><legend>Dias de trabalho</legend>
            ${dayNames.map(([key, name]) => `<label><input type="checkbox" name="workDays" value="${key}" ${s.workDays.includes(key) ? "checked" : ""}><span>${name}</span></label>`).join("")}
          </fieldset>
          <div class="span-2 form-grid cycle-fields" data-mode="cycle">
            <label class="field"><span>Dias trabalhados</span><input class="text-control" type="number" name="cycleWorkDays" min="1" max="14" value="${s.cycleWorkDays}"></label>
            <label class="field"><span>Dias de folga</span><input class="text-control" type="number" name="cycleOffDays" min="0" max="14" value="${s.cycleOffDays}"></label>
            <label class="field span-2"><span>Primeiro dia de trabalho da escala</span><input class="text-control" type="date" name="cycleAnchor" value="${esc(s.cycleAnchor || R.localDate())}"></label>
          </div>
          <label class="checkbox-line span-2"><input type="checkbox" name="offDayOvertime" ${s.offDayOvertime ? "checked" : ""}> Horas trabalhadas em folgas, fins de semana e feriados contam integralmente como horas extras</label>
          <label class="field span-2"><span>Observações</span><input class="text-control" name="notes" maxlength="500" value="${esc(s.notes || "")}" placeholder="Regras específicas, setor, autorizações..."></label>
          <p class="form-hint span-2" id="schedule-summary"></p>
        </div>`,
        onOpen: form => {
          // Mostra/oculta os campos do tipo de escala e recalcula o resumo de horas previstas enquanto o usuário digita.
          const update = () => {
            const mode = form.querySelector('input[name="mode"]:checked').value;
            form.querySelectorAll("[data-mode]").forEach(element => { element.hidden = element.dataset.mode !== mode; });
            const [sh, sm] = form.elements.start.value.split(":").map(Number);
            const [eh, em] = form.elements.end.value.split(":").map(Number);
            let minutes = eh * 60 + em - (sh * 60 + sm);
            if (minutes <= 0) minutes += 1440;
            minutes -= Number(form.elements.breakMinutes.value || 0);
            form.querySelector("#schedule-summary").innerHTML = `<i class="fa-solid fa-circle-info"></i> Jornada prevista: <strong>${fmt.duration(minutes)}</strong> por dia${eh * 60 + em <= sh * 60 + sm ? " (atravessa a meia-noite)" : ""}. Atraso conta após ${Number(form.elements.toleranceMinutes.value || 0)} min; horas extras acima da tolerância.`;
          };
          form.addEventListener("input", update);
          form.addEventListener("change", update);
          update();
        },
        onSubmit: data => {
          const payload = {
            name: data.get("name"), start: data.get("start"), end: data.get("end"),
            breakMinutes: Number(data.get("breakMinutes")), toleranceMinutes: Number(data.get("toleranceMinutes")),
            mode: data.get("mode"), workDays: data.getAll("workDays").join(""),
            cycleWorkDays: Number(data.get("cycleWorkDays")), cycleOffDays: Number(data.get("cycleOffDays")), cycleAnchor: data.get("cycleAnchor"),
            offDayOvertime: data.has("offDayOvertime"), notes: data.get("notes")
          };
          return editing ? api.put(`/api/schedules/${schedule.id}`, payload) : api.post("/api/schedules", payload);
        }
      });
      if (saved) {
        R.toast(editing ? "Jornada atualizada. Os cálculos passam a usar os novos horários." : "Jornada cadastrada.");
        load();
      }
    }

    root.addEventListener("click", async event => {
      const control = event.target.closest("[data-action]");
      if (!control) return;
      const schedule = schedules.find(item => item.id === control.dataset.id);
      try {
        if (control.dataset.action === "new") openForm();
        if (control.dataset.action === "edit" && schedule) openForm(schedule);
        if (control.dataset.action === "copy" && schedule) openForm(schedule, true);
        if (control.dataset.action === "delete" && schedule) {
          if (!(await R.confirm({ title: "Excluir jornada?", message: `A jornada ${schedule.name} será excluída. Jornadas em uso não podem ser excluídas.`, confirmLabel: "Excluir", danger: true }))) return;
          await api.del(`/api/schedules/${schedule.id}`);
          R.toast("Jornada excluída.");
          load();
        }
        if (control.dataset.action === "delete-holiday") {
          await api.del(`/api/holidays/${control.dataset.id}`);
          R.toast("Feriado removido.");
          load();
        }
      } catch (error) {
        R.toast(error.message, "error");
      }
    });

    root.querySelector("#holiday-form").addEventListener("submit", async event => {
      event.preventDefault();
      const data = new FormData(event.target);
      try {
        await api.post("/api/holidays", { date: data.get("date"), name: data.get("name") });
        event.target.reset();
        R.toast("Feriado salvo.");
        holidayYear = Number(String(data.get("date")).slice(0, 4)) || holidayYear;
        root.querySelector("#holiday-year").value = String(holidayYear);
        load();
      } catch (error) {
        R.toast(error.message, "error");
      }
    });
    root.querySelector("#holiday-year").addEventListener("change", event => { holidayYear = Number(event.target.value); load(); });

    await load();
  }
};
