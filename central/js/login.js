// Login: envia as credenciais, aceita somente destinos internos e direciona para a Central ou para o aplicativo.
(function () {
  const loginForm = document.querySelector("#login-form");
  const loginError = document.querySelector("#login-error");
  const forgotForm = document.querySelector("#forgot-form");
  const forgotMessage = document.querySelector("#forgot-message");

  // Para onde ir após o login: página pedida (se for da Central), criação de senha, aplicativo (sem acesso à Central) ou painel.
  function destination(session) {
    const requested = new URLSearchParams(location.search).get("return");
    if (session.user.mustChangePassword) {
      return `/central/trocar-senha.html${requested ? `?return=${encodeURIComponent(requested)}` : ""}`;
    }
    // Quem não tem acesso à Central usa o aplicativo, que fica em uma pasta separada.
    if (!session.user.centralAccess) return "/app/";
    if (requested && /^\/central\/[a-z-]+\.html(\?[\w=&%-]*)?$/.test(requested) && !/entrar|trocar-senha/.test(requested)) return requested;
    return session.user.permissions.includes("dashboard") ? "/central/painel-principal.html" : "/central/configuracoes.html";
  }

  // Quem já está conectado segue direto.
  window.ReoboteApi.get("/api/auth/me", { handleAuth: false })
    .then(session => location.replace(destination(session)))
    .catch(() => {});

  loginForm.addEventListener("submit", async event => {
    event.preventDefault();
    const submit = loginForm.querySelector('button[type="submit"]');
    submit.disabled = true;
    loginError.hidden = true;
    try {
      const data = new FormData(loginForm);
      const session = await window.ReoboteApi.post("/api/auth/login", {
        email: data.get("email"), password: data.get("password"), remember: data.has("remember")
      }, { handleAuth: false });
      location.assign(destination(session));
    } catch (error) {
      loginError.textContent = error.message;
      loginError.hidden = false;
    } finally {
      submit.disabled = false;
    }
  });

  document.querySelector("#forgot-toggle").addEventListener("click", () => {
    forgotForm.hidden = !forgotForm.hidden;
    if (!forgotForm.hidden) {
      forgotForm.elements.email.value = loginForm.elements.email.value;
      forgotForm.elements.email.focus();
    }
  });

  forgotForm.addEventListener("submit", async event => {
    event.preventDefault();
    const submit = forgotForm.querySelector("button");
    submit.disabled = true;
    try {
      const { message } = await window.ReoboteApi.post("/api/auth/forgot", { email: forgotForm.elements.email.value }, { handleAuth: false });
      forgotMessage.textContent = message;
    } catch (error) {
      forgotMessage.textContent = error.message;
    } finally {
      forgotMessage.hidden = false;
      submit.disabled = false;
    }
  });
})();
