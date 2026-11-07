/**
 * Aplicativo REOBOTE do colaborador.
 *
 * Funciona de dois jeitos com o mesmo código:
 *  1. No navegador do celular, aberto em https://SEU-SERVIDOR/app/ (pode ser instalado como PWA);
 *  2. Como APK Android (pasta aplicativo-android/), em que os arquivos ficam dentro do aplicativo e o
 *     colaborador informa o endereço do servidor na tela de login.
 *
 * Ideia central: todo registro (leitura de QR Code, almoço, encerramento) entra primeiro numa FILA LOCAL,
 * com o horário original, e só depois é enviado ao servidor. Assim, mesmo sem internet, nada se perde:
 * quando a conexão volta, a fila é enviada e o servidor preserva o horário em que o registro aconteceu.
 *
 * Organização deste arquivo:
 *  - Constantes e estado do aplicativo
 *  - Utilitários (formatação, avisos, diálogo de confirmação)
 *  - Servidor (endereço da API no APK)
 *  - Armazenamento local e relógio
 *  - Regras de sequência e registro
 *  - Sincronização com o servidor
 *  - Telas (início, leitor de QR Code, resultado, histórico, conta, login e senha)
 *  - Leitor de QR Code e localização
 *  - Eventos de interface e inicialização
 */
(function () {
  "use strict";

  // Constantes e estado ------------------------------------------------------------------------

  const api = window.ReoboteApi;
  const screen = document.querySelector("#screen");          // área onde cada tela é desenhada
  const syncButton = document.querySelector("#sync-status"); // indicador "Sincronizado / X a enviar"

  // true quando o app está rodando como APK (Capacitor); false no navegador.
  const isNative = Boolean(window.Capacitor?.isNativePlatform?.());

  // Formato dos QR Codes gerados pela Central: REOBOTE:U:<código> (unidade) ou REOBOTE:V:<código> (veículo).
  const QR_PATTERN = /^REOBOTE:(U|V):[a-f0-9]{32}$/;

  // Textos exibidos para cada situação da jornada e para cada tipo de registro.
  const STATE_LABELS = { waiting: "Aguardando início", in_transit: "Em deslocamento", working: "Em atendimento", on_break: "Em almoço", finished: "Jornada finalizada" };
  const EVENT_LABELS = { vehicle_checkin: "Chegada ao veículo", unit_checkin: "Chegada à unidade", arrival: "Entrada", break_start: "Início do almoço", break_end: "Retorno do almoço", departure: "Encerramento da jornada", scan: "Leitura de QR Code" };
  const EVENT_ICONS = { vehicle_checkin: "fa-van-shuttle", unit_checkin: "fa-hospital", arrival: "fa-right-to-bracket", break_start: "fa-utensils", break_end: "fa-mug-hot", departure: "fa-flag-checkered", scan: "fa-qrcode" };

  // Chaves usadas no armazenamento do celular (localStorage).
  const SERVER_KEY = "reobote-app:server";   // endereço do servidor (somente APK)
  const SESSION_KEY = "reobote-app:session"; // última sessão, para abrir o app sem internet

  let session = null;          // conta autenticada: { user, company, rules }
  let store = null;            // dados locais da conta: fila, recusados, último "hoje", histórico, ajuste de relógio
  let storeKey = null;         // chave do localStorage da conta atual
  let tab = "home";            // tela atual: home, scan, result, history, account, login, password
  let syncing = false;         // evita dois envios simultâneos da fila
  let scanner = null;          // câmera aberta pelo leitor de QR Code
  let historyRange = 7;        // período do histórico em dias
  let locationWatch = null;    // identificador do acompanhamento de GPS (quando autorizado)
  let lastLocationSent = { at: 0, lat: null, lng: null };
  let timezone = "America/Sao_Paulo";
  let deferredInstall = null;  // convite de instalação do PWA (somente navegador)
  let timersStarted = false;   // garante um único temporizador de sincronização

  // Utilitários ------------------------------------------------------------------------------

  // Escapa textos antes de colocá-los no HTML (evita que um nome com "<script>" vire código).
  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
  // Formatações de data e hora sempre no fuso horário da empresa (definido em Configurações).
  const time = value => value ? new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "—";
  const dateTime = value => value ? new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "—";
  // "2026-11-07" -> "sábado, 07/11" (datas do calendário, sem fuso).
  const dayLabel = iso => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "long", day: "2-digit", month: "2-digit" }).format(new Date(Date.UTC(y, m - 1, d)));
  };
  // 125 -> "2h05".
  const duration = minutes => `${Math.floor((minutes || 0) / 60)}h${String((minutes || 0) % 60).padStart(2, "0")}`;
  // "Fernando Silva" -> "FS" (usado quando não há foto).
  const initials = name => String(name || "?").split(/\s+/).filter(Boolean).map(p => p[0]).slice(0, 2).join("").toUpperCase();
  // Identificador único de cada registro; o servidor usa para descartar envios repetidos.
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`);

  // Aviso rápido na parte de baixo da tela. tone: "info", "success" ou "error".
  let toastTimer;
  // Mostra o aviso (ver comentário acima).
  function toast(message, tone = "info") {
    const element = document.querySelector("#toast");
    element.textContent = message;
    element.dataset.tone = tone;
    element.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove("visible"), 4500);
  }

  // Janela de confirmação (ex.: "Encerrar a jornada?"). Resolve true quando o colaborador confirma.
  function confirmSheet({ title, message, confirmLabel, danger = false }) {
    const root = document.querySelector("#dialog-root");
    const dialog = document.createElement("dialog");
    dialog.className = "m-sheet";
    dialog.innerHTML = `<form method="dialog"><h2>${esc(title)}</h2><p>${esc(message)}</p>
      <div class="m-sheet-actions"><button value="cancel" class="m-button ghost">Cancelar</button><button value="ok" class="m-button ${danger ? "danger" : "primary"}">${esc(confirmLabel)}</button></div></form>`;
    root.append(dialog);
    return new Promise(resolve => {
      dialog.addEventListener("close", () => { resolve(dialog.returnValue === "ok"); dialog.remove(); });
      dialog.showModal();
    });
  }

  // Servidor (somente APK) ------------------------------------------------------------------

  // Lê o endereço do servidor salvo no celular.
  function savedServer() {
    try {
      return localStorage.getItem(SERVER_KEY) || "";
    } catch {
      return "";
    }
  }

  // Normaliza o endereço digitado: remove espaços e a barra final e acrescenta "http://" se faltar.
  function normalizeServer(value) {
    let address = String(value || "").trim().replace(/\/+$/, "");
    if (address && !/^https?:\/\//i.test(address)) address = `http://${address}`;
    return address;
  }

  // Confere se o endereço responde como um servidor REOBOTE antes de salvá-lo.
  async function useServer(address) {
    const normalized = normalizeServer(address);
    if (!/^https?:\/\/[^\s/]+/i.test(normalized)) throw new Error("Informe o endereço do servidor, por exemplo https://reobote.com.br.");
    api.baseUrl = normalized;
    try {
      await api.get("/api/config", { handleAuth: false });
    } catch {
      throw new Error("Não foi possível conectar a este servidor. Confira o endereço e a internet do celular.");
    }
    try { localStorage.setItem(SERVER_KEY, normalized); } catch { /* sem armazenamento */ }
  }

  // Endereço completo de uma página da Central (no APK, abre no navegador do celular).
  function centralUrl() {
    return isNative ? api.url("/central/painel-principal.html") : "/central/painel-principal.html";
  }

  // Armazenamento local e relógio ---------------------------------------------------------------

  // Carrega os dados locais da conta. Cada conta tem a própria fila (útil em celulares compartilhados).
  function loadStore(userId) {
    storeKey = `reobote-app:${userId}`;
    try {
      store = JSON.parse(localStorage.getItem(storeKey) || "null");
    } catch {
      store = null;
    }
    // Valores padrão para o primeiro uso; os dados salvos sobrescrevem estes campos.
    store = { queue: [], rejected: [], today: null, history: null, clockOffset: 0, ...(store || {}) };
  }

  // Grava os dados locais. Se o celular estiver sem espaço, avisa o colaborador.
  function saveStore() {
    try {
      localStorage.setItem(storeKey, JSON.stringify(store));
    } catch {
      toast("O celular está sem espaço para guardar registros. Libere espaço e conecte-se à internet.", "error");
    }
  }

  // Horário "agora" corrigido pela diferença entre o relógio do celular e o do servidor.
  // Assim um celular com hora errada não gera registros com horário errado.
  function nowIso() {
    return new Date(Date.now() + (store.clockOffset || 0)).toISOString();
  }

  // Aprende a diferença de relógio a partir da hora informada pelo servidor (somente em respostas rápidas).
  function learnClock(serverTime, requestStarted) {
    const server = new Date(serverTime).getTime();
    if (!Number.isFinite(server) || Date.now() - requestStarted > 5000) return;
    store.clockOffset = server - (requestStarted + Date.now()) / 2;
  }

  // Regras de sequência e registro --------------------------------------------------------------

  // Situação prevista: parte do último estado confirmado pelo servidor e aplica os registros ainda na fila.
  // Isso permite mostrar a situação certa e liberar os botões corretos mesmo sem internet.
  function predicted() {
    const today = store.today;
    let state = today?.state || "waiting";
    let lastScan = null;
    const pendingEvents = [];
    for (const item of store.queue) {
      // Uma leitura de QR Code vira chegada ao veículo (V) ou à unidade (U) conforme o código.
      const type = item.type === "scan" ? (item.qr.startsWith("REOBOTE:V") ? "vehicle_checkin" : "unit_checkin") : item.type;
      if (type === "vehicle_checkin") state = "in_transit";
      if (type === "unit_checkin") state = "working";
      if (type === "break_start") state = "on_break";
      if (type === "break_end") state = "working";
      if (type === "departure") state = "finished";
      if (item.type === "scan") lastScan = item;
      pendingEvents.push({ eventType: type, label: EVENT_LABELS[type], occurredAt: item.occurredAt, pending: true });
    }
    return { state, pendingEvents, lastScan };
  }

  // Mesmas regras de sequência do servidor (server/lib/journey.php), para responder na hora mesmo sem internet.
  // Retorna a mensagem de erro, ou null quando o registro é permitido.
  function localCheck(type, qr) {
    const { state, lastScan } = predicted();
    if (type === "scan") {
      if (state === "on_break") return "Registre o retorno do almoço antes de uma nova leitura.";
      // Evita registrar duas vezes o mesmo QR Code em menos de 2 minutos.
      if (lastScan && lastScan.qr === qr && Date.now() - new Date(lastScan.occurredAt).getTime() < 120000) return "Este QR Code acabou de ser registrado.";
      const lastServer = store.today?.lastEvent;
      if (!lastScan && lastServer && Date.now() - new Date(lastServer.occurredAt).getTime() < 120000
        && ((qr.startsWith("REOBOTE:V") && lastServer.eventType === "vehicle_checkin") || (qr.startsWith("REOBOTE:U") && lastServer.eventType === "unit_checkin"))) {
        return "Este registro acabou de ser feito.";
      }
      return null;
    }
    if (type === "break_start") return ["working", "in_transit"].includes(state) ? null : state === "on_break" ? "O almoço já foi iniciado." : "Inicie a jornada com a leitura do QR Code antes do almoço.";
    if (type === "break_end") return state === "on_break" ? null : "Não há almoço em andamento.";
    if (type === "departure") {
      if (state === "on_break") return "Registre o retorno do almoço antes de encerrar.";
      if (state === "finished") return "A jornada de hoje já foi encerrada.";
      return ["working", "in_transit"].includes(state) ? null : "Não há jornada em andamento para encerrar.";
    }
    return "Registro inválido.";
  }

  // Localização opcional no momento da leitura do QR Code (somente se a Central ativou e o colaborador permitiu).
  // Serve para a Central conferir a distância até a unidade. Espera no máximo 8 segundos.
  function currentPosition() {
    if (!session.rules.requestGpsOnCheckin || !navigator.geolocation) return Promise.resolve(null);
    return new Promise(resolve => {
      navigator.geolocation.getCurrentPosition(
        position => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
      );
    });
  }

  /**
   * Cria um registro: valida a sequência, coloca na fila com o horário atual e tenta enviar.
   * @param {"scan"|"break_start"|"break_end"|"departure"} type
   * @param {object} extra  Para leituras de QR Code: { qr: "REOBOTE:U:..." }
   * @returns {Promise<{item, result}|null>} null quando a regra de sequência impediu o registro.
   */
  async function record(type, extra = {}) {
    const problem = localCheck(type, extra.qr);
    if (problem) {
      toast(problem, "error");
      return null;
    }
    const occurredAt = nowIso();
    const position = type === "scan" ? await currentPosition() : null;
    const item = { clientId: uuid(), type, occurredAt, ...extra, ...(position || {}) };
    store.queue.push(item);
    saveStore();
    render();
    const result = await sync();
    return { item, result: result?.find(entry => entry.clientId === item.clientId) || null };
  }

  // Sincronização com o servidor ----------------------------------------------------------------

  // Envia a fila ao servidor. Registros aceitos saem da fila; recusados ficam visíveis com o motivo.
  // Sem internet, não faz nada: a fila continua guardada e é enviada depois.
  async function sync() {
    if (!store || !session) return null;
    if (syncing || !store.queue.length) {
      updateSyncStatus();
      return null;
    }
    if (!navigator.onLine) {
      updateSyncStatus();
      return null;
    }
    syncing = true;
    updateSyncStatus();
    const batch = store.queue.slice(0, 100); // o servidor aceita até 100 registros por envio
    const started = Date.now();
    try {
      const response = await api.post("/api/me/attendance", { events: batch }, { handleAuth: false });
      learnClock(response.today.serverTime, started);
      const done = new Set();
      response.results.forEach(result => {
        done.add(result.clientId);
        if (result.status === "rejected") {
          const original = batch.find(item => item.clientId === result.clientId);
          store.rejected.unshift({ ...original, error: result.error, rejectedAt: new Date().toISOString() });
          toast(`Registro recusado: ${result.error}`, "error");
        }
      });
      store.queue = store.queue.filter(item => !done.has(item.clientId));
      store.rejected = store.rejected.slice(0, 20);
      store.today = response.today; // o servidor devolve a situação atualizada do dia
      saveStore();
      return response.results;
    } catch (error) {
      if (error.status === 401) {
        // Sessão expirada: a fila continua salva e será enviada após o novo login.
        showLogin("Sua sessão expirou. Entre novamente para enviar os registros guardados neste celular.");
      } else if (error.code === "password_change_required") {
        showPassword(true);
      } else if (!error.offline && error.status >= 400 && error.status < 500) {
        toast(error.message, "error");
      }
      return null;
    } finally {
      syncing = false;
      render();
    }
  }

  // Busca no servidor a situação do dia (jornada prevista, registros do turno, resumo).
  async function refreshToday() {
    if (!navigator.onLine || !store || !session) return;
    const started = Date.now();
    try {
      const today = await api.get("/api/me/today", { handleAuth: false });
      learnClock(today.serverTime, started);
      // A fila local é aplicada por cima deste estado em predicted().
      store.today = today;
      saveStore();
      render();
    } catch (error) {
      if (error.status === 401) showLogin("Sua sessão expirou. Entre novamente.");
    }
  }

  // Atualiza o indicador do topo: sem internet, registros a enviar ou tudo sincronizado.
  function updateSyncStatus() {
    const pending = store?.queue.length || 0;
    const online = navigator.onLine;
    syncButton.className = `m-sync ${!online ? "offline" : pending ? "pending" : "ok"}`;
    syncButton.querySelector("span").textContent = !online
      ? (pending ? `Sem internet • ${pending} guardado(s)` : "Sem internet")
      : syncing ? "Enviando..." : pending ? `${pending} a enviar` : "Sincronizado";
    syncButton.title = pending ? "Toque para enviar agora" : "Todos os registros foram enviados";
  }

  // Telas ----------------------------------------------------------------------------------------

  // Foto do colaborador (protegida pela API) ou iniciais quando não há foto ou internet.
  function photo(employee, className) {
    if (employee?.hasPhoto && navigator.onLine) {
      const src = api.url(`/api/employees/${encodeURIComponent(employee.id)}/photo?v=${encodeURIComponent(employee.photoVersion || "1")}`);
      return `<span class="${className}"><img src="${esc(src)}" alt="" data-fallback="${esc(initials(employee.name))}"></span>`;
    }
    return `<span class="${className}">${esc(initials(employee?.name || session.user.name))}</span>`;
  }

  // Tela inicial: dados do colaborador, situação atual, andamento da jornada, botões e resumo do dia.
  function homeScreen() {
    const today = store.today;
    const employee = today?.employee;
    const { state, pendingEvents } = predicted();
    const events = [...(today?.shiftEvents || []), ...pendingEvents];
    const schedule = employee?.schedule;
    // Etapas da jornada com o horário de cada registro (tracejado = aguardando envio).
    const steps = [
      ["vehicle_checkin", "Veículo"], ["unit_checkin", "Unidade"], ["break_start", "Almoço"], ["break_end", "Retorno"], ["departure", "Encerrado"]
    ].map(([type, label]) => {
      const event = [...events].reverse().find(item => item.eventType === type || (type === "unit_checkin" && item.eventType === "arrival"));
      return `<li class="${event ? "done" : ""}${event?.pending ? " pending" : ""}"><i class="fa-solid ${EVENT_ICONS[type]}"></i><span>${label}</span><small>${event ? time(event.occurredAt) : "—"}</small></li>`;
    }).join("");
    const last = events[events.length - 1] || today?.lastEvent;
    const day = today?.day;
    // Botões habilitados de acordo com a sequência da jornada.
    const canBreakStart = ["working", "in_transit"].includes(state);
    const canBreakEnd = state === "on_break";
    const canDepart = ["working", "in_transit"].includes(state);

    return `<section class="m-card m-profile">
        ${photo(employee, "m-avatar")}
        <div><h1>${esc(employee?.name || session.user.name)}</h1><p>${esc(employee?.job || session.user.job || "")}</p><p><i class="fa-solid fa-hospital"></i> ${esc(employee?.unit || "Sem unidade fixa")}</p></div>
      </section>

      <section class="m-card m-status state-${state}">
        <span class="m-status-label">Situação atual</span>
        <strong>${STATE_LABELS[state]}</strong>
        <span>${last ? `Último registro: ${esc(last.label || EVENT_LABELS[last.eventType])} às ${time(last.occurredAt)}${last.pending ? " (aguardando envio)" : ""}` : "Nenhum registro hoje"}</span>
        <span><i class="fa-solid fa-calendar-days"></i> ${schedule ? `Jornada prevista: ${esc(schedule.start)} às ${esc(schedule.end)} • almoço de ${schedule.breakMinutes} min` : "Jornada não definida pela Central"}</span>
        ${day?.holiday ? `<span><i class="fa-solid fa-umbrella-beach"></i> Feriado: ${esc(day.holiday)}</span>` : ""}
      </section>

      <ol class="m-steps" aria-label="Andamento da jornada">${steps}</ol>

      <section class="m-actions">
        <button type="button" class="m-button primary big" data-action="scan" ${state === "on_break" ? "disabled" : ""}><i class="fa-solid fa-qrcode"></i> Registrar presença</button>
        <div class="m-action-row">
          ${canBreakEnd
            ? '<button type="button" class="m-button warning" data-action="break_end"><i class="fa-solid fa-mug-hot"></i> Retornar do almoço</button>'
            : `<button type="button" class="m-button warning" data-action="break_start" ${canBreakStart ? "" : "disabled"}><i class="fa-solid fa-utensils"></i> Iniciar almoço</button>`}
          <button type="button" class="m-button danger" data-action="departure" ${canDepart ? "" : "disabled"}><i class="fa-solid fa-flag-checkered"></i> Encerrar jornada</button>
        </div>
        ${state === "on_break" ? '<p class="m-hint">Para fazer nova leitura ou encerrar, registre primeiro o retorno do almoço.</p>' : ""}
      </section>

      ${day ? `<section class="m-card m-summary"><h2>Resumo do dia</h2><dl>
        <div><dt>Trabalhadas</dt><dd>${duration(day.workedMinutes)}</dd></div>
        <div><dt>Almoço</dt><dd>${duration(day.breakMinutes)}</dd></div>
        <div><dt>Atraso</dt><dd class="${day.lateMinutes ? "bad" : ""}">${day.lateMinutes ? duration(day.lateMinutes) : "—"}</dd></div>
        <div><dt>Hora extra</dt><dd class="${day.overtimeMinutes ? "good" : ""}">${day.overtimeMinutes ? duration(day.overtimeMinutes) : "—"}</dd></div>
      </dl><small>Valores atualizados quando os registros chegam à Central.</small></section>` : ""}

      ${store.rejected.length ? `<section class="m-card m-rejected"><h2><i class="fa-solid fa-triangle-exclamation"></i> Registros recusados</h2>
        <ul>${store.rejected.slice(0, 5).map(item => `<li><strong>${esc(EVENT_LABELS[item.type])} • ${dateTime(item.occurredAt)}</strong><span>${esc(item.error)}</span></li>`).join("")}</ul>
        <button type="button" class="m-button ghost small" data-action="clear-rejected">Entendi, limpar avisos</button>
        <p class="m-hint">Se algo estiver errado, avise a Central para um lançamento manual.</p></section>` : ""}`;
  }

  // Tela do leitor: vídeo da câmera traseira com moldura de mira.
  function scanScreen() {
    return `<section class="m-card m-scan">
      <h1>Registrar presença</h1>
      <p>Aponte a câmera para o QR Code do <strong>veículo</strong> ou da <strong>unidade</strong>.</p>
      <div class="m-camera"><video id="scan-video" playsinline muted></video><span class="m-camera-frame"></span><canvas id="scan-canvas" hidden></canvas>
        <p class="m-camera-message" id="scan-message"><i class="fa-solid fa-spinner fa-spin"></i> Abrindo a câmera...</p></div>
      <p class="m-hint">Funciona mesmo sem internet: o registro fica guardado no celular com o horário da leitura e é enviado depois.</p>
      <button type="button" class="m-button ghost" data-tab-go="home">Cancelar</button>
    </section>`;
  }

  // Confirmação depois de uma leitura: enviado, guardado para envio ou recusado (com o motivo).
  function resultScreen(outcome) {
    const { item, result } = outcome;
    const type = result?.eventType || (item.qr?.startsWith("REOBOTE:V") ? "vehicle_checkin" : item.qr ? "unit_checkin" : item.type);
    if (result?.status === "rejected") {
      return `<section class="m-card m-result error"><i class="fa-solid fa-circle-xmark"></i><h1>Registro não aceito</h1><p>${esc(result.error)}</p>
        <button type="button" class="m-button primary" data-tab-go="home">Voltar ao início</button></section>`;
    }
    const sent = result && ["recorded", "duplicate"].includes(result.status);
    return `<section class="m-card m-result ${sent ? "success" : "pending"}">
      <i class="fa-solid ${sent ? "fa-circle-check" : "fa-cloud-arrow-up"}"></i>
      <h1>${esc(EVENT_LABELS[type])}</h1>
      <p class="m-result-time">${time(item.occurredAt)}</p>
      ${result?.place ? `<p><i class="fa-solid fa-location-dot"></i> ${esc(result.place)}</p>` : ""}
      <p>${sent ? (result.status === "duplicate" ? "Este registro já tinha sido recebido pela Central." : "Registrado e enviado à Central REOBOTE.") : "Sem conexão agora: o registro foi guardado no celular com este horário e será enviado automaticamente."}</p>
      ${result?.distanceM !== null && result?.distanceM !== undefined ? `<small>Distância aproximada da unidade: ${result.distanceM} m</small>` : ""}
      <button type="button" class="m-button primary" data-tab-go="home">Concluir</button>
    </section>`;
  }

  // Histórico individual: totais do período e cada dia com horas, almoço, atraso, extras e registros.
  function historyScreen() {
    const history = store.history;
    const statusLabels = { worked: "Trabalhado", in_progress: "Em andamento", absent: "Falta", not_arrived: "Não iniciado", scheduled: "Previsto", off: "Folga", holiday: "Feriado" };
    const body = !history
      ? `<p class="m-loading"><i class="fa-solid fa-spinner fa-spin"></i> Carregando histórico...</p>`
      : history.days.filter(day => day.status !== "off" || day.events.length).map(day => `<article class="m-day status-${day.status}">
        <header><strong>${esc(dayLabel(day.date))}</strong><span class="m-pill">${esc(statusLabels[day.status] || day.status)}</span></header>
        ${day.events.length ? `<dl><div><dt>Trabalhadas</dt><dd>${duration(day.workedMinutes)}</dd></div><div><dt>Almoço</dt><dd>${duration(day.breakMinutes)}</dd></div>
          <div><dt>Atraso</dt><dd class="${day.lateMinutes ? "bad" : ""}">${day.lateMinutes ? duration(day.lateMinutes) : "—"}</dd></div><div><dt>Extra</dt><dd class="${day.overtimeMinutes ? "good" : ""}">${day.overtimeMinutes ? duration(day.overtimeMinutes) : "—"}</dd></div></dl>
          <ul>${day.events.map(event => `<li><i class="fa-solid ${EVENT_ICONS[event.eventType] || "fa-clock"}"></i> ${time(event.occurredAt)} • ${esc(event.label)}${event.place ? ` • ${esc(event.place)}` : ""}</li>`).join("")}</ul>` : `<p>${day.holiday ? esc(day.holiday) : day.status === "absent" ? "Nenhum registro em dia de trabalho previsto." : "Sem registros."}</p>`}
        ${day.flags.includes("missing_departure") ? '<p class="bad">Jornada sem encerramento registrado.</p>' : ""}
      </article>`).join("") || '<p class="m-empty">Nenhum registro no período.</p>';
    const t = history?.totals;
    return `<section class="m-history">
      <header class="m-section-header"><h1>Meu histórico</h1>
        <select id="history-range" aria-label="Período">${[7, 30, 90].map(value => `<option value="${value}" ${value === historyRange ? "selected" : ""}>${value} dias</option>`).join("")}</select></header>
      ${t ? `<section class="m-card m-summary"><dl>
        <div><dt>Dias trabalhados</dt><dd>${t.daysWorked}</dd></div><div><dt>Faltas</dt><dd class="${t.absences ? "bad" : ""}">${t.absences}</dd></div>
        <div><dt>Atrasos</dt><dd class="${t.lateMinutes ? "bad" : ""}">${duration(t.lateMinutes)}</dd></div><div><dt>Horas extras</dt><dd class="${t.overtimeMinutes ? "good" : ""}">${duration(t.overtimeMinutes)}</dd></div>
        <div><dt>Total trabalhado</dt><dd>${duration(t.workedMinutes)}</dd></div><div><dt>Intervalos</dt><dd>${duration(t.breakMinutes)}</dd></div>
      </dl>${!navigator.onLine ? "<small>Sem internet: exibindo o último histórico baixado.</small>" : ""}</section>` : ""}
      ${body}
    </section>`;
  }

  // Conta: dados, consentimento de localização (LGPD), senha, servidor (APK), Central e saída.
  function accountScreen() {
    const employee = store.today?.employee;
    const sharing = Boolean(employee?.trackingEnabled);
    return `<section class="m-card m-profile">${photo(employee, "m-avatar")}<div><h1>${esc(session.user.name)}</h1><p>${esc(session.user.email)}</p><p>${esc(session.user.job || "")}</p></div></section>
      <section class="m-card">
        <h2><i class="fa-solid fa-location-crosshairs"></i> Compartilhar localização</h2>
        <p>Com sua autorização, a Central vê sua posição no mapa enquanto o aplicativo estiver aberto. Você pode parar a qualquer momento.</p>
        <label class="m-switch"><input type="checkbox" id="location-toggle" ${sharing ? "checked" : ""} ${navigator.onLine ? "" : "disabled"}><span>${sharing ? "Compartilhamento autorizado" : "Compartilhamento desativado"}</span></label>
        <small id="location-status">${locationWatch !== null ? "Enviando sua localização enquanto o app estiver aberto." : ""}</small>
      </section>
      <section class="m-card m-links">
        <button type="button" class="m-button ghost" id="install-app" hidden><i class="fa-solid fa-download"></i> Instalar aplicativo</button>
        <button type="button" class="m-button ghost" data-action="change-password" ${navigator.onLine ? "" : "disabled"}><i class="fa-solid fa-key"></i> Alterar senha</button>
        ${session.user.centralAccess ? `<a class="m-button ghost" href="${esc(centralUrl())}" target="_blank" rel="noopener"><i class="fa-solid fa-desktop"></i> Abrir a Central</a>` : ""}
        <button type="button" class="m-button danger" data-action="logout"><i class="fa-solid fa-arrow-right-from-bracket"></i> Sair</button>
      </section>
      ${isNative ? `<section class="m-card"><h2><i class="fa-solid fa-server"></i> Servidor</h2><p>${esc(api.baseUrl)}</p>
        <button type="button" class="m-button ghost small" data-action="change-server">Trocar servidor</button></section>` : ""}
      <section class="m-card"><h2>Ajuda</h2><p>${esc(session.company.name)}${session.company.phone ? ` • ${esc(session.company.phone)}` : ""}${session.company.email ? ` • ${esc(session.company.email)}` : ""}</p>
        <p class="m-hint">Registros feitos sem internet ficam guardados neste celular até serem enviados. Não desinstale o aplicativo nem limpe os dados dele com registros pendentes.</p></section>`;
  }

  // Desenha a tela atual. Telas com controle próprio (leitor, resultado, login, senha) não são redesenhadas aqui.
  function render() {
    if (!store) return;
    updateSyncStatus();
    if (["scan", "result", "login", "password"].includes(tab)) return;
    document.querySelectorAll("[data-tab]").forEach(button => button.classList.toggle("active", button.dataset.tab === tab));
    if (tab === "home") screen.innerHTML = homeScreen();
    if (tab === "history") screen.innerHTML = historyScreen();
    if (tab === "account") {
      screen.innerHTML = accountScreen();
      const install = document.querySelector("#install-app");
      if (install && deferredInstall && !isNative) install.hidden = false;
    }
  }

  // Troca de tela pela barra inferior ou pelos botões.
  function go(next) {
    if (scanner && next !== "scan") stopScanner();
    tab = next;
    document.querySelectorAll("[data-tab]").forEach(button => button.classList.toggle("active", button.dataset.tab === (next === "result" ? "scan" : next)));
    if (next === "scan") {
      screen.innerHTML = scanScreen();
      startScanner();
      return;
    }
    if (next === "history") loadHistory();
    render();
    screen.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  // Baixa o histórico do período escolhido e guarda uma cópia para consultar sem internet.
  async function loadHistory() {
    if (!navigator.onLine || !store || !session) return;
    try {
      const history = await api.get(`/api/me/history?from=${localDate(-(historyRange - 1))}&to=${localDate(0)}`, { handleAuth: false });
      store.history = history;
      saveStore();
      if (tab === "history") render();
    } catch (error) {
      if (tab === "history" && !store.history) screen.innerHTML = `<p class="m-empty">${esc(error.message)}</p>`;
    }
  }

  // Data local (AAAA-MM-DD) no fuso da empresa, deslocada em dias (0 = hoje, -6 = seis dias atrás).
  function localDate(offsetDays) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + offsetDays * 86400000));
  }

  // Leitor de QR Code e localização --------------------------------------------------------------

  // Abre a câmera traseira e procura um QR Code REOBOTE a cada fração de segundo.
  // Usa o detector nativo do celular (BarcodeDetector) quando existe; senão, a biblioteca jsQR.
  async function startScanner() {
    const video = document.querySelector("#scan-video");
    const message = document.querySelector("#scan-message");
    if (!navigator.mediaDevices?.getUserMedia) {
      message.innerHTML = isNative
        ? "Não foi possível acessar a câmera neste aparelho."
        : "Este navegador não permite usar a câmera. Use o Chrome ou o Safari atualizados e acesse por HTTPS.";
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    } catch (error) {
      message.innerHTML = error.name === "NotAllowedError"
        ? (isNative ? "Permissão da câmera negada. Libere a câmera para o REOBOTE em Configurações > Apps > REOBOTE > Permissões." : "Permissão da câmera negada. Libere a câmera para este site nas configurações do navegador.")
        : "Não foi possível abrir a câmera.";
      return;
    }
    // O colaborador pode ter saído da tela enquanto a câmera abria.
    if (tab !== "scan") {
      stream.getTracks().forEach(track => track.stop());
      return;
    }
    video.srcObject = stream;
    await video.play().catch(() => {});
    message.textContent = "Procurando QR Code...";
    const canvas = document.querySelector("#scan-canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    let detector = null;
    if ("BarcodeDetector" in window) {
      try {
        const formats = await window.BarcodeDetector.getSupportedFormats();
        if (formats.includes("qr_code")) detector = new window.BarcodeDetector({ formats: ["qr_code"] });
      } catch {
        detector = null;
      }
    }
    scanner = { stream, active: true };
    const current = scanner;
    let invalidShown = 0;

    // Analisa um quadro do vídeo; repete até encontrar um código válido ou o leitor ser fechado.
    const tick = async () => {
      if (!current.active) return;
      let value = null;
      if (video.readyState >= 2) {
        try {
          if (detector) {
            const codes = await detector.detect(video);
            value = codes[0]?.rawValue || null;
          } else if (window.jsQR) {
            // Reduz o quadro para no máximo 640 px de largura: mais rápido e suficiente para ler o código.
            const width = Math.min(640, video.videoWidth);
            const height = Math.round(video.videoHeight * (width / video.videoWidth));
            canvas.width = width;
            canvas.height = height;
            context.drawImage(video, 0, 0, width, height);
            const code = window.jsQR(context.getImageData(0, 0, width, height).data, width, height, { inversionAttempts: "dontInvert" });
            value = code?.data || null;
          }
        } catch {
          value = null;
        }
      }
      if (value && QR_PATTERN.test(value.trim())) {
        stopScanner();
        navigator.vibrate?.(80); // vibração curta confirmando a leitura
        message.textContent = "QR Code lido. Registrando...";
        const outcome = await record("scan", { qr: value.trim() });
        if (outcome) {
          tab = "result";
          screen.innerHTML = resultScreen(outcome);
        } else {
          go("home");
        }
        return;
      }
      // Código lido, mas de outro sistema: avisa sem parar o leitor.
      if (value && Date.now() - invalidShown > 3000) {
        invalidShown = Date.now();
        message.textContent = "Este QR Code não é do REOBOTE. Procure a etiqueta da empresa.";
      }
      setTimeout(tick, detector ? 150 : 250);
    };
    tick();
  }

  // Fecha a câmera (libera o hardware e a luz indicadora).
  function stopScanner() {
    if (!scanner) return;
    scanner.active = false;
    scanner.stream.getTracks().forEach(track => track.stop());
    scanner = null;
  }

  // Compartilhamento contínuo de localização, somente com consentimento e enquanto o app está aberto.
  // Envia no máximo uma posição por minuto, ou antes disso se o colaborador andar mais de 50 metros.
  function startLocationWatch() {
    if (locationWatch !== null || !navigator.geolocation) return;
    locationWatch = navigator.geolocation.watchPosition(position => {
      const { latitude, longitude, accuracy } = position.coords;
      const moved = lastLocationSent.lat === null || Math.hypot((latitude - lastLocationSent.lat) * 111000, (longitude - lastLocationSent.lng) * 111000 * Math.cos(latitude * Math.PI / 180)) > 50;
      if (!moved && Date.now() - lastLocationSent.at < 60000) return;
      if (!navigator.onLine) return;
      api.post("/api/me/locations", { latitude, longitude, accuracyM: accuracy }, { handleAuth: false })
        .then(() => {
          lastLocationSent = { at: Date.now(), lat: latitude, lng: longitude };
          const status = document.querySelector("#location-status");
          if (status) status.textContent = `Última posição enviada às ${time(new Date())}.`;
        })
        .catch(error => { if (error.status === 409) stopLocationWatch(); }); // 409 = consentimento revogado
    }, error => {
      stopLocationWatch();
      if (error.code === 1) toast("Permissão de localização negada.", "error");
    }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 });
  }

  // Para de acompanhar e enviar a localização.
  function stopLocationWatch() {
    if (locationWatch !== null) navigator.geolocation.clearWatch(locationWatch);
    locationWatch = null;
  }

  // Login e senha (telas próprias do aplicativo) -------------------------------------------------

  // Tela de erro que impede o uso (ex.: cargo sem permissão para o aplicativo).
  function fatal(title, text, action = "") {
    screen.innerHTML = `<section class="m-card m-result error"><i class="fa-solid fa-circle-exclamation"></i><h1>${esc(title)}</h1><p>${esc(text)}</p>${action}</section>`;
    document.querySelector(".m-tabs").hidden = true;
  }

  // Tela de login. No APK também pede o endereço do servidor (fica salvo no celular).
  function showLogin(message = "", askServer = false) {
    stopScanner();
    stopLocationWatch();
    // A fila offline continua salva no celular e volta a ser enviada quando a mesma conta entrar de novo.
    session = null;
    store = null;
    tab = "login";
    document.querySelector(".m-tabs").hidden = true;
    syncButton.hidden = true;
    const showServer = isNative && (askServer || !api.baseUrl);
    screen.innerHTML = `<section class="m-card m-auth">
      <img class="m-auth-logo" src="../compartilhado/assets/reobote-mark.png" alt="">
      <h1>Entrar no aplicativo</h1>
      <p>Use o e-mail corporativo e a senha entregues pela Central.</p>
      ${message ? `<p class="m-auth-notice">${esc(message)}</p>` : ""}
      <form id="app-login-form" class="m-form">
        ${showServer ? `<label>Endereço do servidor<input name="server" type="url" inputmode="url" autocomplete="url" required placeholder="https://reobote.com.br" value="${esc(api.baseUrl || savedServer())}"></label>
          <p class="m-hint">Peça o endereço à Central. Em testes na rede Wi-Fi, use o IP do computador, por exemplo http://192.168.0.10:3000.</p>` : ""}
        <label>E-mail<input name="email" type="email" autocomplete="username" required maxlength="190"></label>
        <label>Senha<input name="password" type="password" autocomplete="current-password" required maxlength="256"></label>
        <label class="m-check"><input type="checkbox" name="remember" checked> Manter conectado neste celular</label>
        <p class="m-form-error" role="alert" hidden></p>
        <button type="submit" class="m-button primary">Entrar</button>
      </form>
      <button type="button" class="m-link" data-action="forgot">Esqueci minha senha</button>
      <form id="app-forgot-form" class="m-form" hidden>
        <label>Seu e-mail<input name="email" type="email" required maxlength="190" autocomplete="username"></label>
        <button type="submit" class="m-button ghost">Avisar a administração</button>
        <p class="m-hint" role="status" hidden></p>
      </form>
      ${isNative && !showServer ? `<button type="button" class="m-link" data-action="change-server">Servidor: ${esc(api.baseUrl)} (trocar)</button>` : ""}
    </section>`;
    screen.querySelector("input").focus();
  }

  // Criação da senha definitiva (obrigatória após senha temporária) ou troca voluntária.
  function showPassword(required) {
    stopScanner();
    tab = "password";
    document.querySelector(".m-tabs").hidden = required;
    screen.innerHTML = `<section class="m-card m-auth">
      <h1>${required ? "Crie sua senha" : "Alterar senha"}</h1>
      <p>${required ? "Por segurança, troque a senha temporária por uma senha pessoal antes de continuar." : "Informe a senha atual e a nova senha."}</p>
      <form id="app-password-form" class="m-form">
        <input type="hidden" name="username" autocomplete="username" value="${esc(session?.user.email || "")}">
        <label>${required ? "Senha temporária" : "Senha atual"}<input name="currentPassword" type="password" autocomplete="current-password" required maxlength="256"></label>
        <label>Nova senha<input name="newPassword" type="password" autocomplete="new-password" required minlength="10" maxlength="256"></label>
        <label>Confirmar nova senha<input name="confirmPassword" type="password" autocomplete="new-password" required minlength="10" maxlength="256"></label>
        <p class="m-hint">Mínimo de 10 caracteres, com letras e números.</p>
        <p class="m-form-error" role="alert" hidden></p>
        <button type="submit" class="m-button primary">Salvar senha</button>
        ${required ? '<button type="button" class="m-button ghost" data-action="logout">Sair</button>' : '<button type="button" class="m-button ghost" data-action="cancel-password">Cancelar</button>'}
      </form>
    </section>`;
  }

  // Abre o aplicativo para a conta autenticada (depois do login ou ao reabrir com a sessão ativa).
  async function enter(newSession) {
    session = newSession;
    try { localStorage.setItem(SESSION_KEY, JSON.stringify({ user: session.user, company: session.company, rules: session.rules })); } catch { /* sem armazenamento */ }
    if (session.user.mustChangePassword) return showPassword(true);
    timezone = session.rules.timezone || timezone;
    // Só colaboradores cujo cargo tem a permissão "Aplicativo" podem registrar jornada.
    if (!session.user.employeeId || !session.user.permissions.includes("app")) {
      return fatal("Aplicativo não liberado", "Seu cargo não tem permissão para registrar jornada pelo aplicativo.",
        `${session.user.centralAccess ? `<a class="m-button primary" href="${esc(centralUrl())}" target="_blank" rel="noopener">Abrir a Central</a>` : ""}<button type="button" class="m-button ghost" data-action="logout">Sair</button>`);
    }
    document.querySelector(".m-tabs").hidden = false;
    syncButton.hidden = false;
    loadStore(session.user.id);
    tab = "home";
    render();
    await sync();          // envia o que ficou guardado
    await refreshToday();  // atualiza a situação do dia
    if (store.today?.employee?.trackingEnabled) startLocationWatch();
    if (!timersStarted) {
      // A cada minuto: envia registros pendentes e atualiza a situação.
      timersStarted = true;
      setInterval(() => { if (session && store && !["login", "password"].includes(tab)) { sync(); refreshToday(); } }, 60000);
    }
  }

  // Eventos de interface -------------------------------------------------------------------------

  // Um único ouvinte de cliques trata todos os botões (inclusive os criados depois, ao trocar de tela).
  document.addEventListener("click", async event => {
    const tabButton = event.target.closest("[data-tab]");
    if (tabButton) return go(tabButton.dataset.tab);
    const goButton = event.target.closest("[data-tab-go]");
    if (goButton) return go(goButton.dataset.tabGo);
    if (event.target.closest("#sync-status")) {
      if (!store) return;
      if (!store.queue.length) return toast(navigator.onLine ? "Todos os registros foram enviados." : "Sem internet no momento.");
      return sync().then(() => toast(store?.queue.length ? "Ainda há registros aguardando conexão." : "Registros enviados."));
    }
    if (event.target.closest("#install-app") && deferredInstall) {
      deferredInstall.prompt();
      deferredInstall = null;
      return;
    }
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!action) return;
    if (action === "scan") return go("scan");
    if (action === "clear-rejected") {
      store.rejected = [];
      saveStore();
      return render();
    }
    if (action === "logout" || action === "change-server") {
      // Antes de sair, avisa se ainda há registros guardados que não chegaram à Central.
      if (store?.queue.length && !(await confirmSheet({ title: "Há registros não enviados", message: `${store.queue.length} registro(s) ainda não chegaram à Central. Eles continuam guardados neste celular e serão enviados quando você entrar de novo.`, confirmLabel: "Sair mesmo assim", danger: true }))) return;
      stopLocationWatch();
      const askServer = action === "change-server";
      if (!session) return showLogin("", askServer);
      api.post("/api/auth/logout", {}, { handleAuth: false }).catch(() => {}).finally(() => showLogin("", askServer));
      return;
    }
    if (action === "change-password") return showPassword(false);
    if (action === "cancel-password") return go("account");
    if (action === "forgot") {
      const form = document.querySelector("#app-forgot-form");
      form.hidden = !form.hidden;
      if (!form.hidden) {
        form.elements.email.value = document.querySelector("#app-login-form").elements.email.value;
        form.elements.email.focus();
      }
      return;
    }
    if (["break_start", "break_end", "departure"].includes(action)) {
      if (action === "departure" && !(await confirmSheet({ title: "Encerrar a jornada?", message: "O horário de saída será registrado agora e enviado à Central.", confirmLabel: "Encerrar jornada", danger: true }))) return;
      const outcome = await record(action);
      if (outcome) {
        const sent = outcome.result && outcome.result.status !== "rejected";
        if (outcome.result?.status === "rejected") toast(outcome.result.error, "error");
        else toast(`${EVENT_LABELS[action]} às ${time(outcome.item.occurredAt)}${sent ? " — enviado à Central." : " — guardado, será enviado ao reconectar."}`, "success");
        render();
      }
    }
  });

  // Mudanças em campos: período do histórico e consentimento de localização.
  document.addEventListener("change", async event => {
    if (event.target.id === "history-range") {
      historyRange = Number(event.target.value);
      store.history = null;
      render();
      loadHistory();
    }
    if (event.target.id === "location-toggle") {
      const consent = event.target.checked;
      event.target.disabled = true;
      try {
        await api.put("/api/me/location-sharing", { consent }, { handleAuth: false });
        if (store.today?.employee) store.today.employee.trackingEnabled = consent;
        saveStore();
        if (consent) startLocationWatch();
        else stopLocationWatch();
        toast(consent ? "Localização compartilhada enquanto o app estiver aberto." : "Compartilhamento de localização desativado.");
      } catch (error) {
        event.target.checked = !consent;
        toast(error.message, "error");
      } finally {
        render();
      }
    }
  });

  // Envio dos formulários de login, "esqueci minha senha" e criação de senha.
  document.addEventListener("submit", async event => {
    const form = event.target;
    if (!["app-login-form", "app-forgot-form", "app-password-form"].includes(form.id)) return;
    event.preventDefault();
    const data = new FormData(form);
    const errorBox = form.querySelector(".m-form-error");
    const submit = form.querySelector('button[type="submit"]');
    if (errorBox) errorBox.hidden = true;
    submit.disabled = true;
    try {
      if (form.id === "app-login-form") {
        if (data.has("server")) await useServer(data.get("server"));
        const result = await api.post("/api/auth/login", { email: data.get("email"), password: data.get("password"), remember: data.has("remember") }, { handleAuth: false });
        await enter(result);
      }
      if (form.id === "app-forgot-form") {
        if (isNative && !api.baseUrl) throw new Error("Informe primeiro o endereço do servidor.");
        const { message } = await api.post("/api/auth/forgot", { email: data.get("email") }, { handleAuth: false });
        const status = form.querySelector(".m-hint");
        status.textContent = message;
        status.hidden = false;
      }
      if (form.id === "app-password-form") {
        if (data.get("newPassword") !== data.get("confirmPassword")) throw new Error("A confirmação não confere com a nova senha.");
        await api.post("/api/auth/change-password", { currentPassword: data.get("currentPassword"), newPassword: data.get("newPassword") }, { handleAuth: false });
        toast("Senha salva com sucesso.", "success");
        await enter(await api.get("/api/auth/me", { handleAuth: false }));
      }
    } catch (error) {
      if (errorBox) {
        errorBox.textContent = error.offline ? "Sem internet. Conecte-se para continuar." : error.message;
        errorBox.hidden = false;
      } else {
        toast(error.message, "error");
      }
    } finally {
      submit.disabled = false;
    }
  });

  // Fotos que não carregam voltam a mostrar as iniciais.
  document.addEventListener("error", event => {
    const image = event.target;
    if (image instanceof HTMLImageElement && image.dataset.fallback) image.replaceWith(document.createTextNode(image.dataset.fallback));
  }, true);

  // Ao recuperar a internet, envia a fila; ao perder, apenas avisa.
  window.addEventListener("online", () => { toast("Conexão restabelecida. Enviando registros..."); sync().then(refreshToday); });
  window.addEventListener("offline", () => { toast("Sem internet. Os registros serão guardados no celular."); render(); });
  // Ao sair do app a câmera é fechada; ao voltar, sincroniza.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (scanner) go("home");
    } else {
      sync().then(refreshToday);
    }
  });

  // Convite para instalar o PWA (somente no navegador; o APK já é instalado).
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredInstall = event;
    if (tab === "account") render();
  });

  // Inicialização -----------------------------------------------------------------------------

  async function start() {
    // No navegador, o service worker guarda as telas para abrir sem internet.
    // No APK isso não é necessário: os arquivos já estão dentro do aplicativo.
    if (!isNative && "serviceWorker" in navigator && location.protocol !== "file:") {
      navigator.serviceWorker.register("/app/sw.js", { scope: "/app/" }).catch(() => {});
    }
    if (isNative) {
      api.baseUrl = savedServer();
      if (!api.baseUrl) return showLogin("", true); // primeiro uso do APK: pede o servidor
    }
    let cachedSession = null;
    try {
      cachedSession = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    } catch {
      cachedSession = null;
    }
    try {
      await enter(await api.get("/api/auth/me", { handleAuth: false }));
    } catch (error) {
      if (error.status === 401) return showLogin();
      if (!error.offline || !cachedSession) {
        return error.offline ? showLogin("Sem conexão com o servidor. Conecte-se à internet para entrar pela primeira vez neste celular.") : showLogin(error.message);
      }
      // Sem internet: segue com a última conta usada neste celular; a fila offline continua funcionando.
      toast("Sem internet: usando os dados guardados neste celular.");
      await enter(cachedSession);
    }
  }

  start();
})();
