// REOBOTE | central/js/colaboradores.js — Central: cadastro de colaboradores, foto e senha temporária
// Colaboradores: cadastro, foto, cargo, unidade, jornada, perfil de acesso e situação do cadastro.
window.ReobotePage = {
  // Monta a página de colaboradores dentro de "root"; R são os utilitários da Central (app-core.js).
  async mount(root, R) {
    const { esc, fmt, api } = R;
    const [{ jobs }, { schedules }, { units }, { roles }] = await Promise.all([
      api.get("/api/jobs"), api.get("/api/schedules"), api.get("/api/units"), api.get("/api/permissions")
    ]);
    let employees = [];
    const filters = { search: "", jobId: "", unitId: "", active: "1", state: "" };
    const domain = R.session.company.emailDomain;

    root.innerHTML = `${R.heading("employees", R.has("employees") ? '<button type="button" class="button-primary" data-action="new"><i class="fa-solid fa-user-plus"></i> Novo colaborador</button>' : "")}
      <section class="panel content-panel wide-panel">
        <div class="content-panel-heading"><h2><i class="fa-solid fa-address-book"></i> Equipe</h2></div>
        <div class="toolbar">
          <label class="search-control"><i class="fa-solid fa-magnifying-glass"></i><input id="employee-search" type="search" placeholder="Buscar por nome, e-mail ou matrícula" aria-label="Buscar colaboradores"></label>
          <label class="select-control"><span>Cargo</span><select id="filter-job"><option value="">Todos</option>${jobs.map(job => `<option value="${esc(job.id)}">${esc(job.name)}</option>`).join("")}</select></label>
          <label class="select-control"><span>Unidade</span><select id="filter-unit"><option value="">Todas</option>${units.map(unit => `<option value="${esc(unit.id)}">${esc(unit.name)}</option>`).join("")}</select></label>
          <label class="select-control"><span>Situação</span><select id="filter-state"><option value="">Todas</option><option value="working">Em atendimento</option><option value="in_transit">Em deslocamento</option><option value="on_break">Em almoço</option><option value="waiting">Aguardando início</option><option value="finished">Jornada finalizada</option></select></label>
          <label class="select-control"><span>Cadastro</span><select id="filter-active"><option value="1">Ativos</option><option value="0">Desativados</option><option value="all">Todos</option></select></label>
          <span class="result-count" id="employee-count"></span>
        </div>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>Colaborador</th><th>Cargo e unidade</th><th>Jornada</th><th>Situação</th><th>Acesso</th><th><span class="sr-only">Ações</span></th></tr></thead>
          <tbody id="employee-rows"><tr><td colspan="6">${R.loading()}</td></tr></tbody></table></div>
      </section>`;

    const rowsElement = root.querySelector("#employee-rows");

    // Desenha as linhas da tabela, aplicando o filtro de situação (feito no navegador).
    function renderRows() {
      const visible = employees.filter(person => !filters.state || person.state === filters.state);
      root.querySelector("#employee-count").textContent = `${visible.length} colaborador(es)`;
      rowsElement.innerHTML = visible.map(person => `<tr${person.active ? "" : ' class="row-inactive"'}>
        <td><a class="person-cell" href="perfil-colaborador.html?id=${encodeURIComponent(person.id)}">${R.avatar(person, "person-avatar")}<span><strong>${esc(person.name)}</strong><small>${person.registration ? `Mat. ${esc(person.registration)} • ` : ""}${esc(person.email)}</small></span></a></td>
        <td><span class="cell-stack"><span>${esc(person.job || "—")}</span><small>${esc(person.unit || "Sem unidade fixa")}</small></span></td>
        <td>${person.schedule ? `<span title="${esc(person.schedule.description)}">${esc(person.schedule.name)}</span>${person.scheduleId ? ' <small class="muted-text">(individual)</small>' : ""}` : '<span class="state-pill warning">Sem jornada</span>'}</td>
        <td>${person.active ? R.statePill(person.state, person.stateLabel) : '<span class="state-pill muted">Desativado</span>'}${person.lastEvent ? `<small class="cell-note">${esc(person.lastEvent.label)} • ${fmt.relative(person.lastEvent.occurredAt)}</small>` : ""}</td>
        <td><span class="cell-stack"><span>${esc(person.roleLabel)}</span><small>${person.mustChangePassword ? "Aguardando primeiro acesso" : person.lastLoginAt ? `Último acesso ${fmt.relative(person.lastLoginAt)}` : "Nunca acessou"}</small></span></td>
        <td class="row-actions">
          <a class="icon-button" href="perfil-colaborador.html?id=${encodeURIComponent(person.id)}" aria-label="Ver perfil de ${esc(person.name)}" title="Ver perfil"><i class="fa-solid fa-id-card"></i></a>
          ${R.has("employees") ? `<button type="button" class="icon-button" data-action="edit" data-id="${esc(person.id)}" aria-label="Editar ${esc(person.name)}" title="Editar"><i class="fa-solid fa-pen-to-square"></i></button>
          <button type="button" class="icon-button" data-action="reset" data-id="${esc(person.id)}" aria-label="Gerar senha temporária para ${esc(person.name)}" title="Gerar senha temporária"><i class="fa-solid fa-key"></i></button>
          <button type="button" class="icon-button ${person.active ? "danger" : ""}" data-action="toggle" data-id="${esc(person.id)}" aria-label="${person.active ? "Desativar" : "Reativar"} ${esc(person.name)}" title="${person.active ? "Desativar cadastro" : "Reativar cadastro"}"><i class="fa-solid ${person.active ? "fa-user-slash" : "fa-user-check"}"></i></button>` : ""}
        </td></tr>`).join("") || `<tr><td colspan="6">${R.emptyState("fa-users", employees.length ? "Nenhum colaborador corresponde aos filtros." : "Nenhum colaborador cadastrado.", "", R.has("employees") && !employees.length ? '<button type="button" class="button-primary" data-action="new"><i class="fa-solid fa-user-plus"></i> Cadastrar o primeiro</button>' : "")}</td></tr>`;
    }

    // Busca os colaboradores no servidor com os filtros de busca, cargo, unidade e cadastro.
    async function load() {
      const params = new URLSearchParams({ active: filters.active });
      if (filters.search) params.set("search", filters.search);
      if (filters.jobId) params.set("jobId", filters.jobId);
      if (filters.unitId) params.set("unitId", filters.unitId);
      try {
        ({ employees } = await api.get(`/api/employees?${params}`));
        renderRows();
      } catch (error) {
        rowsElement.innerHTML = `<tr><td colspan="6" class="empty-state">${esc(error.message)}</td></tr>`;
      }
    }

    // Opções de um <select> a partir de uma lista { id, name }, marcando a selecionada.
    function options(list, selected, empty) {
      return `${empty ? `<option value="">${esc(empty)}</option>` : ""}${list.map(item => `<option value="${esc(item.id)}" ${String(item.id) === String(selected ?? "") ? "selected" : ""}>${esc(item.name)}</option>`).join("")}`;
    }

    // Formulário de cadastro ou edição: dados, foto, cargo, unidade, jornada, perfil de acesso e situação.
    async function openForm(person) {
      const isNew = !person;
      const roleOptions = roles.filter(role => R.user.role === "admin" || role.key === "employee" || role.key === person?.role)
        .map(role => `<option value="${role.key}" ${role.key === (person?.role || "employee") ? "selected" : ""}>${esc(role.label)}</option>`).join("");
      const result = await R.openDialog({
        title: isNew ? "Novo colaborador" : "Editar colaborador",
        subtitle: isNew ? "Uma senha temporária será gerada para o primeiro acesso." : person.email,
        submitLabel: isNew ? "Cadastrar" : "Salvar alterações",
        wide: true,
        body: `<div class="form-grid">
          <div class="photo-field">
            <span class="photo-preview">${person ? R.avatar(person, "avatar large") : '<span class="avatar large"><i class="fa-solid fa-camera"></i></span>'}</span>
            <label class="button-secondary small-button"><i class="fa-solid fa-upload"></i> ${person?.hasPhoto ? "Trocar foto" : "Enviar foto"}<input type="file" name="photo" accept="image/jpeg,image/png,image/webp" hidden></label>
            ${person?.hasPhoto ? '<label class="checkbox-line"><input type="checkbox" name="removePhoto"> Remover foto</label>' : ""}
            <small>Foto de identificação (JPG, PNG ou WEBP, até 5 MB). Use somente com autorização do colaborador (LGPD).</small>
          </div>
          <label class="field"><span>Nome completo *</span><input class="text-control" name="name" required maxlength="160" autocomplete="off" value="${esc(person?.name || "")}"></label>
          <label class="field"><span>Matrícula</span><input class="text-control" name="registration" maxlength="30" autocomplete="off" placeholder="Ex.: 000123 (a matrícula atual da empresa)" value="${esc(person?.registration || "")}"></label>
          <label class="field"><span>E-mail corporativo *</span><input class="text-control" name="email" type="email" required maxlength="190" autocomplete="off" placeholder="nome@${esc(domain)}" value="${esc(person?.email || "")}"></label>
          <label class="field"><span>Telefone</span><input class="text-control" name="phone" type="tel" maxlength="32" value="${esc(person?.phone || "")}"></label>
          <label class="field"><span>Cargo *</span><select class="text-control" name="jobId" required>${options(jobs, person?.jobId, jobs.length ? "Selecione" : "Cadastre um cargo primeiro")}</select></label>
          <label class="field"><span>Unidade de trabalho</span><select class="text-control" name="unitId">${options(units.filter(unit => unit.active || unit.id === person?.unitId), person?.unitId, "Sem unidade fixa")}</select></label>
          <label class="field"><span>Jornada</span><select class="text-control" name="scheduleId">${options(schedules, person?.scheduleId, "Usar a jornada padrão do cargo")}</select></label>
          <label class="field"><span>Salário mensal (R$)</span><input class="text-control" name="salary" inputmode="decimal" maxlength="15" autocomplete="off" placeholder="Ex.: 2.500,00" value="${person?.salary ? esc(person.salary.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })) : ""}"></label>
          <label class="field"><span>Perfil de acesso</span><select class="text-control" name="role">${roleOptions}</select></label>
          ${!isNew ? `<label class="checkbox-line span-2"><input type="checkbox" name="active" ${person.active ? "checked" : ""}> Cadastro ativo (desmarque para bloquear o acesso sem apagar o histórico)</label>` : ""}
          <p class="form-hint span-2"><i class="fa-solid fa-circle-info"></i> Colaborador: usa só o aplicativo. Gestor da Central e Administrador: acessam tudo na Central. Só o Administrador pode dar perfis de Gestor ou Administrador.</p>
        </div>`,
        onOpen: form => {
          const emailInput = form.elements.email;
          const nameInput = form.elements.name;
          // Sugere o e-mail corporativo a partir do nome no cadastro novo.
          if (isNew && domain) {
            nameInput.addEventListener("input", () => {
              if (emailInput.dataset.touched) return;
              const parts = nameInput.value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z\s]/g, "").trim().split(/\s+/).filter(Boolean);
              emailInput.value = parts.length ? `${parts[0]}${parts.length > 1 ? "." + parts[parts.length - 1] : ""}@${domain}` : "";
            });
            emailInput.addEventListener("input", () => { emailInput.dataset.touched = "1"; });
          }
          form.elements.photo.addEventListener("change", () => {
            const file = form.elements.photo.files[0];
            if (!file) return;
            const preview = form.querySelector(".photo-preview");
            preview.innerHTML = `<span class="avatar large"><img alt="Prévia da foto"></span>`;
            preview.querySelector("img").src = URL.createObjectURL(file);
          });
        },
        onSubmit: async (data, form) => {
          const payload = {
            name: data.get("name"), registration: data.get("registration"), email: data.get("email"), phone: data.get("phone"),
            jobId: data.get("jobId"), unitId: data.get("unitId") || null, scheduleId: data.get("scheduleId") || null,
            role: data.get("role") || "employee", active: isNew ? true : form.elements.active.checked,
            salary: data.get("salary").trim() || null // base do "valor ganho" no perfil e no app do técnico
          };
          const response = isNew ? await api.post("/api/employees", payload) : await api.put(`/api/employees/${person.id}`, payload);
          const id = response.employee.id;
          const file = form.elements.photo.files[0];
          if (file) {
            const upload = new FormData();
            upload.append("photo", file);
            await api.upload(`/api/employees/${id}/photo`, upload).catch(error => R.toast(`Cadastro salvo, mas a foto não foi enviada: ${error.message}`, "error"));
          } else if (form.elements.removePhoto?.checked) {
            await api.del(`/api/employees/${id}/photo`);
          }
          return response;
        }
      });
      if (!result) return;
      if (result.temporaryPassword) {
        await R.showTemporaryPassword(result.employee.name, result.employee.email, result.temporaryPassword);
      } else {
        R.toast("Cadastro atualizado.");
      }
      load();
    }

    root.addEventListener("click", async event => {
      const control = event.target.closest("[data-action]");
      if (!control) return;
      const person = employees.find(item => item.id === control.dataset.id);
      const action = control.dataset.action;
      try {
        if (action === "new") openForm();
        if (action === "edit" && person) openForm(person);
        if (action === "reset" && person) {
          if (!(await R.confirm({ title: "Gerar nova senha temporária?", message: `A senha atual de ${person.name} deixará de funcionar. No próximo acesso será obrigatório criar uma senha definitiva.`, confirmLabel: "Gerar senha" }))) return;
          const { temporaryPassword } = await api.post(`/api/employees/${person.id}/reset-password`, {});
          await R.showTemporaryPassword(person.name, person.email, temporaryPassword);
          load();
        }
        if (action === "toggle" && person) {
          const activate = !person.active;
          if (!(await R.confirm({
            title: activate ? "Reativar cadastro?" : "Desativar cadastro?",
            message: activate ? `${person.name} voltará a ter acesso ao aplicativo e à Central conforme o cargo.` : `${person.name} perderá o acesso imediatamente. O histórico de jornada será mantido.`,
            confirmLabel: activate ? "Reativar" : "Desativar", danger: !activate
          }))) return;
          await api.put(`/api/employees/${person.id}`, {
            name: person.name, registration: person.registration, email: person.email, phone: person.phone, jobId: person.jobId, unitId: person.unitId,
            scheduleId: person.scheduleId, role: person.role, active: activate
          });
          R.toast(activate ? "Cadastro reativado." : "Cadastro desativado.");
          load();
        }
      } catch (error) {
        R.toast(error.message, "error");
      }
    });

    const reload = R.debounce(load, 300);
    root.querySelector("#employee-search").addEventListener("input", event => { filters.search = event.target.value.trim(); reload(); });
    root.querySelector("#filter-job").addEventListener("change", event => { filters.jobId = event.target.value; load(); });
    root.querySelector("#filter-unit").addEventListener("change", event => { filters.unitId = event.target.value; load(); });
    root.querySelector("#filter-active").addEventListener("change", event => { filters.active = event.target.value; load(); });
    root.querySelector("#filter-state").addEventListener("change", event => { filters.state = event.target.value; renderRows(); });

    await load();
    if (location.hash === "#novo" && R.has("employees")) {
      history.replaceState(null, "", location.pathname);
      openForm();
    }
  }
};
