// REOBOTE | app/js/config.js — Aplicativo: endereço do servidor embutido no APK
// Configuração do aplicativo REOBOTE.
//
// "servidor": endereço da Central que o APK usa.
// - Agora (testes): o computador com o XAMPP na rede Wi-Fi, http://192.168.1.2:3000.
//   O servidor precisa estar ligado com:  C:\xampp\php\php.exe -S 0.0.0.0:3000 server\router.php
// - Em produção: troque pelo endereço da hospedagem (ex.: "https://reobote.com.br"), ou crie a
//   variável SERVIDOR_APP no GitHub (Settings > Secrets and variables > Actions > Variables),
//   que tem prioridade sobre este arquivo na geração do APK.
// - Na versão web (navegador) este valor é ignorado: o app usa o próprio site.
// - No celular, o endereço pode ser trocado tocando 5 vezes no logotipo da tela de login.
window.REOBOTE_CONFIG = {
  servidor: "http://192.168.1.2:3000"
};
