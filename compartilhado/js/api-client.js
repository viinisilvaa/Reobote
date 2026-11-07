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
 */
window.ReoboteApi = {
  // Endereço do servidor (ex.: "https://reobote.com.br"). Vazio = mesmo endereço da página.
  baseUrl: "",

  // Monta o endereço completo de uma rota da API ("/api/...") a partir do servidor configurado.
  url(path) {
    return /^https?:\/\//i.test(path) ? path : `${this.baseUrl}${path}`;
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
    let response;
    try {
      response = await fetch(this.url(url), {
        // Sem servidor externo, o cookie vai só para o mesmo site; com servidor externo (APK), também para ele.
        credentials: this.baseUrl ? "include" : "same-origin",
        ...options,
        headers: {
          Accept: "application/json",
          "X-Reobote": "1",
          // Formulários com arquivo (FormData) definem o próprio Content-Type com o separador correto.
          ...(options.body && !isForm ? { "Content-Type": "application/json" } : {}),
          ...options.headers
        }
      });
    } catch (networkError) {
      // fetch só lança exceção quando não há conexão (ou o servidor está inacessível).
      const error = new Error("Sem conexão com o servidor. Verifique a internet e tente novamente.");
      error.offline = true;
      throw error;
    }
    if (response.status === 204) return null;
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      // Erros carregam o status HTTP e o código opcional enviado pelo servidor (ex.: "password_change_required").
      const error = new Error(body.error || `A API respondeu com status ${response.status}.`);
      error.status = response.status;
      error.code = body.code;
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
  handleAuthError(error) {
    const here = location.pathname + location.search;
    if (error.status === 401 && location.pathname !== this.loginPage) {
      location.assign(`${this.loginPage}?return=${encodeURIComponent(here)}`);
    }
    if (error.code === "password_change_required" && location.pathname !== this.passwordPage) {
      location.assign(`${this.passwordPage}?return=${encodeURIComponent(here)}`);
    }
  },

  // Atalhos para cada método HTTP. `data` é convertido em JSON automaticamente.
  get(url, options) { return this.request(url, options); },
  post(url, data, options) { return this.request(url, { method: "POST", body: JSON.stringify(data ?? {}), ...options }); },
  put(url, data, options) { return this.request(url, { method: "PUT", body: JSON.stringify(data ?? {}), ...options }); },
  del(url, options) { return this.request(url, { method: "DELETE", ...options }); },
  // Envio de arquivos (ex.: foto do colaborador) com FormData.
  upload(url, formData, options) { return this.request(url, { method: "POST", body: formData, ...options }); }
};
