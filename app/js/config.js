// Configuração do aplicativo REOBOTE.
//
// "servidor": endereço da Central que o APK usa (ex.: "https://reobote.com.br").
// - Na versão web (navegador) fica vazio: o app usa o próprio site.
// - No APK, o GitHub preenche este valor automaticamente com a variável SERVIDOR_APP do
//   repositório (Settings > Secrets and variables > Actions > Variables). Veja docs/GUIA.md.
// - Em testes, o endereço pode ser trocado no celular tocando 5 vezes no logotipo da tela de login.
window.REOBOTE_CONFIG = {
  servidor: ""
};
