// Unidades de atendimento e QR Codes de veículos e unidades usados pelo aplicativo para registrar chegadas.
window.ReobotePage = {
  // Monta a página de unidades e QR Codes dentro de "root"; R são os utilitários da Central (app-core.js).
  async mount(root, R) {
    const { esc, api, fmt } = R;
    let units = [];
    let codes = [];

    root.innerHTML = `${R.heading("units", '<button type="button" class="button-secondary" data-action="new-vehicle"><i class="fa-solid fa-van-shuttle"></i> QR de veículo</button><button type="button" class="button-primary" data-action="new-unit"><i class="fa-solid fa-plus"></i> Nova unidade</button>')}
      <section class="panel content-panel wide-panel">
        <div class="content-panel-heading"><h2><i class="fa-solid fa-hospital"></i> Unidades de atendimento</h2></div>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>Unidade</th><th>Endereço</th><th>Localização</th><th>Raio de chegada</th><th>Equipe</th><th>Situação</th><th><span class="sr-only">Ações</span></th></tr></thead>
          <tbody id="unit-rows"><tr><td colspan="7">${R.loading()}</td></tr></tbody></table></div>
      </section>
      <section class="panel content-panel wide-panel">
        <div class="content-panel-heading"><h2><i class="fa-solid fa-qrcode"></i> QR Codes</h2>
          <span class="heading-spacer"></span>
          <button type="button" class="button-secondary small-button" data-action="print-all"><i class="fa-solid fa-print"></i> Imprimir todos os ativos</button></div>
        <p class="panel-description">Cole o QR Code do veículo no painel do carro e o da unidade na recepção ou entrada técnica. A leitura confirma o código e o ponto de registro; a localização por GPS só é enviada com autorização do colaborador. Se uma etiqueta for copiada ou danificada, use “Substituir” para invalidar a antiga.</p>
        <div class="qr-grid" id="qr-grid">${R.loading()}</div>
      </section>
      <div id="print-area" class="print-area" aria-hidden="true"></div>`;

    // Gera a imagem do QR Code (biblioteca qrcode-generator). cellSize define o tamanho de cada quadradinho.
    function qrImage(payload, cellSize = 6) {
      if (typeof window.qrcode !== "function") return '<span class="qr-missing">Gerador de QR Code indisponível</span>';
      const qr = window.qrcode(0, "M");
      qr.addData(payload);
      qr.make();
      return `<img class="qr-image" src="${qr.createDataURL(cellSize, cellSize * 2)}" alt="QR Code">`;
    }

    // Desenha a tabela de unidades e os cartões de QR Code.
    function render() {
      root.querySelector("#unit-rows").innerHTML = units.map(unit => `<tr${unit.active ? "" : ' class="row-inactive"'}>
        <td><strong>${esc(unit.name)}</strong><small class="cell-note">${esc(unit.kind)}</small></td>
        <td>${esc(unit.address || "—")}</td>
        <td>${unit.latitude !== null ? `<a href="https://www.google.com/maps?q=${unit.latitude},${unit.longitude}" target="_blank" rel="noopener noreferrer">${unit.latitude.toFixed(5)}, ${unit.longitude.toFixed(5)}</a>` : '<span class="muted-text">Não informada</span>'}</td>
        <td>${unit.radiusM} m</td>
        <td>${unit.employeeCount} colab. • ${unit.qrCount} QR</td>
        <td>${unit.active ? '<span class="state-pill success">Ativa</span>' : '<span class="state-pill muted">Desativada</span>'}</td>
        <td class="row-actions">
          <button type="button" class="icon-button" data-action="edit-unit" data-id="${esc(unit.id)}" aria-label="Editar ${esc(unit.name)}"><i class="fa-solid fa-pen-to-square"></i></button>
          <button type="button" class="icon-button" data-action="new-unit-qr" data-id="${esc(unit.id)}" aria-label="Novo QR Code para ${esc(unit.name)}" title="Novo QR Code (ex.: outra entrada)"><i class="fa-solid fa-qrcode"></i></button>
          <button type="button" class="icon-button danger" data-action="delete-unit" data-id="${esc(unit.id)}" aria-label="Excluir ${esc(unit.name)}"><i class="fa-solid fa-trash-can"></i></button>
        </td></tr>`).join("") || `<tr><td colspan="7">${R.emptyState("fa-hospital", "Nenhuma unidade cadastrada", "Cadastre os hospitais e locais de atendimento. Cada unidade recebe um QR Code automaticamente.")}</td></tr>`;

      root.querySelector("#qr-grid").innerHTML = codes.map(code => `<article class="qr-card${code.active ? "" : " inactive"}">
        <div class="qr-card-image">${code.active ? qrImage(code.payload, 4) : '<i class="fa-solid fa-ban"></i>'}</div>
        <div class="qr-card-copy">
          <span class="chip ${code.kind === "unit" ? "chip-green" : ""}"><i class="fa-solid ${code.kind === "unit" ? "fa-hospital" : "fa-van-shuttle"}"></i> ${esc(code.kindLabel)}</span>
          <strong>${esc(code.label)}</strong>
          <small>${code.unit ? esc(code.unit) + " • " : ""}${code.lastUsedAt ? `Última leitura ${fmt.relative(code.lastUsedAt)}` : "Ainda não utilizado"}</small>
        </div>
        <footer>
          ${code.active ? `<button type="button" class="button-secondary small-button" data-action="print" data-id="${esc(code.id)}"><i class="fa-solid fa-print"></i> Imprimir</button>` : ""}
          <button type="button" class="button-secondary small-button" data-action="rename" data-id="${esc(code.id)}"><i class="fa-solid fa-pen"></i></button>
          ${code.active ? `<button type="button" class="button-secondary small-button" data-action="regenerate" data-id="${esc(code.id)}" title="Gerar novo código e invalidar o anterior"><i class="fa-solid fa-rotate"></i> Substituir</button>` : ""}
          <button type="button" class="icon-button ${code.active ? "danger" : ""}" data-action="toggle-qr" data-id="${esc(code.id)}" aria-label="${code.active ? "Desativar" : "Reativar"} QR Code"><i class="fa-solid ${code.active ? "fa-ban" : "fa-rotate-left"}"></i></button>
        </footer>
      </article>`).join("") || R.emptyState("fa-qrcode", "Nenhum QR Code gerado", "Cadastre unidades ou gere QR Codes para os veículos da empresa.");
    }

    // Busca unidades e QR Codes no servidor.
    async function load() {
      const [unitData, codeData] = await Promise.all([api.get("/api/units"), api.get("/api/qr-codes")]);
      units = unitData.units;
      codes = codeData.qrCodes;
      render();
    }

    // Etiquetas para impressão: QR Code grande, identificação e instruções de uso.
    function print(list) {
      const area = root.querySelector("#print-area");
      area.innerHTML = list.map(code => `<section class="qr-label">
        <header><img src="../compartilhado/assets/reobote-mark.png" alt=""><div><strong>REOBOTE</strong><small>Tecnologia que conecta.</small></div></header>
        ${qrImage(code.payload, 10)}
        <h2>${esc(code.label)}</h2>
        <p>${code.kind === "unit" ? "Registro de chegada à unidade" : "Registro de chegada ao veículo"}</p>
        <small>Abra o aplicativo REOBOTE, toque em “Registrar presença” e aponte a câmera para este código.</small>
      </section>`).join("");
      document.body.classList.add("printing-labels");
      // Depois da impressão, volta a página ao normal.
      const done = () => {
        document.body.classList.remove("printing-labels");
        window.removeEventListener("afterprint", done);
      };
      window.addEventListener("afterprint", done);
      setTimeout(() => window.print(), 50);
    }

    // Formulário de unidade (nova ou edição), com opção de usar a localização atual.
    function unitForm(unit) {
      return R.openDialog({
        title: unit ? "Editar unidade" : "Nova unidade",
        subtitle: unit ? "" : "Um QR Code de chegada será criado automaticamente.",
        submitLabel: unit ? "Salvar alterações" : "Cadastrar unidade",
        wide: true,
        body: `<div class="form-grid">
          <label class="field span-2"><span>Nome *</span><input class="text-control" name="name" required maxlength="160" value="${esc(unit?.name || "")}" placeholder="Ex.: Hospital Central — Bloco A"></label>
          <label class="field"><span>Tipo</span><input class="text-control" name="kind" maxlength="40" list="unit-kinds" value="${esc(unit?.kind || "Unidade hospitalar")}">
            <datalist id="unit-kinds"><option>Unidade hospitalar</option><option>Clínica</option><option>Base operacional</option><option>Cliente</option><option>Almoxarifado</option></datalist></label>
          <label class="field"><span>Raio de chegada (m)</span><input class="text-control" type="number" name="radiusM" min="30" max="5000" value="${unit?.radiusM ?? 300}"></label>
          <label class="field span-2"><span>Endereço</span><input class="text-control" name="address" maxlength="300" value="${esc(unit?.address || "")}"></label>
          <label class="field"><span>Latitude</span><input class="text-control" name="latitude" inputmode="decimal" value="${unit?.latitude ?? ""}" placeholder="-22.9068"></label>
          <label class="field"><span>Longitude</span><input class="text-control" name="longitude" inputmode="decimal" value="${unit?.longitude ?? ""}" placeholder="-43.1729"></label>
          <button type="button" class="button-secondary small-button span-2" data-use-location><i class="fa-solid fa-location-crosshairs"></i> Usar minha localização atual (estando na unidade)</button>
          ${unit ? `<label class="checkbox-line span-2"><input type="checkbox" name="active" ${unit.active ? "checked" : ""}> Unidade ativa (desativar bloqueia os QR Codes dela)</label>` : ""}
          <p class="form-hint span-2"><i class="fa-solid fa-circle-info"></i> Com a localização, o mapa mostra a unidade e a Central é avisada quando uma chegada é registrada fora do raio.</p>
        </div>`,
        onOpen: form => form.querySelector("[data-use-location]").addEventListener("click", () => {
          if (!navigator.geolocation) return R.toast("Este navegador não oferece localização.", "error");
          navigator.geolocation.getCurrentPosition(position => {
            form.elements.latitude.value = position.coords.latitude.toFixed(7);
            form.elements.longitude.value = position.coords.longitude.toFixed(7);
          }, () => R.toast("Não foi possível obter a localização.", "error"), { enableHighAccuracy: true, timeout: 15000 });
        }),
        onSubmit: (data, form) => {
          const payload = {
            name: data.get("name"), kind: data.get("kind"), address: data.get("address"), radiusM: Number(data.get("radiusM")),
            latitude: String(data.get("latitude")).replace(",", ".").trim(), longitude: String(data.get("longitude")).replace(",", ".").trim(),
            active: unit ? form.elements.active.checked : true
          };
          return unit ? api.put(`/api/units/${unit.id}`, payload) : api.post("/api/units", payload);
        }
      });
    }

    // Formulário de novo QR Code de veículo ou de unidade.
    function qrForm(kind, unitId) {
      return R.openDialog({
        title: kind === "vehicle" ? "QR Code de veículo" : "Novo QR Code da unidade",
        submitLabel: "Gerar QR Code",
        body: kind === "vehicle"
          ? `<label class="field"><span>Identificação do veículo *</span><input class="text-control" name="label" required maxlength="160" placeholder="Ex.: Fiorino — placa ABC1D23"></label>`
          : `<label class="field"><span>Unidade</span><select class="text-control" name="unitId">${units.filter(u => u.active).map(u => `<option value="${esc(u.id)}" ${u.id === unitId ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select></label>
             <label class="field"><span>Descrição *</span><input class="text-control" name="label" required maxlength="160" placeholder="Ex.: Entrada técnica"></label>`,
        onSubmit: data => api.post("/api/qr-codes", { kind, label: data.get("label"), unitId: data.get("unitId") || null })
      });
    }

    root.addEventListener("click", async event => {
      const control = event.target.closest("[data-action]");
      if (!control) return;
      const unit = units.find(item => item.id === control.dataset.id);
      const code = codes.find(item => item.id === control.dataset.id);
      const action = control.dataset.action;
      try {
        if (action === "new-unit" && await unitForm()) { R.toast("Unidade cadastrada com QR Code."); load(); }
        if (action === "edit-unit" && unit && await unitForm(unit)) { R.toast("Unidade atualizada."); load(); }
        if (action === "delete-unit" && unit) {
          if (!(await R.confirm({ title: "Excluir unidade?", message: `${unit.name} e seus QR Codes serão removidos. Unidades com registros devem ser desativadas, não excluídas.`, confirmLabel: "Excluir", danger: true }))) return;
          await api.del(`/api/units/${unit.id}`);
          R.toast("Unidade excluída.");
          load();
        }
        if (action === "new-vehicle" && await qrForm("vehicle")) { R.toast("QR Code do veículo gerado."); load(); }
        if (action === "new-unit-qr" && await qrForm("unit", control.dataset.id)) { R.toast("QR Code gerado."); load(); }
        if (action === "print" && code) print([code]);
        if (action === "print-all") {
          const active = codes.filter(item => item.active);
          if (!active.length) return R.toast("Não há QR Codes ativos para imprimir.");
          print(active);
        }
        if (action === "rename" && code) {
          const saved = await R.openDialog({
            title: "Renomear QR Code", submitLabel: "Salvar",
            body: `<label class="field"><span>Descrição *</span><input class="text-control" name="label" required maxlength="160" value="${esc(code.label)}"></label>`,
            onSubmit: data => api.put(`/api/qr-codes/${code.id}`, { label: data.get("label") })
          });
          if (saved) load();
        }
        if (action === "regenerate" && code) {
          if (!(await R.confirm({ title: "Substituir QR Code?", message: `O código atual de “${code.label}” deixará de funcionar imediatamente. Imprima e cole a nova etiqueta no local.`, confirmLabel: "Substituir" }))) return;
          await api.post(`/api/qr-codes/${code.id}/regenerate`, {});
          R.toast("Novo QR Code gerado. Imprima a nova etiqueta.");
          load();
        }
        if (action === "toggle-qr" && code) {
          await api.put(`/api/qr-codes/${code.id}`, { active: !code.active });
          R.toast(code.active ? "QR Code desativado." : "QR Code reativado.");
          load();
        }
      } catch (error) {
        R.toast(error.message, "error");
      }
    });

    await load();
  }
};
