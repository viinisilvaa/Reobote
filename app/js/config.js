// REOBOTE | app/js/config.js — Aplicativo: endereço do servidor embutido no APK
// Configuração do aplicativo REOBOTE (só vale no APK; no navegador o app usa o próprio site).
//
// "descoberta": arquivo no GitHub com o endereço ATUAL do servidor (servidor.json, na raiz do
//   repositório). O app lê esse arquivo toda vez que abre. Assim, quando o endereço muda (ex.: o túnel
//   de testes foi religado), basta atualizar o servidor.json no GitHub, sem gerar outro APK.
//
// "servidor": endereço usado quando o servidor.json estiver vazio ou sem internet para lê-lo.
//   Hoje: o computador com o XAMPP na rede Wi-Fi (http://192.168.1.2:3000).
//   Em produção: o endereço da hospedagem (ex.: "https://reobote.com.br"), ou a variável SERVIDOR_APP
//   no GitHub (Settings > Secrets and variables > Actions > Variables), que tem prioridade na geração do APK.
//
// "atualizacao": descrição da versão mais nova das telas do app (publicada pelo GitHub junto com o APK).
//   Ao abrir, o APK confere esse arquivo e, se houver versão nova, baixa e troca as telas sozinho,
//   sem precisar instalar outro APK.
//
// No celular, o endereço também pode ser trocado tocando 5 vezes no logotipo da tela de login.
window.REOBOTE_CONFIG = {
  descoberta: "https://raw.githubusercontent.com/viinisilvaa/Reobote/main/servidor.json",
  atualizacao: "https://github.com/viinisilvaa/Reobote/releases/latest/download/atualizacao.json",
  servidor: "http://192.168.1.2:3000"
};
