// REOBOTE | central/js/pdf-reobote.js — Central: visual padrão dos PDFs (cabeçalho, cartões, assinaturas e rodapé)
/**
 * Visual único dos PDFs do REOBOTE, usado pelo espelho de ponto do perfil e pelos Relatórios.
 * Gera o arquivo no próprio navegador com a biblioteca jsPDF (js/vendor/jspdf), carregada só quando
 * alguém pede um PDF. Folha A4 deitada, compacta, com texto escuro e legível.
 *
 * Uso:
 *   const pdf = await window.ReobotePdf.create({ title: "Espelho de ponto", company: "...", subtitle: "..." });
 *   pdf.cards([["Faltas", "1"], ...]);   // totais em cartões
 *   pdf.table({ head: [...], body: [...] });
 *   pdf.signatures("Nome do colaborador");
 *   pdf.save("arquivo.pdf");
 */
(function () {
  const BRAND = [84, 35, 189];    // roxo REOBOTE
  const GREEN = [34, 180, 90];    // verde REOBOTE
  const INK = [24, 18, 44];       // texto quase preto
  const MUTED = [88, 80, 112];    // texto secundário
  const SOFT = [243, 239, 252];   // fundo dos cartões e linhas alternadas
  const PAGE_W = 297;
  const PAGE_H = 210;
  const MARGIN = 10;

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
        img.src = "../compartilhado/assets/reobote-mark.png";
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
      await loadScript("js/vendor/jspdf/jspdf.umd.min.js");
      await loadScript("js/vendor/jspdf/jspdf.plugin.autotable.min.js");
    }
    const logo = await loadLogo();
    const doc = new window.jspdf.jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    let y = 0;

    // Cabeçalho: faixa roxa com linha verde, logotipo num círculo branco, título e empresa.
    function header() {
      doc.setFillColor(...BRAND);
      doc.rect(0, 0, PAGE_W, 17, "F");
      doc.setFillColor(...GREEN);
      doc.rect(0, 17, PAGE_W, 1.1, "F");
      doc.setFillColor(255, 255, 255);
      doc.circle(MARGIN + 6, 8.5, 6.2, "F");
      if (logo) doc.addImage(logo, "PNG", MARGIN + 1.8, 4.4, 8.4, 8);
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13.5);
      doc.text(title, MARGIN + 15, 8.6);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text("Grupo REOBOTE  •  Tecnologia que conecta.", MARGIN + 15, 13);
      doc.setFontSize(8.5);
      doc.text(company || "Central REOBOTE", PAGE_W - MARGIN, 8.6, { align: "right" });
      if (generated) doc.text(generated, PAGE_W - MARGIN, 13, { align: "right" });
      doc.setTextColor(...INK);
    }
    header();
    y = 24;
    if (subtitle) {
      // Linha de identificação (ex.: colaborador, matrícula, cargo e período).
      const lines = Array.isArray(subtitle) ? subtitle : [subtitle];
      lines.forEach((line, index) => {
        doc.setFont("helvetica", index === 0 ? "bold" : "normal");
        doc.setFontSize(index === 0 ? 11.5 : 8.5);
        doc.setTextColor(...(index === 0 ? INK : MUTED));
        doc.text(line, MARGIN, y);
        y += index === 0 ? 5 : 4.2;
      });
      doc.setTextColor(...INK);
      y += 1.5;
    }

    const api = {
      doc,
      // Totais em cartões pequenos, lado a lado: [["Rótulo", "Valor", "cor opcional"], ...].
      cards(items) {
        const gap = 3;
        const width = (PAGE_W - MARGIN * 2 - gap * (items.length - 1)) / items.length;
        items.forEach(([label, value, tone], index) => {
          const x = MARGIN + index * (width + gap);
          doc.setFillColor(...SOFT);
          doc.setDrawColor(214, 205, 238);
          doc.roundedRect(x, y, width, 13, 2, 2, "FD");
          doc.setFont("helvetica", "normal");
          doc.setFontSize(7.5);
          doc.setTextColor(...MUTED);
          doc.text(label, x + 3, y + 4.6);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(12);
          doc.setTextColor(...(tone === "bad" ? [178, 20, 47] : tone === "good" ? [15, 122, 65] : BRAND));
          doc.text(String(value), x + 3, y + 10.6);
        });
        doc.setTextColor(...INK);
        y += 17;
      },
      // Tabela compacta (jsPDF AutoTable) com o cabeçalho roxo e linhas alternadas.
      table(options) {
        doc.autoTable({
          startY: y,
          margin: { left: MARGIN, right: MARGIN, top: 24, bottom: 14 },
          theme: "grid",
          styles: { font: "helvetica", fontSize: 8.5, textColor: INK, cellPadding: 1.6, lineColor: [222, 215, 240], lineWidth: 0.15, valign: "top" },
          headStyles: { fillColor: BRAND, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8.5 },
          alternateRowStyles: { fillColor: [249, 247, 254] },
          didDrawPage: data => { if (data.pageNumber > 1) header(); }, // cabeçalho também nas páginas seguintes
          ...options
        });
        y = doc.lastAutoTable.finalY + 5;
      },
      // Observação em letra pequena.
      note(text) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.5);
        doc.setTextColor(...MUTED);
        doc.text(text, MARGIN, y);
        doc.setTextColor(...INK);
        y += 5;
      },
      // Nova página com o mesmo cabeçalho.
      newPage(newTitle, newSubtitle) {
        doc.addPage();
        if (newTitle) title = newTitle;
        header();
        y = 24;
        (Array.isArray(newSubtitle) ? newSubtitle : newSubtitle ? [newSubtitle] : []).forEach((line, index) => {
          doc.setFont("helvetica", index === 0 ? "bold" : "normal");
          doc.setFontSize(index === 0 ? 11.5 : 8.5);
          doc.setTextColor(...(index === 0 ? INK : MUTED));
          doc.text(line, MARGIN, y);
          y += index === 0 ? 5 : 4.2;
        });
        doc.setTextColor(...INK);
        y += 1.5;
      },
      // Assinaturas: colaborador à esquerda e Grupo REOBOTE à direita.
      signatures(employeeName) {
        let line = y + 14;
        if (line > PAGE_H - 22) { doc.addPage(); header(); line = 50; }
        doc.setDrawColor(...MUTED);
        doc.setLineWidth(0.3);
        doc.line(30, line, 125, line);
        doc.line(172, line, 267, line);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.text(employeeName, 77.5, line + 4.5, { align: "center" });
        doc.text("Grupo REOBOTE", 219.5, line + 4.5, { align: "center" });
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.5);
        doc.setTextColor(...MUTED);
        doc.text("Colaborador", 77.5, line + 8.5, { align: "center" });
        doc.text("Gestão de jornada", 219.5, line + 8.5, { align: "center" });
        doc.setTextColor(...INK);
        y = line + 12;
      },
      // Rodapé em todas as páginas e download do arquivo.
      save(fileName) {
        const pages = doc.getNumberOfPages();
        for (let page = 1; page <= pages; page++) {
          doc.setPage(page);
          doc.setDrawColor(222, 215, 240);
          doc.setLineWidth(0.2);
          doc.line(MARGIN, PAGE_H - 9, PAGE_W - MARGIN, PAGE_H - 9);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(7.5);
          doc.setTextColor(...MUTED);
          doc.text("Grupo REOBOTE  •  Tecnologia que conecta.", MARGIN, PAGE_H - 5);
          doc.text(`Página ${page} de ${pages}`, PAGE_W - MARGIN, PAGE_H - 5, { align: "right" });
        }
        doc.save(fileName);
      }
    };
    return api;
  }

  window.ReobotePdf = { create, loadScript };
})();
