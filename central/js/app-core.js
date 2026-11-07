// REOBOTE | central/js/app-core.js — Central: núcleo (sessão, menu por permissões e utilitários)
// Núcleo da Central REOBOTE: confere a sessão, monta o menu conforme as permissões,
// oferece utilitários de interface (diálogos, avisos, formatação) e inicia o módulo da página.
(function () {
  "use strict";

  const api = window.ReoboteApi;
  const activePage = document.body.dataset.page || "dashboard";

  // Páginas da Central: arquivo, título, descrição, ícone e permissão exigida.
  const pages = {
    dashboard: { file: "painel-principal.html", title: "Painel Principal", description: "Visão geral da operação e dos registros recebidos.", icon: "fa-house", permission: ["dashboard"] },
    employees: { file: "colaboradores.html", title: "Colaboradores", description: "Cadastre pessoas, gerencie acessos e acompanhe a situação de cada uma.", icon: "fa-users", permission: ["employees"] },
    jobs: { file: "cargos.html", title: "Cargos e Permissões", description: "Organize as funções da equipe e o que cada uma pode acessar.", icon: "fa-briefcase", permission: ["jobs"] },
    schedules: { file: "jornadas.html", title: "Jornadas e Escalas", description: "Defina horários, intervalos, dias de trabalho, tolerância e feriados.", icon: "fa-calendar-days", permission: ["jobs"] },
    units: { file: "unidades.html", title: "Unidades e QR Codes", description: "Cadastre locais de atendimento e gere os QR Codes de veículos e unidades.", icon: "fa-qrcode", permission: ["units"] },
    map: { file: "mapa-tempo-real.html", title: "Mapa em Tempo Real", description: "Acompanhe unidades, chegadas e a localização autorizada da equipe.", icon: "fa-location-dot", permission: ["dashboard"] },
    reports: { file: "relatorios.html", title: "Relatórios", description: "Frequência, atrasos, faltas, horas extras e horas trabalhadas por período.", icon: "fa-chart-simple", permission: ["reports"] },
    notifications: { file: "notificacoes.html", title: "Notificações", description: "Acontecimentos importantes recebidos do aplicativo e do sistema.", icon: "fa-bell", permission: ["notifications", "dashboard"] },
    settings: { file: "configuracoes.html", title: "Configurações", description: "Dados institucionais, regras do sistema, sua conta e auditoria.", icon: "fa-gear", permission: null },
    // Download do APK e instruções de instalação: disponível para todos que acessam a Central.
    download: { file: "aplicativo.html", title: "Aplicativo", description: "Baixe o aplicativo REOBOTE (APK) e veja como instalar nos celulares da equipe.", icon: "fa-mobile-screen-button", permission: null },
    help: { file: "ajuda.html", title: "Ajuda", description: "Respostas rápidas sobre o uso da plataforma.", icon: "fa-circle-question", permission: null },
    profile: { file: "perfil-colaborador.html", title: "Perfil do Colaborador", description: "Dados, cargos e histórico de jornada.", icon: "fa-id-card", permission: null, hidden: true }
  };

  // Utilitários de texto e formatação ------------------------------------------------------

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }

  let timezone = "America/Sao_Paulo";
  // Formata uma data/hora no fuso da empresa com as opções do Intl (base das funções fmt abaixo).
  function formatDate(value, options) {
    if (!value) return "—";
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, ...options }).format(date);
  }

  const fmt = {
    date: value => formatDate(value, { day: "2-digit", month: "2-digit", year: "numeric" }),
    time: value => formatDate(value, { hour: "2-digit", minute: "2-digit" }),
    dateTime: value => formatDate(value, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }),
    weekday: value => formatDate(value, { weekday: "short" }),
    // Datas no formato AAAA-MM-DD representam dias do calendário, sem fuso.
    day: isoDate => {
      const [year, month, day] = String(isoDate).split("-").map(Number);
      return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "2-digit" }).format(new Date(Date.UTC(year, month - 1, day)));
    },
    dayFull: isoDate => {
      const [year, month, day] = String(isoDate).split("-").map(Number);
      return new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(Date.UTC(year, month - 1, day)));
    },
    duration: minutes => {
      const total = Math.max(0, Math.round(Number(minutes) || 0));
      return `${Math.floor(total / 60)}h${String(total % 60).padStart(2, "0")}`;
    },
    relative: value => {
      const diff = (Date.now() - new Date(value).getTime()) / 60000;
      if (!Number.isFinite(diff)) return "—";
      if (diff < 1) return "agora";
      if (diff < 60) return `há ${Math.round(diff)} min`;
      if (diff < 1440) return `há ${Math.round(diff / 60)} h`;
      return formatDate(value, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    }
  };

  // Data local (AAAA-MM-DD) no fuso da empresa.
  function localDate(offsetDays = 0) {
    const date = new Date(Date.now() + offsetDays * 86400000);
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
    return parts;
  }

  // "Fernando Silva" -> "FS" (usado quando não há foto).
  function initials(name) {
    return String(name || "?").trim().split(/\s+/).filter(Boolean).map(part => part[0]).slice(0, 2).join("").toUpperCase() || "?";
  }

  // Foto protegida pela API ou iniciais quando não há foto.
  function avatar(person, className = "avatar") {
    const id = person?.employeeId ?? person?.id;
    if (person?.hasPhoto && id) {
      return `<span class="${className}"><img src="/api/employees/${encodeURIComponent(id)}/photo?v=${esc(person.photoVersion || "1")}" alt="" loading="lazy" data-fallback="${esc(initials(person.name || person.employeeName))}"></span>`;
    }
    return `<span class="${className}">${esc(initials(person?.name || person?.employeeName))}</span>`;
  }

  // Situação da jornada com cor semântica.
  const stateTones = { working: "success", in_transit: "info", on_break: "warning", finished: "muted", waiting: "muted" };
  // Etiqueta colorida com a situação do colaborador (Em atendimento, Em almoço...).
  function statePill(state, label) {
    return `<span class="state-pill state-${esc(state)} ${stateTones[state] || "muted"}">${esc(label)}</span>`;
  }

  const dayStatus = {
    worked: ["Trabalhado", "success"], in_progress: ["Em andamento", "info"], absent: ["Falta", "danger"],
    not_arrived: ["Não iniciou", "danger"], scheduled: ["Previsto", "muted"], off: ["Folga", "muted"], holiday: ["Feriado", "muted"]
  };
  // Etiqueta colorida com a situação de um dia (Trabalhado, Falta, Folga...).
  function dayPill(status) {
    const [label, tone] = dayStatus[status] || [status, "muted"];
    return `<span class="state-pill ${tone}">${esc(label)}</span>`;
  }

  // Texto da situação de um dia, sem a etiqueta colorida (usado no CSV).
  function dayLabel(status) {
    return (dayStatus[status] || [status])[0];
  }

  const eventIcons = {
    vehicle_checkin: "fa-van-shuttle", unit_checkin: "fa-hospital", arrival: "fa-right-to-bracket",
    break_start: "fa-utensils", break_end: "fa-mug-hot", departure: "fa-flag-checkered"
  };

  // Atrasa a execução até o usuário parar de digitar (evita uma busca por tecla).
  function debounce(callback, wait = 300) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => callback(...args), wait);
    };
  }

  // CSV compatível com Excel em português (separador ";" e BOM UTF-8).
  function downloadCsv(fileName, rows) {
    const csv = "﻿" + rows.map(row => row.map(value => `"${String(value ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Avisos e diálogos ---------------------------------------------------------------------

  let toastTimer;
  // Aviso temporário no canto da tela. tone: "info", "success" ou "error".
  function toast(message, tone = "info") {
    const element = document.querySelector("#toast");
    if (!element) return;
    element.textContent = message;
    element.dataset.tone = tone;
    element.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove("visible"), 4200);
  }

  // Abre um diálogo modal com formulário. onSubmit pode retornar false para manter o diálogo aberto.
  function openDialog({ title, subtitle = "", body = "", submitLabel = "Salvar", cancelLabel = "Cancelar", wide = false, danger = false, onSubmit, onOpen, hideSubmit = false }) {
    const root = document.querySelector("#dialog-root");
    const dialog = document.createElement("dialog");
    dialog.className = `app-dialog${wide ? " wide-dialog" : ""}`;
    dialog.innerHTML = `<form method="dialog" novalidate>
      <div class="dialog-heading"><div><h2>${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ""}</div>
        <button type="button" class="icon-button" data-dialog-close aria-label="Fechar"><i class="fa-solid fa-xmark"></i></button></div>
      <div class="dialog-body">${body}</div>
      <p class="form-error" role="alert" hidden></p>
      <div class="form-actions">
        <button type="button" class="clear" data-dialog-close>${esc(cancelLabel)}</button>
        ${hideSubmit ? "" : `<button type="submit" class="save${danger ? " danger" : ""}">${esc(submitLabel)}</button>`}
      </div>
    </form>`;
    root.append(dialog);
    const form = dialog.querySelector("form");
    const errorBox = dialog.querySelector(".form-error");
    return new Promise(resolve => {
      let result = null;
      // Fecha o diálogo (a promessa é resolvida no evento "close").
      const close = () => dialog.close();
      dialog.addEventListener("close", () => {
        dialog.remove();
        resolve(result);
      });
      dialog.addEventListener("click", event => {
        if (event.target === dialog || event.target.closest("[data-dialog-close]")) close();
      });
      form.addEventListener("submit", async event => {
        event.preventDefault();
        if (!form.reportValidity()) return;
        errorBox.hidden = true;
        const submit = form.querySelector('button[type="submit"]');
        if (submit) submit.disabled = true;
        try {
          const value = onSubmit ? await onSubmit(new FormData(form), form) : true;
          if (value !== false) {
            result = value ?? true;
            close();
          }
        } catch (error) {
          errorBox.textContent = error.message;
          errorBox.hidden = false;
        } finally {
          if (submit) submit.disabled = false;
        }
      });
      dialog.showModal();
      onOpen?.(form, dialog);
      form.querySelector("input:not([type=hidden]), select, textarea")?.focus();
    });
  }

  // Pergunta de confirmação (ex.: "Excluir cargo?"). Resolve true quando o usuário confirma.
  function confirmAction({ title, message, confirmLabel = "Confirmar", danger = false }) {
    return openDialog({ title, body: `<p class="dialog-message">${esc(message)}</p>`, submitLabel: confirmLabel, danger }).then(Boolean);
  }

  // Solicita uma justificativa curta (anulação, lançamento manual, etc.).
  function askReason({ title, message, label = "Motivo", confirmLabel = "Confirmar", danger = false }) {
    return openDialog({
      title, danger, submitLabel: confirmLabel,
      body: `<p class="dialog-message">${esc(message)}</p><label class="field"><span>${esc(label)} *</span><textarea class="text-control" name="reason" rows="3" maxlength="300" required></textarea></label>`,
      onSubmit: data => String(data.get("reason")).trim() || false
    });
  }

  // Mostra uma senha temporária uma única vez, com botão de copiar.
  function showTemporaryPassword(name, email, password) {
    return openDialog({
      title: "Senha temporária gerada",
      subtitle: "Ela não será exibida novamente.",
      hideSubmit: true,
      cancelLabel: "Fechar",
      body: `<p class="dialog-message">Entregue a <strong>${esc(name)}</strong> os dados de primeiro acesso. No primeiro login será obrigatório criar uma senha definitiva.</p>
        <dl class="credential-box"><div><dt>E-mail</dt><dd>${esc(email)}</dd></div><div><dt>Senha temporária</dt><dd><code>${esc(password)}</code></dd></div></dl>
        <button type="button" class="button-secondary" data-copy="${esc(password)}"><i class="fa-solid fa-copy"></i> Copiar senha</button>`,
      onOpen: form => form.querySelector("[data-copy]").addEventListener("click", async event => {
        try {
          await navigator.clipboard.writeText(event.currentTarget.dataset.copy);
          toast("Senha copiada.");
        } catch {
          toast("Não foi possível copiar automaticamente. Selecione e copie a senha.");
        }
      })
    });
  }

  // Título da página com ícone, descrição e botões opcionais à direita.
  function heading(page, actions = "") {
    const info = pages[page];
    return `<div class="page-heading"><i class="fa-solid ${info.icon}"></i><div><h1>${esc(info.title)}</h1><p>${esc(info.description)}</p></div>${actions ? `<div class="page-actions">${actions}</div>` : ""}</div>`;
  }

  // Bloco exibido quando uma lista está vazia ou quando algo deu errado.
  function emptyState(icon, title, text = "", action = "") {
    return `<div class="empty-block"><i class="fa-solid ${icon}"></i><strong>${esc(title)}</strong>${text ? `<p>${esc(text)}</p>` : ""}${action}</div>`;
  }

  // Indicador de carregamento.
  function loading(text = "Carregando...") {
    return `<p class="loading-state" role="status"><i class="fa-solid fa-spinner fa-spin"></i> ${esc(text)}</p>`;
  }

  // Shell da Central ----------------------------------------------------------------------

  function canAccess(user, page) {
    const required = pages[page]?.permission;
    if (!required) return true;
    return required.some(permission => user.permissions.includes(permission));
  }

  /**
   * Desenha a estrutura fixa da Central: menu lateral (somente com as páginas que o usuário pode
   * acessar), cabeçalho com nome, notificações, tema e sair, e a área onde cada página é montada.
   */
  function renderShell(session) {
    const user = session.user;
    // Um link por página permitida; o contador de notificações fica no item "Notificações".
    const links = Object.entries(pages)
      .filter(([key, info]) => !info.hidden && canAccess(user, key))
      .map(([key, info]) => `<a class="nav-link${key === "download" ? " nav-app" : ""}${key === activePage ? " selected" : ""}" href="${info.file}" data-page="${key}"${key === activePage ? ' aria-current="page"' : ""}><i class="fa-solid ${info.icon}"></i><span>${esc(info.title)}</span>${key === "notifications" ? '<b class="nav-count" hidden></b>' : ""}</a>`)
      .join("");
    const appLink = "";
    const canNotify = user.permissions.includes("notifications") || user.permissions.includes("dashboard");
    document.body.innerHTML = `
      <a class="skip-link" href="#dashboard">Pular para o conteúdo</a>
      <div class="app">
        <aside class="sidebar">
          <a class="brand" href="${canAccess(user, "dashboard") ? pages.dashboard.file : pages.settings.file}" aria-label="Central REOBOTE"><strong>REOBOTE</strong><small>Tecnologia que conecta.</small></a>
          <nav class="navigation" aria-label="Menu principal">${links}${appLink}</nav>
          <div class="partners">
            <div class="partners-heading"><i class="fa-solid fa-handshake"></i><strong>Parceiros</strong></div>
            <div class="partner-list">
              <div class="partner-entry"><a class="partner-logo" href="https://www.intelbras.com/pt-br/" target="_blank" rel="noopener noreferrer" aria-label="Site da Intelbras (nova aba)"><img src="assets/intelbras-logo.png" alt="Intelbras"></a><small>Parceira oficial</small></div>
              <div class="partner-divider"></div>
              <div class="partner-entry"><a class="partner-logo" href="https://www.saudeamericas.com.br/" target="_blank" rel="noopener noreferrer" aria-label="Site da Rede Américas (nova aba)"><img src="assets/rede-americas-logo.png" alt="Rede Américas"></a><small>Rede de hospitais</small></div>
            </div>
          </div>
        </aside>
        <main class="workspace">
          <header class="topbar">
            <div class="welcome">${user.hasPhoto ? avatar({ id: user.employeeId, name: user.name, hasPhoto: true, photoVersion: Date.now().toString(36).slice(0, 4) }, "account-photo") : '<div class="account-avatar"><i class="fa-solid fa-user"></i></div>'}
              <div><strong>Olá, ${esc(user.name.split(" ")[0])}</strong><p>${esc(session.company.name)} • ${esc(user.roleLabel)}${user.job ? ` • ${esc(user.job)}` : ""}</p></div></div>
            <div class="top-actions">
              ${canNotify ? '<a class="notification-button" href="notificacoes.html" aria-label="Notificações"><i class="fa-solid fa-bell"></i><span hidden></span></a>' : ""}
              <button class="theme-toggle" type="button" data-theme-toggle aria-label="Ativar tema escuro" title="Ativar tema escuro" aria-pressed="false"></button>
              <button class="logout" type="button" data-action="logout" title="Sair" aria-label="Sair"><i class="fa-solid fa-arrow-right-from-bracket"></i></button>
            </div>
          </header>
          <div class="dashboard app-dashboard" id="dashboard" tabindex="-1">${loading()}</div>
        </main>
      </div>
      <div class="toast" id="toast" role="status" aria-live="polite"></div>
      <div id="dialog-root"></div>`;
    window.updateThemeButtons?.(document.documentElement.dataset.theme);
  }

  // Atualiza o número de notificações não lidas no sino e no menu (a cada minuto).
  async function refreshBadge() {
    const badge = document.querySelector(".notification-button span");
    const navCount = document.querySelector(".nav-count");
    if (!badge && !navCount) return;
    try {
      const { unread } = await api.get("/api/notifications/count");
      const label = unread > 99 ? "99+" : String(unread);
      [badge, navCount].forEach(element => {
        if (!element) return;
        element.textContent = label;
        element.hidden = unread === 0;
      });
      document.querySelector(".notification-button")?.setAttribute("aria-label", `${unread} notificações não lidas`);
    } catch {
      // Falhas no contador não interrompem a página.
    }
  }

  // Imagens de perfil que falham voltam para as iniciais.
  document.addEventListener("error", event => {
    const image = event.target;
    if (image instanceof HTMLImageElement && image.dataset.fallback) {
      image.replaceWith(document.createTextNode(image.dataset.fallback));
    }
  }, true);

  document.addEventListener("click", event => {
    if (event.target.closest("[data-action=\"reload\"]")) location.reload();
    if (event.target.closest('[data-action="logout"]')) {
      api.post("/api/auth/logout", {}).finally(() => location.assign("/central/entrar.html"));
    }
  });

  window.Reobote = {
    api, esc, fmt, localDate, initials, avatar, statePill, dayPill, dayLabel, eventIcons, debounce, downloadCsv,
    toast, openDialog, confirm: confirmAction, askReason, showTemporaryPassword, heading, emptyState, loading,
    pages, refreshBadge, session: null, has: () => false
  };

  // Inicialização: confere a sessão, aplica as permissões, desenha o menu e monta a página atual.
  async function start() {
    if (location.protocol === "file:") {
      document.body.innerHTML = '<main class="standalone-message"><h1>Abra pelo servidor</h1><p>A Central REOBOTE usa a API PHP. Inicie com <code>php -S 127.0.0.1:3000 server/router.php</code> e acesse <code>http://localhost:3000</code>.</p></main>';
      return;
    }
    let session;
    try {
      session = await api.get("/api/auth/me");
    } catch (error) {
      if (error.status === 401 || error.code === "password_change_required") return;
      document.body.innerHTML = `<main class="standalone-message"><h1>Não foi possível abrir a Central</h1><p>${esc(error.message)}</p><button type="button" data-action="reload">Tentar novamente</button></main>`;
      return;
    }
    if (session.user.mustChangePassword) {
      location.assign(`/central/trocar-senha.html?return=${encodeURIComponent(location.pathname + location.search)}`);
      return;
    }
    if (!session.user.centralAccess) {
      location.replace("/app/");
      return;
    }
    timezone = session.rules.timezone || timezone;
    window.Reobote.session = session;
    window.Reobote.user = session.user;
    window.Reobote.has = permission => session.user.permissions.includes(permission);
    renderShell(session);
    const info = pages[activePage];
    document.title = `REOBOTE | ${info.title}`;
    const root = document.querySelector("#dashboard");

    if (!canAccess(session.user, activePage)) {
      root.innerHTML = heading(activePage) + `<section class="panel content-panel">${emptyState("fa-lock", "Acesso não autorizado", "Seu cargo não tem permissão para esta área. Solicite à administração, se necessário.")}</section>`;
      return;
    }
    const page = window.ReobotePage;
    if (!page || typeof page.mount !== "function") {
      root.innerHTML = `<p class="loading-state">O módulo da página não foi carregado.</p>`;
      return;
    }
    try {
      await page.mount(root, window.Reobote);
    } catch (error) {
      console.error(error);
      root.innerHTML = heading(activePage) + `<section class="panel content-panel">${emptyState("fa-triangle-exclamation", "Não foi possível carregar esta página", error.message, '<button type="button" class="button-primary" data-action="reload">Tentar novamente</button>')}</section>`;
    }
    refreshBadge();
    setInterval(refreshBadge, 60000);
  }

  start();
})();
