// Mapa em tempo real: unidades de atendimento, situação da equipe e localização autorizada pelos colaboradores.
window.ReobotePage = {
  // Monta o mapa dentro de "root"; R são os utilitários da Central (app-core.js).
  async mount(root, R) {
    const { esc, api, fmt } = R;
    const stateColors = { working: "#17b653", in_transit: "#2f7de1", on_break: "#f3b51f", finished: "#8b8799", waiting: "#ef354e" };
    let data = { employees: [], units: [] };
    let selectedId = null;
    let search = "";
    let stateFilter = "";
    let google = null;
    let map = null;
    let info = null;
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
          <div class="map-legend">${Object.entries({ working: "Em atendimento", in_transit: "Em deslocamento", on_break: "Em almoço", finished: "Finalizada", waiting: "Aguardando" }).map(([state, label]) => `<span><i style="background:${stateColors[state]}"></i>${label}</span>`).join("")}<span><i class="legend-unit"></i>Unidade</span></div>
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
        <span class="map-team-copy"><strong>${esc(person.name)}</strong><small><i class="dot" style="background:${stateColors[person.state]}"></i>${esc(person.stateLabel)}${person.location ? ' <i class="fa-solid fa-location-dot" title="Localização compartilhada"></i>' : ""}</small></span>
        <i class="fa-solid fa-chevron-right"></i></button>`).join("") || '<p class="map-no-selection">Nenhum colaborador encontrado.</p>';

      root.querySelector("#map-units").innerHTML = data.units.map(unit => {
        const here = data.employees.filter(p => p.lastEvent?.unitId === unit.id && p.state === "working").length;
        return `<div><i class="online" style="background:#5423bd"></i><span>${esc(unit.name)}</span><strong title="Colaboradores em atendimento nesta unidade">${here}</strong></div>`;
      }).join("") || '<p class="map-no-selection">Nenhuma unidade cadastrada.</p>';

      const person = data.employees.find(item => item.id === selectedId);
      root.querySelector("#map-detail").innerHTML = person ? `
        <div class="map-detail-main">${R.avatar(person, "map-detail-avatar")}
          <div><strong>${esc(person.name)}</strong>${R.statePill(person.state, person.stateLabel)}</div></div>
        <div class="map-detail-fields">
          <div><i class="fa-solid fa-briefcase"></i><span><small>Cargo</small><strong>${esc(person.job || "—")}</strong></span></div>
          <div><i class="fa-solid fa-clock"></i><span><small>Último registro</small><strong>${person.lastEvent ? `${esc(person.lastEvent.label)}${person.lastEvent.place ? ` • ${esc(person.lastEvent.place)}` : ""} às ${fmt.time(person.lastEvent.occurredAt)}` : "Nenhum registro recente"}</strong></span></div>
          <div><i class="fa-solid fa-calendar-days"></i><span><small>Jornada</small><strong>${esc(person.schedule?.description || "Sem jornada")}</strong></span></div>
          <div><i class="fa-solid fa-location-crosshairs"></i><span><small>Localização</small><strong>${person.location ? `Atualizada ${fmt.relative(person.location.recordedAt)}${person.distanceToUnitM !== null ? ` • ${person.distanceToUnitM < 1000 ? person.distanceToUnitM + " m" : (person.distanceToUnitM / 1000).toFixed(1) + " km"} de ${esc(person.referenceUnit)}` : ""}` : "Não compartilhada no momento"}</strong></span></div>
        </div>
        <div class="map-detail-actions"><a href="perfil-colaborador.html?id=${encodeURIComponent(person.id)}"><i class="fa-solid fa-id-card"></i> Ver perfil</a>${person.phone ? `<a href="tel:${esc(person.phone.replace(/[^\d+]/g, ""))}"><i class="fa-solid fa-phone"></i> ${esc(person.phone)}</a>` : ""}</div>`
        : '<p class="map-no-selection">Selecione um colaborador na lista ou no mapa.</p>';
    }

    // Texto "Atualizado às..." ou aviso de falta de conexão no topo do mapa.
    function setStatus(message, failed = false) {
      const status = root.querySelector("#map-sync-status");
      status.classList.toggle("error", failed);
      status.innerHTML = `<i></i> ${esc(message)}`;
    }

    // Mensagem no lugar do mapa (ex.: chave do Google Maps não configurada).
    function notice(title, text, isError = false) {
      root.querySelector("#map-canvas").innerHTML = `<div class="map-config-notice${isError ? " error" : ""}"><i class="fa-solid ${isError ? "fa-triangle-exclamation" : "fa-map-location-dot"}"></i><strong>${esc(title)}</strong><span>${esc(text)}</span></div>`;
    }

    // Marcador do mapa: círculo colorido pela situação (colaborador) ou quadrado roxo (unidade).
    function markerIcon(color, unit = false) {
      return unit
        ? { path: "M -8 -8 L 8 -8 L 8 8 L -8 8 Z", scale: 1, fillColor: "#5423bd", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2 }
        : { path: google.maps.SymbolPath.CIRCLE, scale: 9, fillColor: color, fillOpacity: 1, strokeColor: "#fff", strokeWeight: 3 };
    }

    // Cria/atualiza os marcadores das unidades (com o raio de chegada) e dos colaboradores com localização recente.
    function updateMarkers() {
      if (!map) return;
      const bounds = new google.maps.LatLngBounds();
      let points = 0;
      data.units.filter(unit => unit.latitude !== null).forEach(unit => {
        const position = { lat: unit.latitude, lng: unit.longitude };
        let marker = unitMarkers.get(unit.id);
        if (!marker) {
          marker = new google.maps.Marker({ map, position, title: unit.name, icon: markerIcon(null, true), zIndex: 1 });
          marker.addListener("click", () => {
            const content = document.createElement("div");
            content.className = "google-map-info";
            content.innerHTML = `<strong>${esc(unit.name)}</strong><span>${esc(unit.kind)}${unit.address ? ` • ${esc(unit.address)}` : ""}</span>`;
            info.setContent(content);
            info.open({ map, anchor: marker });
          });
          new google.maps.Circle({ map, center: position, radius: unit.radiusM, strokeColor: "#5423bd", strokeOpacity: 0.4, strokeWeight: 1, fillColor: "#5423bd", fillOpacity: 0.06, clickable: false });
          unitMarkers.set(unit.id, marker);
        }
        bounds.extend(position);
        points++;
      });
      const withLocation = new Set();
      data.employees.forEach(person => {
        if (!person.location) return;
        withLocation.add(person.id);
        const position = { lat: person.location.latitude, lng: person.location.longitude };
        let marker = employeeMarkers.get(person.id);
        if (!marker) {
          marker = new google.maps.Marker({ map, position, zIndex: 2 });
          marker.addListener("click", () => select(person.id, true));
          employeeMarkers.set(person.id, marker);
        }
        marker.setPosition(position);
        marker.setTitle(`${person.name} — ${person.stateLabel}`);
        marker.setIcon(markerIcon(stateColors[person.state]));
        marker.setVisible(visible(person));
        bounds.extend(position);
        points++;
      });
      employeeMarkers.forEach((marker, id) => {
        if (!withLocation.has(id)) {
          marker.setMap(null);
          employeeMarkers.delete(id);
        }
      });
      if (!map.reoboteFitted && points) {
        if (points === 1) {
          map.setCenter(bounds.getCenter());
          map.setZoom(14);
        } else {
          map.fitBounds(bounds, 40);
        }
        map.reoboteFitted = true;
      }
    }

    // Seleciona um colaborador: mostra os detalhes e centraliza o mapa nele.
    function select(id, fromMap = false) {
      selectedId = id;
      renderSide();
      const person = data.employees.find(item => item.id === id);
      if (map && person?.location && !fromMap) map.panTo({ lat: person.location.latitude, lng: person.location.longitude });
      if (map && person?.location) {
        const content = document.createElement("div");
        content.className = "google-map-info";
        content.innerHTML = `<strong>${esc(person.name)}</strong><span>${esc(person.stateLabel)}</span>`;
        info.setContent(content);
        info.open({ map, anchor: employeeMarkers.get(id) });
      }
    }

    // Carrega o Google Maps uma única vez com a chave configurada no servidor.
    function loadGoogleMaps(key) {
      // O Google chama esta função quando recusa a chave (inválida, sem faturamento ou site não autorizado).
      // Trocamos a tela genérica "Ops! Algo deu errado" por instruções em português.
      window.gm_authFailure = () => notice("Chave do Google Maps recusada",
        "O Google recusou a chave configurada. Confira no Google Cloud: 1) a Maps JavaScript API está ativada; 2) o faturamento do projeto está ativo; 3) o endereço deste site está liberado nas restrições da chave.", true);
      if (window.google?.maps) return Promise.resolve(window.google);
      return new Promise((resolve, reject) => {
        window.reoboteGoogleMapsReady = () => resolve(window.google);
        const script = document.createElement("script");
        script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&callback=reoboteGoogleMapsReady&loading=async`;
        script.async = true;
        script.onerror = () => reject(new Error("O Google Maps não carregou. Verifique a chave, o faturamento e as APIs ativadas."));
        document.head.append(script);
      });
    }

    // Busca a situação da equipe no servidor (a cada 15 segundos).
    async function refresh() {
      try {
        data = await api.get("/api/map");
        if (!selectedId || !data.employees.some(person => person.id === selectedId)) selectedId = data.employees[0]?.id || null;
        renderSide();
        updateMarkers();
        setStatus(`Atualizado às ${fmt.time(data.serverTime)}`);
      } catch (error) {
        setStatus("Sem conexão; exibindo a última atualização", true);
      }
    }

    root.addEventListener("click", event => {
      const button = event.target.closest("[data-select]");
      if (button) select(button.dataset.select);
    });
    root.querySelector("#map-search").addEventListener("input", event => { search = event.target.value.trim().toLowerCase(); renderSide(); updateMarkers(); });
    root.querySelector("#map-status-filter").addEventListener("change", event => { stateFilter = event.target.value; renderSide(); updateMarkers(); });

    await refresh();
    setInterval(refresh, 15000);

    const config = await api.get("/api/config").catch(() => ({}));
    if (!config.googleMapsBrowserKey) {
      notice("Google Maps aguardando configuração", "Defina GOOGLE_MAPS_BROWSER_KEY em server/.env para exibir unidades e localizações no mapa. A lista da equipe abaixo continua funcionando.");
      return;
    }
    try {
      google = await loadGoogleMaps(config.googleMapsBrowserKey);
      const canvas = root.querySelector("#map-canvas");
      canvas.innerHTML = "";
      map = new google.maps.Map(canvas, { center: { lat: -22.9068, lng: -43.1729 }, zoom: 11, mapTypeControl: false, streetViewControl: false, fullscreenControl: true });
      info = new google.maps.InfoWindow();
      updateMarkers();
      if (!data.units.some(unit => unit.latitude !== null) && !data.employees.some(person => person.location)) {
        R.toast("Cadastre a localização das unidades e peça aos colaboradores que autorizem o GPS para ver pontos no mapa.");
      }
    } catch (error) {
      notice("Google Maps indisponível", error.message, true);
    }
  }
};
