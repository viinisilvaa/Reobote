// REOBOTE | central/js/cargos-jornadas.js — Central: cargos e permissões de acesso
// Cargos e permissões: cada cargo define o que seus colaboradores podem acessar e a jornada padrão.
window.ReobotePage = {
  // Monta a página de cargos dentro de "root"; R são os utilitários da Central (app-core.js).
  async mount(root, R) {
    const { esc, api } = R;
    const [{ permissions }, { schedules }] = await Promise.all([api.get("/api/permissions"), api.get("/api/schedules")]);
    let jobs = [];

    root.innerHTML = `${R.heading("jobs", '<a class="button-secondary" href="jornadas.html"><i class="fa-solid fa-calendar-days"></i> Jornadas</a><button type="button" class="button-primary" data-action="new"><i class="fa-solid fa-plus"></i> Novo cargo</button>')}
      <section class="panel content-panel wide-panel">
        <div class="content-panel-heading"><h2><i class="fa-solid fa-briefcase"></i> Cargos cadastrados</h2></div>
        <div class="card-grid" id="job-list">${R.loading()}</div>
      </section>
      <section class="panel content-panel">
        <div class="content-panel-heading"><h2><i class="fa-solid fa-shield-halved"></i> Como as permissões funcionam</h2></div>
        <ul class="plain-list">
          <li><strong>Aplicativo</strong>: permite registrar a própria jornada (QR Code, almoço e encerramento) e consultar o histórico.</li>
          <li>O acesso à <strong>Central</strong> depende do <strong>perfil de acesso</strong> de cada pessoa (em Colaboradores), não do cargo.</li>
          <li>Perfil <strong>Colaborador</strong>: usa somente o aplicativo, qualquer que seja o cargo.</li>
          <li>Perfis <strong>Gestor da Central</strong> e <strong>Administrador</strong>: acessam tudo o que existe na Central, inclusive Configurações. Só o Administrador pode dar ou tirar esses dois perfis.</li>
          <li>Mudanças valem no próximo carregamento de página dos colaboradores do cargo.</li>
        </ul>
      </section>`;

    const list = root.querySelector("#job-list");

    // Desenha os cartões dos cargos com permissões, jornada padrão e quantidade de colaboradores.
    function render() {
      list.innerHTML = jobs.map(job => `<article class="info-card">
        <header><span class="info-card-icon"><i class="fa-solid fa-briefcase"></i></span><div><h3>${esc(job.name)}</h3><p>${esc(job.description || "Sem descrição")}</p></div></header>
        <div class="chip-list">${job.permissions.map(key => `<span class="chip${key === "app" ? " chip-green" : ""}">${esc((permissions.find(p => p.key === key)?.label || key).replace(/^(Central|Aplicativo): /, ""))}</span>`).join("") || '<span class="chip chip-muted">Sem permissões</span>'}</div>
        <dl class="info-card-meta"><div><dt>Jornada padrão</dt><dd>${esc(job.defaultSchedule || "Não definida")}</dd></div><div><dt>Colaboradores ativos</dt><dd>${job.employeeCount}</dd></div></dl>
        <footer>
          <a class="button-secondary small-button" href="colaboradores.html"><i class="fa-solid fa-users"></i> Equipe</a>
          <button type="button" class="button-secondary small-button" data-action="edit" data-id="${esc(job.id)}"><i class="fa-solid fa-pen-to-square"></i> Editar</button>
          <button type="button" class="icon-button danger" data-action="delete" data-id="${esc(job.id)}" aria-label="Excluir cargo ${esc(job.name)}"><i class="fa-solid fa-trash-can"></i></button>
        </footer>
      </article>`).join("") || R.emptyState("fa-briefcase", "Nenhum cargo cadastrado", "Crie o primeiro cargo para cadastrar colaboradores.");
    }

    // Busca os cargos no servidor e redesenha.
    async function load() {
      ({ jobs } = await api.get("/api/jobs"));
      render();
    }

    // Formulário de novo cargo ou de edição (nome, descrição, jornada padrão e permissões).
    async function openForm(job) {
      const saved = await R.openDialog({
        title: job ? "Editar cargo" : "Novo cargo",
        submitLabel: job ? "Salvar alterações" : "Cadastrar cargo",
        wide: true,
        body: `<div class="form-grid">
          <label class="field span-2"><span>Nome do cargo *</span><input class="text-control" name="name" required maxlength="120" placeholder="Ex.: Técnico de campo" value="${esc(job?.name || "")}"></label>
          <label class="field span-2"><span>Descrição</span><textarea class="text-control" name="description" rows="2" maxlength="500" placeholder="Responsabilidades do cargo">${esc(job?.description || "")}</textarea></label>
          <label class="field span-2"><span>Jornada padrão</span><select class="text-control" name="defaultScheduleId"><option value="">Nenhuma</option>${schedules.map(s => `<option value="${esc(s.id)}" ${s.id === job?.defaultScheduleId ? "selected" : ""}>${esc(s.name)} — ${esc(s.description)}</option>`).join("")}</select></label>
          <fieldset class="permission-fieldset span-2"><legend>Permissões de acesso</legend>
            ${permissions.map(p => `<label class="checkbox-line"><input type="checkbox" name="permissions" value="${esc(p.key)}" ${(job ? job.permissions.includes(p.key) : p.key === "app") ? "checked" : ""}> ${esc(p.label)}</label>`).join("")}
          </fieldset>
        </div>`,
        onSubmit: data => {
          const payload = { name: data.get("name"), description: data.get("description"), defaultScheduleId: data.get("defaultScheduleId") || null, permissions: data.getAll("permissions") };
          return job ? api.put(`/api/jobs/${job.id}`, payload) : api.post("/api/jobs", payload);
        }
      });
      if (saved) {
        R.toast(job ? "Cargo atualizado." : "Cargo cadastrado.");
        load();
      }
    }

    root.addEventListener("click", async event => {
      const control = event.target.closest("[data-action]");
      if (!control) return;
      const job = jobs.find(item => item.id === control.dataset.id);
      try {
        if (control.dataset.action === "new") openForm();
        if (control.dataset.action === "edit" && job) openForm(job);
        if (control.dataset.action === "delete" && job) {
          if (!(await R.confirm({ title: "Excluir cargo?", message: `O cargo ${job.name} será removido. Cargos com colaboradores vinculados não podem ser excluídos.`, confirmLabel: "Excluir", danger: true }))) return;
          await api.del(`/api/jobs/${job.id}`);
          R.toast("Cargo excluído.");
          load();
        }
      } catch (error) {
        R.toast(error.message, "error");
      }
    });

    await load();
  }
};
