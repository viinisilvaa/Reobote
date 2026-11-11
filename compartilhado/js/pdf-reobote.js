// REOBOTE | compartilhado/js/pdf-reobote.js — Central e aplicativo: visual padrão dos PDFs (cabeçalho, cartões, assinaturas e rodapé)
/**
 * Visual único dos PDFs do REOBOTE, usado pelo espelho de ponto do perfil, pelos Relatórios e pelo
 * "Meu Histórico" do aplicativo do técnico.
 * Gera o arquivo no próprio navegador com a biblioteca jsPDF (compartilhado/js/vendor/jspdf), carregada só quando
 * alguém pede um PDF. Folha A4 deitada, compacta e com bom contraste: fundo lilás claro, quadros e
 * tabelas brancos com bordas visíveis e texto escuro.
 *
 * Uso:
 *   const pdf = await window.ReobotePdf.create({ title: "Espelho de ponto", company: "...", subtitle: [...] });
 *   pdf.cards([["Faltas", "1", "bad"], ...]);   // totais em cartões
 *   pdf.table({ head: [...], body: [...] });
 *   pdf.earnings(pay);                    // quadro do valor ganho (salário)
 *   pdf.signatures("Nome do colaborador");
 *   pdf.save("arquivo.pdf");   // no APK, abre a janela do Android para salvar ou enviar o arquivo
 */
(function () {
  const BRAND = [84, 35, 189];      // roxo REOBOTE
  const BRAND_DARK = [52, 19, 120]; // roxo escuro (faixa inferior do cabeçalho)
  const GREEN = [34, 180, 90];      // verde REOBOTE
  const RED = [178, 20, 47];        // faltas e atrasos
  const OK = [15, 122, 65];         // horas extras
  const INK = [20, 15, 38];         // texto quase preto
  const MUTED = [70, 62, 96];       // texto secundário (escuro o bastante para ler bem)
  const PAPER = [238, 233, 248];    // fundo da folha (lilás claro, menos branco)
  const PANEL = [255, 255, 255];    // quadros e tabelas
  const LINE = [176, 163, 214];     // bordas e grade da tabela
  const STRIPE = [231, 224, 248];   // linhas alternadas da tabela
  const PAGE_W = 297;
  const PAGE_H = 210;
  const MARGIN = 10;
  // Pasta deste arquivo (compartilhado/js/): a biblioteca jsPDF e o logotipo são buscados a partir dela,
  // então funciona tanto na Central quanto no aplicativo (inclusive dentro do APK).
  const BASE = (document.currentScript?.src || "").replace(/[^/]*$/, "");

  // Carrega um script uma única vez.
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error("biblioteca de PDF não carregou"));
      document.head.append(script);
    });
  }

  // Logotipo REOBOTE como imagem para o PDF (guardado depois da primeira vez).
  let logoData = null;
  async function loadLogo() {
    if (logoData) return logoData;
    try {
      // Reduz a imagem para 160 px (o tamanho que ela ocupa no PDF): o arquivo fica leve.
      const image = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = BASE + "../assets/reobote-mark.png";
      });
      const canvas = document.createElement("canvas");
      canvas.width = 160;
      canvas.height = Math.round(160 * image.naturalHeight / image.naturalWidth);
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      logoData = canvas.toDataURL("image/png");
    } catch {
      logoData = null; // sem logotipo, o PDF sai só com o texto
    }
    return logoData;
  }

  async function create({ title, company, subtitle = "", generated = "" }) {
    if (!window.jspdf?.jsPDF) {
      await loadScript(BASE + "vendor/jspdf/jspdf.umd.min.js");
      await loadScript(BASE + "vendor/jspdf/jspdf.plugin.autotable.min.js");
    }
    const logo = await loadLogo();
    const doc = new window.jspdf.jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    let y = 0;

    // Fundo da folha + cabeçalho (faixa roxa, faixa roxa escura, linha verde, logotipo, título e empresa).
    function header() {
      doc.setFillColor(...PAPER);
      doc.rect(0, 0, PAGE_W, PAGE_H, "F");
      doc.setFillColor(...BRAND);
      doc.rect(0, 0, PAGE_W, 15, "F");
      doc.setFillColor(...BRAND_DARK);
      doc.rect(0, 15, PAGE_W, 3, "F");
      doc.setFillColor(...GREEN);
      doc.rect(0, 18, PAGE_W, 1.2, "F");
      doc.setFillColor(255, 255, 255);
      doc.circle(MARGIN + 6, 9, 6.6, "F");
      if (logo) doc.addImage(logo, "PNG", MARGIN + 1.6, 4.8, 8.8, 8.4);
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text(title, MARGIN + 15.5, 8.8);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text("Grupo REOBOTE  •  Tecnologia que conecta.", MARGIN + 15.5, 13.4);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text(company || "Central REOBOTE", PAGE_W - MARGIN, 8.8, { align: "right" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      if (generated) doc.text(generated, PAGE_W - MARGIN, 13.4, { align: "right" });
      doc.setTextColor(...INK);
    }

    // Quadro branco de identificação (1ª linha em destaque, demais em texto secundário).
    function identity(lines) {
      if (!lines.length) return;
      const height = 5 + 5.5 + (lines.length - 1) * 4.4;
      doc.setFillColor(...PANEL);
      doc.setDrawColor(...LINE);
      doc.setLineWidth(0.3);
      doc.roundedRect(MARGIN, y, PAGE_W - MARGIN * 2, height, 2, 2, "FD");
      doc.setFillColor(...BRAND);
      doc.rect(MARGIN, y, 2.2, height, "F"); // barra roxa na lateral
      let lineY = y + 6.5;
      lines.forEach((line, index) => {
        doc.setFont("helvetica", index === 0 ? "bold" : "normal");
        doc.setFontSize(index === 0 ? 12 : 9);
        doc.setTextColor(...(index === 0 ? INK : MUTED));
        doc.text(line, MARGIN + 6, lineY);
        lineY += index === 0 ? 5.5 : 4.4;
      });
      doc.setTextColor(...INK);
      y += height + 4;
    }

    header();
    y = 23.5;
    identity(Array.isArray(subtitle) ? subtitle : subtitle ? [subtitle] : []);

    const api = {
      doc,
      // Totais em cartões brancos com barra colorida: [["Rótulo", "Valor", "bad" | "good" | ""], ...].
      cards(items) {
        const gap = 3;
        const width = (PAGE_W - MARGIN * 2 - gap * (items.length - 1)) / items.length;
        items.forEach(([label, value, tone], index) => {
          const x = MARGIN + index * (width + gap);
          const color = tone === "bad" ? RED : tone === "good" ? OK : BRAND;
          doc.setFillColor(...PANEL);
          doc.setDrawColor(...LINE);
          doc.setLineWidth(0.3);
          doc.roundedRect(x, y, width, 14, 2, 2, "FD");
          doc.setFillColor(...color);
          doc.rect(x, y + 2, 1.8, 10, "F");
          doc.setFont("helvetica", "bold");
          doc.setFontSize(7.8);
          doc.setTextColor(...MUTED);
          doc.text(label.toUpperCase(), x + 4.5, y + 5);
          doc.setFontSize(13);
          doc.setTextColor(...color);
          doc.text(String(value), x + 4.5, y + 11.5);
        });
        doc.setTextColor(...INK);
        y += 18;
      },
      // Tabela compacta (jsPDF AutoTable): cabeçalho roxo, células brancas, faixas lilás e grade visível.
      table(options) {
        doc.autoTable({
          startY: y,
          margin: { left: MARGIN, right: MARGIN, top: 24, bottom: 14 },
          theme: "grid",
          styles: { font: "helvetica", fontSize: 9, textColor: INK, fillColor: PANEL, cellPadding: 1.8, lineColor: LINE, lineWidth: 0.25, valign: "top" },
          headStyles: { fillColor: BRAND, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 9, lineColor: BRAND_DARK },
          alternateRowStyles: { fillColor: STRIPE },
          willDrawPage: data => { if (data.pageNumber > 1) header(); }, // fundo e cabeçalho nas páginas seguintes
          ...options
        });
        y = doc.lastAutoTable.finalY + 5;
      },
      // Observação em letra pequena.
      note(text) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(...MUTED);
        doc.text(text, MARGIN, y);
        doc.setTextColor(...INK);
        y += 5;
      },
      // Quadro "Valor ganho no período": um mês por linha (pay = "pay" devolvido pelo servidor).
      // Valor da hora = salário ÷ horas previstas no mês; extras com adicional; faltas/atrasos justificados abonados.
      earnings(pay) {
        const money = value => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
        const hours = minutes => `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}`;
        const monthLabel = value => {
          const [year, month] = value.split("-").map(Number);
          const name = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", month: "long" }).format(new Date(Date.UTC(year, month - 1, 1)));
          return `${name.charAt(0).toUpperCase()}${name.slice(1)}/${year}`;
        };
        const part = (minutes, value) => minutes ? `${hours(minutes)} = ${money(value)}` : "-";
        const body = pay.months.map(item => [
          `${monthLabel(item.month)}${item.partial ? " (parcial)" : ""}`, money(pay.salary),
          `${money(item.hourlyRate)}\n(${hours(item.expectedMinutes)}${item.standardDivisor ? " padrão" : " previstas"})`,
          part(item.normalMinutes, item.normalValue), part(item.overtimeMinutes, item.overtimeValue),
          part(item.justifiedMinutes, item.justifiedValue), money(item.total)
        ]);
        if (pay.months.length > 1) {
          const t = pay.totals;
          body.push(["Total do período", "", "", part(t.normalMinutes, t.normalValue), part(t.overtimeMinutes, t.overtimeValue), part(t.justifiedMinutes, t.justifiedValue), money(t.total)]);
        }
        this.note("Valor ganho no período (valor da hora = salário ÷ horas previstas no mês):");
        this.table({
          head: [["Mês", "Salário", "Valor da hora", "Horas normais", `Horas extras (+${pay.overtimePercent}%)`, "Abonadas (justificadas)", "Valor ganho"]],
          body,
          // Valor ganho em verde e negrito; linha de total em negrito.
          didParseCell: cell => {
            if (cell.section !== "body") return;
            if (cell.column.index === 6) { cell.cell.styles.textColor = OK; cell.cell.styles.fontStyle = "bold"; }
            if (pay.months.length > 1 && cell.row.index === body.length - 1) cell.cell.styles.fontStyle = "bold";
          }
        });
        this.note(`Horas extras pagas com adicional de ${pay.overtimePercent}%. Faltas e atrasos justificados pela Central são abonados. Valor bruto: não inclui descontos, impostos ou benefícios.`);
      },
      // Nova página com o mesmo fundo e cabeçalho.
      newPage(newTitle, newSubtitle) {
        doc.addPage();
        if (newTitle) title = newTitle;
        header();
        y = 23.5;
        identity(Array.isArray(newSubtitle) ? newSubtitle : newSubtitle ? [newSubtitle] : []);
      },
      // Assinaturas num quadro branco: colaborador à esquerda e Grupo REOBOTE à direita.
      signatures(employeeName) {
        let top = y + 2;
        if (top + 20 > PAGE_H - 9) { doc.addPage(); header(); top = 26; } // não coube: vai para a próxima folha
        doc.setFillColor(...PANEL);
        doc.setDrawColor(...LINE);
        doc.setLineWidth(0.3);
        doc.roundedRect(MARGIN, top, PAGE_W - MARGIN * 2, 20, 2, 2, "FD");
        const line = top + 10.5;
        doc.setDrawColor(...INK);
        doc.setLineWidth(0.35);
        doc.line(30, line, 125, line);
        doc.line(172, line, 267, line);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9.5);
        doc.setTextColor(...INK);
        doc.text(employeeName, 77.5, line + 4, { align: "center" });
        doc.text("Grupo REOBOTE", 219.5, line + 4, { align: "center" });
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(...MUTED);
        doc.text("Colaborador", 77.5, line + 7.6, { align: "center" });
        doc.text("Gestão de jornada", 219.5, line + 7.6, { align: "center" });
        doc.setTextColor(...INK);
        y = top + 24;
      },
      // Rodapé em todas as páginas e download do arquivo.
      async save(fileName) {
        const pages = doc.getNumberOfPages();
        for (let page = 1; page <= pages; page++) {
          doc.setPage(page);
          doc.setFillColor(...BRAND);
          doc.rect(0, PAGE_H - 8, PAGE_W, 8, "F");
          doc.setFont("helvetica", "normal");
          doc.setFontSize(8);
          doc.setTextColor(255, 255, 255);
          doc.text("Grupo REOBOTE  •  Tecnologia que conecta.", MARGIN, PAGE_H - 3);
          doc.text(`Página ${page} de ${pages}`, PAGE_W - MARGIN, PAGE_H - 3, { align: "right" });
        }
        // Dentro do APK o "baixar" do navegador não funciona: o PDF é gravado no aparelho e o Android
        // abre a janela de compartilhar (Salvar em Arquivos, Drive, WhatsApp, e-mail...).
        const capacitor = window.Capacitor;
        if (capacitor?.isNativePlatform?.()) {
          const Filesystem = capacitor.registerPlugin("Filesystem");
          const Share = capacitor.registerPlugin("Share");
          const data = doc.output("datauristring").split(",").pop();
          const file = await Filesystem.writeFile({ path: fileName, data, directory: "CACHE" });
          await Share.share({ title: fileName, url: file.uri, dialogTitle: "Salvar ou enviar o PDF" }).catch(() => {});
          return;
        }
        doc.save(fileName);
      }
    };
    return api;
  }

  window.ReobotePdf = { create, loadScript };
})();
