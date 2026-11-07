// REOBOTE | central/js/ajuda.js — Central: perguntas frequentes com busca
// Ajuda: perguntas frequentes pesquisáveis e contato da administração.
window.ReobotePage = {
  // Monta a página dentro de "root"; R são os utilitários da Central (app-core.js).
  async mount(root, R) {
    const { esc } = R;
    const questions = [
      ["Como funciona o registro por QR Code?", "Cada veículo e cada unidade têm um QR Code gerado em Unidades e QR Codes. No aplicativo, o colaborador toca em Registrar presença e aponta a câmera: a leitura no veículo registra a chegada ao veículo e a leitura na unidade registra a chegada ao local. O horário é gravado no momento da leitura."],
      ["E se o colaborador estiver sem internet?", "O aplicativo guarda o registro no próprio celular com o horário original e envia automaticamente quando a conexão voltar. O horário da leitura é preservado; a Central mostra que o registro foi sincronizado depois. O prazo máximo para sincronizar é definido em Configurações."],
      ["Como cadastro um colaborador?", "Em Colaboradores, use Novo colaborador, informe nome, e-mail corporativo, cargo, unidade e jornada. O sistema gera uma senha temporária que deve ser entregue ao colaborador; no primeiro acesso ele cria a própria senha."],
      ["O colaborador esqueceu a senha. O que fazer?", "Na tela de login há a opção Esqueci minha senha, que avisa a administração. Em Colaboradores, use o botão da chave para gerar uma nova senha temporária."],
      ["Como o atraso e a hora extra são calculados?", "O primeiro registro do dia é comparado com a entrada prevista na jornada. Passou da tolerância, o atraso é contado. As horas trabalhadas (descontando o almoço registrado) acima das previstas, além da tolerância, são horas extras. Em folgas e feriados, as horas podem contar integralmente como extras, conforme a jornada."],
      ["Como funcionam escalas 12x36 e turnos noturnos?", "Em Jornadas, escolha Escala em ciclo, informe 1 dia de trabalho e 1 de folga e o primeiro dia da escala. Turnos que atravessam a meia-noite (ex.: 19h às 07h) são calculados no dia em que começaram."],
      ["O sistema impede registros duplicados?", "Sim. Leituras repetidas em poucos minutos são ignoradas, e registros fora da sequência são recusados com explicação (por exemplo, encerrar a jornada sem ter retornado do almoço)."],
      ["Como corrijo um registro errado?", "No perfil do colaborador, gestores podem lançar um registro manual ou anular um registro, sempre com justificativa. Nada é apagado: as correções ficam no histórico de alterações."],
      ["Como exporto relatórios em PDF?", "Em Relatórios, gere o período desejado e use o botão PDF. Na janela de impressão, escolha Salvar como PDF. Também é possível exportar em CSV para planilhas."],
      ["Como instalar o aplicativo no celular?", "Abra a página Aplicativo no menu da Central. No Android, aponte a câmera do celular para o QR Code de download, instale o reobote.apk e entre com o e-mail e a senha temporária. No iPhone, use o aplicativo pelo navegador e adicione-o à tela inicial."]
    ];
    const company = R.session.company;

    root.innerHTML = `${R.heading("help")}
      <div class="content-grid help-grid">
        <section class="panel content-panel wide-panel"><div class="content-panel-heading"><h2><i class="fa-solid fa-magnifying-glass"></i> Perguntas frequentes</h2></div>
          <label class="search-control help-search"><i class="fa-solid fa-magnifying-glass"></i><input id="faq-search" type="search" placeholder="Buscar uma dúvida" aria-label="Buscar nas perguntas frequentes"></label>
          <div class="faq-list">${questions.map(([q, a]) => `<details class="faq-item" data-search="${esc(`${q} ${a}`.toLowerCase())}"><summary>${esc(q)}<i class="fa-solid fa-chevron-down"></i></summary><p>${esc(a)}</p></details>`).join("")}</div>
          <p class="empty-state" id="faq-empty" hidden>Nenhuma pergunta encontrada.</p>
        </section>
        <section class="panel content-panel"><div class="content-panel-heading"><h2><i class="fa-solid fa-headset"></i> Fale com a administração</h2></div>
          <ul class="plain-list">
            <li><strong>${esc(company.name)}</strong></li>
            ${company.email ? `<li><i class="fa-solid fa-envelope"></i> <a href="mailto:${esc(company.email)}">${esc(company.email)}</a></li>` : ""}
            ${company.phone ? `<li><i class="fa-solid fa-phone"></i> ${esc(company.phone)}</li>` : ""}
          </ul>
          <p class="panel-description">Os dados de contato são definidos em Configurações.</p>
        </section>
      </div>`;

    root.querySelector("#faq-search").addEventListener("input", event => {
      const query = event.target.value.trim().toLowerCase();
      let matches = 0;
      root.querySelectorAll(".faq-item").forEach(item => {
        item.hidden = !item.dataset.search.includes(query);
        if (!item.hidden) matches++;
      });
      root.querySelector("#faq-empty").hidden = matches > 0;
    });
  }
};
