// REOBOTE | compartilhado/js/api-client.js — Compartilhado: comunicação com a API (Central e aplicativo)
/**
 * Cliente HTTP da API REOBOTE — usado pela Central e pelo aplicativo.
 *
 * Como funciona:
 * - Toda chamada passa por `request()`, que envia e recebe JSON e transforma respostas de erro
 *   em exceções (`Error`) com a mensagem vinda do servidor.
 * - O navegador envia o cookie de sessão automaticamente (`credentials`).
 * - O cabeçalho `X-Reobote: 1` acompanha todas as chamadas; o servidor exige esse cabeçalho nas
 *   operações de escrita, o que impede que outros sites façam ações em nome do usuário (CSRF).
 * - `baseUrl` fica vazio no navegador (a API está no mesmo endereço do site). No APK Android,
 *   o aplicativo preenche `baseUrl` com o endereço do servidor informado na tela de login.
 * - Central publicada no GitHub Pages (https://viinisilvaa.github.io/Reobote/): o GitHub só guarda as
 *   páginas; o servidor (PHP + MySQL) continua no computador, ligado na internet pelo túnel. Nesse caso
 *   (`remote = true`) o endereço do servidor vem do servidor.json do GitHub e o login vai por um token
 *   (cabeçalho X-Reobote-Session) em vez de cookie, porque os navegadores bloqueiam cookies entre sites
 *   diferentes (github.io e trycloudflare.com).
 */
window.ReoboteApi = {
  // Endereço do servidor (ex.: "https://reobote.com.br"). Vazio = mesmo endereço da página.
  baseUrl: "",

  // Central hospedada só como páginas (GitHub Pages): o servidor fica em outro endereço.
  remote: /\.github\.io$/i.test(location.hostname),

  // Arquivo no GitHub com o endereço ATUAL do servidor (atualizado por ferramentas/ligar-internet.ps1).
  discoveryUrl: "https://raw.githubusercontent.com/viinisilvaa/Reobote/main/servidor.json",

  // Promessa resolvida quando o endereço do servidor já é conhecido (as chamadas esperam por ela).
  ready: Promise.resolve(),

  // Começo do caminho do site: "" no XAMPP/servidor; "/Reobote" no GitHub Pages (site de projeto).
  sitePrefix: location.pathname.includes("/central/") ? location.pathname.slice(0, location.pathname.indexOf("/central/")) : "",

  // Caminho de uma página do site ("/central/...") com o começo correto para onde a Central está hospedada.
  page(path) {
    return `${this.sitePrefix}${path}`;
  },

  // Endereço do aplicativo web do colaborador (fica no servidor, não no GitHub Pages).
  appUrl() {
    return this.remote ? `${this.baseUrl}/app/` : "/app/";
  },

  // Token de sessão (apenas no modo remoto), guardado no navegador entre uma página e outra.
  get token() {
    try { return localStorage.getItem("reobote_token") || ""; } catch { return ""; }
  },
  set token(value) {
    try {
      if (value) localStorage.setItem("reobote_token", value); else localStorage.removeItem("reobote_token");
    } catch { /* navegador sem armazenamento: o login dura só esta página */ }
  },

  // Descobre o endereço do servidor lendo o servidor.json do GitHub (sem cache, para pegar o túnel atual).
  // Se o GitHub não responder, usa o último endereço que funcionou neste navegador.
  async discover() {
    let address = "";
    try {
      const response = await fetch(`${this.discoveryUrl}?t=${Date.now()}`, { cache: "no-store" });
      address = String((await response.json()).servidor || "").trim().replace(/\/+$/, "");
      if (address) localStorage.setItem("reobote_servidor", address);
    } catch {
      try { address = localStorage.getItem("reobote_servidor") || ""; } catch { address = ""; }
    }
    this.baseUrl = address;
  },

  // Monta o endereço completo de uma rota da API ("/api/...") a partir do servidor configurado.
  url(path) {
    return /^https?:\/\//i.test(path) ? path : `${this.baseUrl}${path}`;
  },

  /**
   * fetch "cru" para a API (arquivos, fotos), com o endereço do servidor e a sessão corretos.
   * Usado quando a resposta não é JSON. Devolve o Response do fetch.
   */
  async fetchRaw(path, options = {}) {
    await this.ready;
    const headers = { ...options.headers };
    if (this.remote) headers["X-Reobote-Session"] = this.token || "-";
    return fetch(this.url(path), { credentials: this.baseUrl ? "include" : "same-origin", ...options, headers });
  },

  /**
   * Faz uma requisição à API.
   * @param {string} url      Rota da API, por exemplo "/api/me/today".
   * @param {object} options  Opções do fetch e, adicionalmente, `handleAuth: false` para não
   *                          redirecionar automaticamente quando a sessão expirar.
   * @returns {Promise<object|null>} Corpo JSON da resposta (ou null quando o servidor responde 204).
   */
  async request(url, options = {}) {
    const isForm = options.body instanceof FormData;
    await this.ready;
    if (this.remote && !this.baseUrl) {
      throw Object.assign(new Error("O servidor REOBOTE está desligado no momento (endereço não publicado). Ligue o servidor e tente de novo."), { offline: true });
    }
    let response;
    try {
      response = await fetch(this.url(url), {
        // Sem servidor externo, o cookie vai só para o mesmo site; com servidor externo (APK), também para ele.
        credentials: this.baseUrl ? "include" : "same-origin",
        ...options,
        headers: {
          Accept: "application/json",
          "X-Reobote": "1",
          // Modo remoto: a sessão vai no cabeçalho (token), não em cookie.
          // Sem token ainda (antes do login) vai "-", que pede ao servidor para devolver o token da sessão.
          ...(this.remote ? { "X-Reobote-Session": this.token || "-" } : {}),
          // Formulários com arquivo (FormData) definem o próprio Content-Type com o separador correto.
          ...(options.body && !isForm ? { "Content-Type": "application/json" } : {}),
          ...options.headers
        }
      });
    } catch (networkError) {
      // fetch só lança exceção quando não há conexão (ou o servidor está inacessível).
      const error = new Error(this.remote
        ? "Sem conexão com o servidor REOBOTE. Confira se o computador do servidor está ligado na internet."
        : "Sem conexão com o servidor. Verifique a internet e tente novamente.");
      error.offline = true;
      throw error;
    }
    // O servidor devolve o token atual da sessão (ele muda no login e fica vazio no logout).
    if (this.remote && response.headers.has("X-Reobote-Session")) {
      this.token = response.headers.get("X-Reobote-Session");
    }
    if (response.status === 204) return null;
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      // Erros carregam o status HTTP e o código opcional enviado pelo servidor (ex.: "password_change_required").
      const error = new Error(body.error || `A API respondeu com status ${response.status}.`);
      error.status = response.status;
      error.code = body.code;
      if (this.remote && error.status === 401) this.token = "";
      if (options.handleAuth !== false) this.handleAuthError(error);
      throw error;
    }
    return body;
  },

  // Páginas de login e de criação de senha da Central. O aplicativo trata a sessão na própria tela
  // (sempre envia handleAuth: false), por isso não depende destes endereços.
  loginPage: "/central/entrar.html",
  passwordPage: "/central/trocar-senha.html",

  // Redireciona para o login (sessão expirada) ou para a criação de senha (senha temporária).
  // O "return" guarda o caminho sem o começo do site ("/central/..."), igual em qualquer hospedagem.
  handleAuthError(error) {
    const here = location.pathname.slice(this.sitePrefix.length) + location.search;
    if (error.status === 401 && location.pathname !== this.page(this.loginPage)) {
      location.assign(`${this.page(this.loginPage)}?return=${encodeURIComponent(here)}`);
    }
    if (error.code === "password_change_required" && location.pathname !== this.page(this.passwordPage)) {
      location.assign(`${this.page(this.passwordPage)}?return=${encodeURIComponent(here)}`);
    }
  },

  // Atributo de imagem da API para usar em <img>: direto no mesmo site (src="..."); no modo remoto,
  // data-api-src="...", e a foto é baixada com o token pelo observador no fim deste arquivo.
  imageAttr(path) {
    return this.remote ? `data-api-src="${path}"` : `src="${path}"`;
  },

  // Atalhos para cada método HTTP. `data` é convertido em JSON automaticamente.
  get(url, options) { return this.request(url, options); },
  post(url, data, options) { return this.request(url, { method: "POST", body: JSON.stringify(data ?? {}), ...options }); },
  put(url, data, options) { return this.request(url, { method: "PUT", body: JSON.stringify(data ?? {}), ...options }); },
  del(url, options) { return this.request(url, { method: "DELETE", ...options }); },
  // Envio de arquivos (ex.: foto do colaborador) com FormData.
  upload(url, formData, options) { return this.request(url, { method: "POST", body: formData, ...options }); }
};

// Modo remoto (GitHub Pages): descobre o servidor antes da primeira chamada e carrega as fotos protegidas.
if (window.ReoboteApi.remote) {
  window.ReoboteApi.ready = window.ReoboteApi.discover();

  // Baixa a foto pela API (com o token) e mostra como arquivo local; se falhar, volta para as iniciais.
  const loadApiImage = async image => {
    const path = image.dataset.apiSrc;
    delete image.dataset.apiSrc;
    try {
      const response = await window.ReoboteApi.fetchRaw(path);
      if (!response.ok) throw new Error("sem foto");
      image.src = URL.createObjectURL(await response.blob());
    } catch {
      image.dispatchEvent(new Event("error")); // tratado em central/js/app-core.js (iniciais)
    }
  };
  new MutationObserver(() => document.querySelectorAll("img[data-api-src]").forEach(loadApiImage))
    .observe(document.documentElement, { childList: true, subtree: true });
}
