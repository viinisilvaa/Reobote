// REOBOTE | compartilhado/js/theme.js — Compartilhado: alterna e lembra o tema claro/escuro
// Mantém a escolha do tema entre páginas e visitas ao sistema.
const themeStorageKey = "reobote-theme";
const rootElement = document.documentElement;

// Lê o tema salvo neste navegador ("dark" ou "light").
function getSavedTheme() {
  try {
    return localStorage.getItem(themeStorageKey) === "dark" ? "dark" : "light";
  } catch (error) {
    console.error("Não foi possível ler a preferência de tema salva.", error);
    return "light";
  }
}

// Salva o tema escolhido para as próximas visitas.
function saveTheme(theme) {
  try {
    localStorage.setItem(themeStorageKey, theme);
  } catch (error) {
    console.error("Não foi possível salvar a preferência de tema.", error);
  }
}

// Atualiza ícone (lua/sol) e textos de acessibilidade dos botões de tema.
function updateThemeButtons(theme) {
  document.querySelectorAll("[data-theme-toggle]").forEach(button => {
    const darkModeEnabled = theme === "dark";
    button.innerHTML = `<i class="fa-solid ${darkModeEnabled ? "fa-sun" : "fa-moon"}" aria-hidden="true"></i>`;
    button.setAttribute("aria-label", darkModeEnabled ? "Ativar tema claro" : "Ativar tema escuro");
    button.title = darkModeEnabled ? "Ativar tema claro" : "Ativar tema escuro";
    button.setAttribute("aria-pressed", String(darkModeEnabled));
  });
}

// Aplica o tema na página; persist=true também salva a escolha.
function applyTheme(theme, persist = false) {
  const normalizedTheme = theme === "dark" ? "dark" : "light";
  rootElement.dataset.theme = normalizedTheme;
  updateThemeButtons(normalizedTheme);
  if (persist) saveTheme(normalizedTheme);
}

applyTheme(getSavedTheme());
document.addEventListener("DOMContentLoaded", () => updateThemeButtons(rootElement.dataset.theme));

document.addEventListener("click", event => {
  const toggle = event.target.closest("[data-theme-toggle]");
  if (!toggle) return;
  applyTheme(rootElement.dataset.theme === "dark" ? "light" : "dark", true);
});
