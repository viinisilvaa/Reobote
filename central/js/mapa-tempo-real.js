// REOBOTE | central/js/mapa-tempo-real.js — Central: mapa em tempo real com OpenStreetMap
// Mapa em tempo real: unidades de atendimento, presença registrada por QR Code e localização autorizada da equipe.
window.ReobotePage = {
  // Monta o mapa dentro de "root"; R são os utilitários da Central (app-core.js).
  async mount(root, R) {
    const { esc, api, fmt } = R;
    const stateColors = { working: "#17b653", in_transit: "#2f7de1", on_break: "#f3b51f", finished: "#8b8799", waiting: "#ef354e" };
    let data = { employees: [], units: [] };
    let selectedId = null;
    let followEmployeeId = null;
    let refreshing = false;
    let search = "";
    let stateFilter = "";
    let map = null;
    const employeeMarkers = new Map();
    const unitMarkers = new Map();

    root.innerHTML = `<section class="map-live-page" aria-label="Mapa em tempo real">
      <div class="map-metrics" id="map-metrics"></div>
      <div class="map-live-grid">
        <section class="map-surface-card map-operation">
          <header class="map-section-heading">
            <h1><i class="fa-solid fa-location-dot"></i> Mapa da Operação</h1>
            <span class="map-sync-status" id="map-sync-status"><i></i> Carregando...</span>
          </header>
          <div class="map map-large map-live-canvas" id="map-canvas"></div>
          <div class="map-legend">${Object.entries({ working: "Em atendimento", in_transit: "Em deslocamento", on_break: "Em almoço", finished: "Finalizada", waiting: "Aguardando" }).map(([state, label]) => `<span><i style="background:${stateColors[state]}"></i>${label}</span>`).join("")}<span><i class="legend-unit"></i>Unidade (nº de técnicos)</span></div>
        </section>
        <div class="map-side-column">
          <section class="map-surface-card map-detail-card"><header class="map-side-heading">Detalhes do colaborador</header><div class="map-detail-content" id="map-detail"></div></section>
          <section class="map-surface-card map-summary-card"><h2><i class="fa-solid fa-hospital"></i> Unidades</h2><div class="map-summary-list" id="map-units"></div></section>
        </div>
      </div>
      <section class="map-surface-card map-team-section">
        <header class="map-section-heading">
          <h2><i class="fa-solid fa-users"></i> Equipe</h2>
          <label class="map-search"><i class="fa-solid fa-magnifying-glass"></i><input id="map-search" type="search" placeholder="Pesquisar por nome..." aria-label="Pesquisar colaboradores"></label>
          <label class="map-status-select"><span class="sr-only">Filtrar por situação</span><select id="map-status-filter"><option value="">Todas as situações</option><option value="working">Em atendimento</option><option value="in_transit">Em deslocamento</option><option value="on_break">Em almoço</option><option value="waiting">Aguardando início</option><option value="finished">Jornada finalizada</option></select><i class="fa-solid fa-chevron-down"></i></label>
        </header>
        <div class="map-team-list" id="map-team"></div>
      </section>
    </section>`;

    // Indica se o colaborador passa pela pesquisa por nome e pelo filtro de situação.
    const visible = person => (!search || person.name.toLowerCase().includes(search)) && (!stateFilter || person.state === stateFilter);

    // Desenha indicadores, lista da equipe, unidades e detalhes do colaborador selecionado.
    function renderSide() {
      // Quantidade de colaboradores em uma situação.
      const count = state => data.employees.filter(person => person.state === state).length;
      const metrics = [
        ["fa-users", data.employees.filter(p => ["working", "in_transit", "on_break"].includes(p.state)).length, "Ativos agora", "purple", `${data.employees.length} na equipe`],
        ["fa-hospital", count("working"), "Em atendimento", "green", "Chegada registrada"],
        ["fa-van-shuttle", count("in_transit"), "Em deslocamento", "violet", "Leitura no veículo"],
        ["fa-utensils", count("on_break"), "Em almoço", "red", "Intervalo em andamento"]
      ];
      root.querySelector("#map-metrics").innerHTML = metrics.map(([icon, value, label, tone, trend]) => `<article class="map-metric map-metric-${tone}">
        <span class="map-metric-icon"><i class="fa-solid ${icon}"></i></span>
        <span class="map-metric-copy"><strong>${value}</strong><span>${label}</span><small>${trend}</small></span>
        <svg viewBox="0 0 220 34" preserveAspectRatio="none" aria-hidden="true"><path d="M0 28 C30 22 37 31 66 21 S105 26 132 14 S169 23 190 10 S205 14 220 4 V34 H0Z"></path></svg></article>`).join("");

      root.querySelector("#map-team").innerHTML = data.employees.filter(visible).map(person => `<button class="map-team-person ${person.id === selectedId ? "selected" : ""}" type="button" data-select="${esc(person.id)}">
        ${R.avatar(person, "map-team-avatar")}
        <span class="map-team-copy"><strong>${esc(person.name)}</strong><small><i class="dot" style="background:${stateColors[person.state]}"></i>${esc(person.stateLabel)}${person.attendanceUnitId ? ' <i class="fa-solid fa-hospital" title="Presença registrada pelo QR Code da unidade"></i>' : person.location ? ' <i class="fa-solid fa-location-dot" title="Localização compartilhada"></i>' : ""}</small></span>
        <i class="fa-solid fa-chevron-right"></i></button>`).join("") || '<p class="map-no-selection">Nenhum colaborador encontrado.</p>';

      root.querySelector("#map-units").innerHTML = data.units.map(unit => {
        const here = data.employees.filter(p => p.attendanceUnitId === unit.id).length;
        return `<div><i class="online" style="background:#5423bd"></i><span>${esc(unit.name)}</span><strong title="Técnicos presentes nesta unidade">${here}</strong></div>`;
      }).join("") || '<p class="map-no-selection">Nenhuma unidade cadastrada.</p>';

      const person = data.employees.find(item => item.id === selectedId);
      root.querySelector("#map-detail").innerHTML = person ? `
        <div class="map-detail-main">${R.avatar(person, "map-detail-avatar")}
          <div><strong>${esc(person.name)}</strong>${R.statePill(person.state, person.stateLabel)}</div></div>
        <div class="map-detail-fields">
          <div><i class="fa-solid fa-briefcase"></i><span><small>Cargo</small><strong>${esc(person.job || "—")}</strong></span></div>
          <div><i class="fa-solid fa-clock"></i><span><small>Último registro</small><strong>${person.lastEvent ? `${esc(person.lastEvent.label)}${person.lastEvent.place ? ` • ${esc(person.lastEvent.place)}` : ""} às ${fmt.time(person.lastEvent.occurredAt)}` : "Nenhum registro recente"}</strong></span></div>
          <div><i class="fa-solid fa-calendar-days"></i><span><small>Jornada</small><strong>${esc(person.schedule?.description || "Sem jornada")}</strong></span></div>
          <div><i class="fa-solid fa-location-crosshairs"></i><span><small>Localização</small><strong>${person.location ? `GPS do celular atualizado ${fmt.relative(person.location.recordedAt)}${person.distanceToUnitM !== null ? ` • a ${person.distanceToUnitM < 1000 ? person.distanceToUnitM + " m" : (person.distanceToUnitM / 1000).toFixed(1) + " km"} de ${esc(person.referenceUnit)}` : ""}` : "Sem GPS do celular nos últimos 10 minutos"}${person.attendanceUnitId ? ` • QR Code lido em ${esc(data.units.find(unit => unit.id === person.attendanceUnitId)?.name || "unidade")}` : ""}</strong></span></div>
        </div>
        <div class="map-detail-actions"><button type="button" class="map-follow-toggle" data-follow="${esc(person.id)}" aria-pressed="${followEmployeeId === person.id}" ${person.location ? "" : "disabled"}><i class="fa-solid ${followEmployeeId === person.id ? "fa-location-crosshairs" : "fa-crosshairs"}"></i> ${followEmployeeId === person.id ? "Seguindo" : "Seguir técnico"}</button><a href="perfil-colaborador.html?id=${encodeURIComponent(person.id)}"><i class="fa-solid fa-id-card"></i> Ver perfil</a>${person.phone ? `<a href="tel:${esc(person.phone.replace(/[^\d+]/g, ""))}"><i class="fa-solid fa-phone"></i> ${esc(person.phone)}</a>` : ""}</div>`
        : '<p class="map-no-selection">Selecione um colaborador na lista ou no mapa.</p>';
    }

    // Texto "Atualizado às..." ou aviso de falta de conexão no topo do mapa.
    function setStatus(message, failed = false) {
      const status = root.querySelector("#map-sync-status");
      status.classList.toggle("error", failed);
      status.innerHTML = `<i></i> ${esc(message)}`;
    }

    // Mensagem no lugar do mapa (ex.: biblioteca de mapa não carregou).
    function notice(title, text, isError = false) {
      root.querySelector("#map-canvas").innerHTML = `<div class="map-config-notice${isError ? " error" : ""}"><i class="fa-solid ${isError ? "fa-triangle-exclamation" : "fa-map-location-dot"}"></i><strong>${esc(title)}</strong><span>${esc(text)}</span></div>`;
    }

    // Conteúdo do balão que abre ao tocar num marcador.
    function popup(title, subtitle) {
      return `<div class="map-info"><strong>${esc(title)}</strong><span>${esc(subtitle)}</span></div>`;
    }

    // Ícone da unidade: hospital roxo com o número de técnicos que leram o QR Code dela.
    // As FOTOS ficam só nos alfinetes de GPS, para o mapa mostrar onde cada celular realmente está.
    function unitIcon(technicians) {
      return L.divIcon({
        className: "map-unit-marker",
        html: `<span class="map-unit-pin"><i class="fa-solid fa-hospital"></i>${technicians.length ? `<b>${technicians.length}</b>` : ""}</span>`,
        iconSize: [36, 36],
        iconAnchor: [18, 18]
      });
    }

    // Etiqueta fixa embaixo da unidade com os nomes de quem leu o QR Code dela (ex.: "QR: Carlos, Juliana +2").
    // Sem ninguém presente, a etiqueta some. Não há limite de técnicos por unidade.
    function unitLabel(marker, technicians) {
      marker.unbindTooltip();
      if (!technicians.length) return;
      const names = technicians.length === 1
        ? technicians[0].name
        : technicians.slice(0, 2).map(person => person.name.split(" ")[0]).join(", ") + (technicians.length > 2 ? ` +${technicians.length - 2}` : "");
      marker.bindTooltip(`<i class="fa-solid fa-qrcode"></i> ${esc(names)}`, { permanent: true, direction: "bottom", offset: [0, 18], className: "map-unit-label" });
    }

    // Balão da unidade: endereço e lista completa dos técnicos presentes.
    function unitPopup(unit, technicians) {
      const location = `${unit.kind}${unit.address ? ` • ${unit.address}` : ""}`;
      const list = technicians.length
        ? `<div class="map-unit-attendees"><strong>${technicians.length} técnico${technicians.length === 1 ? "" : "s"} presente${technicians.length === 1 ? "" : "s"}</strong><ul>${technicians.map(person => `<li>${R.avatar(person, "map-attendee-avatar")}<span>${esc(person.name)}<small>${esc(person.stateLabel)}</small></span></li>`).join("")}</ul></div>`
        : '<span>Nenhum técnico com presença registrada agora.</span>';
      return `<div class="map-info map-unit-info"><strong>${esc(unit.name)}</strong><span>${esc(location)}</span>${list}</div>`;
    }

    // Ícone do técnico fora da unidade (em deslocamento): foto com o alfinete na cor da situação.
    function technicianIcon(person) {
      const color = stateColors[person.state] || "#8b8799";
      return L.divIcon({
        className: "map-technician-marker",
        // Alfinete com a foto do técnico; a ponta (embaixo) marca a posição exata do GPS.
        html: `<span class="map-technician-pin" style="--marker-color:${color}">${R.avatar(person, "map-technician-avatar")}</span><span class="map-technician-name">${esc(person.name.split(" ")[0])}</span>`,
        iconSize: [52, 74],
        iconAnchor: [26, 60],
        popupAnchor: [0, -56]
      });
    }

    // Balão do técnico: nome, situação e quando o GPS foi atualizado.
    function technicianPopup(person) {
      const updated = person.location ? `GPS atualizado ${fmt.relative(person.location.recordedAt)}` : "GPS indisponível";
      return `<div class="map-info"><strong>${esc(person.name)}</strong><span>${esc(person.stateLabel)} • ${esc(updated)}</span></div>`;
    }

    // Posição do técnico no mapa: SOMENTE o GPS do celular (nunca a posição do QR Code).
    function personPosition(person) {
      return person.location ? [person.location.latitude, person.location.longitude] : null;
    }

    // Cria/atualiza unidades (ícone com a quantidade presente + raio) e localização recente da equipe.
    function updateMarkers() {
      if (!map) return;
      const bounds = [];
      data.units.filter(unit => unit.latitude !== null && unit.longitude !== null).forEach(unit => {
        const position = [unit.latitude, unit.longitude];
        const technicians = data.employees.filter(person => person.attendanceUnitId === unit.id);
        const attendeeKey = technicians.map(person => `${person.id}:${person.state}:${person.photoVersion || ""}`).join("|");
        if (!unitMarkers.has(unit.id)) {
          // Raio de chegada da unidade (área considerada "no local").
          L.circle(position, { radius: unit.radiusM, color: "#5423bd", opacity: 0.4, weight: 1, fillColor: "#5423bd", fillOpacity: 0.06, interactive: false }).addTo(map);
          const marker = L.marker(position, { icon: unitIcon(technicians), title: unit.name, zIndexOffset: 200 }).addTo(map);
          marker.bindPopup(unitPopup(unit, technicians));
          unitLabel(marker, technicians);
          marker.attendeeKey = attendeeKey;
          unitMarkers.set(unit.id, marker);
        } else {
          const marker = unitMarkers.get(unit.id);
          marker.setLatLng(position);
          if (marker.attendeeKey !== attendeeKey) {
            marker.setIcon(unitIcon(technicians));
            marker.setPopupContent(unitPopup(unit, technicians));
            unitLabel(marker, technicians);
            marker.attendeeKey = attendeeKey;
          }
        }
        bounds.push(position);
      });
      const withLocation = new Set();
      data.employees.forEach(person => {
        if (!person.location) return;
        withLocation.add(person.id);
        const position = [person.location.latitude, person.location.longitude];
        let marker = employeeMarkers.get(person.id);
        if (!marker) {
          marker = L.marker(position, { icon: technicianIcon(person), title: person.name, zIndexOffset: 500 }).addTo(map);
          marker.on("click", () => select(person.id, true));
          employeeMarkers.set(person.id, marker);
        } else if (marker.personStyleKey !== `${person.state}:${person.photoVersion || ""}`) {
          marker.setIcon(technicianIcon(person));
        }
        marker.personStyleKey = `${person.state}:${person.photoVersion || ""}`;
        marker.setLatLng(position);
        if (marker.getPopup()) marker.setPopupContent(technicianPopup(person));
        else marker.bindPopup(technicianPopup(person));
        // Respeita a pesquisa e o filtro: esconde o marcador de quem não passa neles.
        // O alfinete com a foto fica sempre no GPS do celular, mesmo se o técnico leu o QR Code de uma unidade.
        if (visible(person)) marker.addTo(map); else marker.remove();
        bounds.push(position);
      });
      // Remove marcadores de quem deixou de compartilhar a localização.
      employeeMarkers.forEach((marker, id) => {
        if (!withLocation.has(id)) {
          marker.remove();
          employeeMarkers.delete(id);
        }
      });
      // Na primeira vez, enquadra todos os pontos na tela.
      if (!map.reoboteFitted && bounds.length) {
        if (bounds.length === 1) map.setView(bounds[0], 15);
        else map.fitBounds(bounds, { padding: [40, 40] });
        map.reoboteFitted = true;
      }
      if (followEmployeeId) {
        const followed = data.employees.find(person => person.id === followEmployeeId);
        const position = followed ? personPosition(followed) : null;
        if (position && map.distance(map.getCenter(), position) > 15) {
          map.panTo(position, { animate: true, duration: 1 });
        }
      }
    }

    // Seleciona um colaborador: mostra os detalhes e centraliza o mapa nele.
    function select(id, fromMap = false) {
      selectedId = id;
      renderSide();
      const person = data.employees.find(item => item.id === id);
      const marker = employeeMarkers.get(id);
      if (map && person?.location && !fromMap) map.panTo([person.location.latitude, person.location.longitude]);
      if (marker) marker.openPopup();
    }

    // Busca a situação da equipe no servidor (a cada 5 segundos).
    async function refresh() {
      if (refreshing) return;
      refreshing = true;
      try {
        data = await api.get("/api/map");
        if (!selectedId || !data.employees.some(person => person.id === selectedId)) selectedId = data.employees[0]?.id || null;
        renderSide();
        updateMarkers();
        setStatus(`Atualizado às ${fmt.time(data.serverTime)}`);
      } catch (error) {
        setStatus("Sem conexão; exibindo a última atualização", true);
      } finally {
        refreshing = false;
      }
    }

    root.addEventListener("click", event => {
      const followButton = event.target.closest("[data-follow]");
      if (followButton) {
        followEmployeeId = followEmployeeId === followButton.dataset.follow ? null : followButton.dataset.follow;
        renderSide();
        const person = data.employees.find(item => item.id === followEmployeeId);
        const position = person ? personPosition(person) : null;
        if (position && map) map.panTo(position);
        return;
      }
      const button = event.target.closest("[data-select]");
      if (button) select(button.dataset.select);
    });
    root.querySelector("#map-search").addEventListener("input", event => { search = event.target.value.trim().toLowerCase(); renderSide(); updateMarkers(); });
    root.querySelector("#map-status-filter").addEventListener("change", event => { stateFilter = event.target.value; renderSide(); updateMarkers(); });

    await refresh();
    setInterval(refresh, 5000);

    // Mapa OpenStreetMap com a biblioteca Leaflet (js/vendor/leaflet): gratuito e sem chave.
    if (typeof window.L === "undefined") {
      notice("Mapa indisponível", "A biblioteca do mapa não carregou. Recarregue a página.", true);
      return;
    }
    const canvas = root.querySelector("#map-canvas");
    canvas.innerHTML = "";
    // Começa no Rio de Janeiro; depois se ajusta às unidades e técnicos cadastrados.
    map = L.map(canvas, { zoomControl: true }).setView([-22.9068, -43.1729], 11);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
    }).addTo(map);
    updateMarkers();
    if (!data.units.some(unit => unit.latitude !== null) && !data.employees.some(person => person.location)) {
      R.toast("Cadastre a localização das unidades. Os técnicos aparecem no mapa durante a jornada, com o aplicativo aberto e o GPS do celular permitido.");
    }
  }
};
