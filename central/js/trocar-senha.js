// REOBOTE | central/js/trocar-senha.js — Central: troca da senha temporária
// Troca obrigatória da senha temporária e retorno para a área de origem.
(function () {
  const api = window.ReoboteApi;
  const form = document.querySelector("#password-form");
  const errorBox = document.querySelector("#password-error");
  let session;

  // Para onde ir depois de salvar a senha: página pedida, aplicativo (sem acesso à Central) ou painel.
  function next() {
    const requested = new URLSearchParams(location.search).get("return");
    if (!session?.user.centralAccess) return api.appUrl();
    // api.page() acrescenta o começo do site quando a Central está no GitHub Pages.
    if (requested && /^\/central\/[a-z-]+\.html(\?[\w=&%-]*)?$/.test(requested) && !/entrar|trocar-senha/.test(requested)) return api.page(requested);
    return api.page(session.user.permissions.includes("dashboard") ? "/central/painel-principal.html" : "/central/configuracoes.html");
  }

  api.get("/api/auth/me").then(data => {
    session = data;
    form.elements.username.value = data.user.email;
    document.querySelector("#password-intro").textContent = data.user.mustChangePassword
      ? `Olá, ${data.user.name.split(" ")[0]}! Por segurança, troque a senha temporária por uma senha pessoal antes de continuar.`
      : "Altere a senha da sua conta.";
  }).catch(() => {});

  form.addEventListener("submit", async event => {
    event.preventDefault();
    errorBox.hidden = true;
    const data = new FormData(form);
    const submit = form.querySelector('button[type="submit"]');
    try {
      if (data.get("newPassword") !== data.get("confirmPassword")) throw new Error("A confirmação não confere com a nova senha.");
      submit.disabled = true;
      await api.post("/api/auth/change-password", { currentPassword: data.get("currentPassword"), newPassword: data.get("newPassword") });
      location.assign(next());
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.hidden = false;
    } finally {
      submit.disabled = false;
    }
  });

  document.querySelector("#password-logout").addEventListener("click", () => {
    api.post("/api/auth/logout", {}).finally(() => location.assign(api.page("/central/entrar.html")));
  });
})();
