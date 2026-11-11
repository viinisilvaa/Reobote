// REOBOTE | app/js/app.js — Aplicativo: login, QR Code, almoço, encerramento e fila offline
/**
 * Aplicativo REOBOTE do colaborador.
 *
 * Funciona de dois jeitos com o mesmo código:
 *  1. No navegador do celular, aberto em https://SEU-SERVIDOR/app/ (pode ser instalado como PWA);
 *  2. Como APK Android (pasta aplicativo-android/). O endereço do servidor vem do arquivo servidor.json
 *     publicado no GitHub, ou do endereço embutido em js/config.js. O colaborador não configura nada.
 *
 * Ideia central: todo registro (leitura de QR Code, almoço, encerramento) entra primeiro numa FILA LOCAL,
 * com o horário original, e só depois é enviado ao servidor. Assim, mesmo sem internet, nada se perde:
 * quando a conexão volta, a fila é enviada e o servidor preserva o horário em que o registro aconteceu.
 *
 * Regras de ponto:
 *  - O INÍCIO e o ENCERRAMENTO da jornada são feitos lendo um QR Code (veículo ou unidade);
 *  - O almoço (saída e retorno) é registrado com um toque;
 *  - Durante a jornada, a localização é enviada automaticamente à Central (somente do início ao encerramento).
 *
 * Organização deste arquivo:
 *  - Constantes e estado do aplicativo
 *  - Utilitários (formatação, avisos, diálogo de confirmação)
 *  - Servidor (endereço da API no APK)
 *  - Armazenamento local e relógio
 *  - Regras de sequência e registro
 *  - Sincronização com o servidor
 *  - Telas: Início, leitor de QR Code, resultado, Meu Histórico, Perfil, Notificações e Mais
 *  - Leitor de QR Code, foto e localização
 *  - Login e senha
 *  - Eventos de interface e inicialização
 */
(function () {
  "use strict";

  // Constantes e estado ------------------------------------------------------------------------

  const api = window.ReoboteApi;
  const screen = document.querySelector("#screen"); // área onde cada tela é desenhada

  // true quando o app está rodando como APK (Capacitor); false no navegador.
  const isNative = Boolean(window.Capacitor?.isNativePlatform?.());

  // Formato dos QR Codes gerados pela Central: REOBOTE:U:<código> (unidade) ou REOBOTE:V:<código> (veículo).
  const QR_PATTERN = /^REOBOTE:(U|V):[a-f0-9]{32}$/;

  // Textos exibidos para cada situação da jornada e para cada tipo de registro.
  const STATE_LABELS = { waiting: "Aguardando início", in_transit: "Em deslocamento", working: "Em atendimento", on_break: "Em almoço", finished: "Jornada finalizada" };
  const EVENT_LABELS = { vehicle_checkin: "Chegada ao veículo", unit_checkin: "Chegada à unidade", arrival: "Entrada", break_start: "Início do almoço", break_end: "Retorno do almoço", departure: "Encerramento da jornada", scan: "Leitura de QR Code" };
  const EVENT_ICONS = { vehicle_checkin: "fa-car", unit_checkin: "fa-location-dot", arrival: "fa-right-to-bracket", break_start: "fa-utensils", break_end: "fa-flag-checkered", departure: "fa-door-open", scan: "fa-qrcode" };
  const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

  // Chaves usadas no armazenamento do celular (localStorage).
  const DISCOVERED_KEY = "reobote-app:server-auto"; // endereço lido do servidor.json no GitHub (somente APK)
  const SESSION_KEY = "reobote-app:session";        // última sessão, para abrir o app sem internet
  const LOGGED_OUT_KEY = "reobote-app:logged-out";  // o colaborador tocou em Sair: não entra sozinho de novo
  const INSTALL_KEY = "reobote-app:install";        // identificador do banco do servidor (muda quando o banco é zerado)

  let session = null;          // conta autenticada: { user, company, rules }
  let store = null;            // dados locais da conta: fila, recusados, último "hoje", histórico, foto, ajuste de relógio
  let storeKey = null;         // chave do localStorage da conta atual
  let tab = "home";            // tela atual: home, scan, result, history, profile, notifications, more, login, password
  let scanMode = "registro";   // leitor: "registro" (início/chegada) ou "encerrar" (fim da jornada)
  let syncing = false;         // evita dois envios simultâneos da fila
  let scanner = null;          // câmera aberta pelo leitor de QR Code
  let historyRange = 7;        // período do histórico: 7 (dias), "month" (um mês), 365 (1 ano) ou "custom"
  let historyMonth = null;     // mês escolhido no período "month" (AAAA-MM)
  let noticeLimit = 5;         // quantas notificações aparecem (5 por vez; "Ver mais" mostra outras 5)
  let customRange = { from: null, to: null };
  let openDay = null;          // dia aberto (detalhes) no histórico
  let photoInMemory = null;    // foto grande demais para guardar no celular
  let locationWatch = null;    // acompanhamento de GPS durante a jornada
  let locationDenied = false;  // o colaborador negou a permissão de localização no aparelho
  let gpsStatus = { tone: "idle", text: "GPS desligado fora da jornada" }; // situação do GPS mostrada na tela
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
  // "2026-10-31" -> "31/10 - Sáb" (datas do calendário, sem fuso).
  const dayLabel = iso => {
    const [y, m, d] = iso.split("-").map(Number);
    return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")} - ${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}`;
  };
  // 125 -> "2h05"; 120 -> "2h".
  const duration = minutes => {
    const total = Math.max(0, Math.round(minutes || 0));
    const rest = total % 60;
    return `${Math.floor(total / 60)}h${rest ? String(rest).padStart(2, "0") : ""}`;
  };
  // "Fernando Silva" -> "FS" (usado quando não há foto).
  const initials = name => String(name || "?").split(/\s+/).filter(Boolean).map(p => p[0]).slice(0, 2).join("").toUpperCase();
  // Matrícula exibida no cartão: a matrícula da empresa (cadastrada na Central) ou, sem ela,
  // o número do cadastro com 6 dígitos (ex.: 000123).
  const registration = () => store?.today?.employee?.registration || String(session?.user.employeeId || "").padStart(6, "0");
  // Identificador único de cada registro; o servidor usa para descartar envios repetidos.
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`);

  // Aviso rápido na parte de baixo da tela. tone: "info", "success" ou "error".
  let toastTimer;
  function toast(message, tone = "info") {
    const element = document.querySelector("#toast");
    element.textContent = message;
    element.dataset.tone = tone;
    element.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove("visible"), 4500);
  }

  // Janela de confirmação (ex.: "Há registros não enviados"). Resolve true quando o colaborador confirma.
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

  // Endereço do servidor usado pelo APK: o publicado no GitHub (servidor.json) ou, sem ele,
  // o endereço embutido no APK (js/config.js). O colaborador não precisa configurar nada.
  function savedServer() {
    let discovered = "";
    try {
      discovered = localStorage.getItem(DISCOVERED_KEY) || "";
    } catch {
      discovered = "";
    }
    return discovered || normalizeServer(window.REOBOTE_CONFIG?.servidor || "");
  }

  // Busca o endereço atual do servidor no arquivo servidor.json do GitHub (REOBOTE_CONFIG.descoberta).
  // Assim, quando o endereço muda, basta atualizar o arquivo no GitHub, sem gerar outro APK.
  // Sem internet, continua usando o último endereço encontrado.
  async function discoverServer() {
    const url = window.REOBOTE_CONFIG?.descoberta;
    if (!url) return;
    try {
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("tempo esgotado")), 6000));
      const response = await Promise.race([fetch(`${url}?t=${Date.now()}`, { cache: "no-store" }), timeout]);
      if (!response.ok) return;
      const address = normalizeServer((await response.json())?.servidor || "");
      if (/^https?:\/\/[^\s/]+/i.test(address)) localStorage.setItem(DISCOVERED_KEY, address);
      else localStorage.removeItem(DISCOVERED_KEY); // arquivo vazio: volta ao endereço embutido
    } catch {
      /* sem internet ou GitHub fora do ar: mantém o último endereço conhecido */
    }
  }

  // Testa os endereços conhecidos (o publicado no GitHub e o embutido no APK) e fica com o primeiro
  // que responder. Assim, se o túnel da internet estiver desligado, o app ainda funciona no Wi-Fi do PC.
  async function chooseServer() {
    const candidates = [...new Set([savedServer(), normalizeServer(window.REOBOTE_CONFIG?.servidor || "")].filter(Boolean))];
    for (const address of candidates) {
      api.baseUrl = address;
      try {
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("tempo esgotado")), 6000));
        checkInstall(await Promise.race([api.get("/api/config", { handleAuth: false }), timeout]));
        return true;
      } catch {
        /* não respondeu: tenta o próximo */
      }
    }
    api.baseUrl = candidates[0] || "";
    return false;
  }

  // Banco do servidor zerado: o identificador da instalação ("install" em /api/config) mudou. Apaga deste
  // celular a sessão, a fila de registros não enviados e o histórico guardados da instalação antiga
  // (mantém só o endereço do servidor; o tema fica em outra chave). Celulares com dados de antes deste
  // controle existir também são limpos uma vez.
  function checkInstall(config) {
    const install = config?.install;
    if (!install) return;
    try {
      const previous = localStorage.getItem(INSTALL_KEY);
      const oldData = Object.keys(localStorage).filter(key => key.startsWith("reobote-app:") && ![DISCOVERED_KEY, INSTALL_KEY].includes(key));
      if (previous !== install && (previous || oldData.length)) {
        oldData.forEach(key => localStorage.removeItem(key));
        store = null;
        session = null;
      }
      localStorage.setItem(INSTALL_KEY, install);
    } catch {
      /* sem armazenamento: nada a limpar */
    }
  }

  // Remove espaços e a barra final do endereço e acrescenta "http://" se faltar.
  function normalizeServer(value) {
    let address = String(value || "").trim().replace(/\/+$/, "");
    if (address && !/^https?:\/\//i.test(address)) address = `http://${address}`;
    return address;
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
    store = { queue: [], rejected: [], today: null, history: null, photo: null, clockOffset: 0, ...(store || {}) };
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

  // Localização no momento da leitura do QR Code (quando a Central pede, em Configurações).
  // Serve para a Central conferir a distância até a unidade. Espera no máximo 8 segundos.
  // Usa a última posição enviada (até 2 minutos); senão pede ao GPS com alta precisão (até 10 s) e,
  // se falhar (ex.: dentro de prédio), com precisão normal (até 6 s).
  async function currentPosition() {
    if (!navigator.geolocation) return null;
    if (lastLocationSent.lat !== null && Date.now() - lastLocationSent.at < 120000) {
      return { latitude: lastLocationSent.lat, longitude: lastLocationSent.lng, accuracy: lastLocationSent.accuracy };
    }
    const ask = options => new Promise(resolve => navigator.geolocation.getCurrentPosition(
      position => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy }),
      error => { if (error.code === 1) warnLocationDenied(); resolve(null); },
      options
    ));
    return (await ask({ enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }))
      || ask({ enableHighAccuracy: false, timeout: 6000, maximumAge: 120000 });
  }

  // GPS obrigatório para bater o ponto ---------------------------------------------------------------
  // O aplicativo abre normalmente com o GPS desligado, mas só registra o ponto com o GPS ligado.

  // Confere rapidamente se o celular consegue dar uma posição. Mostra "Carregando" enquanto confere.
  // Resolve true (GPS ok) ou false (já avisou o técnico para ligar o GPS).
  async function gpsReady() {
    if (!navigator.geolocation) {
      askToTurnOnGps("unavailable");
      return false;
    }
    if (lastLocationSent.lat !== null && Date.now() - lastLocationSent.at < 120000) return true; // posição recente
    toast("Conferindo o GPS...");
    const result = await new Promise(resolve => navigator.geolocation.getCurrentPosition(
      () => resolve("ok"),
      error => resolve(error.code === 1 ? "denied" : error.code === 3 ? "timeout" : "unavailable"),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 120000 }
    ));
    if (result === "ok") return true;
    askToTurnOnGps(result);
    return false;
  }

  // Janela "Ligue o GPS para bater o ponto". Sem permissão (APK): o botão abre as configurações do app.
  let gpsSheetOpen = false;
  async function askToTurnOnGps(reason) {
    if (gpsSheetOpen) return;
    gpsSheetOpen = true;
    const denied = reason === "denied";
    const openSettings = denied && isNative && BackgroundGeolocation;
    const again = await confirmSheet({
      title: denied ? "Permita a localização para bater o ponto" : "Ligue o GPS para bater o ponto",
      message: denied
        ? "O ponto só é registrado com a localização do celular. Permita a localização para o REOBOTE e tente de novo."
        : reason === "timeout"
          ? "O GPS demorou para responder. Confira se a localização do celular está ligada, vá para perto de uma janela ou área aberta e tente de novo."
          : "A localização (GPS) do celular está desligada. Ligue-a no painel de atalhos do celular e tente de novo. O aplicativo funciona normalmente, mas o ponto só é registrado com o GPS ligado.",
      confirmLabel: openSettings ? "Abrir configurações" : "Entendi"
    });
    gpsSheetOpen = false;
    if (again && openSettings) BackgroundGeolocation.openSettings().catch(() => {});
  }

  /**
   * Cria um registro: valida a sequência, coloca na fila com o horário atual e tenta enviar.
   * @param {"scan"|"break_start"|"break_end"|"departure"} type
   * @param {object} extra  Leituras de QR Code e encerramento: { qr: "REOBOTE:U:..." }
   * @returns {Promise<{item, result}|null>} null quando a regra de sequência impediu o registro.
   */
  async function record(type, extra = {}) {
    const problem = localCheck(type, extra.qr);
    if (problem) {
      toast(problem, "error");
      return null;
    }
    const occurredAt = nowIso();
    // Todo registro (QR Code, almoço e encerramento) exige o GPS ligado e confere se não é GPS falso.
    // 1º: algum app de GPS falso está ativado no celular? Então o registro é bloqueado.
    const mock = await checkMockApps();
    if (mock?.mock) {
      blockFakeGps(null, "checkin", mock.mockApps);
      return null;
    }
    // 2º: no APK, a posição vem do plugin nativo, que informa se ela é FALSA (app de GPS falso).
    const fix = await nativeFix();
    if (fix?.simulated) {
      blockFakeGps(fix, "checkin");
      return null; // registro bloqueado: não entra na fila nem vai para a Central
    }
    const position = fix ? { latitude: fix.latitude, longitude: fix.longitude, accuracy: fix.accuracy } : await currentPosition();
    // 3º: sem posição (GPS desligado ou sem permissão), o ponto NÃO é registrado.
    if (!position) {
      askToTurnOnGps("unavailable");
      return null;
    }
    const item = { clientId: uuid(), type, occurredAt, ...extra, ...(position || {}) };
    store.queue.push(item);
    saveStore();
    render();
    const result = await sync();
    // A posição da leitura também vai para o mapa na hora (o alfinete com a foto usa o GPS do celular).
    if (position) sendLocation(position.latitude, position.longitude, position.accuracy, true);
    return { item, result: result?.find(entry => entry.clientId === item.clientId) || null };
  }

  // Sincronização com o servidor ----------------------------------------------------------------

  // Envia a fila ao servidor. Registros aceitos saem da fila; recusados ficam visíveis com o motivo.
  // Sem internet, não faz nada: a fila continua guardada e é enviada depois.
  async function sync() {
    if (!store || !session) return null;
    if (syncing || !store.queue.length || !navigator.onLine) {
      updateBadges();
      return null;
    }
    syncing = true;
    updateBadges();
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
      loadPhoto();
      render();
    } catch (error) {
      if (error.status === 401) showLogin("Sua sessão expirou. Entre novamente.");
    }
  }

  // Texto do indicador de envio: sem internet, registros a enviar ou tudo sincronizado.
  function syncText() {
    const pending = store?.queue.length || 0;
    if (!navigator.onLine) return { tone: "offline", text: pending ? `Sem internet • ${pending} guardado(s)` : "Sem internet" };
    if (syncing) return { tone: "pending", text: "Enviando..." };
    return pending ? { tone: "pending", text: `${pending} a enviar` } : { tone: "ok", text: "Sincronizado" };
  }

  // Atualiza o indicador de envio e as bolinhas vermelhas do sino e da aba Notificações
  // (registros recusados + registros aguardando envio).
  function updateBadges() {
    const count = (store?.rejected.length || 0) + (store?.queue.length || 0);
    ["#bell-badge", "#tab-badge"].forEach(selector => {
      const badge = document.querySelector(selector);
      if (!badge) return;
      badge.hidden = !count;
      badge.textContent = count > 9 ? "9+" : String(count);
    });
    const indicator = document.querySelector("#sync-status");
    if (indicator && store) {
      const { tone, text } = syncText();
      indicator.className = `m-sync ${tone}`;
      indicator.querySelector("span").textContent = text;
    }
  }

  // Telas ----------------------------------------------------------------------------------------

  // Foto do colaborador (buscada pela API, ver loadPhoto) ou as iniciais do nome.
  function photo(employee, className) {
    const data = store?.photo?.data || photoInMemory;
    if (employee?.hasPhoto && data) return `<span class="${className}"><img src="${esc(data)}" alt=""></span>`;
    return `<span class="${className}">${esc(initials(employee?.name || session.user.name))}</span>`;
  }

  // Etiqueta colorida com a situação atual (ex.: "Em atendimento").
  function statusPill(state) {
    return `<span class="m-state state-${state}"><i></i>${STATE_LABELS[state]}</span>`;
  }

  // Botão do grid de ações (ícone, título, subtítulo e seta), como no modelo aprovado.
  function actionCard(action, icon, tone, title, subtitle, enabled) {
    return `<button type="button" class="m-action-card" data-action="${action}" ${enabled ? "" : "disabled"}>
      <i class="fa-solid ${icon} m-action-icon ${tone}"></i>
      <span><strong>${title}</strong><small>${subtitle}</small></span>
      <i class="fa-solid fa-chevron-right m-chevron"></i></button>`;
  }

  // Tela inicial: cartão do colaborador, botão de QR Code, ações da jornada e histórico.
  function homeScreen() {
    const today = store.today;
    const employee = today?.employee;
    const { state, pendingEvents } = predicted();
    const events = [...(today?.shiftEvents || []), ...pendingEvents];
    const last = events[events.length - 1] || today?.lastEvent;
    const sync = syncText();
    // Botões habilitados de acordo com a sequência da jornada.
    const canScan = state !== "on_break";
    const canBreakStart = ["working", "in_transit"].includes(state);
    const canBreakEnd = state === "on_break";
    const canDepart = ["working", "in_transit"].includes(state);

    return `<section class="m-profile-card">
        ${photo(employee, "m-avatar")}
        <div class="m-profile-copy">
          <h1>${esc(employee?.name || session.user.name)}</h1>
          <p>${esc(employee?.job || session.user.job || "Colaborador")}</p>
          <span class="m-registration"><i class="fa-solid fa-id-card"></i> Mat. ${registration()}</span>
          ${statusPill(state)}
        </div>
      </section>
      <div class="m-last"><span>${last ? `Último registro: <strong>${esc(last.label || EVENT_LABELS[last.eventType])}</strong> às ${time(last.occurredAt)}${last.pending ? " (aguardando envio)" : ""}` : "Nenhum registro hoje."}</span>
        <button type="button" class="m-sync ${sync.tone}" id="sync-status"><i class="fa-solid fa-circle"></i><span>${sync.text}</span></button></div>

      <button type="button" class="m-scan-hero" data-action="scan" ${canScan ? "" : "disabled"}>
        <i class="fa-solid fa-qrcode"></i>
        <strong>Escanear QR Code</strong>
        <span>Registrar ponto ou atendimento</span>
      </button>

      <section class="m-action-grid">
        ${actionCard("scan-vehicle", "fa-car", "purple", "Início do Expediente", "QR do Veículo", canScan)}
        ${actionCard("scan-unit", "fa-location-dot", "green", "Chegada na Unidade", "QR da Unidade", canScan)}
        ${actionCard("break_start", "fa-utensils", "purple", "Horário de Almoço", "Registrar saída", canBreakStart)}
        ${actionCard("break_end", "fa-flag-checkered", "green", "Retorno do Almoço", "Registrar retorno", canBreakEnd)}
      </section>

      <button type="button" class="m-wide-button danger" data-action="scan-departure" ${canDepart ? "" : "disabled"}>
        <i class="fa-solid fa-door-open"></i><span><strong>Encerrar Jornada</strong><small>Escaneie o QR Code para finalizar</small></span><i class="fa-solid fa-chevron-right"></i>
      </button>
      <button type="button" class="m-wide-button" data-tab-go="history">
        <i class="fa-solid fa-clock-rotate-left"></i><span><strong>Meu Histórico</strong><small>Ver seus registros de ponto</small></span><i class="fa-solid fa-chevron-right"></i>
      </button>
      ${state === "on_break" ? '<p class="m-hint">Durante o almoço, registre o retorno antes de uma nova leitura ou do encerramento.</p>' : ""}`;
  }

  // Tela do leitor: vídeo da câmera traseira com moldura de mira.
  // scanMode "encerrar" = leitura para finalizar a jornada.
  function scanScreen() {
    const closing = scanMode === "encerrar";
    return `<section class="m-card m-scan">
      <h1>${closing ? "Encerrar jornada" : "Registrar ponto"}</h1>
      <p>${closing ? "Aponte a câmera para o QR Code do <strong>veículo</strong> ou da <strong>unidade</strong> para finalizar o dia de trabalho." : "Aponte a câmera para o QR Code do <strong>veículo</strong> ou da <strong>unidade</strong>."}</p>
      <div class="m-camera"><video id="scan-video" playsinline muted></video><span class="m-camera-frame"></span><canvas id="scan-canvas" hidden></canvas>
        <p class="m-camera-message" id="scan-message"><i class="fa-solid fa-spinner fa-spin"></i> Abrindo a câmera...</p></div>
      <p class="m-hint">Funciona mesmo sem internet: o registro fica guardado no celular com o horário da leitura e é enviado depois.</p>
      <button type="button" class="m-button ghost" data-tab-go="home">Cancelar</button>
    </section>`;
  }

  // Confirmação depois de uma leitura: enviado, guardado para envio ou recusado (com o motivo).
  function resultScreen(outcome) {
    const { item, result } = outcome;
    const type = result?.eventType || (item.type === "departure" ? "departure" : item.qr?.startsWith("REOBOTE:V") ? "vehicle_checkin" : item.qr ? "unit_checkin" : item.type);
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

  // Etiqueta de cada dia do histórico: Normal, Atraso, Hora Extra, Falta, Folga...
  function dayBadge(day) {
    if (day.status === "absent") return ["bad", "fa-circle-xmark", "Falta"];
    if (day.status === "justified") return ["info", "fa-comment-medical", day.justification?.kindLabel || "Falta justificada"]; // pela Central
    if (day.status === "in_progress") return ["info", "fa-clock", "Em andamento"];
    if (day.status === "holiday") return ["neutral", "fa-umbrella-beach", "Feriado"];
    if (day.status === "off") return ["neutral", "fa-mug-saucer", "Folga"];
    if (day.status === "not_arrived") return ["warn", "fa-hourglass-half", "Não iniciado"];
    if (day.status === "scheduled") return ["neutral", "fa-calendar", "Previsto"];
    if (day.justification) return ["info", "fa-comment-medical", day.justification.kindLabel]; // não é descontado
    if (day.lateMinutes > 0) return ["warn", "fa-clock", "Atraso"];
    if (day.overtimeMinutes > 0) return ["extra", "fa-star", "Hora Extra"];
    return ["good", "fa-circle-check", "Normal"];
  }

  // Meu Histórico: períodos, totais (horas, atrasos, faltas, extras) e lista de dias com etiqueta.
  function historyScreen() {
    const history = store.history;
    const t = history?.totals;
    // Do dia mais recente para o mais antigo, como no modelo aprovado.
    const days = (history?.days || []).filter(day => day.status !== "off" || day.events.length).slice().sort((a, b) => b.date.localeCompare(a.date));
    const rangeText = historyRange === "custom" ? `${customRange.from ? dayLabel(customRange.from).slice(0, 5) : ""} a ${customRange.to ? dayLabel(customRange.to).slice(0, 5) : ""}`
      : historyRange === "month" ? monthName(historyMonth) : historyRange === 365 ? "Último ano" : `Últimos ${historyRange} dias`;
    let lastMonth = null; // para separar a lista por mês nos períodos longos
    const list = !history
      ? `<p class="m-loading"><i class="fa-solid fa-spinner fa-spin"></i> Carregando histórico...</p>`
      : days.map(day => {
        const [tone, icon, label] = dayBadge(day);
        const month = day.date.slice(0, 7);
        const monthHeader = historyRange !== 7 && historyRange !== "month" && month !== lastMonth ? `<h2 class="m-month-title">${monthName(month)}</h2>` : "";
        lastMonth = month;
        const first = day.events[0];
        const end = [...day.events].reverse().find(event => event.eventType === "departure");
        const open = openDay === day.date;
        return `${monthHeader}<article class="m-day ${open ? "open" : ""}">
          <button type="button" class="m-day-row" data-day="${esc(day.date)}">
            <span class="m-day-copy"><strong>${dayLabel(day.date)}</strong><small>${first ? `${time(first.occurredAt)} → ${end ? time(end.occurredAt) : "—"}` : "—"}</small></span>
            <i class="fa-solid ${icon} m-day-icon ${tone}"></i><span class="m-pill ${tone}">${label}</span><i class="fa-solid fa-chevron-right m-chevron"></i>
          </button>
          ${open ? `<div class="m-day-detail">
            <p>Trabalhadas <strong>${duration(day.workedMinutes)}</strong> • Almoço <strong>${duration(day.breakMinutes)}</strong>${day.lateMinutes ? ` • Atraso <strong class="bad">${duration(day.lateMinutes)}</strong>` : ""}${day.overtimeMinutes ? ` • Extra <strong class="good">${duration(day.overtimeMinutes)}</strong>` : ""}</p>
            ${day.events.length ? `<ul>${day.events.map(event => `<li><i class="fa-solid ${EVENT_ICONS[event.eventType] || "fa-clock"}"></i> ${time(event.occurredAt)} • ${esc(event.label)}${event.place ? ` • ${esc(event.place)}` : ""}</li>`).join("")}</ul>` : `<p>${day.holiday ? esc(day.holiday) : "Nenhum registro neste dia."}</p>`}
            ${day.arrivalDelayMinutes ? `<p class="bad">Chegou ${duration(day.arrivalDelayMinutes)} depois do horário: conta como falta${day.justification ? "" : " até a Central justificar"}.</p>` : ""}
            ${day.flags.includes("missing_departure") ? '<p class="bad">Jornada sem encerramento registrado.</p>' : ""}
            ${day.justification ? `<p class="m-justified"><i class="fa-solid fa-comment-medical"></i> ${esc(day.justification.kindLabel)} pela Central: ${esc(day.justification.reason)}${day.justification.hasAttachment ? " • atestado anexado" : ""}. Não é descontado do seu valor ganho.</p>` : ""}
          </div>` : ""}
        </article>`;
      }).join("") || '<p class="m-empty">Nenhum registro no período.</p>';
    const records = (history?.days || []).reduce((sum, day) => sum + day.events.length, 0);

    return `<section class="m-history">
      <header class="m-page-header">
        <button type="button" class="m-round" data-tab-go="home" aria-label="Voltar"><i class="fa-solid fa-arrow-left"></i></button>
        <h1>Meu Histórico</h1>
        <button type="button" class="m-round" data-range="custom" aria-label="Escolher período"><i class="fa-solid fa-calendar-days"></i></button>
      </header>
      <div class="m-segment" role="tablist">
        ${[[7, "7 dias"], ["month", "Mês"], [365, "1 ano"], ["custom", "Personalizado"]].map(([value, label]) => `<button type="button" data-range="${value}" class="${historyRange === value ? "active" : ""}">${label}</button>`).join("")}
      </div>
      ${historyRange === "month" ? `<div class="m-month-nav">
        <button type="button" class="m-round" data-month-step="-1" ${historyMonth <= monthOffset(-11) ? "disabled" : ""} aria-label="Mês anterior"><i class="fa-solid fa-chevron-left"></i></button>
        <strong>${monthName(historyMonth)}</strong>
        <button type="button" class="m-round" data-month-step="1" ${historyMonth >= monthOffset(0) ? "disabled" : ""} aria-label="Próximo mês"><i class="fa-solid fa-chevron-right"></i></button></div>` : ""}
      ${historyRange === "custom" ? `<form class="m-custom-range" id="custom-range">
        <label>De<input type="date" name="from" required value="${esc(customRange.from || localDate(-6))}" max="${localDate(0)}"></label>
        <label>Até<input type="date" name="to" required value="${esc(customRange.to || localDate(0))}" max="${localDate(0)}"></label>
        <button type="submit" class="m-button primary small">Ver</button></form>` : ""}
      <section class="m-stat-grid">
        <div class="m-stat"><i class="fa-solid fa-circle-check good"></i><span><small>Horas Trabalhadas</small><strong>${t ? duration(t.workedMinutes) : "—"}</strong></span></div>
        <div class="m-stat"><i class="fa-solid fa-clock bad"></i><span><small>Atrasos</small><strong>${t ? duration(t.lateMinutes) : "—"}</strong></span></div>
        <div class="m-stat"><i class="fa-solid fa-calendar-xmark purple"></i><span><small>Faltas</small><strong>${t ? t.absences : "—"}</strong></span></div>
        <div class="m-stat"><i class="fa-solid fa-star amber"></i><span><small>Horas Extras</small><strong>${t ? duration(t.overtimeMinutes) : "—"}</strong></span></div>
      </section>
      ${earningsCard(history?.pay)}
      ${history ? `<button type="button" class="m-button ghost m-pdf-button" data-action="history-pdf"><i class="fa-solid fa-file-pdf"></i> Baixar PDF do período</button>` : ""}
      <div class="m-day-list">${list}</div>
      ${history ? `<p class="m-info"><i class="fa-solid fa-circle-info"></i><span><strong>Período selecionado: ${esc(rangeText)}</strong>Total de registros: ${records}${!navigator.onLine ? " • sem internet, exibindo o último histórico baixado" : ""}</span></p>` : ""}
    </section>`;
  }

  // Valor em reais: 2500 -> "R$ 2.500,00".
  const money = value => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0);

  // Meu Histórico: quanto o técnico ganhou no período, pelo salário cadastrado na Central
  // (valor da hora = salário ÷ horas previstas no mês; extras com adicional; justificativas abonadas).
  function earningsCard(pay) {
    if (!pay) return "";
    const t = pay.totals;
    const rate = pay.months[pay.months.length - 1];
    const line = (label, minutes, value) => minutes ? `<li><span>${label} <small>${duration(minutes)}</small></span><strong>${money(value)}</strong></li>` : "";
    return `<section class="m-earnings">
      <header><i class="fa-solid fa-sack-dollar"></i><span><small>Valor ganho no período</small><strong>${money(t.total)}</strong></span></header>
      <ul>
        ${line("Horas normais", t.normalMinutes, t.normalValue)}
        ${line(`Horas extras (+${pay.overtimePercent}%)`, t.overtimeMinutes, t.overtimeValue)}
        ${line("Abonadas pela Central", t.justifiedMinutes, t.justifiedValue)}
      </ul>
      <p>Salário ${money(pay.salary)} • valor da hora ${money(rate.hourlyRate)}. Valor bruto, sem descontos.</p>
    </section>`;
  }

  // PDF do período escolhido no Meu Histórico (mesmo visual dos PDFs da Central).
  // No APK, o Android abre a janela para salvar o arquivo ou enviar pelo WhatsApp/e-mail.
  async function downloadHistoryPdf() {
    const history = store.history;
    if (!history) return;
    if (!window.ReobotePdf) await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "../compartilhado/js/pdf-reobote.js";
      script.onload = resolve;
      script.onerror = () => reject(new Error("gerador de PDF não carregou"));
      document.head.append(script);
    });
    const employee = store.today?.employee;
    const name = employee?.name || session.user.name;
    const t = history.totals;
    const brDate = iso => iso.split("-").reverse().join("/");
    const hm = value => value ? time(value) : "-";
    const pdf = await window.ReobotePdf.create({
      title: "Meu histórico de ponto",
      company: session.company.name,
      generated: `Gerado em ${new Date().toLocaleString("pt-BR")}`,
      subtitle: [name, [`Matrícula ${registration()}`, employee?.job, employee?.unit].filter(Boolean).join("   •   "), `Período: ${brDate(history.from)} a ${brDate(history.to)}`]
    });
    pdf.cards([
      ["Dias trabalhados", t.daysWorked], ["Faltas", t.absences, t.absences ? "bad" : ""], ["Atrasos", duration(t.lateMinutes), t.lateMinutes ? "bad" : ""],
      ["Horas extras", duration(t.overtimeMinutes), t.overtimeMinutes ? "good" : ""], ["Trabalhadas", duration(t.workedMinutes)],
      ...(history.pay ? [["Valor ganho", money(history.pay.totals.total), "good"]] : [])
    ]);
    const days = history.days.filter(day => day.status !== "off" || day.events.length).slice().sort((a, b) => a.date.localeCompare(b.date));
    pdf.table({
      head: [["Dia", "Situação", "Entrada", "Saída", "Almoço", "Trabalhadas", "Atraso", "Extra", "Registros"]],
      body: days.length ? days.map(day => {
        const end = [...day.events].reverse().find(event => event.eventType === "departure");
        return [dayLabel(day.date), day.justification ? day.justification.kindLabel : dayBadge(day)[2],
          hm(day.events[0]?.occurredAt), hm(end?.occurredAt), day.events.length ? duration(day.breakMinutes) : "-", day.events.length ? duration(day.workedMinutes) : "-",
          day.lateMinutes ? duration(day.lateMinutes) : "-", day.overtimeMinutes ? duration(day.overtimeMinutes) : "-",
          day.events.map(event => `${hm(event.occurredAt)}  ${event.label}${event.place ? ` - ${event.place}` : ""}`).join("\n") || "-"];
      }) : [["Nenhum registro no período.", "", "", "", "", "", "", "", ""]],
      columnStyles: { 0: { cellWidth: 24 }, 1: { cellWidth: 30 }, 2: { cellWidth: 15 }, 3: { cellWidth: 15 }, 4: { cellWidth: 15 }, 5: { cellWidth: 22 }, 6: { cellWidth: 15 }, 7: { cellWidth: 15 } }
    });
    if (history.pay) pdf.earnings(history.pay);
    const justified = days.filter(day => day.justification);
    if (justified.length) {
      pdf.note("Justificativas registradas pela Central no período:");
      pdf.table({
        head: [["Dia", "Ocorrência", "Motivo"]],
        body: justified.map(day => [dayLabel(day.date), day.justification.kind === "late" ? `Atraso de ${duration(day.lateMinutes)}` : "Falta", day.justification.reason + (day.justification.hasAttachment ? " (atestado anexado)" : "")]),
        columnStyles: { 0: { cellWidth: 30 }, 1: { cellWidth: 36 } }
      });
    }
    pdf.signatures(name);
    await pdf.save(`meu-ponto-${history.from}-a-${history.to}.pdf`);
    toast("PDF pronto.");
  }

  // Perfil: dados do colaborador, jornada prevista e aviso sobre a localização durante a jornada.
  function profileScreen() {
    const employee = store.today?.employee;
    const schedule = employee?.schedule;
    const rows = [
      ["fa-id-card", "Matrícula", registration()],
      ["fa-envelope", "E-mail", session.user.email],
      ["fa-phone", "Telefone", employee?.phone || "—"],
      ["fa-hospital", "Unidade", employee?.unit || "Sem unidade fixa"],
      ["fa-calendar-days", "Jornada", schedule ? `${schedule.start} às ${schedule.end} • almoço de ${schedule.breakMinutes} min` : "Definida pela Central"]
    ];
    return `<section class="m-profile-card vertical">
        ${photo(employee, "m-avatar big")}
        <h1>${esc(employee?.name || session.user.name)}</h1>
        <p>${esc(employee?.job || session.user.job || "Colaborador")}</p>
        ${statusPill(predicted().state)}
      </section>
      <section class="m-card m-list">${rows.map(([icon, label, value]) => `<div><i class="fa-solid ${icon}"></i><span><small>${label}</small><strong>${esc(value)}</strong></span></div>`).join("")}</section>
      <button type="button" class="m-wide-button light" data-action="test-gps">
        <i class="fa-solid fa-satellite-dish"></i><span><strong>Testar GPS</strong><small>Confere se o celular está enviando a localização</small></span><i class="fa-solid fa-chevron-right"></i>
      </button>
      <p class="m-info"><i class="fa-solid fa-location-dot"></i><span><strong>Localização durante a jornada</strong>Do início ao encerramento da jornada, sua localização é enviada automaticamente à Central. Fora da jornada, nada é enviado.</span></p>
      <button type="button" class="m-wide-button light" data-action="change-password" ${navigator.onLine ? "" : "disabled"}>
        <i class="fa-solid fa-key"></i><span><strong>Alterar senha</strong><small>Troque a sua senha de acesso</small></span><i class="fa-solid fa-chevron-right"></i>
      </button>`;
  }

  // Notificações do colaborador: registros recusados, aguardando envio e enviados hoje.
  function notificationsScreen() {
    const items = [];
    store.rejected.forEach(item => items.push({ tone: "bad", icon: "fa-triangle-exclamation", title: `${EVENT_LABELS[item.type === "scan" ? (item.qr?.startsWith("REOBOTE:V") ? "vehicle_checkin" : "unit_checkin") : item.type]} recusado`, text: item.error, at: item.occurredAt }));
    predicted().pendingEvents.slice().reverse().forEach(event => items.push({ tone: "warn", icon: "fa-cloud-arrow-up", title: event.label, text: "Guardado no celular, aguardando envio à Central.", at: event.occurredAt }));
    (store.today?.shiftEvents || []).slice().reverse().forEach(event => items.push({ tone: "good", icon: EVENT_ICONS[event.eventType] || "fa-circle-check", title: event.label, text: `Enviado à Central${event.place ? ` • ${event.place}` : ""}`, at: event.occurredAt }));
    // Uma lista só, da mais recente para a mais antiga (recusas, pendentes e enviados misturados pelo horário).
    items.sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
    const visible = items.slice(0, noticeLimit);
    const hidden = items.length - visible.length;
    return `<header class="m-page-header"><span></span><h1>Notificações</h1><span></span></header>
      <div class="m-notice-list">${visible.map(item => `<article class="m-notice ${item.tone}"><i class="fa-solid ${item.icon}"></i>
        <span><strong>${esc(item.title)}</strong><small>${esc(item.text)}</small></span><time>${dateTime(item.at)}</time></article>`).join("") || '<p class="m-empty"><i class="fa-solid fa-bell-slash"></i><br>Nenhuma notificação hoje.</p>'}</div>
      ${hidden > 0 ? `<button type="button" class="m-button ghost m-more-button" data-action="more-notices"><i class="fa-solid fa-plus"></i> Ver mais (${hidden})</button>` : ""}
      ${store.rejected.length ? '<button type="button" class="m-button ghost small" data-action="clear-rejected">Limpar avisos de recusa</button><p class="m-hint">Se algum registro estiver errado, avise a Central para um lançamento manual.</p>' : ""}`;
  }

  // Mais: tema, senha, Central, instalação, ajuda e sair.
  function moreScreen() {
    const dark = document.documentElement.dataset.theme === "dark";
    const row = (attrs, icon, title, subtitle) => `<button type="button" class="m-wide-button light" ${attrs}><i class="fa-solid ${icon}"></i><span><strong>${title}</strong><small>${subtitle}</small></span><i class="fa-solid fa-chevron-right"></i></button>`;
    return `<header class="m-page-header"><span></span><h1>Mais</h1><span></span></header>
      ${row("data-theme-toggle data-action=\"theme\"", dark ? "fa-sun" : "fa-moon", dark ? "Tema claro" : "Tema escuro", "Muda as cores do aplicativo")}
      ${row(`data-action="change-password" ${navigator.onLine ? "" : "disabled"}`, "fa-key", "Alterar senha", "Troque a sua senha de acesso")}
      ${session.user.centralAccess ? `<a class="m-wide-button light" href="${esc(centralUrl())}" target="_blank" rel="noopener"><i class="fa-solid fa-desktop"></i><span><strong>Abrir a Central</strong><small>Painel da administração</small></span><i class="fa-solid fa-chevron-right"></i></a>` : ""}
      ${!isNative && deferredInstall ? row('id="install-app"', "fa-download", "Instalar aplicativo", "Adicionar à tela inicial") : ""}
      <section class="m-card m-list">
        <div><i class="fa-solid fa-headset"></i><span><small>Ajuda</small><strong>${esc(session.company.name)}</strong></span></div>
        ${session.company.phone ? `<div><i class="fa-solid fa-phone"></i><span><small>Telefone</small><strong>${esc(session.company.phone)}</strong></span></div>` : ""}
        ${session.company.email ? `<div><i class="fa-solid fa-envelope"></i><span><small>E-mail</small><strong>${esc(session.company.email)}</strong></span></div>` : ""}
      </section>
      <p class="m-hint">Versão do aplicativo: <strong>${esc(window.REOBOTE_VERSAO || "web")}</strong></p>
      ${appUpdate?.ready ? `<button type="button" class="m-button primary" data-action="apply-update"><i class="fa-solid fa-rotate"></i> Usar a versão ${esc(appUpdate.version)} agora</button>` : ""}
      ${appUpdate?.needsApk ? `<p class="m-info"><i class="fa-solid fa-circle-info"></i><span><strong>Versão ${esc(appUpdate.version)} disponível</strong>Esta atualização precisa do APK novo. Peça o link à Central ou baixe em github.com/viinisilvaa/Reobote.</span></p>` : ""}
      <p class="m-hint">Registros feitos sem internet ficam guardados neste celular até serem enviados. Não desinstale o aplicativo nem limpe os dados dele com registros pendentes.</p>
      <button type="button" class="m-button danger" data-action="logout"><i class="fa-solid fa-arrow-right-from-bracket"></i> Sair</button>`;
  }

  // Desenha a tela atual. Telas com controle próprio (leitor, resultado, login, senha) não são redesenhadas aqui.
  function render() {
    if (!store) return;
    updateBadges();
    autoLocation();
    if (["scan", "result", "login", "password"].includes(tab)) return;
    document.querySelectorAll(".m-tabs [data-tab]").forEach(button => button.classList.toggle("active", button.dataset.tab === (tab === "history" ? "home" : tab)));
    const screens = { home: homeScreen, history: historyScreen, profile: profileScreen, notifications: notificationsScreen, more: moreScreen };
    screen.innerHTML = (screens[tab] || homeScreen)();
    updateBadges();
  }

  // Troca de tela pela barra inferior ou pelos botões.
  function go(next) {
    if (scanner && next !== "scan") stopScanner();
    tab = next;
    if (next === "scan") {
      document.querySelectorAll(".m-tabs [data-tab]").forEach(button => button.classList.toggle("active", button.dataset.tab === "home"));
      screen.innerHTML = scanScreen();
      startScanner();
      return;
    }
    if (next === "history") loadHistory();
    if (next === "notifications") noticeLimit = 5; // ao abrir, mostra só as 5 mais recentes
    render();
    screen.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  // Baixa o histórico do período escolhido e guarda uma cópia para consultar sem internet.
  async function loadHistory() {
    if (!navigator.onLine || !store || !session) return;
    // Datas do período: últimos N dias (7 ou 365), personalizado ou um mês inteiro.
    let from = typeof historyRange === "number" ? localDate(-(historyRange - 1)) : customRange.from;
    let to = typeof historyRange === "number" ? localDate(0) : customRange.to;
    if (historyRange === "month") {
      // Do dia 1 ao último dia do mês (ou até hoje, no mês atual).
      const [year, month] = historyMonth.split("-").map(Number);
      from = `${historyMonth}-01`;
      const last = `${historyMonth}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}`;
      to = last < localDate(0) ? last : localDate(0);
    }
    if (!from || !to) return;
    try {
      const history = await api.get(`/api/me/history?from=${from}&to=${to}`, { handleAuth: false });
      store.history = history;
      saveStore();
      if (tab === "history") render();
    } catch (error) {
      if (tab === "history") toast(error.message, "error");
    }
  }

  // Mês atual deslocado (0 = este mês, -11 = onze meses atrás), no formato AAAA-MM.
  function monthOffset(offset) {
    const [year, month] = localDate(0).split("-").map(Number);
    const moved = new Date(Date.UTC(year, month - 1 + offset, 1));
    return `${moved.getUTCFullYear()}-${String(moved.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  // "2026-11" -> "Novembro de 2026".
  function monthName(value) {
    const [year, month] = String(value || monthOffset(0)).split("-").map(Number);
    const name = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", month: "long" }).format(new Date(Date.UTC(year, month - 1, 1)));
    return `${name.charAt(0).toUpperCase()}${name.slice(1)} de ${year}`;
  }

  // Data local (AAAA-MM-DD) no fuso da empresa, deslocada em dias (0 = hoje, -6 = seis dias atrás).
  function localDate(offsetDays) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + offsetDays * 86400000));
  }

  // Leitor de QR Code, foto e localização ----------------------------------------------------------

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
        // Modo "encerrar": a leitura registra o fim da jornada; senão, início/chegada.
        const outcome = scanMode === "encerrar" ? await record("departure", { qr: value.trim() }) : await record("scan", { qr: value.trim() });
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

  // Busca a foto do colaborador pela API (no APK, imagens comuns não levam o login ao servidor).
  // Fotos pequenas ficam guardadas no celular para aparecer também sem internet.
  async function loadPhoto() {
    const employee = store?.today?.employee;
    if (!employee?.hasPhoto) {
      if (store?.photo) { store.photo = null; saveStore(); }
      return;
    }
    if (store.photo?.version === employee.photoVersion || !navigator.onLine) return;
    try {
      const { photo: data } = await api.get("/api/me/photo", { handleAuth: false });
      if (!data) return;
      if (data.length < 400000) {
        store.photo = { version: employee.photoVersion, data };
        saveStore();
      } else {
        photoInMemory = data;
      }
      render();
    } catch {
      /* sem foto: continuam as iniciais */
    }
  }

  // Localização durante a jornada ----------------------------------------------------------------
  // No APK, usa o plugin de localização em SEGUNDO PLANO: o técnico é acompanhado mesmo com a tela
  // apagada ou com outro app aberto (ex.: dirigindo o carro). O Android mostra uma notificação fixa
  // "REOBOTE: jornada em andamento" enquanto isso acontece. No navegador, só com o app aberto na tela.
  const BackgroundGeolocation = isNative ? window.Capacitor?.registerPlugin?.("BackgroundGeolocation") : null;
  let backgroundWatcher = null;       // promessa com o identificador do acompanhamento em segundo plano
  let backgroundUnavailable = false;  // plugin ausente (APK antigo): usa o acompanhamento comum

  // Mostra a situação do GPS na tela (linha embaixo do último registro e na tela Perfil).
  // tone: "ok" (enviado), "waiting" (procurando sinal), "denied" (sem permissão), "error" ou "idle".
  function setGps(tone, text) {
    gpsStatus = { tone, text };
    document.querySelectorAll(".m-gps").forEach(element => {
      element.className = `m-gps ${tone}`;
      element.querySelector("span").textContent = text;
    });
  }

  // Liga o envio de localização durante a jornada e desliga fora dela.
  // Com o app aberto, usa o GPS do navegador interno (o mesmo que já funcionava); no APK, o serviço em
  // segundo plano funciona junto, como reforço para quando a tela apaga. Posições repetidas são filtradas.
  function autoLocation() {
    if (!store || !session) return;
    const active = ["in_transit", "working", "on_break"].includes(predicted().state);
    if (!active || locationDenied) {
      stopLocationWatch();
      stopBackgroundTracking();
      if (!active && gpsStatus.tone !== "idle") setGps("idle", "GPS desligado fora da jornada");
      return;
    }
    startLocationWatch();
    if (BackgroundGeolocation && !backgroundUnavailable) startBackgroundTracking();
  }

  // Envia uma posição à Central: no máximo uma a cada 15 segundos, ou antes disso se andar mais de 20 metros.
  // force = true envia na hora (ex.: posição da leitura do QR Code).
  function sendLocation(latitude, longitude, accuracy, force = false) {
    if (Date.now() - fakeGpsAt < 120000) return; // GPS falso detectado há menos de 2 minutos: nada é enviado
    const moved = lastLocationSent.lat === null || Math.hypot((latitude - lastLocationSent.lat) * 111000, (longitude - lastLocationSent.lng) * 111000 * Math.cos(latitude * Math.PI / 180)) > 20;
    if (!force && !moved && Date.now() - lastLocationSent.at < 15000) return;
    if (!navigator.onLine) return setGps("error", "GPS ok, mas sem internet para enviar à Central");
    lastLocationSent = { at: Date.now(), lat: latitude, lng: longitude, accuracy: accuracy ?? null };
    api.post("/api/me/locations", { latitude, longitude, accuracyM: accuracy ?? 0 }, { handleAuth: false })
      .then(() => setGps("ok", `GPS enviado à Central às ${time(new Date())}${accuracy ? ` (precisão de ${Math.round(accuracy)} m)` : ""}`))
      .catch(error => {
        if (error.status === 409) { // 409 = fora da jornada
          stopLocationWatch();
          stopBackgroundTracking();
          setGps("idle", "GPS desligado fora da jornada");
        } else {
          setGps("error", `GPS não enviado: ${error.offline ? "sem conexão com o servidor" : error.message}`);
        }
      });
  }

  // Avisa uma única vez quando o celular não deixa o REOBOTE usar a localização.
  function warnLocationDenied() {
    setGps("denied", "GPS sem permissão: libere a localização do REOBOTE nas configurações do celular");
    if (locationDenied) return;
    locationDenied = true;
    toast("Permita a localização do REOBOTE (\"Permitir o tempo todo\" ou \"Durante o uso\") nas configurações do celular para a Central acompanhar a jornada.", "error");
  }

  // Ao abrir o app (e ao voltar para ele), pede a permissão de localização. Se o técnico negar ou se a
  // localização do celular estiver desligada, mostra uma janela explicando e pede de novo.
  let gpsAsking = false;
  function ensureGpsPermission() {
    if (!navigator.geolocation || gpsAsking || !session) return;
    gpsAsking = true;
    navigator.geolocation.getCurrentPosition(() => {
      gpsAsking = false;
      locationDenied = false;
      autoLocation();
    }, async error => {
      if (error.code === 3) { gpsAsking = false; return; } // demorou: tenta de novo na próxima vez
      const denied = error.code === 1;
      const openSettings = denied && isNative && BackgroundGeolocation;
      const again = await confirmSheet({
        title: denied ? "Permita a localização" : "Ligue a localização do celular",
        message: denied
          ? "O REOBOTE precisa da localização para registrar a jornada e mostrar sua posição à Central durante o trabalho. Escolha \"Permitir\" (de preferência \"o tempo todo\")."
          : "A localização (GPS) do celular está desligada. Ligue-a no painel de atalhos do celular e toque em Tentar de novo.",
        confirmLabel: openSettings ? "Abrir configurações" : "Tentar de novo"
      });
      gpsAsking = false;
      if (!again) return;
      if (openSettings) BackgroundGeolocation.openSettings().catch(() => {}); // volta ao app = novo pedido
      else ensureGpsPermission();
    }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 });
  }

  // Botão "Testar GPS" (tela Perfil): pede uma posição agora e mostra o resultado, para conferir o celular.
  function testGps() {
    if (!navigator.geolocation) return toast("Este aparelho não tem GPS disponível para o aplicativo.", "error");
    locationDenied = false;
    setGps("waiting", "Testando o GPS...");
    navigator.geolocation.getCurrentPosition(position => {
      const { latitude, longitude, accuracy } = position.coords;
      toast(`GPS funcionando: ${latitude.toFixed(5)}, ${longitude.toFixed(5)} (precisão de ${Math.round(accuracy)} m).`, "success");
      if (["in_transit", "working", "on_break"].includes(predicted().state)) sendLocation(latitude, longitude, accuracy, true);
      else setGps("idle", "GPS funcionando. Ele é enviado à Central só durante a jornada");
      autoLocation();
    }, error => {
      const reasons = { 1: "sem permissão de localização", 2: "sinal de GPS indisponível (ligue a localização do celular)", 3: "o GPS demorou para responder (tente perto de uma janela)" };
      if (error.code === 1) warnLocationDenied();
      else setGps("error", `GPS com problema: ${reasons[error.code] || error.message}`);
      toast(`GPS com problema: ${reasons[error.code] || error.message}`, "error");
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  }

  // Bloqueio de GPS falso ---------------------------------------------------------------------------
  // O Android marca as posições que vêm de apps de "GPS falso" (localização simulada). O plugin nativo
  // repassa essa marca no campo "simulated". Com ela, o app bloqueia o registro de ponto, não envia a
  // posição ao mapa e avisa a Central na hora. (No navegador essa marca não existe.)
  let fakeGpsAt = 0;          // quando foi detectada a última posição falsa
  let lastNativeFix = null;   // última posição recebida do plugin: { location, at }
  let fakeSheetOpen = false;

  // Detector nativo próprio do REOBOTE (aplicativo-android/nativo/MockLocationPlugin.java): pergunta ao
  // Android se há um app de GPS falso ativado ("app de local fictício" nas opções do desenvolvedor).
  const MockLocation = isNative ? window.Capacitor?.registerPlugin?.("MockLocation") : null;

  // Resolve com { mock, mockApps, enabledApps, lastLocationMock, checkedApps, errors }, ou null
  // (navegador, APK antigo ou erro). O erro fica guardado para o diagnóstico.
  let mockCheckError = null;
  async function checkMockApps() {
    if (!MockLocation) return null;
    try {
      mockCheckError = null;
      return await MockLocation.check();
    } catch (error) {
      mockCheckError = String(error?.message || error);
      return null;
    }
  }

  // Diagnóstico (uma vez ao abrir o app): envia ao servidor o resultado do detector de GPS falso, para a
  // administração conferir no histórico de alterações se a proteção está funcionando neste celular.
  let diagnosticSent = false;
  async function sendDiagnostic(result) {
    if (diagnosticSent || !isNative) return;
    diagnosticSent = true;
    api.post("/api/me/diagnostic", {
      detector: Boolean(MockLocation), backgroundPlugin: Boolean(BackgroundGeolocation) && !backgroundUnavailable,
      result: result || null, error: mockCheckError, version: window.REOBOTE_VERSAO || null, userAgent: navigator.userAgent
    }, { handleAuth: false }).catch(() => {});
  }

  // Verificação periódica (ao abrir, ao voltar para o app e a cada minuto): com GPS falso ativado,
  // nada é enviado ao mapa e o técnico vê o aviso.
  async function guardAgainstMock() {
    if (!session || !store) return;
    const mock = await checkMockApps();
    sendDiagnostic(mock);
    if (mock?.mock) blockFakeGps(null, "tracking", mock.mockApps);
  }

  // Pede uma posição ao plugin nativo (APK). Resolve com a posição (inclui "simulated"), null se não
  // houver sinal em 12 s, ou undefined quando o plugin não existe (navegador ou APK antigo).
  function nativeFix(timeoutMs = 12000) {
    if (!BackgroundGeolocation || backgroundUnavailable) return Promise.resolve(undefined);
    if (lastNativeFix && Date.now() - lastNativeFix.at < 20000) return Promise.resolve(lastNativeFix.location);
    return new Promise(resolve => {
      let watcherId = null;
      let done = false;
      const finish = value => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (watcherId) BackgroundGeolocation.removeWatcher({ id: watcherId }).catch(() => {});
        resolve(value);
      };
      const timer = setTimeout(() => finish(null), timeoutMs);
      // Sem "backgroundMessage": acompanhamento só com o app aberto, encerrado na primeira posição.
      BackgroundGeolocation.addWatcher({ requestPermissions: true, stale: false }, (location, error) => {
        if (error) return finish(null);
        if (location) {
          lastNativeFix = { location, at: Date.now() };
          finish(location);
        }
      }).then(id => {
        watcherId = id;
        if (done) BackgroundGeolocation.removeWatcher({ id }).catch(() => {});
      }).catch(() => finish(undefined));
    });
  }

  // GPS falso detectado: bloqueia, explica ao técnico e avisa a Central (no máximo 1 aviso a cada 10 min).
  function blockFakeGps(location, context, apps = []) {
    const first = Date.now() - fakeGpsAt > 600000;
    fakeGpsAt = Date.now();
    if (first || context === "checkin") {
      api.post("/api/me/mock-location", { context, latitude: location?.latitude ?? null, longitude: location?.longitude ?? null, apps }, { handleAuth: false }).catch(() => {});
    }
    if (fakeSheetOpen) return;
    fakeSheetOpen = true;
    confirmSheet({
      title: "GPS falso detectado",
      message: (apps.length ? `Este celular tem um aplicativo de GPS falso instalado: ${apps.map(app => app.replace(/ \(.*\)$/, "")).join(", ")}. Desinstale-o para registrar o ponto. ` : "Este celular está usando localização falsa (GPS falso). ") + (context === "checkin" ? "O registro de ponto foi bloqueado. " : "Sua localização não está sendo enviada. ") + "Desinstale ou desative o app de GPS falso e desligue a \"localização simulada\" nas opções do desenvolvedor do Android. A Central foi avisada.",
      confirmLabel: "Entendi",
      danger: true
    }).finally(() => { fakeSheetOpen = false; });
  }

  // APK: acompanhamento em segundo plano com o plugin @capacitor-community/background-geolocation.
  function startBackgroundTracking() {
    if (backgroundWatcher) return;
    backgroundWatcher = BackgroundGeolocation.addWatcher({
      backgroundTitle: "REOBOTE: jornada em andamento",
      backgroundMessage: "Sua localização é enviada à Central até o encerramento da jornada.",
      requestPermissions: true,  // pede a permissão de localização na primeira vez
      stale: false,              // ignora posições antigas
      distanceFilter: 0          // posições contínuas (também parado); o envio é limitado em sendLocation
    }, (location, error) => {
      if (error) {
        if (error.code === "NOT_AUTHORIZED") { stopBackgroundTracking(); warnLocationDenied(); }
        else setGps("error", `GPS em segundo plano com problema: ${error.message || error.code}`);
        return;
      }
      if (!location) return;
      lastNativeFix = { location, at: Date.now() };
      if (location.simulated) return blockFakeGps(location, "tracking"); // posição falsa: não vai para o mapa
      fakeGpsAt = 0; // posição verdadeira de novo
      sendLocation(location.latitude, location.longitude, location.accuracy);
    }).catch(() => {
      // APK gerado antes do plugin: volta ao acompanhamento comum (só com o app aberto).
      backgroundWatcher = null;
      backgroundUnavailable = true;
      startLocationWatch();
    });
  }

  // Encerra o acompanhamento em segundo plano (fim da jornada ou saída da conta) e a notificação fixa.
  function stopBackgroundTracking() {
    if (!backgroundWatcher) return;
    const pending = backgroundWatcher;
    backgroundWatcher = null;
    pending.then(id => id && BackgroundGeolocation.removeWatcher({ id })).catch(() => {});
  }

  // Navegador (ou APK sem o plugin): acompanhamento enquanto o aplicativo está aberto na tela.
  function startLocationWatch() {
    if (locationWatch !== null || !navigator.geolocation) return;
    if (gpsStatus.tone !== "ok") setGps("waiting", "Procurando sinal de GPS...");
    locationWatch = navigator.geolocation.watchPosition(position => {
      // No APK, quando o plugin nativo já está entregando posições, só elas contam: o navegador interno
      // não informa se a posição é falsa (GPS falso), e o plugin informa.
      if (isNative && lastNativeFix) return;
      const { latitude, longitude, accuracy } = position.coords;
      sendLocation(latitude, longitude, accuracy);
    }, error => {
      stopLocationWatch();
      if (error.code === 1) warnLocationDenied();
      else setGps("error", error.code === 3 ? "GPS demorando para responder, tentando de novo..." : "Sinal de GPS indisponível: confira se a localização do celular está ligada");
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  }

  // Para o acompanhamento comum (navegador).
  function stopLocationWatch() {
    if (locationWatch !== null) navigator.geolocation.clearWatch(locationWatch);
    locationWatch = null;
  }

  // Login e senha (telas próprias do aplicativo) -------------------------------------------------

  // Mostra ou esconde a barra de abas e o sino (escondidos no login).
  function chrome(visible) {
    document.querySelector(".m-tabs").hidden = !visible;
    document.querySelector("#header-bell").hidden = !visible;
  }

  // Tela de erro que impede o uso (ex.: cargo sem permissão para o aplicativo).
  function fatal(title, text, action = "") {
    screen.innerHTML = `<section class="m-card m-result error"><i class="fa-solid fa-circle-exclamation"></i><h1>${esc(title)}</h1><p>${esc(text)}</p>${action}</section>`;
    chrome(false);
  }

  // Tela de login: só e-mail, senha e "Esqueci minha senha".
  function showLogin(message = "") {
    stopScanner();
    stopLocationWatch();
    // A fila offline continua salva no celular e volta a ser enviada quando a mesma conta entrar de novo.
    session = null;
    store = null;
    tab = "login";
    chrome(false);
    screen.innerHTML = `<section class="m-card m-auth">
      <img class="m-auth-logo" src="../compartilhado/assets/reobote-mark.png" alt="">
      <h1>Entrar no aplicativo</h1>
      <p>Use o e-mail corporativo e a senha entregues pela Central.</p>
      ${message ? `<p class="m-auth-notice">${esc(message)}</p>` : ""}
      <form id="app-login-form" class="m-form">
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
    </section>`;
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

  // Sair: vale mesmo sem internet. Apaga a sessão guardada no celular, o cookie de login (APK) e marca
  // que o colaborador saiu, para o app não entrar sozinho na conta ao ser aberto de novo.
  function logout() {
    stopLocationWatch();
    stopBackgroundTracking();
    try {
      localStorage.removeItem(SESSION_KEY);
      localStorage.setItem(LOGGED_OUT_KEY, "1");
    } catch { /* sem armazenamento */ }
    api.post("/api/auth/logout", {}, { handleAuth: false }).catch(() => {}); // avisa o servidor, se houver conexão
    window.Capacitor?.Plugins?.CapacitorCookies?.clearAllCookies?.().catch?.(() => {});
    showLogin();
  }

  // Abre o aplicativo para a conta autenticada (depois do login ou ao reabrir com a sessão ativa).
  async function enter(newSession) {
    session = newSession;
    try { localStorage.removeItem(LOGGED_OUT_KEY); } catch { /* sem armazenamento */ }
    try { localStorage.setItem(SESSION_KEY, JSON.stringify({ user: session.user, company: session.company, rules: session.rules })); } catch { /* sem armazenamento */ }
    if (session.user.mustChangePassword) return showPassword(true);
    timezone = session.rules.timezone || timezone;
    // Só colaboradores cujo cargo tem a permissão "Aplicativo" podem registrar jornada.
    if (!session.user.employeeId || !session.user.permissions.includes("app")) {
      return fatal("Aplicativo não liberado", "Seu cargo não tem permissão para registrar jornada pelo aplicativo.",
        `${session.user.centralAccess ? `<a class="m-button primary" href="${esc(centralUrl())}" target="_blank" rel="noopener">Abrir a Central</a>` : ""}<button type="button" class="m-button ghost" data-action="logout">Sair</button>`);
    }
    chrome(true);
    loadStore(session.user.id);
    ensureGpsPermission(); // pede a localização logo ao entrar
    guardAgainstMock();    // confere se há app de GPS falso ativado
    tab = "home";
    render();
    await sync();          // envia o que ficou guardado
    await refreshToday();  // atualiza a situação do dia (e a foto)
    if (!timersStarted) {
      // A cada minuto: envia registros pendentes e atualiza a situação.
      timersStarted = true;
      setInterval(() => { if (session && store && !["login", "password"].includes(tab)) { sync(); refreshToday(); guardAgainstMock(); } }, 60000);
    }
  }

  // Eventos de interface -------------------------------------------------------------------------

  // Um único ouvinte de cliques trata todos os botões (inclusive os criados depois, ao trocar de tela).
  document.addEventListener("click", async event => {
    const tabButton = event.target.closest("[data-tab]");
    if (tabButton) return store && go(tabButton.dataset.tab);
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
    // Tela Mais: aplicar a atualização já baixada (o app recarrega com as telas novas).
    if (event.target.closest('[data-action="apply-update"]') && appUpdate?.id) {
      if (store?.queue?.length) toast("Registros pendentes continuam guardados e serão enviados depois.");
      Updater.set({ id: appUpdate.id }).catch(error => toast(`Não foi possível atualizar: ${error.message}`, "error"));
      return;
    }
    // Histórico: baixar o PDF do período.
    if (event.target.closest('[data-action="history-pdf"]')) {
      if (!navigator.onLine && !window.ReobotePdf && !isNative) {
        toast("Conecte-se à internet para gerar o PDF.", "error");
        return;
      }
      toast("Gerando o PDF...");
      downloadHistoryPdf().catch(error => toast(`Não foi possível gerar o PDF: ${error.message}`, "error"));
      return;
    }
    // Histórico: troca de período e abertura dos detalhes de um dia.
    const range = event.target.closest("[data-range]");
    if (range) {
      historyRange = ["custom", "month"].includes(range.dataset.range) ? range.dataset.range : Number(range.dataset.range);
      if (historyRange === "month" && !historyMonth) historyMonth = monthOffset(0);
      if (historyRange === "custom") {
        customRange = { from: customRange.from || localDate(-6), to: customRange.to || localDate(0) };
      }
      store.history = null;
      openDay = null;
      render();
      loadHistory();
      return;
    }
    // Setas do período "Mês": volta ou avança um mês (até 12 meses atrás).
    const monthStep = event.target.closest("[data-month-step]");
    if (monthStep) {
      const [year, month] = historyMonth.split("-").map(Number);
      const moved = new Date(Date.UTC(year, month - 1 + Number(monthStep.dataset.monthStep), 1));
      historyMonth = `${moved.getUTCFullYear()}-${String(moved.getUTCMonth() + 1).padStart(2, "0")}`;
      store.history = null;
      openDay = null;
      render();
      loadHistory();
      return;
    }
    const dayRow = event.target.closest("[data-day]");
    if (dayRow) {
      openDay = openDay === dayRow.dataset.day ? null : dayRow.dataset.day;
      return render();
    }
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!action) return;
    // Leitor de QR Code: início do expediente, chegada na unidade ou encerramento.
    if (["scan", "scan-vehicle", "scan-unit"].includes(action)) {
      if (!(await gpsReady())) return; // GPS desligado: avisa e não abre a câmera
      scanMode = "registro";
      return go("scan");
    }
    if (action === "scan-departure") {
      const problem = localCheck("departure");
      if (problem) return toast(problem, "error");
      if (!(await gpsReady())) return;
      scanMode = "encerrar";
      return go("scan");
    }
    if (action === "theme") return setTimeout(render, 0); // o theme.js troca o tema; aqui só redesenha
    if (action === "more-notices") {
      noticeLimit += 5;
      return render();
    }
    if (action === "clear-rejected") {
      store.rejected = [];
      saveStore();
      return render();
    }
    if (action === "logout") {
      // Antes de sair, avisa se ainda há registros guardados que não chegaram à Central.
      if (store?.queue.length && !(await confirmSheet({ title: "Há registros não enviados", message: `${store.queue.length} registro(s) ainda não chegaram à Central. Eles continuam guardados neste celular e serão enviados quando você entrar de novo.`, confirmLabel: "Sair mesmo assim", danger: true }))) return;
      return logout();
    }
    if (action === "change-password") return showPassword(false);
    if (action === "test-gps") return testGps();
    if (action === "cancel-password") return go("more");
    if (action === "forgot") {
      const form = document.querySelector("#app-forgot-form");
      form.hidden = !form.hidden;
      if (!form.hidden) {
        form.elements.email.value = document.querySelector("#app-login-form").elements.email.value;
        form.elements.email.focus();
      }
      return;
    }
    if (["break_start", "break_end"].includes(action)) {
      if (localCheck(action)) return toast(localCheck(action), "error");
      if (!(await gpsReady())) return; // GPS desligado: o almoço não é registrado
      const outcome = await record(action);
      if (outcome) {
        const sent = outcome.result && outcome.result.status !== "rejected";
        if (outcome.result?.status === "rejected") toast(outcome.result.error, "error");
        else toast(`${EVENT_LABELS[action]} às ${time(outcome.item.occurredAt)}${sent ? " — enviado à Central." : " — guardado, será enviado ao reconectar."}`, "success");
        render();
      }
    }
  });

  // Envio dos formulários: login, "esqueci minha senha", senha e período personalizado do histórico.
  document.addEventListener("submit", async event => {
    const form = event.target;
    if (form.id === "custom-range") {
      event.preventDefault();
      const data = new FormData(form);
      const from = String(data.get("from"));
      const to = String(data.get("to"));
      if (from > to) return toast("A data inicial deve ser antes da final.", "error");
      if ((new Date(to) - new Date(from)) / 86400000 > 366) return toast("Escolha um período de no máximo 1 ano.", "error");
      customRange = { from, to };
      store.history = null;
      render();
      loadHistory();
      return;
    }
    if (!["app-login-form", "app-forgot-form", "app-password-form"].includes(form.id)) return;
    event.preventDefault();
    const data = new FormData(form);
    const errorBox = form.querySelector(".m-form-error");
    const submit = form.querySelector('button[type="submit"]');
    if (errorBox) errorBox.hidden = true;
    submit.disabled = true;
    try {
      if (isNative && !api.baseUrl) throw Object.assign(new Error("offline"), { offline: true });
      if (form.id === "app-login-form") {
        const result = await api.post("/api/auth/login", { email: data.get("email"), password: data.get("password"), remember: data.has("remember") }, { handleAuth: false });
        await enter(result);
      }
      if (form.id === "app-forgot-form") {
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
      const text = error.offline
        ? (isNative ? "Não foi possível conectar ao servidor da Central. Verifique a internet e tente de novo em instantes." : "Sem internet. Conecte-se para continuar.")
        : error.message;
      if (errorBox) {
        errorBox.textContent = text;
        errorBox.hidden = false;
      } else {
        toast(text, "error");
      }
    } finally {
      submit.disabled = false;
    }
  });

  // Ao recuperar a internet, envia a fila; ao perder, apenas avisa.
  window.addEventListener("online", () => { toast("Conexão restabelecida. Enviando registros..."); sync().then(refreshToday); });
  window.addEventListener("offline", () => { toast("Sem internet. Os registros serão guardados no celular."); render(); });
  // Ao sair do app a câmera é fechada; ao voltar, sincroniza.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (scanner) go("home");
    } else {
      sync().then(refreshToday);
      ensureGpsPermission(); // ex.: o técnico desligou e religou o GPS: pede a permissão de novo
      guardAgainstMock();
    }
  });

  // Convite para instalar o PWA (somente no navegador; o APK já é instalado).
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredInstall = event;
    if (tab === "more") render();
  });

  // Atualização automática (só no APK) ---------------------------------------------------------
  // A cada geração do APK, o GitHub publica também as telas do app num zip (atualizacao.zip) e a
  // descrição da versão (atualizacao.json). Ao abrir, o app confere a versão: se houver uma mais nova
  // do mesmo "nível nativo", baixa o zip em segundo plano e passa a usar as telas novas na próxima vez
  // que for aberto (ou na hora, pelo botão da tela Mais). Sem internet, continua com a versão atual.
  // Quando a novidade exige um APK novo (plugins/permissões), mostra o aviso para baixar o APK.
  const Updater = isNative ? window.Capacitor?.registerPlugin?.("CapacitorUpdater") : null;
  let appUpdate = null; // { ready: true, version, id } ou { needsApk: true, version }

  // "1.0.57" -> 57 (número da geração no GitHub).
  const buildNumber = version => Number(String(version || "").split(".").pop()) || 0;

  async function checkAppUpdate() {
    if (!Updater) return;
    // Confirma que esta versão abriu bem (sem isso, o atualizador volta para a versão anterior).
    await Updater.notifyAppReady().catch(() => {});
    const url = window.REOBOTE_CONFIG?.atualizacao;
    if (!url || !navigator.onLine) return;
    try {
      const response = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) return;
      const info = await response.json();
      if (!info?.version || !info.url || buildNumber(info.version) <= buildNumber(window.REOBOTE_VERSAO)) return;
      if (Number(info.nativo) !== Number(window.REOBOTE_NATIVO || 1)) {
        appUpdate = { needsApk: true, version: info.version }; // precisa instalar o APK novo
      } else {
        // Já baixada antes? Só marca para usar. Senão, baixa agora (em segundo plano).
        const { bundles = [] } = await Updater.list().catch(() => ({}));
        const bundle = bundles.find(item => item.version === info.version && item.status === "success")
          || await Updater.download({ url: info.url, version: info.version });
        await Updater.next({ id: bundle.id });
        appUpdate = { ready: true, version: info.version, id: bundle.id };
        toast("Nova versão do aplicativo baixada. Ela entra na próxima vez que o app for aberto.");
      }
      if (tab === "more") render();
    } catch {
      /* sem internet ou GitHub fora do ar: tenta de novo na próxima abertura */
    }
  }

  // Inicialização -----------------------------------------------------------------------------
  async function start() {
    // No navegador, o service worker guarda as telas para abrir sem internet.
    // No APK isso não é necessário: os arquivos já estão dentro do aplicativo.
    if (!isNative && "serviceWorker" in navigator && location.protocol !== "file:") {
      navigator.serviceWorker.register("/app/sw.js", { scope: "/app/" }).catch(() => {});
    }
    if (isNative) {
      checkAppUpdate(); // em paralelo: não atrasa a abertura do app
      await discoverServer(); // endereço atual publicado no GitHub
      await chooseServer();   // usa o primeiro endereço que responder (GitHub ou o embutido no APK)
      if (!api.baseUrl) return showLogin();
    } else {
      // Navegador: confere se o banco do servidor foi zerado (limpa os dados antigos guardados).
      try { checkInstall(await api.get("/api/config", { handleAuth: false })); } catch { /* sem internet */ }
    }
    // Depois de tocar em Sair, o app sempre abre na tela de login.
    let loggedOut = false;
    try { loggedOut = localStorage.getItem(LOGGED_OUT_KEY) === "1"; } catch { loggedOut = false; }
    if (loggedOut) return showLogin();
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
