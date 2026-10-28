// Leitura de arquivos no navegador, compartilhada entre o painel (assets/painel.js) e a configuração (app.html).
// - layoutTexto(): texto de uma página de PDF mantendo as colunas (tabelas, calendário de provas)
// - nomeDoTema() / tipoDoArquivo(): igual ao que a drive-varrer faz com os arquivos do Drive
// - calendário: prepara o PDF ou a foto para a IA e monta a tabela de revisão das provas
// O arquivo também roda no Node (module.exports) para os testes.
(function (g) {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const semAcento = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  /* ---------- texto do PDF com as colunas no lugar ---------- */
  const RE_DATA = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/;
  /**
   * itens: [{str, x, y, w, h}] de uma página (x/y do pdf.js: y cresce para cima).
   * Junta os textos por linha (mesmo y), ordena por x e coloca espaços proporcionais à distância.
   * Se a página tem uma linha de datas (cabeçalho de uma grade), cada texto abaixo dela ganha
   * " [dd/mm/aaaa]" com a data da coluna em que está: assim a IA não precisa adivinhar a coluna.
   */
  function layoutTexto(itens) {
    const its = (itens || []).filter((i) => i && String(i.str || "").trim()).map((i) => ({ s: String(i.str).replace(/\s+/g, " "), x: +i.x || 0, y: +i.y || 0, w: Math.max(0, +i.w || 0), h: Math.abs(+i.h || 0) }));
    if (!its.length) return "";
    // largura média de uma letra (para converter distância em espaços)
    const larg = its.filter((i) => i.s.trim().length >= 3 && i.w > 0).map((i) => i.w / i.s.length).sort((a, b) => a - b);
    const cw = larg.length ? larg[Math.floor(larg.length / 2)] : 5;
    const alturas = its.map((i) => i.h).filter((h) => h > 0).sort((a, b) => a - b);
    const tol = Math.max(1, (alturas.length ? alturas[Math.floor(alturas.length / 2)] : 8) * 0.45);
    // linhas: de cima para baixo
    its.sort((a, b) => b.y - a.y || a.x - b.x);
    const linhas = [];
    for (const it of its) {
      const l = linhas.length ? linhas[linhas.length - 1] : null;
      if (l && Math.abs(l.y - it.y) <= tol) l.itens.push(it); else linhas.push({ y: it.y, itens: [it] });
    }
    // blocos: textos vizinhos na mesma linha viram um só ("PRIMEROS" + "AUXILIOS")
    for (const l of linhas) {
      l.itens.sort((a, b) => a.x - b.x);
      const blocos = [];
      for (const it of l.itens) {
        const b = blocos[blocos.length - 1];
        const fim = b ? b.x + b.w : 0;
        if (b && it.x - fim < cw * 1.6) { b.s += (it.x - fim > cw * 0.25 && !b.s.endsWith(" ") && !it.s.startsWith(" ") ? " " : "") + it.s; b.w = Math.max(b.w, it.x + it.w - b.x); }
        else blocos.push({ ...it });
      }
      l.blocos = blocos.map((b) => ({ ...b, s: b.s.trim() })).filter((b) => b.s);
    }
    // cabeçalho de datas (a linha com mais datas, pelo menos 3)
    let cab = null;
    for (const l of linhas) { const ds = l.blocos.filter((b) => RE_DATA.test(b.s)); if (ds.length >= 3 && (!cab || ds.length > cab.ds.length)) cab = { l, ds }; }
    let colunas = null;
    if (cab) {
      const cs = cab.ds.map((b) => ({ c: b.x + b.w / 2, d: b.s })).sort((a, b) => a.c - b.c);
      const passo = cs.length > 1 ? (cs[cs.length - 1].c - cs[0].c) / (cs.length - 1) : 60;
      colunas = { cs, ini: cs[0].c - passo / 2, fim: cs[cs.length - 1].c + passo / 2, y: cab.l.y };
    }
    const x0 = Math.min(...its.map((i) => i.x));
    const out = [];
    for (const l of linhas) {
      let txt = "";
      for (const b of l.blocos) {
        let s = b.s;
        if (colunas && l.y < colunas.y - tol && !RE_DATA.test(s)) {
          const c = b.x + b.w / 2;
          if (c >= colunas.ini && c <= colunas.fim) {
            let m = colunas.cs[0]; for (const k of colunas.cs) if (Math.abs(k.c - c) < Math.abs(m.c - c)) m = k;
            s += ` [${m.d}]`;
          }
        }
        const col = Math.max(0, Math.round((b.x - x0) / cw));
        txt += (txt.length < col ? " ".repeat(col - txt.length) : txt ? "  " : "") + s;
      }
      out.push(txt.replace(/\s+$/, ""));
    }
    return out.join("\n");
  }
  /** Itens do pdf.js -> formato do layoutTexto */
  const itensPdfjs = (tc) => (tc.items || []).map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: it.height || Math.abs(it.transform[3]) }));

  /* ---------- arquivos ---------- */
  const MIMES = { pdf: "application/pdf", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", txt: "text/plain", md: "text/markdown" };
  /** "pdf" | "pptx" | "docx" | "txt" | null (e o mime gravado no banco) */
  function tipoDoArquivo(nome, mime) {
    const ext = (String(nome || "").match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || "";
    if (ext === "pdf" || mime === MIMES.pdf) return { tipo: "pdf", mime: MIMES.pdf };
    if (ext === "pptx" || mime === MIMES.pptx) return { tipo: "pptx", mime: MIMES.pptx };
    if (ext === "docx" || mime === MIMES.docx) return { tipo: "docx", mime: MIMES.docx };
    if (ext === "txt") return { tipo: "txt", mime: MIMES.txt };
    if (ext === "md") return { tipo: "txt", mime: MIMES.md };
    return null;
  }
  /** Nome do tema a partir do nome do arquivo (o mesmo da função drive-varrer). */
  function nomeDoTema(arquivo) {
    let s = String(arquivo || "").replace(/\.(pdf|pptx?|pptm|ppsx?|potx?|docx?|docm|dotx?|txt|md|key|odt|odp|ods|rtf|xlsx?|xlsm|csv|html?)$/i, "");
    s = s.replace(/_/g, " ").replace(/\s+[-–—]\s+/g, " - ").replace(/\s+/g, " ").trim();
    s = s.replace(/^(\d{1,3}|[a-z]\d{1,2})\s*[.)\-–:]?\s+(?=\S)/i, "");
    s = s.replace(/^[-–—.\s]+|[-–—.\s]+$/g, "");
    if (s.length > 120) s = s.slice(0, 120).trim();
    return s || String(arquivo || "Sem nome").slice(0, 120);
  }

  /* ---------- calendário de provas ---------- */
  /** Foto -> JPEG em base64 com o lado maior até 1600 px */
  async function imagemBase64(file, lado = 1600) {
    const img = await createImageBitmap(file);
    const k = Math.min(1, lado / Math.max(img.width, img.height));
    const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
    const g2 = c.getContext("2d"); g2.fillStyle = "#fff"; g2.fillRect(0, 0, c.width, c.height); g2.drawImage(img, 0, 0, c.width, c.height);
    const url = c.toDataURL("image/jpeg", 0.85);
    return { mime: "image/jpeg", base64: url.slice(url.indexOf(",") + 1) };
  }
  /** PDF ou foto do calendário -> {texto} ou {imagem}. Lança Error com mensagem para o aluno. */
  async function prepararCalendario(file, carregarPdfjs, prog) {
    const nome = String(file?.name || "");
    if (!file) throw new Error("Escolha o arquivo do calendário.");
    if (file.size > 30 * 1024 * 1024) throw new Error("Arquivo grande demais (mais de 30 MB).");
    if (/^image\/(jpeg|png|webp)$/.test(file.type) || /\.(jpe?g|png|webp)$/i.test(nome)) {
      prog && prog("Preparando a foto…");
      try { return { imagem: await imagemBase64(file) }; } catch (_) { throw new Error("Não consegui abrir essa imagem. Use JPG ou PNG."); }
    }
    if (!(file.type === "application/pdf" || /\.pdf$/i.test(nome))) throw new Error("Use o PDF do calendário ou uma foto (JPG ou PNG).");
    const lib = await carregarPdfjs();
    let doc;
    try { doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, disableFontFace: true }).promise; }
    catch (e) { throw new Error(/password/i.test(e?.name + e?.message) ? "Esse PDF tem senha. Tire a senha e tente de novo." : "Não consegui abrir esse PDF."); }
    try {
      const partes = [];
      const n = Math.min(doc.numPages, 12);
      for (let i = 1; i <= n; i++) {
        prog && prog(`Lendo a página ${i} de ${n}…`);
        const pg = await doc.getPage(i);
        partes.push(layoutTexto(itensPdfjs(await pg.getTextContent())));
        pg.cleanup();
      }
      const texto = partes.join("\n\n--- página ---\n\n").replace(/\u0000/g, " ");
      if (texto.replace(/\s+/g, "").length < 30) throw new Error("Esse PDF parece escaneado (sem texto). Tire uma foto ou print da tabela e envie a imagem.");
      return { texto };
    } finally { try { doc.destroy(); } catch (_) { } }
  }

  /**
   * Qualquer documento da faculdade (PDF de várias páginas ou foto/print) -> {texto, imagens:[Blob], paginas, paginasImagem}.
   * Páginas de PDF sem texto (escaneadas, que são foto) viram imagem JPEG para a IA ler (até 10).
   */
  async function prepararDocumento(file, carregarPdfjs, prog, limites = {}) {
    const MAX_PAG = limites.paginas || 40, MAX_IMG = limites.imagens || 10;
    const nome = String(file?.name || "");
    if (!file) throw new Error("Escolha o arquivo.");
    if (file.size > 40 * 1024 * 1024) throw new Error("Arquivo grande demais (mais de 40 MB).");
    if (/^image\//.test(file.type) || /\.(jpe?g|png|webp|heic)$/i.test(nome)) {
      prog && prog("Preparando a foto…");
      try { return { texto: "", imagens: [await imagemBlob(await createImageBitmap(file))], paginas: 1, paginasImagem: 1 }; }
      catch (_) { throw new Error("Não consegui abrir essa imagem. Use JPG ou PNG."); }
    }
    if (!(file.type === "application/pdf" || /\.pdf$/i.test(nome))) throw new Error("Use um PDF ou uma foto/print (JPG ou PNG). Para Word e PowerPoint de aula, use Enviar arquivos.");
    const lib = await carregarPdfjs();
    let doc;
    try { doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise; }
    catch (e) { throw new Error(/password/i.test(e?.name + e?.message) ? "Esse PDF tem senha. Tire a senha e tente de novo." : "Não consegui abrir esse PDF."); }
    try {
      const partes = [], imagens = []; let semTexto = 0;
      const n = Math.min(doc.numPages, MAX_PAG);
      for (let i = 1; i <= n; i++) {
        prog && prog(`Lendo a página ${i} de ${n}…`);
        const pg = await doc.getPage(i);
        const t = layoutTexto(itensPdfjs(await pg.getTextContent()));
        if (t.replace(/\s+/g, "").length < 60) { // página que é imagem: vai como foto
          semTexto++;
          if (imagens.length < MAX_IMG) {
            prog && prog(`Página ${i} é imagem: preparando a foto dela…`);
            const vp1 = pg.getViewport({ scale: 1 }), vp = pg.getViewport({ scale: Math.min(2.5, 1500 / Math.max(vp1.width, vp1.height)) });
            const c = document.createElement("canvas"); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
            const g2 = c.getContext("2d"); g2.fillStyle = "#fff"; g2.fillRect(0, 0, c.width, c.height);
            await pg.render({ canvasContext: g2, viewport: vp }).promise;
            imagens.push(await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.8)));
            partes.push(`(página ${i}: imagem ${imagens.length})`);
          }
        } else partes.push(t);
        pg.cleanup();
      }
      const texto = partes.join("\n\n--- página ---\n\n").replace(/\u0000/g, " ");
      if (!imagens.length && texto.replace(/\s+/g, "").length < 30) throw new Error("Não achei texto nesse PDF.");
      return { texto: texto.replace(/\s+/g, "").length >= 30 ? texto : "", imagens: imagens.filter(Boolean), paginas: doc.numPages, paginasImagem: semTexto, cortado: doc.numPages > MAX_PAG || semTexto > MAX_IMG };
    } finally { try { doc.destroy(); } catch (_) { } }
  }
  async function imagemBlob(img, lado = 1600) {
    const k = Math.min(1, lado / Math.max(img.width, img.height));
    const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
    const g2 = c.getContext("2d"); g2.fillStyle = "#fff"; g2.fillRect(0, 0, c.width, c.height); g2.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.85));
  }

  // nomes das matérias: "Anatomía Patológica II" casa com "ANATOMIA PATOLOGICA"
  const ROMANOS = { i: "1", ii: "2", iii: "3", iv: "4", v: "5", vi: "6" };
  const palavrasMat = (s) => semAcento(s).replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean).map((w) => ROMANOS[w] || w)
    .filter((w) => !["de", "da", "do", "la", "el", "en", "e", "y"].includes(w));
  /** Índice da matéria do aluno que corresponde ao nome do documento (ou -1). */
  function casarMateria(nome, materias) {
    const A = palavrasMat(nome).filter((w) => !/^\d+$/.test(w)); if (!A.length) return -1;
    let melhor = -1, nota = 0;
    (materias || []).forEach((m, i) => {
      const B = palavrasMat(m).filter((w) => !/^\d+$/.test(w)); if (!B.length) return;
      const igual = (a, b) => a === b || (a.length >= 5 && b.length >= 5 && (a.startsWith(b.slice(0, 5)) || b.startsWith(a.slice(0, 5))));
      const n = A.filter((a) => B.some((b) => igual(a, b))).length;
      // o documento costuma usar o nome curto ("GESTION" = "Gestión en Salud II"): pesa mais cobrir as palavras do documento
      const s = 0.6 * n / A.length + 0.4 * n / B.length;
      if (n && s > nota) { nota = s; melhor = i; }
    });
    return nota >= 0.55 ? melhor : -1;
  }
  /**
   * Tabela de revisão: nada é salvo antes do aluno confirmar.
   * provas: [{materia, disciplina_id?, tipo, modalidade, data, hora}]; disc: [{id, nome}]
   */
  function revisaoHTML(provas, disc) {
    if (!provas.length) return `<div class="empty">A IA não achou provas para a sua turma nesse arquivo.</div>`;
    const ids = (disc || []).map((d) => d.id), nomes = (disc || []).map((d) => d.nome);
    const linhas = provas.map((p, i) => {
      const k = p.disciplina_id != null && ids.includes(p.disciplina_id) ? p.disciplina_id : p.disciplina_id === null ? "" : (ids[casarMateria(p.materia, nomes)] ?? "");
      const usar = typeof p.ok === "boolean" ? p.ok && k !== "" : k !== "";
      return `<tr data-rev="${i}"><td><input type="checkbox" data-k="ok" ${usar ? "checked" : ""} aria-label="Importar ${esc(p.materia)}"></td>
        <td><span class="rev-doc">${esc(p.materia)}</span><select data-k="disc" aria-label="Matéria do painel para ${esc(p.materia)}"><option value="">Não importar</option>${(disc || []).map((d) => `<option value="${esc(d.id)}" ${String(d.id) === String(k) ? "selected" : ""}>${esc(d.nome)}</option>`).join("")}</select></td>
        <td><select data-k="tipo" aria-label="Prova">${["P1", "P2", "Final"].map((t) => `<option ${t === p.tipo ? "selected" : ""}>${t}</option>`).join("")}</select></td>
        <td><select data-k="mod" aria-label="Teórica ou prática"><option value="teorica">teórica</option><option value="pratica" ${p.modalidade === "pratica" ? "selected" : ""}>prática</option></select></td>
        <td><input type="date" data-k="data" value="${esc(p.data || "")}" aria-label="Data"></td>
        <td><input type="time" data-k="hora" value="${esc(p.hora || "")}" aria-label="Hora"></td></tr>`;
    }).join("");
    return `<div class="tablewrap rev-wrap"><table class="rev"><thead><tr><th>Usar</th><th>Matéria (no documento → no painel)</th><th>Prova</th><th>Tipo</th><th>Data</th><th>Hora</th></tr></thead><tbody>${linhas}</tbody></table></div>`;
  }
  /** Lê a tabela de revisão: só as linhas marcadas, com matéria e data válidas. */
  function lerRevisao(box) {
    const out = [];
    box.querySelectorAll("tr[data-rev]").forEach((tr) => {
      const v = (k) => tr.querySelector(`[data-k="${k}"]`);
      if (!v("ok").checked || !v("disc").value || !/^\d{4}-\d{2}-\d{2}$/.test(v("data").value)) return;
      out.push({ disciplina_id: +v("disc").value, tipo: v("tipo").value, modalidade: v("mod").value === "pratica" ? "pratica" : "teorica", data: v("data").value, hora: /^\d{2}:\d{2}/.test(v("hora").value) ? v("hora").value.slice(0, 5) : null });
    });
    // a mesma prova duas vezes: fica a última
    const m = new Map(); out.forEach((p) => m.set(`${p.disciplina_id}|${p.tipo}|${p.modalidade}`, p));
    return [...m.values()];
  }

  const API = { layoutTexto, itensPdfjs, tipoDoArquivo, nomeDoTema, prepararCalendario, prepararDocumento, casarMateria, revisaoHTML, lerRevisao, MIMES };
  g.Leitor = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
